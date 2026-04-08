const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const profileAnalyzer = require('./profile-analyzer');
const profileManager = require('./profile-manager');

let currentProcess = null;
let cancelled = false;

// Find yt-dlp binary: bundled first, then system PATH.
function findYtDlp(resourcesPath) {
  const bundled = path.join(resourcesPath || '', 'bin',
    process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  if (fs.existsSync(bundled)) return bundled;

  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = execSync(`${cmd} yt-dlp`, { encoding: 'utf8' }).trim();
    if (result) return result.split('\n')[0];
  } catch {}

  return null;
}

// Find whisper-transcriber binary (fallback only).
function findTranscriber(appPath, resourcesPath) {
  const name = process.platform === 'win32' ? 'whisper-transcriber.exe' : 'whisper-transcriber';
  const bundled = path.join(resourcesPath || '', 'bin', name);
  if (fs.existsSync(bundled)) return bundled;
  const dev = path.join(appPath, '..', 'build', name);
  if (fs.existsSync(dev)) return dev;
  return null;
}

// Find Whisper model (fallback only).
function findModel(appPath, resourcesPath) {
  const paths = [
    path.join(resourcesPath || '', 'models', 'ggml-small.en.bin'),
    path.join(appPath, '..', 'models', 'ggml-small.en.bin'),
    path.join(resourcesPath || '', 'models', 'ggml-base.en.bin'),
    path.join(appPath, '..', 'models', 'ggml-base.en.bin'),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Find ffmpeg binary (fallback only).
function findFfmpeg() {
  try {
    return require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
  } catch {
    return null;
  }
}

// ── YouTube Captions (fast path) ──

// Fetch YouTube auto-generated captions via yt-dlp. Returns transcript text or null.
function fetchYouTubeCaptions(ytdlpPath, url, tempDir, index) {
  return new Promise((resolve, reject) => {
    const subBase = path.join(tempDir, `sub-${index}`);
    const args = [
      '--write-auto-sub',         // grab auto-generated captions
      '--sub-lang', 'en',         // English
      '--skip-download',          // don't download video/audio
      '--sub-format', 'vtt/srt/best',
      '-o', subBase,
      '--no-playlist',
      '--quiet',
      url,
    ];

    const proc = spawn(ytdlpPath, args);
    currentProcess = proc;

    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      currentProcess = null;
      if (cancelled) return reject(new Error('Cancelled'));

      // yt-dlp writes subtitle files with language suffix — find them.
      try {
        const files = fs.readdirSync(tempDir).filter(f =>
          f.startsWith(`sub-${index}`) && (f.endsWith('.vtt') || f.endsWith('.srt') || f.endsWith('.en.vtt') || f.endsWith('.en.srt'))
        );
        if (files.length > 0) {
          const subPath = path.join(tempDir, files[0]);
          const raw = fs.readFileSync(subPath, 'utf8');
          const text = parseSubtitleToText(raw);
          if (text && text.length > 100) {
            resolve(text);
            return;
          }
        }
      } catch {}

      // No captions found.
      resolve(null);
    });

    proc.on('error', (err) => {
      currentProcess = null;
      resolve(null); // Don't fail — fall back to Whisper.
    });
  });
}

// Fetch video title via yt-dlp.
function fetchVideoTitle(ytdlpPath, url) {
  return new Promise((resolve) => {
    try {
      const result = execSync(
        `"${ytdlpPath}" --get-title --no-playlist "${url}"`,
        { encoding: 'utf8', timeout: 15000 }
      ).trim();
      resolve(result || null);
    } catch {
      resolve(null);
    }
  });
}

// Parse VTT/SRT subtitle content into plain text.
function parseSubtitleToText(raw) {
  const lines = raw.split('\n');
  const textLines = [];
  const seen = new Set(); // deduplicate repeated caption lines

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip VTT header, timestamps, sequence numbers, style tags.
    if (!trimmed) continue;
    if (trimmed === 'WEBVTT') continue;
    if (trimmed.startsWith('Kind:') || trimmed.startsWith('Language:')) continue;
    if (trimmed.startsWith('NOTE')) continue;
    if (/^\d+$/.test(trimmed)) continue; // SRT sequence numbers
    if (/^\d{2}:\d{2}/.test(trimmed)) continue; // timestamps
    if (trimmed.startsWith('align:') || trimmed.startsWith('position:')) continue;

    // Strip HTML tags (<c>, <b>, etc.) and VTT positioning.
    let clean = trimmed
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();

    if (!clean || clean.length < 2) continue;

    // Deduplicate — YouTube VTT repeats lines across overlapping cues.
    if (seen.has(clean)) continue;
    seen.add(clean);

    textLines.push(clean);
  }

  return textLines.join(' ');
}

// ── Whisper Fallback (slow path) ──

function downloadAudio(ytdlpPath, url, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-x', '--audio-format', 'wav',
      '-o', outputPath,
      '--no-playlist', '--quiet',
      url,
    ];
    const proc = spawn(ytdlpPath, args);
    currentProcess = proc;

    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      currentProcess = null;
      if (cancelled) return reject(new Error('Cancelled'));
      if (code !== 0) return reject(new Error(`yt-dlp audio download failed (code ${code}): ${stderr.slice(-200)}`));
      const dir = path.dirname(outputPath);
      const base = path.basename(outputPath, path.extname(outputPath));
      const files = fs.readdirSync(dir).filter(f => f.startsWith(base));
      if (files.length > 0) {
        resolve(path.join(dir, files[0]));
      } else {
        reject(new Error('Downloaded audio file not found'));
      }
    });

    proc.on('error', (err) => { currentProcess = null; reject(err); });
  });
}

function resampleAudio(ffmpegPath, inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-i', inputPath, '-ar', '16000', '-ac', '1', '-y', outputPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    currentProcess = proc;

    proc.on('close', (code) => {
      currentProcess = null;
      if (cancelled) return reject(new Error('Cancelled'));
      if (code !== 0) return reject(new Error(`ffmpeg resample failed (code ${code})`));
      resolve(outputPath);
    });

    proc.on('error', reject);
  });
}

function transcribeAudio(transcriberPath, modelPath, audioPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(transcriberPath, [modelPath, audioPath]);
    currentProcess = proc;

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      currentProcess = null;
      if (cancelled) return reject(new Error('Cancelled'));
      if (code !== 0) return reject(new Error(`Transcription failed (code ${code}): ${stderr.slice(-200)}`));
      resolve(stdout);
    });

    proc.on('error', reject);
  });
}

// ── Main Calibration Pipeline ──

async function runCalibration({ name, urls, appPath, resourcesPath, biblesDir, onProgress }) {
  cancelled = false;

  const ytdlpPath = findYtDlp(resourcesPath);
  if (!ytdlpPath) throw new Error('yt-dlp not found. Install it: brew install yt-dlp (or download from github.com/yt-dlp/yt-dlp)');

  // Whisper tools are optional — only needed as fallback when captions unavailable.
  const transcriberPath = findTranscriber(appPath, resourcesPath);
  const modelPath = findModel(appPath, resourcesPath);
  const ffmpegPath = findFfmpeg();

  const tempDir = path.join(os.tmpdir(), `reactivebible-calibration-${uuidv4()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const total = urls.length;
  const transcripts = [];
  const sermons = [];
  let captionCount = 0;
  let whisperCount = 0;

  try {
    for (let i = 0; i < total; i++) {
      if (cancelled) throw new Error('Cancelled');

      const url = urls[i];

      // Step 1: Try YouTube captions first (fast — seconds).
      onProgress({
        phase: 'captions',
        current: i + 1,
        total,
        message: `Fetching captions for sermon ${i + 1}/${total}...`,
      });

      let transcript = await fetchYouTubeCaptions(ytdlpPath, url, tempDir, i);
      let title = await fetchVideoTitle(ytdlpPath, url);

      if (transcript) {
        captionCount++;
        transcripts.push(transcript);
        sermons.push({ url, title, method: 'youtube-captions', downloadedAt: new Date().toISOString() });
        continue;
      }

      // Step 2: No captions — fall back to Whisper transcription (slow).
      if (!transcriberPath || !modelPath || !ffmpegPath) {
        onProgress({
          phase: 'skip',
          current: i + 1,
          total,
          message: `Sermon ${i + 1}/${total}: no captions available and Whisper not found — skipping`,
        });
        continue;
      }

      onProgress({
        phase: 'download',
        current: i + 1,
        total,
        message: `No captions for sermon ${i + 1}/${total} — downloading audio (Whisper fallback)...`,
      });

      if (cancelled) throw new Error('Cancelled');

      const rawAudio = await downloadAudio(ytdlpPath, url, path.join(tempDir, `audio-${i}.wav`));

      if (cancelled) throw new Error('Cancelled');

      onProgress({
        phase: 'resample',
        current: i + 1,
        total,
        message: `Resampling audio ${i + 1}/${total}...`,
      });
      const resampledPath = path.join(tempDir, `audio-${i}-16k.wav`);
      await resampleAudio(ffmpegPath, rawAudio, resampledPath);

      if (cancelled) throw new Error('Cancelled');

      onProgress({
        phase: 'transcribe',
        current: i + 1,
        total,
        message: `Transcribing sermon ${i + 1}/${total} with Whisper (this may take a while)...`,
      });
      transcript = await transcribeAudio(transcriberPath, modelPath, resampledPath);
      whisperCount++;
      transcripts.push(transcript);
      sermons.push({ url, title, method: 'whisper', downloadedAt: new Date().toISOString() });
    }

    if (cancelled) throw new Error('Cancelled');
    if (transcripts.length === 0) throw new Error('No sermons could be transcribed. Check that the URLs are valid YouTube videos.');

    // Phase 2: Analyze all transcripts.
    onProgress({
      phase: 'analyze',
      current: total,
      total,
      message: `Analyzing patterns across ${transcripts.length} sermon${transcripts.length !== 1 ? 's' : ''}...`,
    });
    const analysisResult = profileAnalyzer.analyzeTranscripts(transcripts, biblesDir);

    // Build full profile.
    const id = profileManager.nameToId(name);
    const profile = {
      version: 1,
      id,
      name,
      createdAt: new Date().toISOString(),
      sermons,
      captionCount,
      whisperCount,
      ...analysisResult,
    };

    profileManager.saveProfile(profile);

    return { profileId: id, profile };

  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

function cancel() {
  cancelled = true;
  if (currentProcess) {
    try { currentProcess.kill(); } catch {}
    currentProcess = null;
  }
}

module.exports = {
  runCalibration,
  cancel,
};
