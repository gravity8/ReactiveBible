import React, { useEffect, useRef } from 'react';
import useStore from '../store/useStore';
import useAudio from '../hooks/useAudio';

export default function TranscriptPanel() {
  const isTranscribing = useStore((s) => s.isTranscribing);
  const transcriptLines = useStore((s) => s.transcriptLines);
  const { start, stop } = useAudio();
  const bodyRef = useRef(null);

  /* Auto-scroll to bottom when new lines arrive */
  useEffect(() => {
    const el = bodyRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [transcriptLines]);

  const showToast = useStore((s) => s.showToast);

  const handleToggle = async () => {
    if (isTranscribing) {
      await stop();
    } else {
      try {
        await start();
      } catch (err) {
        const msg = err.name === 'NotAllowedError'
          ? 'Microphone access denied. Check your system permissions.'
          : err.name === 'NotFoundError'
          ? 'No microphone found. Connect one and try again.'
          : `Audio failed: ${err.message}`;
        showToast(msg, 'error', 5000);
      }
    }
  };

  return (
    <div className="panel panel--transcript">
      {/* ── Header ── */}
      <div className="panel-header">
        <h2 className="panel-title">Live transcript</h2>
        <div className={`audio-bars ${isTranscribing ? 'audio-bars--active' : ''}`}>
          <span className="audio-bar" />
          <span className="audio-bar" />
          <span className="audio-bar" />
          <span className="audio-bar" />
          <span className="audio-bar" />
        </div>
      </div>

      {/* ── Body ── */}
      <div className="panel-body" ref={bodyRef}>
        {!isTranscribing && transcriptLines.length === 0 ? (
          <div className="panel-empty">
            {/* Microphone icon */}
            <svg
              className="panel-empty-icon"
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            <p className="panel-empty-text">
              Press start to begin transcribing the sermon
            </p>
          </div>
        ) : (
          <div className="transcript-lines">
            {transcriptLines.map((line, i) => (
              <p className="transcript-line" key={i}>
                {line}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="panel-footer">
        <button
          className={`btn btn--block ${isTranscribing ? 'btn--danger' : 'btn--success'}`}
          onClick={handleToggle}
        >
          {isTranscribing ? (
            <>
              {/* Stop / square icon */}
              <svg
                className="btn-icon"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="none"
              >
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
              Stop transcribing
            </>
          ) : (
            <>
              {/* Play / triangle icon */}
              <svg
                className="btn-icon"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="none"
              >
                <polygon points="5,3 19,12 5,21" />
              </svg>
              Start transcribing
            </>
          )}
        </button>
      </div>
    </div>
  );
}
