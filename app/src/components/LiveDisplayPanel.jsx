import React, { useState } from 'react';
import useStore from '../store/useStore';
import THEMES from '../themes';

export default function LiveDisplayPanel() {
  const liveVerse = useStore((s) => s.liveVerse);
  const isLiveEnabled = useStore((s) => s.isLiveEnabled);
  const toggleLive = useStore((s) => s.toggleLive);
  const clearLive = useStore((s) => s.clearLive);
  const sendDirectToLive = useStore((s) => s.sendDirectToLive);
  const displayBg = useStore((s) => s.displayBg);
  const setDisplayBg = useStore((s) => s.setDisplayBg);
  const clearDisplayBg = useStore((s) => s.clearDisplayBg);
  const displayTheme = useStore((s) => s.displayTheme);
  const setDisplayTheme = useStore((s) => s.setDisplayTheme);
  const clearDisplayTheme = useStore((s) => s.clearDisplayTheme);
  const [dragOver, setDragOver] = useState(false);
  const [themePicker, setThemePicker] = useState(false);

  const handleDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    try {
      const verse = JSON.parse(e.dataTransfer.getData('application/x-verse'));
      if (verse?.text) sendDirectToLive(verse);
    } catch {}
  };

  const handlePickBg = async () => {
    try {
      console.log('Opening file picker...');
      const dataUrl = await window.api.pickDisplayBg();
      console.log('File picker result:', dataUrl ? 'got image' : 'cancelled');
      if (dataUrl) setDisplayBg(dataUrl);
    } catch (err) {
      console.error('Pick BG failed:', err);
    }
  };

  const activeTheme = THEMES.find((t) => t.id === displayTheme) || THEMES[0];
  const cardStyle = {
    backgroundImage: displayBg ? `url(${displayBg})` : 'none',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundColor: displayBg ? 'transparent' : activeTheme.preview.bg,
  };

  return (
    <div
      className="panel panel--live"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={dragOver ? { outline: '2px solid #00c853', outlineOffset: -2 } : undefined}
    >
      {/* ── Header ── */}
      <div className="panel-header">
        <h2 className="panel-title">Live display</h2>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Theme picker button */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={displayTheme !== 'midnight' ? clearDisplayTheme : () => setThemePicker(!themePicker)}
              title={displayTheme !== 'midnight' ? 'Reset theme' : 'Choose display theme'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 8px',
                borderRadius: 12,
                border: 'none',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s',
                background: displayTheme !== 'midnight' ? 'rgba(20,184,166,0.15)' : themePicker ? 'rgba(20,184,166,0.15)' : 'rgba(255,255,255,0.05)',
                color: displayTheme !== 'midnight' ? '#14b8a6' : themePicker ? '#14b8a6' : '#666',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="4" />
                <line x1="21.17" y1="8" x2="12" y2="8" />
                <line x1="3.95" y1="6.06" x2="8.54" y2="14" />
                <line x1="10.88" y1="21.94" x2="15.46" y2="14" />
              </svg>
              {displayTheme !== 'midnight' ? 'Clear Theme' : 'Theme'}
            </button>
            {themePicker && (
              <div style={{
                position: 'absolute', top: 28, right: 0, zIndex: 50,
                background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: 10,
                padding: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
                display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6,
                width: 260,
              }}>
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { setDisplayTheme(t.id); setThemePicker(false); }}
                    title={t.name}
                    style={{
                      width: 44, height: 44, borderRadius: 8, cursor: 'pointer',
                      background: t.preview.bg,
                      border: displayTheme === t.id
                        ? `2px solid ${t.preview.accent}`
                        : '2px solid transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s',
                      boxShadow: displayTheme === t.id ? `0 0 8px ${t.preview.accent}40` : 'none',
                    }}
                  >
                    <span style={{
                      fontSize: 8, fontWeight: 700, color: t.preview.accent,
                      textTransform: 'uppercase', letterSpacing: 0.3,
                      textAlign: 'center', lineHeight: 1.2,
                    }}>
                      {t.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Background image button */}
          <button
            onClick={displayBg ? clearDisplayBg : handlePickBg}
            title={displayBg ? 'Remove background image' : 'Import background image'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 8px',
              borderRadius: 12,
              border: 'none',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s',
              background: displayBg ? 'rgba(20,184,166,0.15)' : 'rgba(255,255,255,0.05)',
              color: displayBg ? '#14b8a6' : '#666',
            }}
          >
            {/* Image icon */}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            {displayBg ? 'Clear BG' : 'BG Image'}
          </button>

          {/* Go live toggle */}
          <label className="toggle">
            <input
              className="toggle-input"
              type="checkbox"
              checked={isLiveEnabled}
              onChange={(e) => toggleLive(e.target.checked)}
            />
            <span className={`toggle-track ${isLiveEnabled ? 'toggle-track--on' : ''}`}>
              <span className="toggle-thumb" />
            </span>
            <span className="toggle-label">Go live</span>
          </label>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="panel-body">
        {liveVerse ? (
          <div className="verse-card verse-card--live" style={cardStyle}>
            <div style={{
              background: displayBg ? 'rgba(0,0,0,0.55)' : 'transparent',
              borderRadius: 8,
              padding: displayBg ? 16 : 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              gap: 12,
              maxWidth: '90%',
            }}>
              <p className="verse-card-text">{liveVerse.text}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="verse-card-reference">{liveVerse.reference}</span>
                {liveVerse.active && (
                  <span className="verse-card-translation">({liveVerse.active})</span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="verse-card" style={cardStyle}>
            <div className="panel-empty">
              <svg className="panel-empty-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              <p className="panel-empty-text">Nothing on screen</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="panel-footer">
        <button
          className="btn btn--danger btn--block"
          disabled={!liveVerse}
          onClick={clearLive}
        >
          <svg className="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          Clear screen
        </button>
      </div>
    </div>
  );
}
