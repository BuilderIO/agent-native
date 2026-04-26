import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

type FlowState = "idle" | "recording" | "processing" | "complete";

interface DesktopVoiceDictationOptions {
  enabled: boolean;
  serverUrl: string;
}

interface VoiceSession {
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: Blob[];
  audioContext: AudioContext | null;
  analyser: AnalyserNode | null;
  raf: number | null;
  mimeType: string;
  startedAt: number;
  stopping: boolean;
}

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const mime of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      // ignore
    }
  }
  return "audio/webm";
}

function setFlowState(state: FlowState): void {
  emit("voice:state-change", { state }).catch(() => {});
}

function stopMeter(session: VoiceSession): void {
  if (session.raf != null) {
    cancelAnimationFrame(session.raf);
    session.raf = null;
  }
  session.audioContext?.close().catch(() => {});
  session.audioContext = null;
  session.analyser = null;
  emit("voice:audio-level", { level: 0 }).catch(() => {});
}

function stopTracks(session: VoiceSession): void {
  session.stream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      // ignore
    }
  });
}

function startMeter(session: VoiceSession): void {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(session.stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    session.audioContext = ctx;
    session.analyser = analyser;
    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (!session.analyser) return;
      session.analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) {
        const centered = (value - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / data.length);
      const level = Math.min(1, rms * 4);
      emit("voice:audio-level", { level }).catch(() => {});
      session.raf = requestAnimationFrame(tick);
    };
    session.raf = requestAnimationFrame(tick);
  } catch (err) {
    console.warn("[voice-dictation] audio meter unavailable", err);
  }
}

async function transcribe(
  serverUrl: string,
  chunks: Blob[],
  mimeType: string,
): Promise<string> {
  const audioBlob = new Blob(chunks, { type: mimeType });
  const form = new FormData();
  const ext = mimeType.includes("mp4")
    ? "m4a"
    : mimeType.includes("ogg")
      ? "ogg"
      : "webm";
  form.append("audio", audioBlob, `voice.${ext}`);
  const res = await fetch(
    `${serverUrl.replace(/\/+$/, "")}/_agent-native/transcribe-voice`,
    {
      method: "POST",
      body: form,
      credentials: "include",
    },
  );
  if (!res.ok) {
    const body = await res
      .json()
      .catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body?.error || `Transcription failed (${res.status})`);
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

export function installDesktopVoiceDictation(
  options: DesktopVoiceDictationOptions,
): () => void {
  let disposed = false;
  let session: VoiceSession | null = null;
  let serverUrl = options.serverUrl;
  let enabled = options.enabled;
  const unlistens: Array<() => void> = [];

  const cleanup = (hide = true) => {
    const current = session;
    session = null;
    if (current) {
      stopMeter(current);
      stopTracks(current);
    }
    setFlowState("idle");
    if (hide) invoke("hide_flow_bar").catch(() => {});
  };

  const start = async () => {
    if (disposed || !enabled || session) return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      console.error("[voice-dictation] MediaRecorder unavailable");
      return;
    }

    try {
      await invoke("show_flow_bar");
      setFlowState("recording");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (disposed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      const next: VoiceSession = {
        stream,
        recorder,
        chunks: [],
        audioContext: null,
        analyser: null,
        raf: null,
        mimeType: recorder.mimeType || mimeType,
        startedAt: Date.now(),
        stopping: false,
      };
      session = next;
      recorder.ondataavailable = (event) => {
        if (event.data?.size) next.chunks.push(event.data);
      };
      recorder.onstop = async () => {
        stopMeter(next);
        stopTracks(next);
        if (session === next) session = null;
        if (disposed || next.chunks.length === 0) {
          cleanup();
          return;
        }
        setFlowState("processing");
        try {
          const text = await transcribe(serverUrl, next.chunks, next.mimeType);
          if (text) {
            await invoke("complete_voice_dictation", { text });
          }
          setFlowState("complete");
          window.setTimeout(() => {
            if (!disposed) cleanup();
          }, 550);
        } catch (err) {
          console.error("[voice-dictation] transcription failed", err);
          cleanup();
        }
      };
      startMeter(next);
      recorder.start();
    } catch (err) {
      console.error("[voice-dictation] start failed", err);
      cleanup();
    }
  };

  const stop = () => {
    const current = session;
    if (!current || current.stopping) return;
    current.stopping = true;
    if (Date.now() - current.startedAt < 250) {
      cleanup();
      return;
    }
    try {
      current.recorder.stop();
    } catch (err) {
      console.error("[voice-dictation] stop failed", err);
      cleanup();
    }
  };

  listen("voice:shortcut-start", () => {
    start();
  })
    .then((u) => unlistens.push(u))
    .catch(() => {});
  listen("voice:shortcut-stop", () => {
    stop();
  })
    .then((u) => unlistens.push(u))
    .catch(() => {});

  return () => {
    disposed = true;
    enabled = false;
    serverUrl = "";
    unlistens.forEach((u) => {
      try {
        u();
      } catch {
        // ignore
      }
    });
    unlistens.length = 0;
    cleanup();
  };
}
