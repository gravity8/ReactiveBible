const { contextBridge, ipcRenderer } = require('electron');

console.log('[preload] Loading preload.js...');

// Track registered listeners so they can be cleaned up on HMR.
const listeners = [];

function onChannel(channel, callback) {
  const wrapped = (e, ...args) => callback(...args);
  ipcRenderer.on(channel, wrapped);
  listeners.push({ channel, wrapped });
}

try {
contextBridge.exposeInMainWorld('api', {
  // Transcription control
  startTranscription: (sampleRate) => ipcRenderer.invoke('start-transcription', sampleRate),
  stopTranscription: () => ipcRenderer.invoke('stop-transcription'),
  sendAudio: (buffer) => ipcRenderer.send('send-audio', buffer),

  // Display control
  sendToDisplay: (verse) => ipcRenderer.invoke('send-to-display', verse),
  clearDisplay: () => ipcRenderer.invoke('clear-display'),
  openDisplayWindow: () => ipcRenderer.invoke('open-display-window'),
  closeDisplayWindow: () => ipcRenderer.invoke('close-display-window'),
  getDisplays: () => ipcRenderer.invoke('get-displays'),

  // Display background
  pickDisplayBg: () => ipcRenderer.invoke('pick-display-bg'),
  sendDisplayBg: (bg) => ipcRenderer.invoke('send-display-bg', bg),
  sendDisplayTheme: (themeId) => ipcRenderer.invoke('send-display-theme', themeId),

  // Network display
  startNetworkDisplay: () => ipcRenderer.invoke('start-network-display'),
  stopNetworkDisplay: () => ipcRenderer.invoke('stop-network-display'),
  getNetworkDisplayInfo: () => ipcRenderer.invoke('get-network-display-info'),

  // Config and search
  getConfig: () => ipcRenderer.invoke('get-config'),
  searchVerse: (query, translation) => ipcRenderer.invoke('search-verse', query, translation),
  fetchChapterOnline: (opts) => ipcRenderer.invoke('fetch-chapter-online', opts),
  getOnlineTranslations: () => ipcRenderer.invoke('get-online-translations'),
  setMode: (mode) => ipcRenderer.invoke('set-mode', mode),

  // Session / Collaboration
  startSession: (name) => ipcRenderer.invoke('start-session', name),
  stopSession: () => ipcRenderer.invoke('stop-session'),
  joinSession: (opts) => ipcRenderer.invoke('join-session', opts),
  leaveSession: () => ipcRenderer.invoke('leave-session'),
  syncAction: (data) => ipcRenderer.invoke('sync-action', data),
  syncBroadcast: (data) => ipcRenderer.invoke('sync-broadcast', data),
  syncState: (state) => ipcRenderer.invoke('sync-state', state),
  promoteToHost: (arg) => ipcRenderer.invoke('promote-to-host', arg),
  transferHost: (targetId) => ipcRenderer.invoke('transfer-host', targetId),
  getSessionInfo: () => ipcRenderer.invoke('get-session-info'),

  // Event listeners — use onChannel to track them.
  onVerseDetected: (cb) => onChannel('verse-detected', cb),
  onTranscript: (cb) => onChannel('transcript', cb),
  onLog: (cb) => onChannel('log', cb),
  onTranslationChanged: (cb) => onChannel('translation-changed', cb),
  onTranscriptionStopped: (cb) => onChannel('transcription-stopped', cb),
  onDisplayClosed: (cb) => onChannel('display-closed', cb),
  onShowVerse: (cb) => onChannel('show-verse', cb),
  onClearVerse: (cb) => onChannel('clear-verse', cb),
  onSetBackground: (cb) => onChannel('set-background', cb),
  onSetTheme: (cb) => onChannel('set-theme', cb),
  onError: (cb) => onChannel('error', cb),
  onSessionSync: (cb) => onChannel('session-sync', cb),
  onSessionUpdate: (cb) => onChannel('session-update', cb),
  onSessionClients: (cb) => onChannel('session-clients', cb),
  onRemoteAction: (cb) => onChannel('remote-action', cb),
  onActionRejected: (cb) => onChannel('action-rejected', cb),
  onHostLost: (cb) => onChannel('host-lost', cb),
  onSessionDisconnected: (cb) => onChannel('session-disconnected', cb),
  onSessionError: (cb) => onChannel('session-error', cb),
  onBecomeHost: (cb) => onChannel('become-host', cb),
  onSessionTransferred: (cb) => onChannel('session-transferred', cb),

  // Cleanup all listeners (called before re-registering on HMR).
  removeAllListeners: () => {
    for (const { channel, wrapped } of listeners) {
      ipcRenderer.removeListener(channel, wrapped);
    }
    listeners.length = 0;
  },
});
console.log('[preload] window.api exposed successfully');
} catch (err) {
  console.error('[preload] FATAL: Failed to expose API:', err);
}
