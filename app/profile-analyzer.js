const fs = require('fs');
const path = require('path');

// Canonical Bible book names for regex matching.
const BOOKS = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
  'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel', '1 Kings', '2 Kings',
  '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah', 'Esther',
  'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon',
  'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel',
  'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah',
  'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
  'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans',
  '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
  'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians',
  '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James',
  '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation',
];

// Build a regex that matches any book name (case-insensitive) followed by chapter:verse.
function buildVerseRefRegex() {
  // Sort longest first to avoid partial matches.
  const escaped = [...BOOKS].sort((a, b) => b.length - a.length)
    .map(b => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const bookPattern = escaped.join('|');
  // Match: Book <chapter>:<verse>, Book <chapter> <verse>, Book chapter <N> verse <N>
  return new RegExp(
    `(${bookPattern})\\s+(?:chapter\\s+)?(\\d{1,3})\\s*[:.\\s,]\\s*(?:verse\\s+)?(\\d{1,3})`,
    'gi'
  );
}

// Find all verse references in a transcript.
function findVerseReferences(text) {
  const regex = buildVerseRefRegex();
  const refs = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const book = normalizeBookName(match[1]);
    const chapter = parseInt(match[2]);
    const verse = parseInt(match[3]);
    if (book && chapter > 0 && verse > 0) {
      refs.push({
        book, chapter, verse,
        index: match.index,
        fullMatch: match[0],
      });
    }
  }
  return refs;
}

// Normalize a book name to canonical form.
function normalizeBookName(input) {
  const lower = input.toLowerCase().trim();
  for (const book of BOOKS) {
    if (book.toLowerCase() === lower) return book;
  }
  // Partial prefix match.
  for (const book of BOOKS) {
    if (book.toLowerCase().startsWith(lower) && lower.length >= 3) return book;
  }
  return null;
}

// Load all available Bible translations from the bibles directory.
function loadBibles(biblesDir) {
  const bibles = {};
  try {
    const files = fs.readdirSync(biblesDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const code = file.replace('.json', '').toUpperCase();
      try {
        bibles[code] = JSON.parse(fs.readFileSync(path.join(biblesDir, file), 'utf8'));
      } catch {}
    }
  } catch {}
  return bibles;
}

// Compute word overlap ratio between two strings.
function wordOverlap(a, b) {
  const wordsA = new Set(a.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  return overlap / Math.max(wordsA.size, wordsB.size);
}

// ── Translation Fingerprinting ──

function fingerprintTranslation(transcripts, bibles) {
  const scores = {}; // { "KJV": [0.8, 0.6, ...], "NLT": [...], ... }

  for (const transcript of transcripts) {
    const refs = findVerseReferences(transcript);

    for (const ref of refs) {
      // Extract ~100 words after the reference (the pastor quoting the verse).
      const afterRef = transcript.substring(ref.index + ref.fullMatch.length);
      const words = afterRef.split(/\s+/).slice(0, 50).join(' ');
      if (words.length < 20) continue; // too short to match

      for (const [code, bible] of Object.entries(bibles)) {
        const verseText = bible?.[ref.book]?.[String(ref.chapter)]?.[String(ref.verse)];
        if (!verseText) continue;

        const similarity = wordOverlap(words, verseText);
        if (!scores[code]) scores[code] = [];
        scores[code].push(similarity);
      }
    }
  }

  // Compute average score per translation.
  const distribution = {};
  let bestCode = null;
  let bestAvg = 0;
  let totalSamples = 0;

  for (const [code, values] of Object.entries(scores)) {
    if (values.length === 0) continue;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    distribution[code] = Math.round(avg * 100) / 100;
    totalSamples = Math.max(totalSamples, values.length);
    if (avg > bestAvg) {
      bestAvg = avg;
      bestCode = code;
    }
  }

  return {
    code: bestCode || 'KJV',
    confidence: Math.round(bestAvg * 100) / 100,
    distribution,
  };
}

// ── Citation Pattern Extraction ──

function extractCitationPatterns(transcripts) {
  const patternCounts = {};

  for (const transcript of transcripts) {
    const refs = findVerseReferences(transcript);
    for (const ref of refs) {
      // Get 10 words before the reference.
      const before = transcript.substring(Math.max(0, ref.index - 200), ref.index);
      const words = before.trim().split(/\s+/);
      // Try 3-5 word phrases from the end.
      for (let len = 3; len <= Math.min(6, words.length); len++) {
        const phrase = words.slice(-len).join(' ').toLowerCase().replace(/[^\w\s]/g, '').trim();
        if (phrase.length >= 8) {
          patternCounts[phrase] = (patternCounts[phrase] || 0) + 1;
        }
      }
    }
  }

  // Keep phrases that appear 3+ times.
  return Object.entries(patternCounts)
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([phrase]) => phrase);
}

// ── Book Frequency ──

function extractBookFrequency(transcripts) {
  const freq = {};
  for (const transcript of transcripts) {
    const refs = findVerseReferences(transcript);
    for (const ref of refs) {
      freq[ref.book] = (freq[ref.book] || 0) + 1;
    }
  }
  // Sort by frequency.
  return Object.fromEntries(
    Object.entries(freq).sort((a, b) => b[1] - a[1])
  );
}

// ── Theological Vocabulary ──

// Common English words to filter out.
const COMMON_WORDS = new Set([
  'the', 'and', 'that', 'have', 'for', 'not', 'with', 'you', 'this', 'but',
  'from', 'they', 'were', 'been', 'said', 'each', 'which', 'their', 'will',
  'other', 'about', 'many', 'then', 'them', 'some', 'could', 'into', 'time',
  'very', 'when', 'come', 'made', 'after', 'back', 'only', 'over', 'such',
  'also', 'your', 'just', 'because', 'people', 'would', 'there', 'something',
  'through', 'going', 'before', 'between', 'should', 'being', 'every', 'still',
  'really', 'actually', 'understand', 'together', 'something', 'everything',
  'everybody', 'somebody', 'whatever', 'anything', 'everyone', 'different',
  'important', 'beautiful', 'wonderful', 'beginning', 'situation', 'generation',
  'relationship', 'yesterday', 'tomorrow', 'morning', 'evening', 'tonight',
]);

function extractTheologicalVocabulary(transcripts) {
  const wordCounts = {};
  const sermonAppearance = {}; // which sermons each word appears in

  transcripts.forEach((transcript, idx) => {
    const words = transcript.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
    const seen = new Set();
    for (const word of words) {
      if (word.length < 8) continue;
      if (COMMON_WORDS.has(word)) continue;
      if (/^\d+$/.test(word)) continue;
      wordCounts[word] = (wordCounts[word] || 0) + 1;
      if (!seen.has(word)) {
        seen.add(word);
        sermonAppearance[word] = (sermonAppearance[word] || 0) + 1;
      }
    }
  });

  // Keep words appearing in 2+ sermons and 5+ total times.
  return Object.entries(wordCounts)
    .filter(([word, count]) => count >= 5 && (sermonAppearance[word] || 0) >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([word]) => word);
}

// ── Build Extension Strings ──

function buildWhisperExtension(profile) {
  const parts = [];

  // Top books (up to 5).
  const topBooks = Object.keys(profile.bookFrequency || {}).slice(0, 5);
  if (topBooks.length > 0) parts.push(topBooks.join(', '));

  // Theological vocabulary (up to 10).
  const vocab = (profile.theologicalVocabulary || []).slice(0, 10);
  if (vocab.length > 0) parts.push(vocab.join(', '));

  // Citation phrases (up to 3).
  const phrases = (profile.citationPatterns || []).slice(0, 3);
  if (phrases.length > 0) parts.push(phrases.join(', '));

  // Cap total at ~50 words to stay within Whisper's token limit.
  let result = parts.join(', ');
  const words = result.split(/\s+/);
  if (words.length > 50) {
    result = words.slice(0, 50).join(' ');
  }
  return result;
}

function buildLlmExtension(profile) {
  const sections = [];

  if (profile.preferredTranslation?.code) {
    sections.push(`PASTOR PREFERRED TRANSLATION: ${profile.preferredTranslation.code}`);
  }

  const topBooks = Object.keys(profile.bookFrequency || {}).slice(0, 10);
  if (topBooks.length > 0) {
    sections.push(`PASTOR MOST-REFERENCED BOOKS: ${topBooks.join(', ')}`);
  }

  const pronMap = profile.pronunciationMap || {};
  const pronEntries = Object.entries(pronMap);
  if (pronEntries.length > 0) {
    const lines = pronEntries.slice(0, 20).map(([garbled, canonical]) =>
      `- "${garbled}" \u2192 "${canonical}"`
    );
    sections.push(`PASTOR-SPECIFIC STT CORRECTIONS:\n${lines.join('\n')}`);
  }

  const patterns = (profile.citationPatterns || []).slice(0, 8);
  if (patterns.length > 0) {
    const lines = patterns.map(p => `- "${p}" \u2192 verse reference likely follows`);
    sections.push(`PASTOR CITATION PATTERNS:\n${lines.join('\n')}`);
  }

  return sections.length > 0
    ? `\u2550\u2550\u2550 PASTOR PROFILE (${profile.name || 'unknown'}) \u2550\u2550\u2550\n\n${sections.join('\n\n')}`
    : '';
}

// ── Main Analysis Entry Point ──

function analyzeTranscripts(transcripts, biblesDir) {
  const bibles = loadBibles(biblesDir);

  const preferredTranslation = fingerprintTranslation(transcripts, bibles);
  const bookFrequency = extractBookFrequency(transcripts);
  const citationPatterns = extractCitationPatterns(transcripts);
  const theologicalVocabulary = extractTheologicalVocabulary(transcripts);

  // Build the profile data (without id/name — caller adds those).
  const profile = {
    preferredTranslation,
    bookFrequency,
    citationPatterns,
    pronunciationMap: {}, // populated by pronunciation detection or user editing
    theologicalVocabulary,
  };

  profile.whisperPromptExtension = buildWhisperExtension(profile);
  profile.llmPromptExtension = buildLlmExtension(profile);

  return profile;
}

module.exports = {
  analyzeTranscripts,
  fingerprintTranslation,
  extractCitationPatterns,
  extractBookFrequency,
  extractTheologicalVocabulary,
  buildWhisperExtension,
  buildLlmExtension,
  findVerseReferences,
};
