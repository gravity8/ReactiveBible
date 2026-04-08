import React, { useState, useEffect } from 'react';
import useStore from '../store/useStore';

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
    width: 500,
    maxWidth: '90vw',
    maxHeight: '80vh',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid #2a2a3e',
  },
  title: { fontSize: 16, fontWeight: 700, color: '#e0e0e0' },
  closeBtn: {
    background: 'none', border: 'none', color: '#888',
    fontSize: 20, cursor: 'pointer', padding: '4px 8px',
    borderRadius: 6, lineHeight: 1,
  },
  body: {
    padding: '16px 20px 24px',
    display: 'flex', flexDirection: 'column', gap: 16,
    overflowY: 'auto',
  },
  label: { fontSize: 13, fontWeight: 600, color: '#aaa' },
  input: {
    background: '#12121e', border: '1px solid #2a2a3e',
    borderRadius: 6, padding: '8px 10px', color: '#e0e0e0',
    fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box',
  },
  textarea: {
    background: '#12121e', border: '1px solid #2a2a3e',
    borderRadius: 6, padding: '8px 10px', color: '#e0e0e0',
    fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box',
    minHeight: 80, resize: 'vertical', fontFamily: 'inherit',
  },
  profileCard: (isActive) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', borderRadius: 8,
    background: isActive ? 'rgba(20,184,166,0.1)' : '#12121e',
    border: isActive ? '1px solid #14b8a6' : '1px solid #2a2a3e',
    cursor: 'pointer', transition: 'all 0.15s',
  }),
  profileName: { fontSize: 14, fontWeight: 600, color: '#e0e0e0' },
  profileMeta: { fontSize: 11, color: '#666', marginTop: 2 },
  activeBadge: {
    fontSize: 10, fontWeight: 700, color: '#14b8a6',
    background: 'rgba(20,184,166,0.15)', padding: '2px 8px',
    borderRadius: 8,
  },
  btn: (variant) => ({
    padding: '8px 16px', borderRadius: 8, border: 'none',
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
    transition: 'all 0.15s',
    ...(variant === 'primary' ? {
      background: '#14b8a6', color: '#fff',
    } : variant === 'danger' ? {
      background: 'rgba(239,68,68,0.15)', color: '#ef4444',
    } : {
      background: 'rgba(255,255,255,0.05)', color: '#aaa',
    }),
  }),
  progressBar: {
    height: 4, borderRadius: 2, background: '#2a2a3e', overflow: 'hidden',
  },
  progressFill: (pct) => ({
    height: '100%', width: `${pct}%`, background: '#14b8a6',
    transition: 'width 0.3s',
  }),
  emptyState: {
    textAlign: 'center', padding: '32px 16px', color: '#555', fontSize: 13,
  },
  detailRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '6px 0', borderBottom: '1px solid #1e1e2e',
  },
  detailLabel: { fontSize: 12, color: '#888' },
  detailValue: { fontSize: 12, color: '#e0e0e0', fontWeight: 600 },
};

// ── Profile List View ──
function ProfileListView({ onNewProfile, onViewDetail }) {
  const profiles = useStore((s) => s.profiles);
  const activeProfileId = useStore((s) => s.activeProfileId);
  const activateProfile = useStore((s) => s.activateProfile);
  const removeProfile = useStore((s) => s.removeProfile);

  return (
    <>
      {profiles.length === 0 ? (
        <div style={styles.emptyState}>
          No pastor profiles yet. Create one by providing YouTube sermon links.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {profiles.map((p) => {
            const isActive = p.id === activeProfileId;
            return (
              <div key={p.id} style={styles.profileCard(isActive)}>
                <div
                  style={{ flex: 1, cursor: 'pointer' }}
                  onClick={() => onViewDetail(p.id)}
                >
                  <div style={styles.profileName}>{p.name}</div>
                  <div style={styles.profileMeta}>
                    {p.preferredTranslation || 'No translation detected'}
                    {p.sermonCount > 0 && ` \u00B7 ${p.sermonCount} sermon${p.sermonCount !== 1 ? 's' : ''}`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {isActive ? (
                    <span style={styles.activeBadge}>ACTIVE</span>
                  ) : (
                    <button
                      style={styles.btn()}
                      onClick={() => activateProfile(p.id)}
                    >
                      Activate
                    </button>
                  )}
                  <button
                    style={styles.btn('danger')}
                    onClick={() => {
                      if (confirm(`Delete profile "${p.name}"?`)) removeProfile(p.id);
                    }}
                    title="Delete profile"
                  >
                    &times;
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginTop: 8 }}>
        <button style={styles.btn('primary')} onClick={onNewProfile}>
          + New Profile
        </button>
        {activeProfileId && (
          <button style={styles.btn()} onClick={() => activateProfile(null)}>
            Deactivate Profile
          </button>
        )}
      </div>
    </>
  );
}

// ── New Profile / Calibration View ──
function NewProfileView({ onBack }) {
  const [name, setName] = useState('');
  const [urls, setUrls] = useState('');
  const calibrationState = useStore((s) => s.calibrationState);
  const setCalibrationState = useStore((s) => s.setCalibrationState);
  const loadProfiles = useStore((s) => s.loadProfiles);

  const isCalibrating = calibrationState !== null;

  useEffect(() => {
    const handleProgress = (data) => setCalibrationState(data);
    const handleComplete = () => {
      setCalibrationState(null);
      loadProfiles();
      onBack();
    };
    const handleError = (data) => {
      setCalibrationState(null);
      alert(`Calibration failed: ${data?.message || 'Unknown error'}`);
    };

    window.api?.onCalibrationProgress(handleProgress);
    window.api?.onCalibrationComplete(handleComplete);
    window.api?.onCalibrationError(handleError);

    return () => {
      // Listeners are cleaned up via removeAllListeners on HMR.
    };
  }, []);

  const handleStart = () => {
    const urlList = urls.split('\n').map(u => u.trim()).filter(Boolean);
    if (!name.trim()) return alert('Please enter a name for this profile.');
    if (urlList.length === 0) return alert('Please enter at least one YouTube URL.');

    setCalibrationState({ phase: 'starting', current: 0, total: urlList.length, message: 'Starting...' });
    window.api?.startCalibration({ name: name.trim(), urls: urlList });
  };

  const handleCancel = () => {
    window.api?.cancelCalibration();
    setCalibrationState(null);
  };

  const progress = calibrationState
    ? Math.round(((calibrationState.current || 0) / Math.max(calibrationState.total || 1, 1)) * 100)
    : 0;

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={styles.label}>Pastor name</label>
        <input
          style={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Pastor John"
          disabled={isCalibrating}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={styles.label}>YouTube sermon links (one per line)</label>
        <textarea
          style={styles.textarea}
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          placeholder={"https://youtube.com/watch?v=...\nhttps://youtube.com/watch?v=..."}
          disabled={isCalibrating}
        />
        <span style={{ fontSize: 11, color: '#555' }}>
          Provide 3-5 sermons for best results. Uses YouTube captions for fast analysis (under a minute). Falls back to local Whisper if captions are unavailable.
        </span>
      </div>

      {isCalibrating && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, color: '#aaa' }}>
            {calibrationState.message || `${calibrationState.phase}... (${calibrationState.current}/${calibrationState.total})`}
          </div>
          <div style={styles.progressBar}>
            <div style={styles.progressFill(progress)} />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        {!isCalibrating ? (
          <>
            <button style={styles.btn()} onClick={onBack}>Back</button>
            <button style={styles.btn('primary')} onClick={handleStart}>
              Start Calibration
            </button>
          </>
        ) : (
          <button style={styles.btn('danger')} onClick={handleCancel}>
            Cancel
          </button>
        )}
      </div>
    </>
  );
}

// ── Profile Detail View ──
function ProfileDetailView({ profileId, onBack }) {
  const [profile, setProfile] = useState(null);
  const activeProfileId = useStore((s) => s.activeProfileId);
  const activateProfile = useStore((s) => s.activateProfile);

  useEffect(() => {
    window.api?.getActiveProfile().then(() => {
      // We need a getProfile(id) IPC — for now load active or find from list.
    });
    // Load directly via the profiles list data + any stored data.
    window.api?.getProfiles().then((list) => {
      const found = list?.find((p) => p.id === profileId);
      if (found) setProfile(found);
    });
  }, [profileId]);

  if (!profile) return <div style={styles.emptyState}>Loading...</div>;

  const isActive = activeProfileId === profileId;

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#e0e0e0' }}>
          {profile.name}
        </div>

        <div style={styles.detailRow}>
          <span style={styles.detailLabel}>Preferred Translation</span>
          <span style={styles.detailValue}>{profile.preferredTranslation || 'Not detected'}</span>
        </div>
        <div style={styles.detailRow}>
          <span style={styles.detailLabel}>Sermons Analyzed</span>
          <span style={styles.detailValue}>{profile.sermonCount || 0}</span>
        </div>
        <div style={styles.detailRow}>
          <span style={styles.detailLabel}>Status</span>
          <span style={{
            ...styles.detailValue,
            color: isActive ? '#14b8a6' : '#666',
          }}>
            {isActive ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button style={styles.btn()} onClick={onBack}>Back</button>
        {!isActive && (
          <button style={styles.btn('primary')} onClick={() => activateProfile(profileId)}>
            Activate
          </button>
        )}
      </div>
    </>
  );
}

// ── Main Modal ──
export default function PastorProfileModal() {
  const profileModalOpen = useStore((s) => s.profileModalOpen);
  const closeProfileModal = useStore((s) => s.closeProfileModal);
  const loadProfiles = useStore((s) => s.loadProfiles);

  const [view, setView] = useState('list'); // 'list' | 'new' | 'detail'
  const [detailId, setDetailId] = useState(null);

  useEffect(() => {
    if (profileModalOpen) {
      loadProfiles();
      setView('list');
    }
  }, [profileModalOpen]);

  if (!profileModalOpen) return null;

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) closeProfileModal();
  };

  return (
    <div style={styles.overlay} onClick={handleOverlayClick}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <span style={styles.title}>Pastor Profiles</span>
          <button
            style={styles.closeBtn}
            onClick={closeProfileModal}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#e0e0e0'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#888'; }}
          >
            &#x2715;
          </button>
        </div>
        <div style={styles.body}>
          {view === 'list' && (
            <ProfileListView
              onNewProfile={() => setView('new')}
              onViewDetail={(id) => { setDetailId(id); setView('detail'); }}
            />
          )}
          {view === 'new' && (
            <NewProfileView onBack={() => setView('list')} />
          )}
          {view === 'detail' && detailId && (
            <ProfileDetailView profileId={detailId} onBack={() => setView('list')} />
          )}
        </div>
      </div>
    </div>
  );
}
