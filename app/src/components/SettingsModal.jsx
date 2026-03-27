import React, { useState, useEffect } from 'react';
import useStore from '../store/useStore';

const TRANSLATIONS = ['KJV', 'NLT', 'AMP', 'NIV', 'NKJV', 'MSG'];

/* ── Inline styles (dark theme) ── */
const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#1a1a2e',
    border: '1px solid #2a2a3e',
    borderRadius: 12,
    width: 420,
    maxWidth: '90vw',
    maxHeight: '80vh',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  },

  /* ── Header ── */
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid #2a2a3e',
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    color: '#e0e0e0',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#888',
    fontSize: 20,
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 6,
    lineHeight: 1,
    transition: 'color .12s',
  },

  /* ── Body ── */
  body: {
    padding: '16px 20px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    overflowY: 'auto',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: '#aaa',
  },
  select: {
    background: '#12121e',
    border: '1px solid #2a2a3e',
    borderRadius: 6,
    padding: '8px 10px',
    color: '#e0e0e0',
    fontSize: 13,
    outline: 'none',
    cursor: 'pointer',
  },

  /* ── Toggle row ── */
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  toggleLabel: {
    fontSize: 13,
    color: '#ccc',
  },
  toggle: (on) => ({
    width: 40,
    height: 22,
    borderRadius: 11,
    background: on ? '#14b8a6' : '#333',
    border: 'none',
    cursor: 'pointer',
    position: 'relative',
    flexShrink: 0,
    transition: 'background .2s',
  }),
  toggleKnob: (on) => ({
    position: 'absolute',
    top: 3,
    left: on ? 21 : 3,
    width: 16,
    height: 16,
    borderRadius: '50%',
    background: '#fff',
    transition: 'left .2s',
  }),
};

export default function SettingsModal() {
  const {
    settingsOpen,
    closeSettings,
    autoPreview,
    autoLive,
    setAutoPreview,
    setAutoLive,
    mode,
    setMode,
  } = useStore();

  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [defaultTranslation, setDefaultTranslation] = useState('KJV');

  // Enumerate audio input devices on mount
  useEffect(() => {
    if (!settingsOpen) return;

    async function loadDevices() {
      try {
        // Request permission first so labels are populated
        await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) =>
          s.getTracks().forEach((t) => t.stop())
        );
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter((d) => d.kind === 'audioinput');
        setAudioDevices(inputs);
        if (inputs.length > 0 && !selectedDevice) {
          setSelectedDevice(inputs[0].deviceId);
        }
      } catch (err) {
        console.error('Failed to enumerate audio devices:', err);
      }
    }

    loadDevices();
  }, [settingsOpen]);

  if (!settingsOpen) return null;

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) closeSettings();
  };

  return (
    <div style={styles.overlay} onClick={handleOverlayClick}>
      <div style={styles.modal}>
        {/* ── Header ── */}
        <div style={styles.header}>
          <span style={styles.title}>Settings</span>
          <button
            style={styles.closeBtn}
            onClick={closeSettings}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#e0e0e0'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#888'; }}
          >
            &#x2715;
          </button>
        </div>

        {/* ── Body ── */}
        <div style={styles.body}>
          {/* Audio input device */}
          <div style={styles.field}>
            <label style={styles.label}>Audio input device</label>
            <select
              style={styles.select}
              value={selectedDevice}
              onChange={(e) => setSelectedDevice(e.target.value)}
            >
              {audioDevices.length === 0 && (
                <option value="">No devices found</option>
              )}
              {audioDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Microphone (${d.deviceId.slice(0, 8)}...)`}
                </option>
              ))}
            </select>
          </div>

          {/* Default translation */}
          <div style={styles.field}>
            <label style={styles.label}>Default translation</label>
            <select
              style={styles.select}
              value={defaultTranslation}
              onChange={(e) => setDefaultTranslation(e.target.value)}
            >
              {TRANSLATIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Detection mode */}
          <div style={styles.field}>
            <label style={styles.label}>Detection mode</label>
            <select
              style={styles.select}
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="online">Online — Groq LLM (better accuracy, needs internet)</option>
              <option value="offline">Offline — Local regex only (faster, no internet)</option>
            </select>
            <span style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
              {mode === 'online'
                ? 'Uses Groq AI to understand garbled speech and ambiguous references. Falls back to local when rate-limited.'
                : 'Uses local pattern matching only. Faster but less accurate with accented speech.'}
            </span>
          </div>

          {/* Auto-send to preview */}
          <div style={styles.toggleRow}>
            <span style={styles.toggleLabel}>
              Auto-send detected verses to preview
            </span>
            <button
              style={styles.toggle(autoPreview)}
              onClick={() => setAutoPreview(!autoPreview)}
            >
              <div style={styles.toggleKnob(autoPreview)} />
            </button>
          </div>

          {/* Auto-send preview to live */}
          <div style={styles.toggleRow}>
            <span style={styles.toggleLabel}>
              Auto-send preview to live
            </span>
            <button
              style={styles.toggle(autoLive)}
              onClick={() => setAutoLive(!autoLive)}
            >
              <div style={styles.toggleKnob(autoLive)} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
