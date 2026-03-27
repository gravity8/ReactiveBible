import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import useStore from './store/useStore';
import './index.css';

/* ── IPC listeners from Electron main process ── */
let hostLostTimer = null; // Track promote timer to prevent duplicates.

function setupIpcListeners() {
  const api = window.api;
  if (!api) return;

  // Clean up any previously registered listeners (prevents HMR accumulation).
  api.removeAllListeners?.();

  // Verse detected by the C++ engine
  api.onVerseDetected?.((verse) => {
    const { addRecentDetection, setPreviewVerse, autoPreview } =
      useStore.getState();
    addRecentDetection(verse);
    if (autoPreview) {
      setPreviewVerse(verse);
    }
  });

  // Live transcript line from whisper / audio pipeline
  api.onTranscript?.((text) => {
    useStore.getState().addTranscriptLine(text);
  });

  // Translation changed by voice (e.g. pastor says "read that in NLT")
  api.onTranslationChanged?.((translation) => {
    const state = useStore.getState();

    // 1. Update the global translation dropdown.
    state.setActiveTranslation(translation);

    // 2. If there's a verse in preview, re-fetch it in the new translation.
    const { previewVerse, liveVerse } = state;
    if (previewVerse?.reference) {
      const match = previewVerse.reference.match(/^(.+?)\s+(\d+):(\d+)/);
      if (match) {
        const book = match[1];
        const chapter = match[2];
        const verseNum = parseInt(match[3]);

        // Fetch the full chapter in the new translation.
        api.searchVerse(`${book} ${chapter}`, translation).then((result) => {
          if (!result || result.error) return;

          // Update the scripture area.
          useStore.setState({ searchResult: result, highlightedVerse: verseNum });

          // Find the verse text in the new translation.
          const found = (result.verses || []).find((v) => v.verse === verseNum);
          if (found) {
            const updated = {
              reference: previewVerse.reference,
              text: found.text,
              active: translation,
            };

            // Update preview.
            useStore.getState().setPreviewVerse(updated, { skipAutoSearch: true });

            // Update live if it's showing the same verse.
            if (liveVerse?.reference === previewVerse.reference) {
              useStore.getState().sendDirectToLive(updated);
            }
          }
        });
      }
    }
  });

  // Transcription session ended
  api.onTranscriptionStopped?.(() => {
    useStore.getState().setTranscribing(false);
  });

  // Errors from detector, ffmpeg, or other backend processes
  api.onError?.((msg) => {
    useStore.getState().showToast(msg, 'error', 8000);
    useStore.getState().setTranscribing(false);
  });

  // ── Session / Collaboration events ──

  // Full state sync from host (on join or reconnect).
  api.onSessionSync?.((data) => {
    const { state, clients } = data;
    if (state) {
      useStore.setState({
        previewVerse: state.previewVerse || null,
        liveVerse: state.liveVerse || null,
        queue: state.queue || [],
        recentDetections: state.recentDetections || [],
        activeTranslation: state.activeTranslation || 'KJV',
        isLiveEnabled: state.isLiveEnabled || false,
        displayBg: state.displayBg || null,
        transcriptLines: state.transcriptLines || [],
      });
    }
    if (clients) {
      useStore.getState().setConnectedClients(clients);
    }
  });

  // Incremental state update from host.
  api.onSessionUpdate?.((data) => {
    const { field, value } = data;
    useStore.setState({ [field]: value });
  });

  // Connected clients changed.
  api.onSessionClients?.((data) => {
    useStore.getState().setConnectedClients(data.clients || []);
  });

  // Remote action from another client (host applies it).
  api.onRemoteAction?.((data) => {
    const store = useStore.getState();
    switch (data.field) {
      case 'previewVerse':
        store.setPreviewVerse(data.value);
        break;
      case 'liveVerse':
        store.sendDirectToLive(data.value);
        break;
      case 'queue':
        if (data.action === 'add') store.addToQueue(data.value);
        break;
      case 'clearLive':
        store.clearLive();
        break;
      default:
        useStore.setState({ [data.field]: data.value });
    }
    // Broadcast updated state to all clients.
    store.broadcastState();
  });

  // Action rejected by host (another operator was faster).
  api.onActionRejected?.((data) => {
    useStore.getState().showToast(
      `${data.lockedBy} already sent a verse. Try again.`,
      'warning',
      3000
    );
  });

  // Host went down — auto-promote (deduplicated).
  api.onHostLost?.(() => {
    if (hostLostTimer) return; // Already promoting.
    useStore.getState().showToast(
      'Host disconnected. Promoting you to host...',
      'warning',
      5000
    );
    hostLostTimer = setTimeout(() => {
      hostLostTimer = null;
      useStore.getState().promoteToHost();
    }, 1500);
  });

  // Disconnected from host (network issue).
  api.onSessionDisconnected?.(() => {
    useStore.setState({ sessionConnected: false });
    useStore.getState().showToast('Connection lost. Reconnecting...', 'warning');
  });

  // Session error.
  api.onSessionError?.((msg) => {
    useStore.getState().showToast(msg, 'error');
  });

  // Host role transferred to us by the current host.
  api.onBecomeHost?.((data) => {
    const { state, pin } = data;
    // Apply the received state.
    if (state) {
      useStore.setState({
        previewVerse: state.previewVerse || null,
        liveVerse: state.liveVerse || null,
        queue: state.queue || [],
        recentDetections: state.recentDetections || [],
        activeTranslation: state.activeTranslation || 'KJV',
        isLiveEnabled: state.isLiveEnabled || false,
      });
    }
    // Promote to host, reusing the same PIN so other clients can reconnect.
    useStore.getState().promoteToHost(pin);
    useStore.getState().showToast('You are now the session host', 'info', 5000);
  });

  // We transferred host role to someone else.
  api.onSessionTransferred?.(() => {
    useStore.setState({
      sessionRole: null,
      sessionIP: null,
      sessionPin: null,
      connectedClients: [],
      sessionConnected: false,
    });
    useStore.getState().showToast('Host role transferred. You can rejoin as a client.', 'info', 5000);
  });
}

/* ── Load initial config (mode, etc.) ── */
async function loadInitialConfig() {
  try {
    const config = await window.api?.getConfig();
    if (config?.mode) {
      // Just set the store — don't call setMode which writes back to config.
      useStore.setState({ mode: config.mode });
    }
  } catch (e) {
    console.error('Failed to load config:', e);
  }
}

/* ── Bootstrap ── */
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

setupIpcListeners();
loadInitialConfig();
