/**
 * ReactiveBible Online Fetcher
 * Tries multiple sources: YouVersion (bible.com) → BibleHub (biblehub.com)
 */
const https = require('https');
const http = require('http');

// ── YouVersion config ────────────────────────────────

const YOUVERSION_IDS = {
  KJV: 1, NKJV: 114, NIV: 111, NLT: 116, ESV: 59,
  AMP: 1588, AMPC: 8, MSG: 97, TPT: 1849, NASB: 2692,
  CSB: 1713, CEV: 392, GNT: 68, ICB: 1359, ASV: 12,
  WEB: 206, YLT: 821, HCSB: 72, NET: 107,
};

const USFM = {
  'Genesis': 'GEN', 'Exodus': 'EXO', 'Leviticus': 'LEV',
  'Numbers': 'NUM', 'Deuteronomy': 'DEU', 'Joshua': 'JOS',
  'Judges': 'JDG', 'Ruth': 'RUT', '1 Samuel': '1SA',
  '2 Samuel': '2SA', '1 Kings': '1KI', '2 Kings': '2KI',
  '1 Chronicles': '1CH', '2 Chronicles': '2CH', 'Ezra': 'EZR',
  'Nehemiah': 'NEH', 'Esther': 'EST', 'Job': 'JOB',
  'Psalms': 'PSA', 'Proverbs': 'PRO', 'Ecclesiastes': 'ECC',
  'Song of Solomon': 'SNG', 'Isaiah': 'ISA', 'Jeremiah': 'JER',
  'Lamentations': 'LAM', 'Ezekiel': 'EZK', 'Daniel': 'DAN',
  'Hosea': 'HOS', 'Joel': 'JOL', 'Amos': 'AMO',
  'Obadiah': 'OBA', 'Jonah': 'JON', 'Micah': 'MIC',
  'Nahum': 'NAM', 'Habakkuk': 'HAB', 'Zephaniah': 'ZEP',
  'Haggai': 'HAG', 'Zechariah': 'ZEC', 'Malachi': 'MAL',
  'Matthew': 'MAT', 'Mark': 'MRK', 'Luke': 'LUK',
  'John': 'JHN', 'Acts': 'ACT', 'Romans': 'ROM',
  '1 Corinthians': '1CO', '2 Corinthians': '2CO',
  'Galatians': 'GAL', 'Ephesians': 'EPH', 'Philippians': 'PHP',
  'Colossians': 'COL', '1 Thessalonians': '1TH',
  '2 Thessalonians': '2TH', '1 Timothy': '1TI',
  '2 Timothy': '2TI', 'Titus': 'TIT', 'Philemon': 'PHM',
  'Hebrews': 'HEB', 'James': 'JAS', '1 Peter': '1PE',
  '2 Peter': '2PE', '1 John': '1JN', '2 John': '2JN',
  '3 John': '3JN', 'Jude': 'JUD', 'Revelation': 'REV',
};

// ── BibleHub config ──────────────────────────────────
// BibleHub URL format: https://biblehub.com/{translation}/{book}/{chapter}.htm
// Book names are lowercase, spaces replaced with nothing for numbered books.

const BIBLEHUB_BOOKS = {
  'Genesis': 'genesis', 'Exodus': 'exodus', 'Leviticus': 'leviticus',
  'Numbers': 'numbers', 'Deuteronomy': 'deuteronomy', 'Joshua': 'joshua',
  'Judges': 'judges', 'Ruth': 'ruth', '1 Samuel': '1_samuel',
  '2 Samuel': '2_samuel', '1 Kings': '1_kings', '2 Kings': '2_kings',
  '1 Chronicles': '1_chronicles', '2 Chronicles': '2_chronicles', 'Ezra': 'ezra',
  'Nehemiah': 'nehemiah', 'Esther': 'esther', 'Job': 'job',
  'Psalms': 'psalms', 'Proverbs': 'proverbs', 'Ecclesiastes': 'ecclesiastes',
  'Song of Solomon': 'songs', 'Isaiah': 'isaiah', 'Jeremiah': 'jeremiah',
  'Lamentations': 'lamentations', 'Ezekiel': 'ezekiel', 'Daniel': 'daniel',
  'Hosea': 'hosea', 'Joel': 'joel', 'Amos': 'amos',
  'Obadiah': 'obadiah', 'Jonah': 'jonah', 'Micah': 'micah',
  'Nahum': 'nahum', 'Habakkuk': 'habakkuk', 'Zephaniah': 'zephaniah',
  'Haggai': 'haggai', 'Zechariah': 'zechariah', 'Malachi': 'malachi',
  'Matthew': 'matthew', 'Mark': 'mark', 'Luke': 'luke',
  'John': 'john', 'Acts': 'acts', 'Romans': 'romans',
  '1 Corinthians': '1_corinthians', '2 Corinthians': '2_corinthians',
  'Galatians': 'galatians', 'Ephesians': 'ephesians', 'Philippians': 'philippians',
  'Colossians': 'colossians', '1 Thessalonians': '1_thessalonians',
  '2 Thessalonians': '2_thessalonians', '1 Timothy': '1_timothy',
  '2 Timothy': '2_timothy', 'Titus': 'titus', 'Philemon': 'philemon',
  'Hebrews': 'hebrews', 'James': 'james', '1 Peter': '1_peter',
  '2 Peter': '2_peter', '1 John': '1_john', '2 John': '2_john',
  '3 John': '3_john', 'Jude': 'jude', 'Revelation': 'revelation',
};

// ── Shared utilities ─────────────────────────────────

function fetchUrl(url) {
  const mod = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      timeout: 12000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); // Drain the redirect response to free the socket.
        const loc = res.headers.location.startsWith('http')
          ? res.headers.location
          : `https://biblehub.com${res.headers.location}`;
        return fetchUrl(loc).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume(); // Drain to free the socket.
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function stripHtml(html) {
  let clean = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  clean = clean.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  clean = clean.replace(/<br\s*\/?>/gi, ' ');
  clean = clean.replace(/<\/(p|div|h\d|li|td)>/gi, ' ');
  clean = clean.replace(/<[^>]+>/g, '');
  return clean;
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => {
      const code = parseInt(n);
      if (code === 8220 || code === 8221) return '"';
      if (code === 8216 || code === 8217) return "'";
      if (code === 8212) return ' — ';
      if (code === 8211) return ' - ';
      return String.fromCharCode(code);
    });
}

function cleanVerseText(text) {
  let t = text;
  // Remove ALL HTML tags — complete and incomplete.
  // Complete tags: <span class="foo">
  t = t.replace(/<[^>]+>/g, '');
  // Incomplete tags at end: <span class="verse v17"  (no closing >)
  t = t.replace(/<[^>]*$/g, '');
  // Incomplete tags at start: ...class="foo">
  t = t.replace(/^[^<]*>/g, '');
  // Anything remaining that starts with < (catch-all for malformed HTML).
  t = t.replace(/<\S[^]*$/g, '');
  t = stripHtml(t);
  t = decodeEntities(t);
  t = t.replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Remove leading verse number.
  t = t.replace(/^\d+\s*/, '');
  // Remove footnote markers and short cross-references, but KEEP amplified text.
  // Short brackets like [a], [b], [Num. 21:9.] are footnotes — remove them.
  // Long brackets like [on a pole] or [who clings to, trusts in] are AMPC amplification — keep them.
  t = t.replace(/\s*#\s*\d+:\d+\s*.*$/g, '');
  t = t.replace(/\[\s*[a-z]\s*\]/gi, '');             // [a], [b], [c]
  t = t.replace(/\[\s*[A-Z][a-z]+\.\s*\d+[:\d.-]*\s*\]/g, ''); // [Num. 21:9.]
  t = t.replace(/\[\s*See\s+[^\]]*\]/gi, '');          // [See ver. 3]
  t = t.replace(/\s*\([a-z]\)/gi, '');                 // (a), (b)
  // Remove stray Unicode control chars.
  t = t.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ');
  // Remove orphaned bracket fragments like "a " at start or trailing brackets.
  t = t.replace(/^[a-z]\s+/i, '');
  t = t.replace(/\s+[a-z]$/i, '');
  t = t.replace(/^[,;:\s\])+]+/, '');
  t = t.replace(/[(\[]+$/, '');
  // Collapse spaces.
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

/**
 * Strip all <span class="CLASS..."> blocks with balanced nesting.
 * Handles deeply nested spans inside footnotes/cross-references.
 */
function stripNestedSpans(html, classPrefix) {
  const marker = `<span class="${classPrefix}`;
  const parts = [];
  let i = 0;
  while (i < html.length) {
    const start = html.indexOf(marker, i);
    if (start === -1) {
      parts.push(html.substring(i));
      break;
    }
    parts.push(html.substring(i, start));
    // Count balanced <span> / </span> to find the matching close.
    let depth = 0;
    let j = start;
    const limit = Math.min(html.length, start + 5000); // Safety cap.
    while (j < limit) {
      if (html.startsWith('<span', j)) {
        depth++;
        const close = html.indexOf('>', j);
        if (close === -1) { j = limit; break; }
        j = close + 1;
      } else if (html.startsWith('</span>', j)) {
        depth--;
        j += 7;
        if (depth === 0) break;
      } else {
        j++;
      }
    }
    i = j;
  }
  return parts.join('');
}

// ── YouVersion fetcher ───────────────────────────────

async function fetchFromYouVersion(book, chapter, translation) {
  const versionId = YOUVERSION_IDS[translation.toUpperCase()];
  if (!versionId) return null;

  const usfm = USFM[book] || book;
  const url = `https://www.bible.com/bible/${versionId}/${usfm}.${chapter}.${translation}`;
  console.log(`[fetch] Trying YouVersion: ${url}`);

  const html = await fetchUrl(url);
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/);
  if (!match) return null;

  const data = JSON.parse(match[1]);
  const content = data?.props?.pageProps?.chapterInfo?.content;
  if (!content) return null;

  const versePattern = new RegExp(
    `data-usfm="${usfm}\\.${chapter}\\.(\\d+)"[^>]*>(.*?)(?=data-usfm="|$)`, 'gs'
  );

  const verseMap = new Map();
  let m;
  while ((m = versePattern.exec(content)) !== null) {
    const vNum = parseInt(m[1]);
    let raw = m[2];
    // Remove footnotes and cross-references with balanced span matching.
    raw = stripNestedSpans(raw, 'note');
    // Remove labels (verse numbers inside the content).
    raw = raw.replace(/<span class="label">[^<]*<\/span>/g, '');
    // Now strip all remaining HTML tags to get the plain text.
    const text = cleanVerseText(raw);
    if (text && text.length > 1) {
      verseMap.set(vNum, verseMap.has(vNum) ? verseMap.get(vNum) + ' ' + text : text);
    }
  }

  // Final cleanup pass.
  for (const [vNum, text] of verseMap) {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned || cleaned.length <= 1) verseMap.delete(vNum);
    else verseMap.set(vNum, cleaned);
  }

  const verses = Array.from(verseMap.entries())
    .map(([verse, text]) => ({ verse, text }))
    .sort((a, b) => a.verse - b.verse);

  return verses.length > 0 ? verses : null;
}

// ── BibleHub fetcher ─────────────────────────────────

async function fetchFromBibleHub(book, chapter, translation) {
  const bhBook = BIBLEHUB_BOOKS[book];
  if (!bhBook) return null;

  const trans = translation.toLowerCase();
  const url = `https://biblehub.com/${trans}/${bhBook}/${chapter}.htm`;
  console.log(`[fetch] Trying BibleHub: ${url}`);

  let html;
  try {
    html = await fetchUrl(url);
  } catch (e) {
    console.log(`[fetch] BibleHub failed: ${e.message}`);
    return null;
  }

  // BibleHub renders verses in <span class="reftext">N</span> followed by verse text.
  // The page structure varies, but verses are typically in a div with class containing the text.
  const verseMap = new Map();

  // Pattern 1: Look for verse spans with class "reftext" followed by text content.
  const refPattern = /<span class="reftext"><a[^>]*>(\d+)<\/a><\/span>([\s\S]*?)(?=<span class="reftext"|<\/div>|<div class)/g;
  let m;
  while ((m = refPattern.exec(html)) !== null) {
    const vNum = parseInt(m[1]);
    const text = cleanVerseText(m[2]);
    if (text && text.length > 2) {
      verseMap.set(vNum, text);
    }
  }

  // Pattern 2: Fallback — look for <p> with verse numbers.
  if (verseMap.size === 0) {
    const pPattern = /<p[^>]*>\s*<b>(\d+)<\/b>\s*([\s\S]*?)<\/p>/g;
    while ((m = pPattern.exec(html)) !== null) {
      const vNum = parseInt(m[1]);
      const text = cleanVerseText(m[2]);
      if (text && text.length > 2) {
        verseMap.set(vNum, text);
      }
    }
  }

  // Pattern 3: Another common BibleHub format.
  if (verseMap.size === 0) {
    const spanPattern = /class="[^"]*vnum[^"]*"[^>]*>(\d+)<\/span>([\s\S]*?)(?=class="[^"]*vnum|$)/g;
    while ((m = spanPattern.exec(html)) !== null) {
      const vNum = parseInt(m[1]);
      const text = cleanVerseText(m[2]);
      if (text && text.length > 2) {
        verseMap.set(vNum, text);
      }
    }
  }

  const verses = Array.from(verseMap.entries())
    .map(([verse, text]) => ({ verse, text }))
    .sort((a, b) => a.verse - b.verse);

  return verses.length > 0 ? verses : null;
}

// ── Main fetch function (tries sources in order) ─────

/**
 * Fetch a chapter from online sources.
 * Tries YouVersion first, then BibleHub.
 */
async function fetchChapter(book, chapter, translation) {
  const errors = [];

  // Source 1: YouVersion
  try {
    const verses = await fetchFromYouVersion(book, chapter, translation);
    if (verses && verses.length > 0) {
      console.log(`[fetch] Got ${verses.length} verses from YouVersion`);
      return { verses, book, chapter, translation, reference: `${book} ${chapter}`, source: 'online' };
    }
  } catch (e) {
    errors.push(`YouVersion: ${e.message}`);
  }

  // Source 2: BibleHub
  try {
    const verses = await fetchFromBibleHub(book, chapter, translation);
    if (verses && verses.length > 0) {
      console.log(`[fetch] Got ${verses.length} verses from BibleHub`);
      return { verses, book, chapter, translation, reference: `${book} ${chapter}`, source: 'online' };
    }
  } catch (e) {
    errors.push(`BibleHub: ${e.message}`);
  }

  // All sources failed.
  const knownCodes = Object.keys(YOUVERSION_IDS).join(', ');
  throw new Error(
    `"${translation}" could not be fetched online. ` +
    `Available translations: ${knownCodes}. ` +
    `Some translations (e.g. Wuest, Passion) are copyrighted and not available for free online fetching.`
  );
}

function getAvailableTranslations() {
  // Return known translations, but any code can be tried via BibleHub.
  return Object.keys(YOUVERSION_IDS);
}

module.exports = { fetchChapter, getAvailableTranslations, YOUVERSION_IDS };
