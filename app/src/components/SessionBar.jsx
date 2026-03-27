import React, { useState } from 'react';
import useStore from '../store/useStore';

const s = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    background: '#111',
    borderBottom: '1px solid #2a2a2a',
    fontSize: 12,
    flexShrink: 0,
    WebkitAppRegion: 'no-drag',
    position: 'relative',
    zIndex: 5,
  },
  label: { color: '#888', fontWeight: 500 },
  value: { color: '#e0e0e0', fontWeight: 600 },
  pin: { color: '#14b8a6', fontWeight: 700, letterSpacing: 2, fontSize: 14 },
  ip: { color: '#14b8a6', fontWeight: 600 },
  dot: (on) => ({
    width: 6, height: 6, borderRadius: '50%',
    background: on ? '#00c853' : '#555',
    flexShrink: 0,
  }),
  clients: { color: '#888', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 },
  btn: (variant) => ({
    padding: '4px 12px',
    borderRadius: 6,
    border: 'none',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s',
    background: variant === 'primary' ? 'rgba(20,184,166,0.15)' : variant === 'danger' ? 'rgba(255,68,68,0.15)' : 'rgba(255,255,255,0.05)',
    color: variant === 'primary' ? '#14b8a6' : variant === 'danger' ? '#ff4444' : '#888',
  }),
  modal: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  dialog: {
    background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: 12,
    padding: 24, width: 360, display: 'flex', flexDirection: 'column', gap: 16,
  },
  title: { fontSize: 16, fontWeight: 700, color: '#e0e0e0' },
  input: {
    background: '#12121e', border: '1px solid #2a2a3e', borderRadius: 6,
    padding: '8px 10px', color: '#e0e0e0', fontSize: 13, outline: 'none', width: '100%',
  },
  fieldLabel: { fontSize: 12, color: '#888', marginBottom: 4 },
  row: { display: 'flex', gap: 8 },
};

export default function SessionBar() {
  const {
    sessionRole, sessionIP, sessionPin, sessionConnected,
    connectedClients, sessionName, setSessionName,
    startSession, stopSession, joinSession, leaveSession, showToast, transferHost,
  } = useStore();

  const [showDialog, setShowDialog] = useState(null); // 'host' | 'join' | null
  const [joinHost, setJoinHost] = useState('');
  const [joinPin, setJoinPin] = useState('');
  const [nameInput, setNameInput] = useState(sessionName || '');
  const [loading, setLoading] = useState(false);
  const [transferTarget, setTransferTarget] = useState(null);

  const handleStartSession = async () => {
    if (!nameInput.trim()) {
      showToast('Please enter your name', 'warning');
      return;
    }
    setLoading(true);
    setSessionName(nameInput.trim());
    try {
      const result = await startSession(nameInput.trim());
      if (result?.success) {
        setShowDialog(null);
        showToast(`Session started. PIN: ${result.pin}`, 'info', 6000);
      } else {
        showToast(result?.error || 'Failed to start session', 'error');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinSession = async () => {
    if (!nameInput.trim()) { showToast('Please enter your name', 'warning'); return; }
    if (!joinHost.trim()) { showToast('Please enter the host IP address', 'warning'); return; }
    if (!joinPin.trim()) { showToast('Please enter the session PIN', 'warning'); return; }
    setLoading(true);
    setSessionName(nameInput.trim());
    try {
      const result = await joinSession({
        host: joinHost.trim(),
        pin: joinPin.trim(),
        name: nameInput.trim(),
      });
      if (result?.success) {
        setShowDialog(null);
        showToast('Connected to session', 'info');
      } else {
        showToast(result?.error || 'Failed to join', 'error');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Not in a session — show join/host buttons.
  if (!sessionRole) {
    return (
      <>
        <div style={s.bar}>
          <span style={s.label}>Session:</span>
          <span style={{ color: '#555' }}>Not connected</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, position: 'relative', zIndex: 10 }}>
            <button style={s.btn('primary')} onClick={() => { console.log('Host clicked'); setShowDialog('host'); }}>
              Host Session
            </button>
            <button style={s.btn()} onClick={() => { console.log('Join clicked'); setShowDialog('join'); }}>
              Join Session
            </button>
          </div>
        </div>

        {showDialog && (
          <div style={s.modal} onClick={(e) => { if (e.target === e.currentTarget) setShowDialog(null); }}>
            <div style={s.dialog}>
              <div style={s.title}>{showDialog === 'host' ? 'Host a Session' : 'Join a Session'}</div>

              <div>
                <div style={s.fieldLabel}>Your name</div>
                <input
                  style={s.input}
                  placeholder="e.g. David"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  autoFocus
                />
              </div>

              {showDialog === 'join' && (
                <>
                  <div>
                    <div style={s.fieldLabel}>Host IP address</div>
                    <input
                      style={s.input}
                      placeholder="e.g. 192.168.1.5"
                      value={joinHost}
                      onChange={(e) => setJoinHost(e.target.value)}
                    />
                  </div>
                  <div>
                    <div style={s.fieldLabel}>Session PIN</div>
                    <input
                      style={s.input}
                      placeholder="4-digit PIN"
                      value={joinPin}
                      onChange={(e) => setJoinPin(e.target.value)}
                      maxLength={4}
                    />
                  </div>
                </>
              )}

              <div style={s.row}>
                <button
                  style={{
                    ...s.btn('primary'),
                    flex: 1,
                    padding: '8px 16px',
                    opacity: loading ? 0.6 : 1,
                    pointerEvents: loading ? 'none' : 'auto',
                  }}
                  onClick={showDialog === 'host' ? handleStartSession : handleJoinSession}
                  disabled={loading}
                >
                  {loading ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" style={{ animation: 'spin 1s linear infinite' }}>
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="31 31" strokeLinecap="round" />
                      </svg>
                      {showDialog === 'host' ? 'Starting...' : 'Connecting...'}
                    </span>
                  ) : (
                    showDialog === 'host' ? 'Start Session' : 'Connect'
                  )}
                </button>
                <button
                  style={{ ...s.btn(), padding: '8px 16px' }}
                  onClick={() => { if (!loading) setShowDialog(null); }}
                  disabled={loading}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // In a session — show session info.
  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text).then(() => {
      showToast(`${label} copied to clipboard`, 'info', 2000);
    });
  };

  return (
    <div style={s.bar}>
      <span style={s.dot(sessionConnected)} />
      <span style={s.label}>{sessionRole === 'host' ? 'Hosting' : 'Connected'}</span>

      {sessionRole === 'host' && (
        <>
          <span style={s.label}>IP:</span>
          <span
            style={{ ...s.ip, cursor: 'pointer', userSelect: 'all' }}
            onClick={() => copyToClipboard(sessionIP, 'IP address')}
            title="Click to copy IP"
          >{sessionIP}</span>

          <span style={s.label}>PIN:</span>
          <span
            style={{ ...s.pin, cursor: 'pointer', userSelect: 'all' }}
            onClick={() => copyToClipboard(sessionPin, 'PIN')}
            title="Click to copy PIN"
          >{sessionPin}</span>

          <button
            style={{ ...s.btn('primary'), marginLeft: 4, padding: '3px 8px', fontSize: 10 }}
            onClick={() => copyToClipboard(`IP: ${sessionIP}  PIN: ${sessionPin}`, 'Connection details')}
            title="Copy connection details"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Copy
          </button>
        </>
      )}

      <div style={s.clients}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <span>{connectedClients.length + 1}</span>
        {connectedClients.map((c) => (
          <span key={c.id} style={{ color: '#666', display: 'inline-flex', alignItems: 'center', gap: 3 }} title={`${c.name} (${c.role})`}>
            {c.name}
            {sessionRole === 'host' && (
              transferTarget === c.id ? (
                <span style={{ display: 'inline-flex', gap: 3 }}>
                  <button
                    style={{
                      background: 'rgba(20,184,166,0.2)', border: '1px solid #14b8a6', borderRadius: 4,
                      color: '#14b8a6', fontSize: 9, padding: '1px 5px', cursor: 'pointer',
                      lineHeight: 1.4, fontWeight: 700,
                    }}
                    onClick={() => { transferHost(c.id); setTransferTarget(null); }}
                  >
                    Confirm
                  </button>
                  <button
                    style={{
                      background: 'none', border: '1px solid #333', borderRadius: 4,
                      color: '#888', fontSize: 9, padding: '1px 5px', cursor: 'pointer',
                      lineHeight: 1.4,
                    }}
                    onClick={() => setTransferTarget(null)}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  style={{
                    background: 'none', border: '1px solid #333', borderRadius: 4,
                    color: '#888', fontSize: 9, padding: '1px 5px', cursor: 'pointer',
                    lineHeight: 1.4, transition: 'all 0.15s',
                  }}
                  title={`Transfer host role to ${c.name}`}
                  onClick={() => setTransferTarget(c.id)}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#14b8a6'; e.currentTarget.style.borderColor = '#14b8a6'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#888'; e.currentTarget.style.borderColor = '#333'; }}
                >
                  Make Host
                </button>
              )
            )}
          </span>
        ))}
      </div>

      <button
        style={s.btn('danger')}
        onClick={sessionRole === 'host' ? stopSession : leaveSession}
      >
        {sessionRole === 'host' ? 'End Session' : 'Leave'}
      </button>
    </div>
  );
}
