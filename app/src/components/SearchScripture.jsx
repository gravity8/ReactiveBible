import React, { useState, useCallback, useEffect, useRef } from 'react';
import useStore from '../store/useStore';

const LOCAL_TRANSLATIONS = ['KJV', 'NLT', 'AMP', 'NIV', 'NKJV', 'MSG'];
const ONLINE_TRANSLATIONS = ['NASB', 'ESV', 'AMPC', 'TPT', 'CSB', 'CEV', 'ASV', 'WEB', 'YLT', 'GNT', 'HCSB'];
const ALL_TRANSLATIONS = [...LOCAL_TRANSLATIONS, ...ONLINE_TRANSLATIONS];

/* ── Inline styles (dark theme) ── */
const styles = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    background: '#1a1a2e',
    borderRadius: 8,
    border: '1px solid #2a2a3e',
    overflow: 'hidden',
    minHeight: 0,
  },

  /* ── Search bar ── */
  searchBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 0,
    padding: '8px 10px',
    borderBottom: '1px solid #2a2a3e',
    flexShrink: 0,
  },
  tab: (active) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 34,
    height: 34,
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    background: active ? 'rgba(20,184,166,0.15)' : 'transparent',
    color: active ? '#14b8a6' : '#888',
    fontSize: 16,
    flexShrink: 0,
    transition: 'background .15s, color .15s',
  }),
  input: {
    flex: 1,
    background: '#12121e',
    border: '1px solid #2a2a3e',
    borderRadius: 6,
    padding: '7px 10px',
    color: '#e0e0e0',
    fontSize: 13,
    outline: 'none',
    marginLeft: 6,
  },
  select: {
    background: '#12121e',
    border: '1px solid #2a2a3e',
    borderRadius: 6,
    padding: '7px 8px',
    color: '#e0e0e0',
    fontSize: 12,
    outline: 'none',
    marginLeft: 6,
    cursor: 'pointer',
    flexShrink: 0,
  },

  /* ── Scripture display ── */
  scriptureArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '14px 16px',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: '#555',
    textAlign: 'center',
    gap: 6,
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: 4,
    opacity: 0.5,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#777',
  },
  emptySub: {
    fontSize: 12,
    color: '#555',
  },
  reference: {
    color: '#14b8a6',
    fontWeight: 700,
    fontSize: 15,
    marginBottom: 6,
    padding: '0 4px',
  },
  verseList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  },
  verseRow: (selected) => ({
    display: 'flex',
    gap: 10,
    padding: '10px 14px',
    borderRadius: 6,
    cursor: 'pointer',
    transition: 'all 0.15s',
    background: selected ? 'rgba(255,255,255,0.07)' : 'transparent',
    border: selected ? '2px solid rgba(20,184,166,0.6)' : '2px solid transparent',
    width: '100%',
  }),
  verseNumber: {
    color: '#14b8a6',
    fontWeight: 700,
    fontSize: 13,
    minWidth: 28,
    textAlign: 'right',
    flexShrink: 0,
    paddingTop: 1,
    userSelect: 'none',
  },
  verseText: {
    color: '#d0d0d0',
    fontSize: 13,
    lineHeight: 1.7,
    flex: 1,
  },
  copyright: {
    color: '#555',
    fontSize: 11,
    marginTop: 12,
    padding: '0 4px',
    fontStyle: 'italic',
  },
};

/* ── Icons (simple SVG) ── */
function BookIcon({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15z" />
    </svg>
  );
}

function SearchIcon({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export default function SearchScripture() {
  const { searchResult, setSearchResult, setPreviewVerse, highlightedVerse, setHighlightedVerse, previewVerse, liveVerse, sendDirectToLive, activeTranslation, setActiveTranslation } = useStore();
  const [activeTab, setActiveTab] = useState('book');
  const selectedTranslation = activeTranslation;
  const [query, setQuery] = useState('');
  const [fetching, setFetching] = useState(false);
  const searchCounter = useRef(0); // Prevents stale search responses from overwriting newer ones.
  const scrollAreaRef = useRef(null);
  const highlightRef = useRef(null);

  // Auto-scroll to highlighted verse when it changes.
  useEffect(() => {
    if (highlightedVerse && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightedVerse, searchResult]);

  // Sync query input when search result changes from auto-search.
  useEffect(() => {
    if (searchResult?.reference) {
      setQuery(searchResult.reference);
    }
  }, [searchResult]);

  // Try local first, then fetch online if local doesn't have the translation.
  const searchChapter = useCallback(async (bookQuery, chapter, trans) => {
    const thisRequest = ++searchCounter.current;

    // Try local.
    const local = await window.api.searchVerse(`${bookQuery} ${chapter}`, trans);
    if (thisRequest !== searchCounter.current) return null; // Stale — discard.
    if (local && !local.error) return local;

    // Local failed — try online.
    setFetching(true);
    try {
      const kjvResult = await window.api.searchVerse(`${bookQuery} ${chapter}`, 'KJV');
      if (thisRequest !== searchCounter.current) return null;
      const canonicalBook = kjvResult?.book || bookQuery;

      const online = await window.api.fetchChapterOnline({
        book: canonicalBook,
        chapter: parseInt(chapter),
        translation: trans,
      });
      if (thisRequest !== searchCounter.current) return null;
      if (online?.error) return { error: `Online: ${online.error}` };
      return online;
    } catch (err) {
      return { error: err.message };
    } finally {
      if (thisRequest === searchCounter.current) setFetching(false);
    }
  }, []);

  const handleSearch = useCallback(async (overrideTranslation) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const trans = overrideTranslation || selectedTranslation;

    // Check if query includes a specific verse (e.g. "Gen 1:6", "John 3:16").
    const verseMatch = trimmed.match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/);

    if (verseMatch) {
      const bookQuery = verseMatch[1];
      const chapter = verseMatch[2];
      const verseNum = parseInt(verseMatch[3]);

      const chapterResult = await searchChapter(bookQuery, chapter, trans);
      if (chapterResult && !chapterResult.error) {
        setSearchResult(chapterResult);
        setHighlightedVerse(verseNum);

        const found = (chapterResult.verses || []).find(
          (v) => (v.verse ?? v.number) === verseNum
        );
        if (found) {
          setPreviewVerse({
            reference: `${chapterResult.book || bookQuery} ${chapter}:${verseNum}`,
            text: found.text,
            active: trans,
          });
        }
      } else {
        setSearchResult(chapterResult);
        setHighlightedVerse(null);
      }
    } else {
      setHighlightedVerse(null);
      const chapterMatch = trimmed.match(/^(.+?)\s+(\d+)$/);
      if (chapterMatch) {
        const result = await searchChapter(chapterMatch[1], chapterMatch[2], trans);
        setSearchResult(result);
      } else {
        try {
          const result = await window.api.searchVerse(trimmed, trans);
          setSearchResult(result);
        } catch (err) {
          console.error('Search failed:', err);
        }
      }
    }
  }, [query, selectedTranslation, searchChapter, setSearchResult, setHighlightedVerse, setPreviewVerse]);

  // Re-search when translation changes — also update preview and live verses.
  const handleTranslationChange = async (newTranslation) => {
    setActiveTranslation(newTranslation);

    // Re-fetch chapter in new translation.
    if (!searchResult?.book || !searchResult?.chapter) {
      // No chapter loaded — trigger a search if there's a query or a preview verse.
      if (query.trim()) {
        handleSearch(newTranslation);
      } else if (previewVerse?.reference) {
        // Extract book+chapter from the preview verse reference and search.
        const m = previewVerse.reference.match(/^(.+?)\s+(\d+)/);
        if (m) {
          const result = await searchChapter(m[1], m[2], newTranslation);
          if (result && !result.error) setSearchResult(result);
        }
      }
      return;
    }

    const result = await searchChapter(searchResult.book, String(searchResult.chapter), newTranslation);
    if (!result || result.error) return;

    setSearchResult(result);

    // If a verse is highlighted, update preview + live with new translation text.
    const vNum = highlightedVerse;
    if (vNum) {
      const found = (result.verses || []).find((v) => (v.verse ?? v.number) === vNum);
      if (found) {
        const ref = `${result.book} ${result.chapter}:${vNum}`;
        const updatedVerse = { reference: ref, text: found.text, active: newTranslation };

        // Update preview — skip auto-search since we already loaded the chapter.
        setPreviewVerse(updatedVerse, { skipAutoSearch: true });

        // If live is showing the same reference, update it too.
        if (liveVerse && liveVerse.reference === (previewVerse?.reference || ref)) {
          sendDirectToLive(updatedVerse);
        }
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSearch();
  };

  const handleVerseClick = useCallback((verse, verseNum) => {
    const book = searchResult?.book || '';
    const chapter = searchResult?.chapter || '';
    const ref = `${book} ${chapter}:${verseNum}`;

    setHighlightedVerse(verseNum);
    setPreviewVerse({
      reference: ref,
      text: verse.text,
      active: selectedTranslation,
    });
  }, [searchResult, selectedTranslation, setPreviewVerse, setHighlightedVerse]);

  return (
    <div style={styles.container}>
      {/* ── Search bar ── */}
      <div style={styles.searchBar}>
        <button
          style={styles.tab(activeTab === 'book')}
          onClick={() => setActiveTab('book')}
          title="Book search"
        >
          <BookIcon size={16} color={activeTab === 'book' ? '#14b8a6' : '#888'} />
        </button>

        <button
          style={styles.tab(activeTab === 'context')}
          onClick={() => setActiveTab('context')}
          title="Context search"
        >
          <SearchIcon size={16} color={activeTab === 'context' ? '#14b8a6' : '#888'} />
        </button>

        <input
          style={styles.input}
          type="text"
          placeholder="John 3:16 or keyword"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        <div style={{ position: 'relative', flexShrink: 0, marginLeft: 6 }}>
          <input
            style={{
              ...styles.select,
              width: 70,
              textTransform: 'uppercase',
              textAlign: 'center',
              marginLeft: 0,
              cursor: 'text',
            }}
            type="text"
            value={selectedTranslation}
            onChange={(e) => {
              const val = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
              setActiveTranslation(val);
            }}
            onBlur={() => {
              if (selectedTranslation.trim()) {
                handleTranslationChange(selectedTranslation.trim());
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && selectedTranslation.trim()) {
                e.target.blur();
                handleTranslationChange(selectedTranslation.trim());
              }
            }}
            list="translation-list"
            placeholder="KJV"
            title="Type a translation code (e.g. KJV, NASB, ESV) or pick from suggestions"
          />
          <datalist id="translation-list">
            <optgroup label="Local">
              {LOCAL_TRANSLATIONS.map((t) => (
                <option key={t} value={t} />
              ))}
            </optgroup>
            <optgroup label="Online">
              {ONLINE_TRANSLATIONS.map((t) => (
                <option key={t} value={t} />
              ))}
            </optgroup>
          </datalist>
        </div>
      </div>

      {/* ── Scripture display ── */}
      <div style={styles.scriptureArea}>
        {fetching ? (
          <div style={styles.empty}>
            <svg width="24" height="24" viewBox="0 0 24 24" style={{ animation: 'spin 1s linear infinite' }}>
              <circle cx="12" cy="12" r="10" stroke="#14b8a6" strokeWidth="3" fill="none" strokeDasharray="31 31" strokeLinecap="round" />
            </svg>
            <div style={{ ...styles.emptyTitle, marginTop: 10 }}>Fetching online...</div>
            <div style={styles.emptySub}>Downloading {selectedTranslation} chapter</div>
          </div>
        ) : !searchResult ? (
          <div style={styles.empty}>
            <div style={styles.emptyIcon}>
              <BookIcon size={32} color="#555" />
            </div>
            <div style={styles.emptyTitle}>No scripture selected</div>
            <div style={styles.emptySub}>
              Search for a book, chapter, or keyword above
            </div>
          </div>
        ) : (
          <>
            <div style={styles.reference}>
              {searchResult.reference}
              {searchResult.translation && (
                <span style={{
                  marginLeft: 8,
                  fontSize: 10,
                  fontWeight: 600,
                  color: searchResult.source === 'online' ? '#14b8a6' : '#666',
                  background: searchResult.source === 'online' ? 'rgba(20,184,166,0.12)' : 'rgba(255,255,255,0.05)',
                  padding: '2px 6px',
                  borderRadius: 4,
                  verticalAlign: 'middle',
                }}>{searchResult.translation}{searchResult.source === 'online' ? ' ↓' : ''}</span>
              )}
            </div>
            <div style={styles.verseList}>
              {(searchResult.verses || []).map((v) => {
                const vNum = v.verse ?? v.number;
                const isHighlighted = highlightedVerse === vNum;
                const verseData = {
                  reference: `${searchResult.book || ''} ${searchResult.chapter || ''}:${vNum}`,
                  text: v.text,
                  active: selectedTranslation,
                };
                return (
                  <div
                    key={vNum}
                    ref={isHighlighted ? highlightRef : undefined}
                    style={styles.verseRow(isHighlighted)}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-verse', JSON.stringify(verseData));
                      e.dataTransfer.effectAllowed = 'copyMove';
                    }}
                    onClick={() => handleVerseClick(v, vNum)}
                    onMouseEnter={(e) => {
                      if (!isHighlighted) e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isHighlighted) e.currentTarget.style.background = 'transparent';
                    }}
                    title={`Drag to preview, live, or queue`}
                  >
                    <span style={styles.verseNumber}>{vNum}</span>
                    <span style={styles.verseText}>{v.text}</span>
                  </div>
                );
              })}
              {!searchResult.verses && searchResult.text && (
                <div style={{ ...styles.verseRow(false), cursor: 'default' }}>
                  <span style={styles.verseText}>{searchResult.text}</span>
                </div>
              )}
            </div>
            {searchResult.copyright && (
              <div style={styles.copyright}>{searchResult.copyright}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
