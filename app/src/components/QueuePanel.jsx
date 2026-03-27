import React, { useState } from 'react';
import useStore from '../store/useStore';

export default function QueuePanel() {
  const queue = useStore((s) => s.queue);
  const addToQueue = useStore((s) => s.addToQueue);
  const sendQueueItemToPreview = useStore((s) => s.sendQueueItemToPreview);
  const removeFromQueue = useStore((s) => s.removeFromQueue);
  const clearQueue = useStore((s) => s.clearQueue);
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    try {
      const verse = JSON.parse(e.dataTransfer.getData('application/x-verse'));
      if (verse?.text) addToQueue(verse);
    } catch {}
  };

  return (
    <div
      className="panel panel--queue"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={dragOver ? { outline: '2px dashed #14b8a6', outlineOffset: -2 } : undefined}
    >
      {/* ── Header ── */}
      <div className="panel-header">
        <h2 className="panel-title">Queue</h2>
        {queue.length > 0 && (
          <span className="badge">{queue.length}</span>
        )}
      </div>

      {/* ── Body ── */}
      <div className="panel-body">
        {queue.length === 0 ? (
          <div className="panel-empty">
            {/* List icon */}
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
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            <p className="panel-empty-text">Queue is empty</p>
          </div>
        ) : (
          <ul className="queue-list">
            {queue.map((item) => (
              <li className="queue-item" key={item.id}>
                <div className="queue-item-info">
                  <span className="queue-item-reference">{item.reference}</span>
                  <span className="queue-item-text">
                    {item.text.length > 80
                      ? item.text.slice(0, 80) + '...'
                      : item.text}
                  </span>
                </div>

                <div className="queue-item-actions">
                  {/* Play / send to preview */}
                  <button
                    className="btn-icon-only"
                    onClick={() => sendQueueItemToPreview(item.id)}
                    title="Send to preview"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      stroke="none"
                    >
                      <polygon points="5,3 19,12 5,21" />
                    </svg>
                  </button>

                  {/* Remove from queue */}
                  <button
                    className="btn-icon-only btn-icon-only--danger"
                    onClick={() => removeFromQueue(item.id)}
                    title="Remove from queue"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="panel-footer">
        <button
          className="btn btn--secondary btn--block"
          disabled={queue.length === 0}
          onClick={clearQueue}
        >
          Clear all
        </button>
      </div>
    </div>
  );
}
