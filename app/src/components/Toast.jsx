import React, { useEffect } from 'react';
import useStore from '../store/useStore';

const colors = {
  info: { bg: 'rgba(20,184,166,0.15)', border: '#14b8a6', text: '#14b8a6' },
  warning: { bg: 'rgba(255,180,0,0.15)', border: '#ffb400', text: '#ffb400' },
  error: { bg: 'rgba(255,68,68,0.15)', border: '#ff4444', text: '#ff4444' },
};

export default function Toast() {
  const toast = useStore((s) => s.toast);
  const clearToast = useStore((s) => s.clearToast);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(clearToast, toast.duration || 4000);
    return () => clearTimeout(timer);
  }, [toast, clearToast]);

  if (!toast) return null;

  const c = colors[toast.type] || colors.info;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.text,
        padding: '10px 20px',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 500,
        zIndex: 2000,
        maxWidth: '80vw',
        textAlign: 'center',
        backdropFilter: 'blur(8px)',
        cursor: 'pointer',
      }}
      onClick={clearToast}
    >
      {toast.message}
    </div>
  );
}
