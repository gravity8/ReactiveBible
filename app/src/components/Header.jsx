import React, { useEffect } from 'react';
import useStore from '../store/useStore';
import DisplayOutputs from './DisplayOutputs';

export default function Header() {
  const isTranscribing = useStore((s) => s.isTranscribing);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const toggleSettings = useStore((s) => s.toggleSettings);
  const toggleProfileModal = useStore((s) => s.toggleProfileModal);
  const activeProfileId = useStore((s) => s.activeProfileId);
  const profiles = useStore((s) => s.profiles);
  const loadProfiles = useStore((s) => s.loadProfiles);

  useEffect(() => { loadProfiles(); }, []);

  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  const handleToggleMode = () => {
    setMode(mode === 'online' ? 'offline' : 'online');
  };

  const isOnline = mode === 'online';

  return (
    <header className="header">
      {/* Drag region for frameless macOS window */}
      <div className="header-drag" />

      {/* Left: brand */}
      <div className="header-left">
        <span className="header-logo">ReactiveBible</span>
        <span className="header-badge">FREE</span>
      </div>

      {/* Center: status pill + mode toggle */}
      <div className="header-center">
        <div className={`status-pill ${isTranscribing ? 'status-pill--active' : ''}`}>
          <span className="status-dot" />
          <span className="status-label">
            {isTranscribing ? 'Listening' : 'Ready'}
          </span>
        </div>

        <button
          onClick={handleToggleMode}
          title={isOnline
            ? 'Online mode: uses Groq LLM for better accuracy. Click to switch to offline.'
            : 'Offline mode: local regex only, no internet needed. Click to switch to online.'}
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
            marginLeft: 10,
            background: isOnline ? 'rgba(0,200,83,0.15)' : 'rgba(255,255,255,0.05)',
            color: isOnline ? '#00c853' : '#666',
          }}
        >
          <span style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: isOnline ? '#00c853' : '#444',
          }} />
          {isOnline ? 'Online' : 'Offline'}
        </button>

        <button
          onClick={toggleProfileModal}
          title={activeProfile ? `Profile: ${activeProfile.name}` : 'No pastor profile active — click to manage'}
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
            marginLeft: 6,
            background: activeProfile ? 'rgba(20,184,166,0.15)' : 'rgba(255,255,255,0.05)',
            color: activeProfile ? '#14b8a6' : '#555',
          }}
        >
          {/* Person icon */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          {activeProfile ? activeProfile.name : 'No Profile'}
        </button>
      </div>

      {/* Right: actions */}
      <div className="header-right">
        <DisplayOutputs />

        <button
          className="header-btn"
          onClick={toggleSettings}
          title="Settings"
        >
          {/* Gear icon */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </header>
  );
}
