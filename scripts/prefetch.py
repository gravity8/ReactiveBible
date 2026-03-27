#!/usr/bin/env python3
"""
Prefetch Bible translations and save as bundled JSON files.

Sources:
  - API.Bible: NLT, AMP, NIV, NKJV, MSG (using 2 accounts)
  - YouVersion: AMPC, TPT (no API key needed)

Output: /bibles/{TRANSLATION}.json in nested format:
  { "Genesis": { "1": { "1": "In the beginning...", "2": "..." } } }

Usage:
  python3 scripts/prefetch.py
"""

import json, os, sys, time, re, urllib.request, urllib.error

BIBLES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "bibles")

# ── Config ─────────────────────────────────────────────────

# Load from config.json
CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config.json")
with open(CONFIG_PATH) as f:
    config = json.load(f)

# Build translation → API key map from api_bible_accounts
api_bible_keys = {}
for account in config.get("api_bible_accounts", []):
    key = account.get("key", "")
    for trans in account.get("translations", []):
        api_bible_keys[trans] = key

# API.Bible Bible IDs (verified against rest.api.bible)
API_BIBLE_IDS = {
    "KJV":  "de4e12af7f28f599-02",
    "NLT":  "d6e14a625393b4da-01",
    "AMP":  "a81b73293d3080c9-01",
    "NIV":  "78a9f6124f344018-01",
    "NKJV": "63097d2a0a2f7db3-01",
    "MSG":  "6f11a7de016f942e-01",
}

API_BIBLE_BASE = "https://rest.api.bible"

# YouVersion version IDs — all translations available here
YOUVERSION_IDS = {
    "KJV":  1,     "NKJV": 114,   "NIV":  111,
    "NLT":  116,   "ESV":  59,    "AMP":  1588,
    "AMPC": 8,     "MSG":  97,    "TPT":  1849,
    "NASB": 2692,
}

# USFM book abbreviations
BOOKS = [
    ("Genesis", "GEN", 50), ("Exodus", "EXO", 40), ("Leviticus", "LEV", 27),
    ("Numbers", "NUM", 36), ("Deuteronomy", "DEU", 34), ("Joshua", "JOS", 24),
    ("Judges", "JDG", 21), ("Ruth", "RUT", 4), ("1 Samuel", "1SA", 31),
    ("2 Samuel", "2SA", 24), ("1 Kings", "1KI", 22), ("2 Kings", "2KI", 25),
    ("1 Chronicles", "1CH", 29), ("2 Chronicles", "2CH", 36), ("Ezra", "EZR", 10),
    ("Nehemiah", "NEH", 13), ("Esther", "EST", 10), ("Job", "JOB", 42),
    ("Psalms", "PSA", 150), ("Proverbs", "PRO", 31), ("Ecclesiastes", "ECC", 12),
    ("Song of Solomon", "SNG", 8), ("Isaiah", "ISA", 66), ("Jeremiah", "JER", 52),
    ("Lamentations", "LAM", 5), ("Ezekiel", "EZK", 48), ("Daniel", "DAN", 12),
    ("Hosea", "HOS", 14), ("Joel", "JOL", 3), ("Amos", "AMO", 9),
    ("Obadiah", "OBA", 1), ("Jonah", "JON", 4), ("Micah", "MIC", 7),
    ("Nahum", "NAM", 3), ("Habakkuk", "HAB", 3), ("Zephaniah", "ZEP", 3),
    ("Haggai", "HAG", 2), ("Zechariah", "ZEC", 14), ("Malachi", "MAL", 4),
    ("Matthew", "MAT", 28), ("Mark", "MRK", 16), ("Luke", "LUK", 24),
    ("John", "JHN", 21), ("Acts", "ACT", 28), ("Romans", "ROM", 16),
    ("1 Corinthians", "1CO", 16), ("2 Corinthians", "2CO", 13),
    ("Galatians", "GAL", 6), ("Ephesians", "EPH", 6), ("Philippians", "PHP", 4),
    ("Colossians", "COL", 4), ("1 Thessalonians", "1TH", 5),
    ("2 Thessalonians", "2TH", 3), ("1 Timothy", "1TI", 6),
    ("2 Timothy", "2TI", 4), ("Titus", "TIT", 3), ("Philemon", "PHM", 1),
    ("Hebrews", "HEB", 13), ("James", "JAS", 5), ("1 Peter", "1PE", 5),
    ("2 Peter", "2PE", 3), ("1 John", "1JN", 5), ("2 John", "2JN", 1),
    ("3 John", "3JN", 1), ("Jude", "JUD", 1), ("Revelation", "REV", 22),
]

TOTAL_CHAPTERS = sum(ch for _, _, ch in BOOKS)  # 1189

# ── Helpers ────────────────────────────────────────────────

def strip_html(text):
    """Remove HTML tags (including partial/broken ones) and decode entities."""
    # Remove complete tags
    text = re.sub(r'<[^>]+>', '', text)
    # Remove broken/partial tags (e.g., '<span class="verse v3 v4 v5"')
    text = re.sub(r'<[^>]*$', '', text)
    text = text.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    text = text.replace('&#8220;', '"').replace('&#8221;', '"')
    text = text.replace('&#8216;', "'").replace('&#8217;', "'")
    text = text.replace('&#8212;', ' — ').replace('&#8211;', ' - ')
    text = re.sub(r'&#\d+;', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def fetch_url(url, headers=None, retries=3, delay=1.0):
    """Fetch URL with retries."""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers or {})
            resp = urllib.request.urlopen(req, timeout=30)
            return resp.read().decode('utf-8')
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = delay * (2 ** attempt) + 5
                print(f"    Rate limited, waiting {wait:.0f}s...")
                time.sleep(wait)
            elif e.code == 404:
                return None
            else:
                print(f"    HTTP {e.code}, retry {attempt+1}/{retries}")
                time.sleep(delay)
        except Exception as e:
            print(f"    Error: {e}, retry {attempt+1}/{retries}")
            time.sleep(delay)
    return None


# ── API.Bible Fetcher ──────────────────────────────────────

def fetch_api_bible_chapter(bible_id, api_key, book_usfm, chapter):
    """Fetch a chapter from API.Bible (1 API call). Returns dict of {verse_num: text}."""
    url = f"{API_BIBLE_BASE}/v1/bibles/{bible_id}/chapters/{book_usfm}.{chapter}?content-type=html&include-verse-numbers=true"
    headers = {
        "api-key": api_key,
        "Accept": "application/json",
    }
    body = fetch_url(url, headers)
    if not body:
        return {}

    try:
        data = json.loads(body)
        html = data.get("data", {}).get("content", "")
        if not html:
            return {}

        # Parse verses from HTML spans: <span data-number="N" data-sid="...">N</span>text
        # Split on verse markers.
        verses = {}
        parts = re.split(r'<span\s+data-number="(\d+)"\s+data-sid="[^"]*"\s+class="v">\d+</span>', html)

        # parts = [preamble, verse1_num, verse1_text, verse2_num, verse2_text, ...]
        for i in range(1, len(parts) - 1, 2):
            vnum = parts[i]
            text = strip_html(parts[i + 1])
            if text and vnum not in verses:
                verses[vnum] = text

        return verses
    except Exception as e:
        print(f"    Parse error: {e}")
        return {}


# ── YouVersion Fetcher ─────────────────────────────────────

def fetch_youversion_chapter(version_id, book_usfm, chapter, translation_code):
    """Fetch a chapter from YouVersion. Returns dict of {verse_num: text}."""
    url = f"https://www.bible.com/bible/{version_id}/{book_usfm}.{chapter}.{translation_code}"
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}
    body = fetch_url(url, headers)
    if not body:
        return {}

    try:
        # Extract __NEXT_DATA__ JSON
        match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', body, re.DOTALL)
        if not match:
            return {}

        data = json.loads(match.group(1))
        content = data["props"]["pageProps"]["chapterInfo"]["content"]

        # Extract verses using data-usfm.
        # Handles both single verses (data-usfm="GEN.1.1") and
        # grouped verses like MSG (data-usfm="GEN.1.1+GEN.1.2").
        # We extract the FIRST verse number from each group.
        pattern = rf'data-usfm="{book_usfm}\.{chapter}\.(\d+)(?:\+[^"]*)?"\s*>(.*?)(?=data-usfm="|</div>\s*</div>\s*</div>|$)'
        chunks = re.findall(pattern, content, re.DOTALL)

        # If few matches, try the class-based pattern for MSG-style grouping:
        # <span class="verse v1 v2" data-usfm="GEN.1.1+GEN.1.2">
        if len(chunks) < 5:
            pattern2 = rf'class="verse[^"]*"\s+data-usfm="{book_usfm}\.{chapter}\.(\d+)(?:\+[^"]*)?"\s*>(.*?)(?=<span[^>]*class="verse|</div>\s*</div>\s*</div>|$)'
            chunks2 = re.findall(pattern2, content, re.DOTALL)
            if len(chunks2) > len(chunks):
                chunks = chunks2

        verses = {}
        for vnum, raw in chunks:
            if vnum in verses:
                continue
            text = strip_html(raw)
            # Remove leading verse/range label like "1-2 " or "3 "
            text = re.sub(r'^\d+(?:-\d+)?\s*', '', text)
            # Remove footnote markers
            text = re.sub(r'\s*#\s*\d+:\d+.*', '', text)
            text = re.sub(r'\[\[?[a-z]\]?\]?', '', text)
            if text:
                verses[vnum] = text
        return verses
    except Exception as e:
        print(f"    Parse error: {e}")
        return {}


# ── Main Prefetch Logic ───────────────────────────────────

def prefetch_translation(translation, source, **kwargs):
    """Download an entire translation and save as nested JSON."""
    outfile = os.path.join(BIBLES_DIR, f"{translation.lower()}.json")

    # Check if already exists and has substantial content
    if os.path.exists(outfile):
        size = os.path.getsize(outfile)
        if size > 3_000_000:  # >3MB = likely complete (full Bible ~4MB)
            print(f"[{translation}] Already exists ({size/1024/1024:.1f}MB), skipping")
            return True

    # Load partial progress if exists (prefer partial over small/corrupt main file)
    bible = {}
    progress_file = outfile + ".partial"
    if os.path.exists(progress_file):
        try:
            with open(progress_file) as f:
                loaded = json.load(f)
            # Only use partial if it has actual verse data
            verse_count = sum(len(ch) for b in loaded.values() for ch in b.values())
            if verse_count > 0:
                bible = loaded
                done = sum(len(b) for b in bible.values())
                print(f"[{translation}] Resuming from {done}/{TOTAL_CHAPTERS} chapters ({verse_count} verses)")
            else:
                print(f"[{translation}] Partial file empty, starting fresh")
                os.remove(progress_file)
        except Exception:
            print(f"[{translation}] Corrupt partial file, starting fresh")
            os.remove(progress_file)
    elif os.path.exists(outfile):
        # Try loading from main file as resume source
        try:
            with open(outfile) as f:
                loaded = json.load(f)
            verse_count = sum(len(ch) for b in loaded.values() for ch in b.values())
            if verse_count > 0:
                bible = loaded
                done = sum(len(b) for b in bible.values())
                print(f"[{translation}] Resuming from existing file: {done}/{TOTAL_CHAPTERS} chapters ({verse_count} verses)")
        except Exception:
            pass

    total_verses = 0
    chapters_done = 0
    chapters_total = TOTAL_CHAPTERS

    for book_name, book_usfm, num_chapters in BOOKS:
        if book_name not in bible:
            bible[book_name] = {}

        for ch in range(1, num_chapters + 1):
            ch_str = str(ch)
            if ch_str in bible[book_name] and bible[book_name][ch_str]:
                chapters_done += 1
                total_verses += len(bible[book_name][ch_str])
                continue

            # Fetch
            if source == "api_bible":
                verses = fetch_api_bible_chapter(
                    kwargs["bible_id"], kwargs["api_key"], book_usfm, ch)
                time.sleep(0.3)  # ~3 req/sec to stay well within limits
            elif source == "youversion":
                verses = fetch_youversion_chapter(
                    kwargs["version_id"], book_usfm, ch, translation)
                time.sleep(2.0)  # Slower for YouVersion (no official API)

            if verses:
                bible[book_name][ch_str] = verses
                total_verses += len(verses)
                chapters_done += 1
                print(f"  [{translation}] {book_name} {ch} — {len(verses)} verses "
                      f"({chapters_done}/{chapters_total})")
            else:
                print(f"  [{translation}] {book_name} {ch} — FAILED")
                chapters_done += 1

            # Save progress every 10 chapters
            if chapters_done % 10 == 0:
                with open(progress_file, 'w') as f:
                    json.dump(bible, f)

    # Save final file
    with open(outfile, 'w') as f:
        json.dump(bible, f, indent=None, ensure_ascii=False)

    # Clean up partial
    if os.path.exists(progress_file):
        os.remove(progress_file)

    file_size = os.path.getsize(outfile)
    print(f"[{translation}] Done! {total_verses} verses, {file_size/1024/1024:.1f}MB → {outfile}")
    return True


def main():
    os.makedirs(BIBLES_DIR, exist_ok=True)

    # Determine what to fetch
    translations_to_fetch = config.get("l1_translations", [])
    if len(sys.argv) > 1:
        translations_to_fetch = [t.upper() for t in sys.argv[1:]]

    print(f"Prefetching: {translations_to_fetch}")
    print(f"Output: {BIBLES_DIR}")
    print(f"Total chapters per translation: {TOTAL_CHAPTERS}")
    print()

    for trans in translations_to_fetch:
        if trans == "KJV":
            # Already bundled
            kjv_path = os.path.join(BIBLES_DIR, "kjv.json")
            if os.path.exists(kjv_path):
                print(f"[KJV] Already bundled, skipping")
                continue

        # Override: use first account key for NKJV (second account hit monthly limit)
        if trans == "NKJV":
            api_bible_keys["NKJV"] = "kfY2fvfX8gHXhj-YInQhL"

        if trans in api_bible_keys and trans in API_BIBLE_IDS:
            print(f"[{trans}] Fetching from API.Bible...")
            prefetch_translation(trans, "api_bible",
                                 bible_id=API_BIBLE_IDS[trans],
                                 api_key=api_bible_keys[trans])
        elif trans in YOUVERSION_IDS:
            print(f"[{trans}] Fetching from YouVersion...")
            prefetch_translation(trans, "youversion",
                                 version_id=YOUVERSION_IDS[trans])
        else:
            print(f"[{trans}] No source available — skipping")

    print("\nAll done! Restart sermon-verse-detector to load the new translations.")


if __name__ == "__main__":
    main()
