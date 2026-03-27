import { useRef, useCallback, useEffect } from 'react';
import useStore from '../store/useStore';

export default function useAudio() {
  const audioCtx = useRef(null);
  const stream = useRef(null);
  const processor = useRef(null);
  const { setTranscribing } = useStore();

  // Cleanup function reusable by stop() and unmount.
  const cleanup = useCallback(() => {
    if (processor.current) {
      try { processor.current.disconnect(); } catch {}
      processor.current.onaudioprocess = null;
      processor.current = null;
    }
    if (audioCtx.current) {
      try { audioCtx.current.close(); } catch {}
      audioCtx.current = null;
    }
    if (stream.current) {
      stream.current.getTracks().forEach((t) => t.stop());
      stream.current = null;
    }
  }, []);

  const start = useCallback(async (deviceId) => {
    // Stop any existing capture first.
    cleanup();

    try {
      const constraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false,
      };

      stream.current = await navigator.mediaDevices.getUserMedia(constraints);
      audioCtx.current = new AudioContext({ sampleRate: 48000 });

      const source = audioCtx.current.createMediaStreamSource(stream.current);
      processor.current = audioCtx.current.createScriptProcessor(4096, 1, 1);

      processor.current.onaudioprocess = (e) => {
        if (!processor.current) return; // Guard against calls after cleanup.
        const pcm = e.inputBuffer.getChannelData(0);
        window.api?.sendAudio(pcm.buffer.slice(0));
      };

      source.connect(processor.current);
      processor.current.connect(audioCtx.current.destination);

      await window.api.startTranscription(audioCtx.current.sampleRate);
      setTranscribing(true);
    } catch (err) {
      // Clean up any partially initialized resources.
      cleanup();
      console.error('Audio capture failed:', err);
      throw err;
    }
  }, [setTranscribing, cleanup]);

  const stop = useCallback(async () => {
    cleanup();
    await window.api?.stopTranscription();
    setTranscribing(false);
  }, [setTranscribing, cleanup]);

  // Ensure cleanup on unmount.
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return { start, stop };
}
