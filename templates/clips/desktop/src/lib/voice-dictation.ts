import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

export type VoiceShortcutPreference =
  | "fn"
  | "cmd-shift-space"
  | "ctrl-shift-space"
  | "both";
export type VoiceMode = "push-to-talk" | "toggle";

type FlowState = "idle" | "recording" | "processing" | "complete" | "error";
type VoiceShortcutSource = "fn" | "cmd-shift-space" | "ctrl-shift-space";

interface DesktopVoiceDictationOptions {
  enabled: boolean;
  serverUrl: string;
  shortcut: VoiceShortcutPreference;
  mode: VoiceMode;
}

interface VoiceShortcutEvent {
  source?: VoiceShortcutSource;
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
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch(
      `${serverUrl.replace(/\/+$/, "")}/_agent-native/transcribe-voice`,
      {
        method: "POST",
        body: form,
        credentials: "include",
        signal: controller.signal,
      },
    );
    // The timeout has to stay armed across the body read — `fetch()` resolves
    // as soon as headers arrive, so a stalled body would hang `res.json()`
    // indefinitely if we cleared the timer here. AbortController also aborts
    // an in-flight body stream, so this keeps the 45s ceiling end-to-end.
    if (!res.ok) {
      const body = await res
        .json()
        .catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(body?.error || `Transcription failed (${res.status})`);
    }
    const data = (await res.json()) as { text?: string };
    return (data.text ?? "").trim();
  } finally {
    window.clearTimeout(timeout);
  }
}

export function installDesktopVoiceDictation(
  options: DesktopVoiceDictationOptions,
): () => void {
  let disposed = false;
  let session: VoiceSession | null = null;
  let serverUrl = options.serverUrl;
  let enabled = options.enabled;
  let shortcut = options.shortcut;
  let mode = options.mode;
  let startInFlight = false;
  let stopRequestedBeforeReady = false;
  const unlistens: Array<() => void> = [];

  const acceptsShortcut = (source: VoiceShortcutSource | undefined) => {
    if (!source) return shortcut === "both";
    if (shortcut === "both") return true;
    return source === shortcut;
  };

  // Tear down any session-bound resources we still hold, then hide the
  // overlay. CRITICAL: only touches `session` if it matches the one being
  // cleaned up. Otherwise a late post-transcribe cleanup from a prior
  // press (transcribe can take many seconds, especially when the dev DB
  // is slow) would clobber the brand-new session a subsequent press just
  // created — which manifests as "second press doesn't bring the UI back."
  const cleanup = (target: VoiceSession | null = null, hide = true) => {
    if (target) {
      stopMeter(target);
      stopTracks(target);
    }
    if (target && session !== target) {
      // A new session has taken over — don't touch global state or hide
      // its bar; it owns the UI now. Just release the old session's
      // resources (already done above).
      return;
    }
    startInFlight = false;
    stopRequestedBeforeReady = false;
    if (target) {
      session = null;
    }
    setFlowState("idle");
    if (hide) invoke("hide_flow_bar").catch(() => {});
  };

  const start = async () => {
    if (disposed || !enabled) return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      console.error("[voice-dictation] MediaRecorder unavailable");
      return;
    }
    // Wait briefly for any in-flight start() or stopping session to
    // settle so a fast-repeat Fn press isn't dropped in the tear-down
    // window of the previous one.
    const waitStart = Date.now();
    while (
      !disposed &&
      (startInFlight || (session && session.stopping)) &&
      Date.now() - waitStart < 800
    ) {
      await new Promise((r) => window.setTimeout(r, 30));
    }
    if (disposed || session || startInFlight) return;

    try {
      startInFlight = true;
      stopRequestedBeforeReady = false;
      await invoke("show_flow_bar");
      setFlowState("recording");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (disposed || stopRequestedBeforeReady) {
        stream.getTracks().forEach((track) => track.stop());
        startInFlight = false;
        stopRequestedBeforeReady = false;
        setFlowState("idle");
        invoke("hide_flow_bar").catch(() => {});
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
      startInFlight = false;
      recorder.ondataavailable = (event) => {
        if (event.data?.size) next.chunks.push(event.data);
      };
      recorder.onstop = async () => {
        stopMeter(next);
        stopTracks(next);
        if (session === next) session = null;
        if (disposed || next.chunks.length === 0) {
          cleanup(next);
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
            if (!disposed) cleanup(next);
          }, 550);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[voice-dictation] transcription failed:", message);
          setFlowState("error");
          window.setTimeout(() => {
            if (!disposed) cleanup(next);
          }, 800);
        }
      };
      startMeter(next);
      recorder.start();
      if (stopRequestedBeforeReady) {
        stop();
      }
    } catch (err) {
      console.error("[voice-dictation] start failed", err);
      // start() failed before any session was wired up. Reset flags
      // immediately so the next Fn press isn't blocked, leave the
      // "error" frame visible briefly, then hide the bar — but only
      // if no new session has taken over by then.
      startInFlight = false;
      stopRequestedBeforeReady = false;
      setFlowState("error");
      window.setTimeout(() => {
        if (disposed || session) return;
        setFlowState("idle");
        invoke("hide_flow_bar").catch(() => {});
      }, 800);
    }
  };

  const stop = () => {
    const current = session;
    if (!current) {
      if (startInFlight) {
        stopRequestedBeforeReady = true;
        // If start() hangs (e.g. getUserMedia awaiting a permission
        // dialog the user dismissed), the cleanup path that hides the
        // flow-bar may never run. Force-hide after a short wait so the
        // bar can't get stranded.
        window.setTimeout(() => {
          if (disposed) return;
          if (!session && startInFlight) {
            invoke("hide_flow_bar").catch(() => {});
          }
        }, 1500);
      }
      return;
    }
    if (current.stopping) return;
    current.stopping = true;
    if (Date.now() - current.startedAt < 250) {
      cleanup(current);
      return;
    }
    try {
      current.recorder.stop();
    } catch (err) {
      console.error("[voice-dictation] stop failed", err);
      setFlowState("error");
      window.setTimeout(() => {
        if (!disposed) cleanup(current);
      }, 800);
    }
  };

  listen<VoiceShortcutEvent>("voice:shortcut-start", (event) => {
    if (!acceptsShortcut(event.payload?.source)) return;
    if (mode === "toggle" && (session || startInFlight)) {
      stop();
      return;
    }
    start();
  })
    .then((u) => unlistens.push(u))
    .catch(() => {});
  listen<VoiceShortcutEvent>("voice:shortcut-stop", (event) => {
    if (!acceptsShortcut(event.payload?.source)) return;
    if (mode === "toggle") return;
    stop();
  })
    .then((u) => unlistens.push(u))
    .catch(() => {});

  return () => {
    disposed = true;
    enabled = false;
    serverUrl = "";
    shortcut = "both";
    mode = "push-to-talk";
    unlistens.forEach((u) => {
      try {
        u();
      } catch {
        // ignore
      }
    });
    unlistens.length = 0;
    cleanup(session);
  };
}
