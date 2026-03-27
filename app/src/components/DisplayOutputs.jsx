import React, { useState, useEffect, useRef } from 'react';
import useStore from '../store/useStore';

const s = {
  wrapper: { position: 'relative' },
  btn: {
    background: 'transparent', border: 'none', color: '#888',
    width: 36, height: 36, borderRadius: 6, display: 'flex',
    alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    transition: 'all 0.15s',
  },
  dropdown: {
    position: 'absolute', top: 40, right: 0, width: 320,
    background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: 10,
    padding: 12, zIndex: 100, boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  title: { fontSize: 13, fontWeight: 700, color: '#e0e0e0', marginBottom: 2 },
  option: (active) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
    background: active ? 'rgba(20,184,166,0.1)' : 'rgba(255,255,255,0.03)',
    border: `1px solid ${active ? 'rgba(20,184,166,0.3)' : '#2a2a3e'}`,
    transition: 'all 0.15s',
  }),
  optLabel: { fontSize: 13, fontWeight: 600, color: '#e0e0e0' },
  optDesc: { fontSize: 11, color: '#888', marginTop: 2 },
  optStatus: (on) => ({
    fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
    background: on ? 'rgba(0,200,83,0.15)' : 'rgba(255,255,255,0.05)',
    color: on ? '#00c853' : '#666',
  }),
  url: {
    fontSize: 11, color: '#14b8a6', background: 'rgba(20,184,166,0.08)',
    padding: '6px 10px', borderRadius: 6, marginTop: 6, cursor: 'pointer',
    wordBreak: 'break-all', textAlign: 'center', border: '1px solid rgba(20,184,166,0.2)',
  },
  clients: { fontSize: 11, color: '#888', marginTop: 4, textAlign: 'center' },
};

export default function DisplayOutputs() {
  const [open, setOpen] = useState(false);
  const [displayWindowOpen, setDisplayWindowOpen] = useState(false);
  const [networkInfo, setNetworkInfo] = useState({ running: false, url: null, clients: 0 });
  const { showToast } = useStore();
  const ref = useRef();

  // Close dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Poll network display info when dropdown is open.
  useEffect(() => {
    if (!open) return;
    const poll = async () => {
      const info = await window.api?.getNetworkDisplayInfo();
      if (info) setNetworkInfo(info);
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [open]);

  const handleDisplayWindow = () => {
    if (displayWindowOpen) {
      window.api?.closeDisplayWindow();
      setDisplayWindowOpen(false);
    } else {
      window.api?.openDisplayWindow();
      setDisplayWindowOpen(true);
    }
  };

  const handleNetworkDisplay = async () => {
    if (networkInfo.running) {
      await window.api?.stopNetworkDisplay();
      setNetworkInfo({ running: false, url: null, clients: 0 });
    } else {
      const result = await window.api?.startNetworkDisplay();
      if (result?.url) {
        setNetworkInfo({ running: true, url: result.url, clients: result.clients });
        showToast(`Network display started at ${result.url}`, 'info', 5000);
      }
    }
  };

  const copyUrl = () => {
    if (networkInfo.url) {
      navigator.clipboard.writeText(networkInfo.url);
      showToast('Display URL copied', 'info', 2000);
    }
  };

  return (
    <div style={s.wrapper} ref={ref}>
      <button
        style={{ ...s.btn, color: (displayWindowOpen || networkInfo.running) ? '#14b8a6' : '#888' }}
        onClick={() => setOpen(!open)}
        title="Display outputs"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      </button>

      {open && (
        <div style={s.dropdown}>
          <div style={s.title}>Display Outputs</div>

          {/* Option 1: Display Window */}
          <div style={s.option(displayWindowOpen)} onClick={handleDisplayWindow}>
            <div>
              <div style={s.optLabel}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: -2, marginRight: 6 }}>
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
                Display Window
              </div>
              <div style={s.optDesc}>Drag to projector or second screen. Also works as OBS window capture.</div>
            </div>
            <span style={s.optStatus(displayWindowOpen)}>{displayWindowOpen ? 'ON' : 'OFF'}</span>
          </div>

          {/* Option 2: Network Display */}
          <div>
            <div style={s.option(networkInfo.running)} onClick={handleNetworkDisplay}>
              <div>
                <div style={s.optLabel}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: -2, marginRight: 6 }}>
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  Network Display
                </div>
                <div style={s.optDesc}>Open on any browser, smart TV, tablet, or phone on the same WiFi.</div>
              </div>
              <span style={s.optStatus(networkInfo.running)}>{networkInfo.running ? 'ON' : 'OFF'}</span>
            </div>
            {networkInfo.running && networkInfo.url && (
              <>
                <div style={s.url} onClick={copyUrl} title="Click to copy URL">
                  {networkInfo.url}
                </div>
                <div style={s.clients}>
                  {networkInfo.clients} device{networkInfo.clients !== 1 ? 's' : ''} connected
                </div>
              </>
            )}
          </div>

          {/* Option 3: vMix / NDI */}
          <div>
            <div
              style={s.option(networkInfo.running)}
              onClick={async () => {
                if (!networkInfo.running) await handleNetworkDisplay();
                copyUrl();
              }}
            >
              <div>
                <div style={s.optLabel}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: -2, marginRight: 6 }}>
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="M6 8h.01M10 8h.01M14 8h4" />
                  </svg>
                  vMix / NDI
                </div>
                <div style={s.optDesc}>
                  Add as a <b>Web Browser input</b> in vMix. Works like NDI — zero latency, native rendering.
                </div>
              </div>
              <span style={s.optStatus(networkInfo.running)}>{networkInfo.running ? 'READY' : 'START'}</span>
            </div>
            {networkInfo.running && networkInfo.url && (
              <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, marginTop: 4, border: '1px solid #2a2a3e' }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>In vMix: Add Input → Web Browser → paste this URL:</div>
                <div style={s.url} onClick={copyUrl} title="Click to copy">
                  {networkInfo.url}
                </div>
                <div style={{ fontSize: 10, color: '#555', marginTop: 6, lineHeight: 1.5 }}>
                  Set resolution to match your output (1920x1080).<br />
                  Also works as OBS "Browser Source" or any app that accepts a URL input.
                </div>
              </div>
            )}
          </div>

          {/* Option 4: OBS */}
          <div style={{ ...s.option(false), cursor: 'default', opacity: 0.7 }}>
            <div>
              <div style={s.optLabel}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: -2, marginRight: 6 }}>
                  <circle cx="12" cy="12" r="10" />
                  <polygon points="10 8 16 12 10 16 10 8" />
                </svg>
                OBS Studio
              </div>
              <div style={s.optDesc}>Use Display Window as "Window Capture", or Network Display URL as "Browser Source".</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
