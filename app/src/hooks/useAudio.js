import { useRef, useCallback, useEffect } from 'react';
import useStore from '../store/useStore';

// Inline the AudioWorklet processor code as a string.
// This avoids file path issues in both dev and packaged builds.
const WORKLET_CODE = `
class AudioSenderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length > 0) {
      this.port.postMessage(input[0].buffer.slice(0));
    }
    return true;
  }
}
registerProcessor('audio-sender', AudioSenderProcessor);
`;

function createWorkletUrl() {
  const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}

export default function useAudio() {
  const audioCtx = useRef(null);
  const stream = useRef(null);
  const workletNode = useRef(null);
  const sourceNode = useRef(null);
  const workletUrl = useRef(null);
  const { setTranscribing } = useStore();

  const cleanup = useCallback(() => {
    if (workletNode.current) {
      try { workletNode.current.disconnect(); } catch {}
      if (workletNode.current.port) {
        workletNode.current.port.onmessage = null;
      }
      if (workletNode.current.onaudioprocess !== undefined) {
        workletNode.current.onaudioprocess = null;
      }
      workletNode.current = null;
    }
    if (sourceNode.current) {
      try { sourceNode.current.disconnect(); } catch {}
      sourceNode.current = null;
    }
    if (audioCtx.current) {
      try { audioCtx.current.close(); } catch {}
      audioCtx.current = null;
    }
    if (stream.current) {
      stream.current.getTracks().forEach((t) => t.stop());
      stream.current = null;
    }
    if (workletUrl.current) {
      URL.revokeObjectURL(workletUrl.current);
      workletUrl.current = null;
    }
  }, []);

  const start = useCallback(async (deviceId) => {
    cleanup();

    try {
      const constraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false,
      };

      stream.current = await navigator.mediaDevices.getUserMedia(constraints);
      audioCtx.current = new AudioContext({ sampleRate: 48000 });
      sourceNode.current = audioCtx.current.createMediaStreamSource(stream.current);

      // Try AudioWorkletNode first (modern, non-deprecated).
      let connected = false;
      try {
        workletUrl.current = createWorkletUrl();
        await audioCtx.current.audioWorklet.addModule(workletUrl.current);
        workletNode.current = new AudioWorkletNode(audioCtx.current, 'audio-sender');
        workletNode.current.port.onmessage = (e) => {
          window.api?.sendAudio(e.data);
        };
        sourceNode.current.connect(workletNode.current);
        workletNode.current.connect(audioCtx.current.destination);
        connected = true;
      } catch (err) {
        console.warn('[audio] AudioWorklet unavailable, falling back to ScriptProcessor:', err.message);
      }

      // Fallback to ScriptProcessorNode.
      if (!connected) {
        workletNode.current = audioCtx.current.createScriptProcessor(4096, 1, 1);
        workletNode.current.onaudioprocess = (e) => {
          if (!workletNode.current) return;
          const pcm = e.inputBuffer.getChannelData(0);
          window.api?.sendAudio(pcm.buffer.slice(0));
        };
        sourceNode.current.connect(workletNode.current);
        workletNode.current.connect(audioCtx.current.destination);
      }

      if (!window.api?.startTranscription) {
        throw new Error('Transcription API not available. Restart the app.');
      }
      await window.api.startTranscription(audioCtx.current.sampleRate);
      setTranscribing(true);
    } catch (err) {
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

  useEffect(() => {
    return () => { cleanup(); };
  }, [cleanup]);

  return { start, stop };
}
