import React from 'react';
import useStore from '../store/useStore';

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
  header: {
    padding: '10px 14px',
    fontSize: 13,
    fontWeight: 600,
    color: '#aaa',
    borderBottom: '1px solid #2a2a3e',
    flexShrink: 0,
    letterSpacing: 0.3,
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: '4px 0',
  },

  /* ── Item ── */
  item: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '10px 14px',
    cursor: 'pointer',
    transition: 'background .12s',
    borderBottom: '1px solid #1e1e32',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#14b8a6',
    flexShrink: 0,
    marginTop: 5,
  },
  itemContent: {
    flex: 1,
    minWidth: 0,
  },
  reference: {
    fontWeight: 700,
    fontSize: 13,
    color: '#e0e0e0',
    marginBottom: 2,
  },
  preview: {
    fontSize: 12,
    color: '#777',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  time: {
    fontSize: 11,
    color: '#555',
    flexShrink: 0,
    marginTop: 2,
    fontVariantNumeric: 'tabular-nums',
  },

  /* ── Empty state ── */
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: '#555',
    textAlign: 'center',
    gap: 6,
    padding: 20,
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
};

function formatTime(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export default function RecentDetections() {
  const { recentDetections, setPreviewVerse } = useStore();

  const handleClick = (item) => {
    setPreviewVerse({
      reference: item.reference,
      text: item.text,
      active: item.active,
    });
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>Recent detections</div>

      <div style={styles.list}>
        {recentDetections.length === 0 ? (
          <div style={styles.empty}>
            <div style={styles.emptyTitle}>No detections yet</div>
            <div style={styles.emptySub}>
              Verses detected from speech appear here
            </div>
          </div>
        ) : (
          recentDetections.map((item, i) => (
            <div
              key={`${item.reference}-${i}`}
              style={styles.item}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-verse', JSON.stringify({
                  reference: item.reference,
                  text: item.text,
                  active: item.active,
                }));
                e.dataTransfer.effectAllowed = 'copyMove';
              }}
              onClick={() => handleClick(item)}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#22223a';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <div style={styles.dot} />
              <div style={styles.itemContent}>
                <div style={styles.reference}>{item.reference}</div>
                <div style={styles.preview}>{item.text}</div>
              </div>
              <div style={styles.time}>{formatTime(item.detectedAt)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
