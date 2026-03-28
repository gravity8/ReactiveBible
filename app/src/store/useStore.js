import { create } from 'zustand';

const useStore = create((set, get) => ({
  // ── Audio / Transcription ──
  isTranscribing: false,
  transcriptLines: [],
  setTranscribing: (val) => set({ isTranscribing: val }),
  addTranscriptLine: (text) =>
    set((s) => ({
      transcriptLines: [...s.transcriptLines.slice(-49), text],
    })),

  // ── Verse flow ──
  previewVerse: null,
  liveVerse: null,
  queue: [],
  recentDetections: [],
  isLiveEnabled: false,
  autoPreview: true,
  autoLive: false,

  _previewSearchVersion: 0,

  // skipAutoSearch: set true when caller already loaded the chapter (e.g. translation change).
  setPreviewVerse: (verse, { skipAutoSearch } = {}) => {
    set({ previewVerse: verse });

    // Sync the active translation from the detected verse.
    if (verse?.active) {
      set({ activeTranslation: verse.active });
    }

    // Auto-load the chapter in scripture area and highlight the verse.
    if (!skipAutoSearch && verse?.reference) {
      const match = verse.reference.match(/^(.+?)\s+(\d+):(\d+)/);
      if (match) {
        const book = match[1];
        const chapter = parseInt(match[2]);
        const verseNum = parseInt(match[3]);
        const query = `${book} ${chapter}`;
        const version = ++get()._previewSearchVersion;
        set({ highlightedVerse: verseNum, _previewSearchVersion: version });
        const translation = verse.active || 'KJV';
        window.api?.searchVerse(query, translation).then((result) => {
          // Only apply if this is still the latest request.
          if (get()._previewSearchVersion !== version) return;
          if (result && !result.error) {
            set({ searchResult: result });
          }
        }).catch(() => {});
      }
    }

    if (get().autoLive && verse) {
      get().sendToLive();
    }
  },

  sendToLive: () => {
    const { previewVerse } = get();
    if (!previewVerse) return;
    set({ liveVerse: { ...previewVerse } });
    window.api?.sendToDisplay(previewVerse);
  },

  // Drop directly to live (bypasses preview-first flow).
  sendDirectToLive: (verse) => {
    set({ previewVerse: verse, liveVerse: { ...verse } });
    window.api?.sendToDisplay(verse);
  },

  clearLive: () => {
    set({ liveVerse: null });
    window.api?.clearDisplay();
  },

  toggleLive: (val) => {
    set({ isLiveEnabled: val });
    if (val) {
      // Re-send current live verse when toggling on.
      const { liveVerse } = get();
      if (liveVerse) window.api?.sendToDisplay(liveVerse);
    } else {
      // Clear the display and reset live verse.
      set({ liveVerse: null });
      window.api?.clearDisplay();
    }
  },

  addToQueue: (verse) =>
    set((s) => ({ queue: [...s.queue, { ...verse, id: Date.now() }].slice(-100) })),

  removeFromQueue: (id) =>
    set((s) => ({ queue: s.queue.filter((v) => v.id !== id) })),

  sendQueueItemToPreview: (id) => {
    const { queue } = get();
    const item = queue.find((v) => v.id === id);
    if (item) {
      get().setPreviewVerse(item);
      get().removeFromQueue(id);
    }
  },

  clearQueue: () => set({ queue: [] }),

  addRecentDetection: (verse) =>
    set((s) => ({
      recentDetections: [
        { ...verse, detectedAt: new Date() },
        ...s.recentDetections.slice(0, 19),
      ],
    })),

  setAutoPreview: (val) => set({ autoPreview: val }),
  setAutoLive: (val) => set({ autoLive: val }),

  // ── Search / Translation ──
  searchResult: null,
  highlightedVerse: null,
  activeTranslation: 'KJV',
  setSearchResult: (result) => set({ searchResult: result }),
  setHighlightedVerse: (v) => set({ highlightedVerse: v }),
  setActiveTranslation: (t) => set({ activeTranslation: t }),

  // ── Display background & theme ──
  displayBg: null, // data URL or file path
  displayTheme: 'midnight', // built-in theme id
  setDisplayBg: (bg) => {
    set({ displayBg: bg });
    window.api?.sendDisplayBg(bg);
  },
  clearDisplayBg: () => {
    set({ displayBg: null });
    window.api?.sendDisplayBg(null);
  },
  setDisplayTheme: (themeId) => {
    set({ displayTheme: themeId });
    window.api?.sendDisplayTheme(themeId);
  },
  clearDisplayTheme: () => {
    set({ displayTheme: 'midnight' });
    window.api?.sendDisplayTheme('midnight');
  },

  // ── Mode (online = Groq LLM, offline = local regex only) ──
  mode: 'online',
  setMode: (newMode) => {
    set({ mode: newMode });
    try {
      window.api?.setMode(newMode);
    } catch (e) {
      console.error('Failed to set mode via IPC:', e);
    }
  },

  // ── Settings ──
  settingsOpen: false,
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  closeSettings: () => set({ settingsOpen: false }),

  // ── Collaboration / Session ──
  sessionRole: null,   // 'host' | 'client' | null
  sessionIP: null,
  sessionPin: null,
  sessionName: '',
  connectedClients: [],
  sessionConnected: false,
  toast: null, // { message, type: 'info'|'warning'|'error', duration }

  setSessionName: (name) => set({ sessionName: name }),

  startSession: async (name) => {
    const result = await window.api?.startSession(name);
    if (result?.success) {
      set({
        sessionRole: 'host',
        sessionIP: result.ip,
        sessionPin: result.pin,
        sessionConnected: true,
        sessionName: name,
      });
    }
    return result;
  },

  stopSession: async () => {
    await window.api?.stopSession();
    set({
      sessionRole: null,
      sessionIP: null,
      sessionPin: null,
      connectedClients: [],
      sessionConnected: false,
    });
  },

  joinSession: async ({ host, pin, name }) => {
    const result = await window.api?.joinSession({ host, pin, name });
    if (result?.success) {
      set({
        sessionRole: 'client',
        sessionConnected: true,
        sessionName: name,
      });
    }
    return result;
  },

  leaveSession: async () => {
    await window.api?.leaveSession();
    set({
      sessionRole: null,
      sessionIP: null,
      sessionPin: null,
      connectedClients: [],
      sessionConnected: false,
    });
  },

  promoteToHost: async (pin) => {
    const { sessionName } = get();
    const result = await window.api?.promoteToHost(pin ? { name: sessionName, pin } : sessionName);
    if (result?.success) {
      set({
        sessionRole: 'host',
        sessionIP: result.ip,
        sessionPin: result.pin,
        sessionConnected: true,
        toast: {
          message: 'You are now the host. Start transcribing to enable live detection.',
          type: 'warning',
          duration: 8000,
        },
      });
    }
    return result;
  },

  transferHost: async (targetId) => {
    const result = await window.api?.transferHost(targetId);
    if (result?.success) {
      get().showToast('Host role transferred', 'info', 5000);
    }
    return result;
  },

  setConnectedClients: (clients) => set({ connectedClients: clients }),

  showToast: (message, type = 'info', duration = 4000) =>
    set({ toast: { message, type, duration } }),
  clearToast: () => set({ toast: null }),

  // Broadcast state to sync server (host only).
  broadcastState: () => {
    const s = get();
    const syncableState = {
      previewVerse: s.previewVerse,
      liveVerse: s.liveVerse,
      queue: s.queue,
      recentDetections: s.recentDetections,
      activeTranslation: s.activeTranslation,
      isLiveEnabled: s.isLiveEnabled,
      displayBg: s.displayBg,
      transcriptLines: s.transcriptLines,
    };
    window.api?.syncState(syncableState);
  },
}));

export default useStore;
