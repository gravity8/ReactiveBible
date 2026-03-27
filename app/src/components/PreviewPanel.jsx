import React, { useState, useEffect, useRef } from 'react';
import useStore from '../store/useStore';

export default function PreviewPanel() {
  const previewVerse = useStore((s) => s.previewVerse);
  const setPreviewVerse = useStore((s) => s.setPreviewVerse);
  const sendToLive = useStore((s) => s.sendToLive);
  const addToQueue = useStore((s) => s.addToQueue);
  const autoLive = useStore((s) => s.autoLive);
  const setAutoLive = useStore((s) => s.setAutoLive);
  const [dragOver, setDragOver] = useState(false);

  // When autoLive is on and previewVerse changes, send to live.
  const prevRef = useRef(previewVerse);
  useEffect(() => {
    if (autoLive && previewVerse && previewVerse !== prevRef.current) {
      sendToLive();
    }
    prevRef.current = previewVerse;
  }, [previewVerse, autoLive, sendToLive]);

  const handleDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    try {
      const verse = JSON.parse(e.dataTransfer.getData('application/x-verse'));
      if (verse?.text) setPreviewVerse(verse);
    } catch {}
  };

  return (
    <div
      className="panel panel--preview"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={dragOver ? { outline: '2px solid #14b8a6', outlineOffset: -2 } : undefined}
    >
      {/* ── Header ── */}
      <div className="panel-header">
        <h2 className="panel-title">Program preview</h2>
        <button
          onClick={() => setAutoLive(!autoLive)}
          title={autoLive
            ? 'Auto send live ON: selecting a verse sends it straight to live. Click to disable.'
            : 'Auto send live OFF: verses stay in preview until you send them. Click to enable.'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '3px 10px',
            borderRadius: 12,
            border: 'none',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s',
            background: autoLive ? 'rgba(0,200,83,0.15)' : 'rgba(255,255,255,0.05)',
            color: autoLive ? '#00c853' : '#666',
          }}
        >
          <span style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: autoLive ? '#00c853' : '#444',
          }} />
          Auto send live
        </button>
      </div>

      {/* ── Body ── */}
      <div className="panel-body">
        {previewVerse ? (
          <div className="verse-card">
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12, maxWidth: '90%' }}>
              <p className="verse-card-text">{previewVerse.text}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="verse-card-reference">{previewVerse.reference}</span>
                {previewVerse.active && (
                  <span className="verse-card-translation">({previewVerse.active})</span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="panel-empty">
            <svg
              className="panel-empty-icon"
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
            <p className="panel-empty-text">No verse in preview</p>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="panel-footer">
        <button
          className="btn btn--primary btn--block"
          disabled={!previewVerse}
          onClick={sendToLive}
        >
          <svg className="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
          Send to live
        </button>

        <button
          className="btn btn--secondary"
          disabled={!previewVerse}
          onClick={() => previewVerse && addToQueue(previewVerse)}
        >
          <svg className="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Queue
        </button>
      </div>
    </div>
  );
}
