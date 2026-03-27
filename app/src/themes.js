// Built-in display themes for the verse output.
// Each theme defines colors, fonts, and background for the display window.

const THEMES = [
  {
    id: 'midnight',
    name: 'Midnight',
    preview: { bg: '#000000', accent: '#14b8a6' },
    styles: {
      body: 'background:#000;',
      container: '',
      reference: 'color:#14b8a6;',
      text: 'color:#ffffff; font-weight:300;',
      translation: 'color:#666;',
    },
  },
  {
    id: 'ember',
    name: 'Ember',
    preview: { bg: '#1a0a00', accent: '#f59e0b' },
    styles: {
      body: 'background:linear-gradient(145deg,#1a0a00 0%,#2d1200 50%,#0f0700 100%);',
      container: 'background:rgba(245,158,11,0.06); border:1px solid rgba(245,158,11,0.12); border-radius:20px;',
      reference: 'color:#f59e0b;',
      text: 'color:#fef3c7; font-weight:300;',
      translation: 'color:#92400e;',
    },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    preview: { bg: '#0a1628', accent: '#38bdf8' },
    styles: {
      body: 'background:linear-gradient(160deg,#0a1628 0%,#0c2340 40%,#071a2f 100%);',
      container: 'background:rgba(56,189,248,0.05); border:1px solid rgba(56,189,248,0.1); border-radius:20px;',
      reference: 'color:#38bdf8;',
      text: 'color:#e0f2fe; font-weight:300;',
      translation: 'color:#0369a1;',
    },
  },
  {
    id: 'royal',
    name: 'Royal',
    preview: { bg: '#110a24', accent: '#a78bfa' },
    styles: {
      body: 'background:linear-gradient(145deg,#110a24 0%,#1e1145 50%,#0c0618 100%);',
      container: 'background:rgba(167,139,250,0.06); border:1px solid rgba(167,139,250,0.12); border-radius:20px;',
      reference: 'color:#a78bfa;',
      text: 'color:#ede9fe; font-weight:300;',
      translation: 'color:#6d28d9;',
    },
  },
  {
    id: 'eden',
    name: 'Eden',
    preview: { bg: '#0a1a0a', accent: '#4ade80' },
    styles: {
      body: 'background:linear-gradient(145deg,#0a1a0a 0%,#0f2e0f 50%,#061206 100%);',
      container: 'background:rgba(74,222,128,0.05); border:1px solid rgba(74,222,128,0.1); border-radius:20px;',
      reference: 'color:#4ade80;',
      text: 'color:#dcfce7; font-weight:300;',
      translation: 'color:#166534;',
    },
  },
  {
    id: 'sanctuary',
    name: 'Sanctuary',
    preview: { bg: '#1a1510', accent: '#d4a574' },
    styles: {
      body: 'background:linear-gradient(145deg,#1a1510 0%,#2a2018 50%,#110e0a 100%);',
      container: 'background:rgba(212,165,116,0.06); border:1px solid rgba(212,165,116,0.1); border-radius:20px;',
      reference: 'color:#d4a574;',
      text: 'color:#fef3e2; font-weight:300; font-family:Georgia,"Times New Roman",serif;',
      translation: 'color:#8b6914;',
    },
  },
  {
    id: 'alabaster',
    name: 'Alabaster',
    preview: { bg: '#f5f0eb', accent: '#78716c' },
    styles: {
      body: 'background:linear-gradient(145deg,#f5f0eb 0%,#e7e0d8 50%,#f0ebe5 100%);',
      container: 'background:rgba(255,255,255,0.6); border:1px solid rgba(120,113,108,0.15); border-radius:20px; box-shadow:0 8px 32px rgba(0,0,0,0.08);',
      reference: 'color:#78716c;',
      text: 'color:#1c1917; font-weight:400;',
      translation: 'color:#a8a29e;',
    },
  },
  {
    id: 'crimson',
    name: 'Crimson',
    preview: { bg: '#1a0508', accent: '#f43f5e' },
    styles: {
      body: 'background:linear-gradient(145deg,#1a0508 0%,#2d0a10 50%,#0f0305 100%);',
      container: 'background:rgba(244,63,94,0.05); border:1px solid rgba(244,63,94,0.12); border-radius:20px;',
      reference: 'color:#f43f5e;',
      text: 'color:#ffe4e6; font-weight:300;',
      translation: 'color:#9f1239;',
    },
  },
  {
    id: 'slate',
    name: 'Slate',
    preview: { bg: '#0f172a', accent: '#94a3b8' },
    styles: {
      body: 'background:linear-gradient(145deg,#0f172a 0%,#1e293b 50%,#0f172a 100%);',
      container: 'background:rgba(148,163,184,0.05); border:1px solid rgba(148,163,184,0.1); border-radius:20px;',
      reference: 'color:#94a3b8;',
      text: 'color:#e2e8f0; font-weight:300;',
      translation: 'color:#475569;',
    },
  },
  {
    id: 'aurora',
    name: 'Aurora',
    preview: { bg: '#0a0a1a', accent: '#22d3ee' },
    styles: {
      body: 'background:linear-gradient(160deg,#0a0a1a 0%,#0d1a2a 30%,#0a1a1a 60%,#0a0a1a 100%);',
      container: 'background:linear-gradient(135deg,rgba(34,211,238,0.04),rgba(168,85,247,0.04)); border:1px solid rgba(34,211,238,0.1); border-radius:20px;',
      reference: 'color:#22d3ee;',
      text: 'color:#f0fdfa; font-weight:300;',
      translation: 'color:#0e7490;',
    },
  },
];

export default THEMES;
