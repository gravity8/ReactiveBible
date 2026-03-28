const { app, BrowserWindow, ipcMain, screen, dialog, powerSaveBlocker } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Load .env — check multiple locations in order of priority.
// Avoid app.getPath() here — it can throw before app is ready on some platforms.
try {
  const envPaths = [
    path.join(__dirname, '..', '.env'),                        // dev (project root)
    path.join(process.resourcesPath || __dirname, '.env'),     // packaged resources
  ];
  for (const envPath of envPaths) {
    try {
      if (fs.existsSync(envPath)) {
        require('dotenv').config({ path: envPath });
        console.log(`[app] Loaded .env from ${envPath}`);
        break;
      }
    } catch {}
  }
} catch (e) {
  console.error('[app] Failed to load .env:', e.message);
}
const http = require('http');
const SyncServer = require('./sync-server');
const SyncClient = require('./sync-client');
const bibleFetcher = require('./bible-fetcher');
const { WebSocketServer } = require('ws');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Writable directory for caches — app bundle is read-only on macOS.
function getUserDataDir() {
  return app.isPackaged ? app.getPath('userData') : path.join(__dirname, '..');
}

// Prevent EPIPE and other uncaught errors from crashing the app.
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') {
    console.error('[app] Suppressed pipe error:', err.code);
    return;
  }
  console.error('[app] Uncaught exception:', err);
});

let mainWindow = null;
let displayWindow = null;
let detectorProcess = null;
let ffmpegProcess = null;
let currentDisplayBg = null;
let currentDisplayTheme = 'midnight';
const THEMES = require('./themes.cjs');
let powerSaveId = null;
let networkDisplayServer = null;
let networkDisplayWss = null;
let networkDisplayClients = new Set();
const NETWORK_DISPLAY_PORT = 3001;

// ── Collaboration state ──
let syncServer = null;
let syncClient = null;
let sessionRole = null; // 'host' | 'client' | null
let cachedAppState = {}; // Local copy of app state for sync

// Resolve paths — works both in dev and packaged mode.
function resolvePath(relative) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, relative);
  }
  return path.join(__dirname, '..', relative);
}

function getConfig() {
  const configPath = resolvePath('config.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.error('Failed to load config:', e);
    return {};
  }
}

// Cache of loaded Bible translations: { "KJV": {...}, "NLT": {...}, ... }
const bibleCache = {};

function loadTranslation(code) {
  if (bibleCache[code]) return bibleCache[code];

  const lower = code.toLowerCase();
  const filePath = resolvePath(`bibles/${lower}.json`);
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      bibleCache[code] = data;
      console.log(`Loaded ${code} from ${filePath}`);
      return data;
    }
  } catch (e) {
    console.error(`Failed to load ${code}:`, e);
  }
  return null;
}

function createMainWindow() {
  const iconPath = path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#0d0d0d',
    icon: iconPath,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: isDev,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopDetector();
    if (displayWindow) displayWindow.close();
    app.quit();
  });
}

function createDisplayWindow(externalDisplay) {
  const bounds = externalDisplay
    ? externalDisplay.bounds
    : { x: 100, y: 100, width: 1280, height: 720 };

  displayWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    backgroundColor: '#000000',
    frame: false,
    alwaysOnTop: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    displayWindow.loadURL('http://localhost:5173/display.html');
  } else {
    displayWindow.loadFile(path.join(__dirname, 'display.html'));
  }

  // Send current background and theme once the page is ready.
  displayWindow.webContents.once('did-finish-load', () => {
    if (currentDisplayBg && displayWindow) {
      displayWindow.webContents.send('set-background', currentDisplayBg);
    }
    const theme = THEMES.find((t) => t.id === currentDisplayTheme);
    if (theme && displayWindow) {
      displayWindow.webContents.send('set-theme', theme.styles);
    }
  });

  displayWindow.on('closed', () => {
    displayWindow = null;
    if (mainWindow) mainWindow.webContents.send('display-closed');
  });
}

// ── Detector process management ──────────────────────

function startDetector(sampleRate) {
  if (detectorProcess) return;

  const binaryName = process.platform === 'win32'
    ? 'sermon-verse-detector.exe'
    : 'sermon-verse-detector';
  const detectorPath = app.isPackaged
    ? path.join(process.resourcesPath, 'bin', binaryName)
    : path.join(__dirname, '..', 'build', binaryName);
  const configPath = resolvePath('config.json');

  // Pre-flight checks — verify dependencies exist before spawning.
  if (!fs.existsSync(detectorPath)) {
    const msg = 'Detector binary not found. Run cmake --build build/ first.';
    console.error('[app]', msg);
    if (mainWindow) mainWindow.webContents.send('error', msg);
    return;
  }

  // Use bundled ffmpeg from ffmpeg-static.
  const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
  if (!fs.existsSync(ffmpegPath)) {
    const msg = 'Bundled ffmpeg binary not found.';
    console.error('[app]', msg);
    if (mainWindow) mainWindow.webContents.send('error', msg);
    return;
  }

  // Prevent system sleep while transcribing.
  if (powerSaveId === null) {
    powerSaveId = powerSaveBlocker.start('prevent-app-suspension');
    console.log('[power] Sleep blocker started');
  }

  // ffmpeg resamples browser audio (typically 48kHz) to 16kHz mono f32le.
  ffmpegProcess = spawn(ffmpegPath, [
    '-f', 'f32le',
    '-ar', String(sampleRate || 48000),
    '-ac', '1',
    '-i', 'pipe:0',
    '-ar', '16000',
    '-ac', '1',
    '-f', 'f32le',
    'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'ignore'] });

  // Absorb write errors on ffmpeg stdin (prevents EPIPE crash if process dies).
  ffmpegProcess.stdin.on('error', (err) => {
    console.error('[ffmpeg] stdin error:', err.code);
  });

  ffmpegProcess.on('error', (err) => {
    console.error('[ffmpeg] process error:', err);
    if (mainWindow) mainWindow.webContents.send('error', `FFmpeg failed: ${err.message}`);
  });

  detectorProcess = spawn(detectorPath, [configPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: resolvePath('.'),
    env: {
      ...process.env,
      BIBLE_CACHE_DIR: path.join(getUserDataDir(), 'bible_cache'),
    },
  });

  // Absorb write errors on detector stdin (prevents EPIPE crash if process dies).
  detectorProcess.stdin.on('error', (err) => {
    console.error('[detector] stdin error:', err.code);
  });

  // Pipe ffmpeg output → detector input.
  ffmpegProcess.stdout.pipe(detectorProcess.stdin);

  // Read detector stdout (JSON verse output).
  let stdoutBuffer = '';
  detectorProcess.stdout.on('data', (data) => {
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop(); // keep incomplete line
    for (const line of lines) {
      if (line.trim()) {
        try {
          const parsed = JSON.parse(line.trim());
          if (parsed.event === 'translation_change') {
            // Translation change event from detector.
            if (mainWindow) mainWindow.webContents.send('translation-changed', parsed.translation);
          } else {
            // Verse detection.
            if (mainWindow) mainWindow.webContents.send('verse-detected', parsed);
          }
        } catch (e) {
          // Not JSON — ignore.
        }
      }
    }
  });

  // Read detector stderr (logs — transcript, pipeline, etc.).
  let stderrBuffer = '';
  detectorProcess.stderr.on('data', (data) => {
    stderrBuffer += data.toString();
    const lines = stderrBuffer.split('\n');
    stderrBuffer = lines.pop();
    for (const line of lines) {
      if (line.trim()) {
        // Extract whisper transcript lines.
        const whisperMatch = line.match(/\[whisper\] "(.+)"/);
        if (whisperMatch) {
          if (mainWindow) mainWindow.webContents.send('transcript', whisperMatch[1]);
        }
        // Send all logs for debug panel.
        if (mainWindow) mainWindow.webContents.send('log', line.trim());
      }
    }
  });

  detectorProcess.on('close', (code) => {
    console.log('Detector exited with code', code);
    detectorProcess = null;
    ffmpegProcess = null;
    isTranscribing = false;
    if (mainWindow) mainWindow.webContents.send('transcription-stopped');
  });

  detectorProcess.on('error', (err) => {
    console.error('Detector error:', err);
    if (mainWindow) mainWindow.webContents.send('error', `Detector failed: ${err.message}`);
  });

  isTranscribing = true;
}

function stopDetector() {
  if (ffmpegProcess) {
    // Unpipe before killing to prevent write-after-close errors.
    try { ffmpegProcess.stdout.unpipe(); } catch {}
    try { ffmpegProcess.stdin.end(); } catch {}
    ffmpegProcess.kill('SIGTERM');
    ffmpegProcess = null;
  }
  if (detectorProcess) {
    // Remove listeners to prevent processing after stop.
    detectorProcess.stdout.removeAllListeners();
    detectorProcess.stderr.removeAllListeners();
    detectorProcess.removeAllListeners();
    try { detectorProcess.stdin.end(); } catch {}
    detectorProcess.kill('SIGTERM');
    detectorProcess = null;
  }
  isTranscribing = false;

  // Release sleep blocker if no session is active either.
  if (powerSaveId !== null && !syncServer && !syncClient) {
    powerSaveBlocker.stop(powerSaveId);
    powerSaveId = null;
    console.log('[power] Sleep blocker released');
  }
}

// ── IPC handlers ─────────────────────────────────────

ipcMain.handle('start-transcription', (event, sampleRate) => {
  startDetector(sampleRate);
  return { success: true };
});

ipcMain.handle('stop-transcription', () => {
  stopDetector();
  return { success: true };
});

ipcMain.on('send-audio', (event, audioBuffer) => {
  if (ffmpegProcess && ffmpegProcess.stdin.writable && !ffmpegProcess.killed) {
    try {
      ffmpegProcess.stdin.write(Buffer.from(audioBuffer));
    } catch (err) {
      // Swallow write errors — process may have just died.
    }
  }
});

ipcMain.handle('send-to-display', (event, verseData) => {
  // Display window (projector).
  if (displayWindow) {
    displayWindow.webContents.send('show-verse', verseData);
  }
  // Network displays (smart TVs, tablets, browsers).
  broadcastToNetworkDisplays({ type: 'verse', ...verseData });
});

ipcMain.handle('clear-display', () => {
  if (displayWindow) {
    displayWindow.webContents.send('clear-verse');
  }
  broadcastToNetworkDisplays({ type: 'clear' });
});

ipcMain.handle('open-display-window', () => {
  if (displayWindow) {
    displayWindow.focus();
    return;
  }
  const displays = screen.getAllDisplays();
  const external = displays.find(d => d.id !== screen.getPrimaryDisplay().id);
  createDisplayWindow(external || null);
});

ipcMain.handle('close-display-window', () => {
  if (displayWindow) displayWindow.close();
});

ipcMain.handle('pick-display-bg', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose display background',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  // Read the file and return as data URL so it works in the display window.
  const filePath = result.filePaths[0];
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  const data = fs.readFileSync(filePath);
  return `data:${mime};base64,${data.toString('base64')}`;
});

ipcMain.handle('send-display-bg', (event, bgDataUrl) => {
  currentDisplayBg = bgDataUrl;
  if (displayWindow) {
    displayWindow.webContents.send('set-background', bgDataUrl);
  }
  broadcastToNetworkDisplays({ type: 'background', bg: bgDataUrl });
});

ipcMain.handle('send-display-theme', (event, themeId) => {
  const theme = THEMES.find((t) => t.id === themeId);
  if (!theme) return;
  currentDisplayTheme = themeId;
  if (displayWindow) {
    displayWindow.webContents.send('set-theme', theme.styles);
  }
  broadcastToNetworkDisplays({ type: 'theme', styles: theme.styles });
});

ipcMain.handle('get-displays', () => {
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || `Display ${i + 1}`,
    width: d.size.width,
    height: d.size.height,
    primary: d.id === screen.getPrimaryDisplay().id,
  }));
});

ipcMain.handle('get-config', () => {
  return getConfig();
});

ipcMain.handle('set-mode', (event, mode) => {
  // Update config.json with new mode.
  const configPath = resolvePath('config.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.mode = mode;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('Failed to update config mode:', e);
    return { success: false, error: e.message };
  }

  // If currently transcribing, restart the detector so it picks up the new mode.
  if (detectorProcess) {
    stopDetector();
    // Brief delay to let processes fully exit before restarting.
    setTimeout(() => {
      startDetector(48000);
      if (mainWindow) mainWindow.webContents.send('log', `[app] Switched to ${mode} mode — detector restarted`);
    }, 200);
  }

  return { success: true };
});

ipcMain.handle('search-verse', (event, query, translation) => {
  const code = (translation || 'KJV').toUpperCase();
  let bibleData = loadTranslation(code);

  // If translation isn't available locally, return an error so the frontend can try online.
  if (!bibleData) {
    console.log(`${code} not available locally`);
    return { error: `${code} not available locally`, notLocal: true };
  }

  // Parse "Book Chapter:Verse" format. Supports multi-word books like "1 Samuel".
  const match = query.match(/^(\d?\s*[a-zA-Z][a-zA-Z\s]*?)\s+(\d+)(?::(\d+)(?:-(\d+))?)?$/);
  if (!match) return { error: 'Invalid format. Use: John 3:16' };

  const bookQuery = match[1].trim().toLowerCase();
  const chapter = parseInt(match[2]);
  const verseStart = match[3] ? parseInt(match[3]) : null;
  const verseEnd = match[4] ? parseInt(match[4]) : null;

  // Find book in data.
  const bookKeys = Object.keys(bibleData);
  const bookKey = bookKeys.find(k => k.toLowerCase().startsWith(bookQuery));
  if (!bookKey) return { error: `Book "${match[1]}" not found` };

  const chapterData = bibleData[bookKey]?.[String(chapter)];
  if (!chapterData) return { error: `${bookKey} ${chapter} not found in ${code}` };

  // Clean verse text — some local files have HTML artifacts baked in.
  // Only strip HTML and control chars. Do NOT strip [brackets] — AMPC uses
  // them for amplified text which is intentional content.
  function cleanLocal(text) {
    return text
      .replace(/<[^>]+>/g, '')           // Complete HTML tags
      .replace(/<[^>]*$/g, '')           // Partial tags at end (e.g. <span class="verse v17")
      .replace(/^[^<]*>/g, '')           // Partial close tags at start
      .replace(/<\S[^]*$/g, '')          // Any leftover < fragment at end
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (verseStart) {
    const verses = [];
    const end = verseEnd || verseStart;
    for (let v = verseStart; v <= end; v++) {
      const text = chapterData[String(v)];
      if (text) verses.push({ verse: v, text: cleanLocal(text) });
    }
    if (verses.length === 0) return { error: `Verse ${verseStart} not found` };
    return {
      reference: verseEnd
        ? `${bookKey} ${chapter}:${verseStart}-${verseEnd}`
        : `${bookKey} ${chapter}:${verseStart}`,
      book: bookKey,
      chapter,
      verses,
      translation: code,
    };
  }

  // Return full chapter.
  const verses = Object.entries(chapterData)
    .map(([v, text]) => ({ verse: parseInt(v), text: cleanLocal(text) }))
    .sort((a, b) => a.verse - b.verse);
  return { reference: `${bookKey} ${chapter}`, book: bookKey, chapter, verses, translation: code };
});

// Fetch a chapter online from YouVersion (for translations not available locally).
ipcMain.handle('fetch-chapter-online', async (event, { book, chapter, translation }) => {
  try {
    const result = await bibleFetcher.fetchChapter(book, chapter, translation);

    // Cache the fetched chapter locally so future searches are instant.
    if (!bibleCache[translation]) bibleCache[translation] = {};
    if (!bibleCache[translation][book]) bibleCache[translation][book] = {};
    if (!bibleCache[translation][book][String(chapter)]) bibleCache[translation][book][String(chapter)] = {};
    for (const v of result.verses) {
      bibleCache[translation][book][String(chapter)][String(v.verse)] = v.text;
    }

    // Also save to disk cache for persistence across restarts.
    const cacheDir = path.join(getUserDataDir(), 'bible_cache');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    const cachePath = path.join(cacheDir, `${translation}.json`);
    try {
      let existing = {};
      if (fs.existsSync(cachePath)) {
        existing = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      }
      if (!existing[book]) existing[book] = {};
      existing[book][String(chapter)] = {};
      for (const v of result.verses) {
        existing[book][String(chapter)][String(v.verse)] = v.text;
      }
      fs.writeFileSync(cachePath, JSON.stringify(existing, null, 2));
    } catch (e) {
      console.error('Failed to write cache:', e);
    }

    return {
      success: true,
      reference: `${book} ${chapter}`,
      book,
      chapter,
      verses: result.verses,
      translation,
      source: 'online',
    };
  } catch (err) {
    console.error('[fetch] Online fetch failed:', err.message);
    return { error: err.message };
  }
});

// Get list of translations available online.
ipcMain.handle('get-online-translations', () => {
  return bibleFetcher.getAvailableTranslations();
});

// ── Network Display Server ───────────────────────────
// Serves a web page on the local network that any browser/smart TV can open.

function getNetworkDisplayHtml() {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ReactiveBible Display</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
width:100vw;height:100vh;overflow:hidden;display:flex;align-items:center;justify-content:center;
background-size:cover;background-position:center}
#v{text-align:center;max-width:85vw;padding:40px 60px;border-radius:16px;
opacity:0;transform:translateY(20px);transition:all .6s cubic-bezier(.16,1,.3,1)}
#v.show{opacity:1;transform:translateY(0)}
#ref{color:#14b8a6;font-size:clamp(18px,3vw,32px);font-weight:700;margin-bottom:20px}
#txt{color:#fff;font-size:clamp(24px,4.5vw,48px);font-weight:300;line-height:1.5}
#tr{color:#666;font-size:clamp(12px,1.5vw,18px);margin-top:16px;text-transform:uppercase;letter-spacing:1px}
#status{position:fixed;top:10px;right:10px;font-size:11px;color:#333;padding:4px 8px;border-radius:4px}
#status.on{color:#14b8a6}
</style></head><body>
<div id="v"><div id="ref"></div><div id="txt"></div><div id="tr"></div></div>
<div id="status">Connecting...</div>
<script>
const v=document.getElementById('v'),ref=document.getElementById('ref'),
txt=document.getElementById('txt'),tr=document.getElementById('tr'),
status=document.getElementById('status');
let ws,retry=1000,hasBg=false,curTheme=null;
function applyTheme(s){
  curTheme=s;
  if(!hasBg){document.body.style.cssText=s.body+'width:100vw;height:100vh;overflow:hidden;display:flex;align-items:center;justify-content:center;background-size:cover;background-position:center;font-family:-apple-system,BlinkMacSystemFont,\\'Segoe UI\\',system-ui,sans-serif;'}
  ref.style.cssText=(s.reference||'')+'font-size:clamp(18px,3vw,32px);font-weight:700;margin-bottom:20px;';
  txt.style.cssText=(s.text||'')+'font-size:clamp(24px,4.5vw,48px);line-height:1.5;';
  tr.style.cssText=(s.translation||'')+'font-size:clamp(12px,1.5vw,18px);margin-top:16px;text-transform:uppercase;letter-spacing:1px;';
  var isVis=v.classList.contains('show');
  v.style.cssText=(s.container||'')+'text-align:center;max-width:85vw;padding:40px 60px;opacity:'+(isVis?1:0)+';transform:translateY('+(isVis?'0':'20px')+');transition:all .6s cubic-bezier(.16,1,.3,1);';
  if(hasBg){v.style.background='rgba(0,0,0,0.55)';v.style.backdropFilter='blur(2px)'}
}
function connect(){
  const proto=location.protocol==='https:'?'wss':'ws';
  ws=new WebSocket(proto+'://'+location.host+'/ws');
  ws.onopen=()=>{status.textContent='Connected';status.className='on';retry=1000};
  ws.onmessage=(e)=>{
    const msg=JSON.parse(e.data);
    if(msg.type==='verse'){
      v.classList.remove('show');
      setTimeout(()=>{ref.textContent=msg.reference||'';txt.textContent=msg.text||'';
      tr.textContent=msg.active||'';v.classList.add('show')},100);
    }else if(msg.type==='clear'){v.classList.remove('show')}
    else if(msg.type==='theme'){applyTheme(msg.styles)}
    else if(msg.type==='background'){
      if(msg.bg){hasBg=true;document.body.style.backgroundImage='url('+msg.bg+')';
      v.style.background='rgba(0,0,0,0.55)';v.style.backdropFilter='blur(2px)'}
      else{hasBg=false;document.body.style.backgroundImage='none';
      if(curTheme)applyTheme(curTheme);else{document.body.style.background='#000';}
      v.style.backdropFilter='none'}}
  };
  ws.onclose=()=>{status.textContent='Reconnecting...';status.className='';
  setTimeout(connect,retry);retry=Math.min(retry*2,10000)};
  ws.onerror=()=>ws.close();
}
connect();
</script></body></html>`;
}

function startNetworkDisplay() {
  if (networkDisplayServer) return;

  networkDisplayServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(getNetworkDisplayHtml());
  });

  networkDisplayWss = new WebSocketServer({ server: networkDisplayServer });

  networkDisplayWss.on('connection', (ws) => {
    // Reject if too many clients connected.
    if (networkDisplayClients.size >= 50) {
      ws.close(1013, 'Too many clients');
      return;
    }

    ws.isAlive = true;
    networkDisplayClients.add(ws);
    console.log(`[network-display] Client connected (${networkDisplayClients.size} total)`);

    // Send current state.
    const theme = THEMES.find((t) => t.id === currentDisplayTheme);
    if (theme) {
      ws.send(JSON.stringify({ type: 'theme', styles: theme.styles }));
    }
    if (currentDisplayBg) {
      ws.send(JSON.stringify({ type: 'background', bg: currentDisplayBg }));
    }

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('close', () => {
      networkDisplayClients.delete(ws);
      console.log(`[network-display] Client disconnected (${networkDisplayClients.size} total)`);
    });
    ws.on('error', () => networkDisplayClients.delete(ws));
  });

  // Ping clients every 30s to detect zombie connections.
  networkDisplayWss._pingInterval = setInterval(() => {
    for (const ws of networkDisplayClients) {
      if (!ws.isAlive) {
        networkDisplayClients.delete(ws);
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch { networkDisplayClients.delete(ws); }
    }
  }, 30000);

  networkDisplayServer.listen(NETWORK_DISPLAY_PORT, '0.0.0.0', () => {
    console.log(`[network-display] Server running on port ${NETWORK_DISPLAY_PORT}`);
  });
}

function stopNetworkDisplay() {
  if (networkDisplayWss) {
    if (networkDisplayWss._pingInterval) {
      clearInterval(networkDisplayWss._pingInterval);
      networkDisplayWss._pingInterval = null;
    }
    for (const ws of networkDisplayClients) {
      try { ws.terminate(); } catch {}
    }
    networkDisplayClients.clear();
    networkDisplayWss.close();
    networkDisplayWss = null;
  }
  if (networkDisplayServer) {
    networkDisplayServer.close();
    networkDisplayServer = null;
  }
}

function broadcastToNetworkDisplays(message) {
  const data = JSON.stringify(message);
  for (const ws of networkDisplayClients) {
    if (ws.readyState === 1) {
      try { ws.send(data); } catch {}
    }
  }
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

// IPC: Start/stop network display.
ipcMain.handle('start-network-display', () => {
  startNetworkDisplay();
  return { url: `http://${getLocalIP()}:${NETWORK_DISPLAY_PORT}`, port: NETWORK_DISPLAY_PORT, clients: networkDisplayClients.size };
});

ipcMain.handle('stop-network-display', () => {
  stopNetworkDisplay();
  return { success: true };
});

ipcMain.handle('get-network-display-info', () => {
  return {
    running: !!networkDisplayServer,
    url: networkDisplayServer ? `http://${getLocalIP()}:${NETWORK_DISPLAY_PORT}` : null,
    clients: networkDisplayClients.size,
  };
});

// ── Session / Collaboration IPC ──────────────────────

// Host starts a session.
ipcMain.handle('start-session', async (event, name) => {
  if (syncServer) return { error: 'Session already running' };
  try {
    syncServer = new SyncServer({
      port: 3000,
      onLog: (msg) => {
        if (mainWindow) mainWindow.webContents.send('log', msg);
      },
    });

    // Handle actions from remote clients.
    syncServer.onAction((msg, clientInfo) => {
      // Forward to renderer to apply the action.
      if (mainWindow) {
        mainWindow.webContents.send('remote-action', {
          field: msg.field,
          value: msg.value,
          action: msg.action,
          from: clientInfo.name,
        });
      }
      // Broadcast the state update to all clients.
      syncServer.broadcast({
        type: 'update',
        field: msg.field,
        value: msg.value,
        from: clientInfo.name,
      });
    });

    const info = await syncServer.start();
    sessionRole = 'host';
    return { success: true, ...info };
  } catch (err) {
    syncServer = null;
    return { error: err.message };
  }
});

// Host stops session.
ipcMain.handle('stop-session', () => {
  if (syncServer) {
    syncServer.stop();
    syncServer = null;
  }
  if (syncClient) {
    syncClient.disconnect();
    syncClient = null;
  }
  sessionRole = null;
  return { success: true };
});

// Client joins a session.
ipcMain.handle('join-session', async (event, { host, pin, name }) => {
  if (syncClient) return { error: 'Already in a session' };

  syncClient = new SyncClient({
    onLog: (msg) => {
      if (mainWindow) mainWindow.webContents.send('log', msg);
    },
  });

  syncClient.onSync((state, clients) => {
    if (mainWindow) mainWindow.webContents.send('session-sync', { state, clients });
  });

  syncClient.onUpdate((field, value) => {
    if (mainWindow) mainWindow.webContents.send('session-update', { field, value });
  });

  syncClient.onClientsChanged((clients, event) => {
    if (mainWindow) mainWindow.webContents.send('session-clients', { clients, event: event.type });
  });

  syncClient.onActionRejected((field, lockedBy) => {
    if (mainWindow) mainWindow.webContents.send('action-rejected', { field, lockedBy });
  });

  syncClient.onHostLost(() => {
    if (mainWindow) mainWindow.webContents.send('host-lost');
  });

  syncClient.onDisconnect(() => {
    if (mainWindow) mainWindow.webContents.send('session-disconnected');
  });

  syncClient.onError((msg) => {
    if (mainWindow) mainWindow.webContents.send('session-error', msg);
  });

  syncClient.onBecomeHost((state, pin) => {
    if (mainWindow) mainWindow.webContents.send('become-host', { state, pin });
  });

  try {
    await syncClient.connect({ host, port: 3000, pin, name });
    sessionRole = 'client';
    return { success: true };
  } catch (err) {
    syncClient = null;
    return { error: err.message };
  }
});

// Leave a session (client).
ipcMain.handle('leave-session', () => {
  if (syncClient) {
    syncClient.disconnect();
    syncClient = null;
  }
  sessionRole = null;
  return { success: true };
});

// Send action to host (from client).
ipcMain.handle('sync-action', (event, { field, value }) => {
  if (syncClient) {
    syncClient.sendAction(field, value);
  }
});

// Transfer host role to a connected client (host only).
ipcMain.handle('transfer-host', (event, targetId) => {
  if (!syncServer) return { error: 'Not hosting' };
  // Send transfer message through the server.
  for (const [ws, info] of syncServer.clients) {
    if (info.id === targetId) {
      ws.send(JSON.stringify({
        type: 'become-host',
        state: syncServer.state,
        pin: syncServer.pin,
      }));
      // Stop our server after a brief delay to let the message deliver.
      setTimeout(() => {
        syncServer.stop();
        syncServer = null;
        sessionRole = null;
        if (mainWindow) mainWindow.webContents.send('session-transferred');
      }, 500);
      return { success: true };
    }
  }
  return { error: 'Client not found' };
});

// Host broadcasts state update to all clients.
ipcMain.handle('sync-broadcast', (event, { field, value }) => {
  if (syncServer) {
    syncServer.broadcast({ type: 'update', field, value });
  }
});

// Update cached state (host keeps this for new joiners).
ipcMain.handle('sync-state', (event, state) => {
  cachedAppState = state;
  if (syncServer) syncServer.setState(state);
});

// Auto-promote: client becomes host.
// Accepts either a string (name) or object { name, pin } for host transfer.
ipcMain.handle('promote-to-host', async (event, arg) => {
  const name = typeof arg === 'string' ? arg : arg?.name;
  const pin = typeof arg === 'object' ? arg?.pin : undefined;

  // Clean up old client connection.
  if (syncClient) {
    syncClient.disconnect();
    syncClient = null;
  }

  // Start a new server (reuse pin if transferring from another host).
  try {
    syncServer = new SyncServer({
      port: 3000,
      pin,
      onLog: (msg) => {
        if (mainWindow) mainWindow.webContents.send('log', msg);
      },
    });

    syncServer.onAction((msg, clientInfo) => {
      if (mainWindow) {
        mainWindow.webContents.send('remote-action', {
          field: msg.field,
          value: msg.value,
          action: msg.action,
          from: clientInfo.name,
        });
      }
      syncServer.broadcast({
        type: 'update',
        field: msg.field,
        value: msg.value,
        from: clientInfo.name,
      });
    });

    // Use cached state so the new host has the latest data.
    syncServer.setState(cachedAppState);

    const info = await syncServer.start();
    sessionRole = 'host';
    return { success: true, ...info };
  } catch (err) {
    syncServer = null;
    return { error: err.message };
  }
});

ipcMain.handle('get-session-info', () => {
  return {
    role: sessionRole,
    ip: syncServer?._getLocalIP() || null,
    pin: syncServer?.pin || null,
    clients: syncServer?.getConnectedClients() || [],
  };
});

// ── Auto-update ──────────────────────────────────────

function setupAutoUpdater() {
  if (isDev) return; // Skip in development.

  try {
    const { autoUpdater } = require('electron-updater');

    // Point to the PUBLIC releases repo (source repo is private).
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'gravity8',
      repo: 'reactivebible-releases',
    });

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      console.log('[updater] Update available:', info.version);
      if (mainWindow) mainWindow.webContents.send('log', `Update found: v${info.version}. Downloading...`);
    });

    autoUpdater.on('update-not-available', () => {
      console.log('[updater] App is up to date.');
    });

    autoUpdater.on('download-progress', (progress) => {
      const pct = Math.round(progress.percent);
      if (mainWindow) mainWindow.webContents.send('log', `Downloading update: ${pct}%`);
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('[updater] Update downloaded:', info.version);
      if (mainWindow) {
        mainWindow.webContents.send('log', `v${info.version} ready — restart to install.`);
      }
      // Prompt user via dialog.
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Ready',
        message: `ReactiveBible v${info.version} has been downloaded.`,
        detail: 'Restart now to install the update.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
      }).then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
    });

    autoUpdater.on('error', (err) => {
      console.error('[updater] Error:', err.message);
    });

    autoUpdater.checkForUpdatesAndNotify();
  } catch (err) {
    console.error('[updater] Failed to initialize:', err.message);
  }
}

// ── App lifecycle ────────────────────────────────────

app.whenReady().then(() => {
  createMainWindow();
  setupAutoUpdater();
});

app.on('window-all-closed', () => {
  stopDetector();
  if (syncServer) syncServer.stop();
  if (syncClient) syncClient.disconnect();
  app.quit();
});

app.on('before-quit', () => {
  stopDetector();
  if (syncServer) syncServer.stop();
  if (syncClient) syncClient.disconnect();
});
