import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

export type VoiceShortcutPreference =
  | "fn"
  | "cmd-shift-space"
  | "ctrl-shift-space"
  | "both";
export type VoiceMode = "push-to-talk" | "toggle";

/**
 * Which transcription backend to use. The desktop app surfaces this in
 * Settings → Voice transcription. "auto" picks the best server-side
 * provider that's actually configured (Gemini → Builder → Groq → OpenAI),
 * falling through to the browser's Web Speech API if nothing is set up —
 * which is free, real-time, and routes through Apple's on-device
 * dictation engine inside WKWebView.
 */
export type VoiceProvider =
  | "auto"
  | "browser"
  | "builder"
  | "gemini"
  | "openai"
  | "groq";

type FlowState = "idle" | "recording" | "processing" | "complete" | "error";
type VoiceShortcutSource = "fn" | "cmd-shift-space" | "ctrl-shift-space";

interface ProviderStatus {
  builder: boolean;
  gemini: boolean;
  openai: boolean;
  groq: boolean;
  browser: true;
}

interface DesktopVoiceDictationOptions {
  enabled: boolean;
  serverUrl: string;
  shortcut: VoiceShortcutPreference;
  mode: VoiceMode;
  provider: VoiceProvider;
}

interface VoiceShortcutEvent {
  source?: VoiceShortcutSource;
}

interface VoiceSession {
  // "server" sessions capture audio with MediaRecorder and POST it to
  // the transcribe-voice endpoint. "browser" sessions use WebKit's
  // built-in webkitSpeechRecognition for real-time on-device dictation —
  // no server round-trip, no API keys, no "Polishing..." state.
  kind: "server" | "browser";
  // server-only fields
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  audioContext: AudioContext | null;
  analyser: AnalyserNode | null;
  raf: number | null;
  mimeType: string;
  // browser-only fields
  recognition: SpeechRecognition | null;
  // Accumulated final transcript from interim webkit results, in case
  // the recognition session ends before we ask it to stop.
  browserTranscript: string;
  // common
  startedAt: number;
  stopping: boolean;
  // Set when transcription begins so the cancel button can abort the
  // in-flight HTTP request and tear down immediately.
  transcribeAbort: AbortController | null;
  // Marks the session as user-cancelled so the recorder.onstop handler
  // skips transcription + paste and just hides the bar.
  cancelled: boolean;
}

// Minimal type shim for webkitSpeechRecognition — TypeScript's lib.dom
// only declares this under non-prefixed `SpeechRecognition` in newer
// versions; on older targets it's missing entirely.
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognition;
function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
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
  if (!session.stream) return;
  session.stream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      // ignore
    }
  });
}

function startMeter(session: VoiceSession): void {
  if (!session.stream) return; // browser-path sessions don't expose a stream
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

/**
 * Browser-path: we don't have a real audio meter (Web Speech API doesn't
 * expose the raw stream), but the flow-bar's waveform looks dead without
 * any motion. Drive it with a low-amplitude synthetic level that pulses
 * gently so the bar still reads as "listening." Matches Wispr Flow's
 * fallback behavior.
 */
function startSyntheticMeter(session: VoiceSession): void {
  const tick = () => {
    if (session.cancelled || session.stopping) return;
    const t = (Date.now() - session.startedAt) / 1000;
    const level = 0.18 + 0.08 * Math.sin(t * 4);
    emit("voice:audio-level", { level }).catch(() => {});
    session.raf = requestAnimationFrame(tick);
  };
  session.raf = requestAnimationFrame(tick);
}

async function transcribe(
  serverUrl: string,
  chunks: Blob[],
  mimeType: string,
  providerPref: "auto" | "builder" | "gemini" | "openai" | "groq",
  controller: AbortController,
): Promise<string> {
  const audioBlob = new Blob(chunks, { type: mimeType });
  const form = new FormData();
  const ext = mimeType.includes("mp4")
    ? "m4a"
    : mimeType.includes("ogg")
      ? "ogg"
      : "webm";
  form.append("audio", audioBlob, `voice.${ext}`);
  // Tells the server which provider to use. "auto" matches the existing
  // server default (Gemini → Builder → Groq → OpenAI fallback chain),
  // anything else pins to that one provider with no fallback.
  form.append("provider", providerPref);
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
  let provider = options.provider;
  let startInFlight = false;
  let stopRequestedBeforeReady = false;
  // Cached provider availability fetched once at install time. Used by
  // resolveProvider() so an "auto" preference can pick browser when no
  // server-side provider is configured. Refreshed lazily when start()
  // sees a stale cache.
  let providerStatus: ProviderStatus | null = null;
  let providerStatusFetchedAt = 0;
  const unlistens: Array<() => void> = [];

  const acceptsShortcut = (source: VoiceShortcutSource | undefined) => {
    if (!source) return shortcut === "both";
    if (shortcut === "both") return true;
    return source === shortcut;
  };

  /**
   * Fetch /voice-providers/status, refreshing at most every 60s. Resilient:
   * any error treated as "no server providers available" so we degrade
   * gracefully to the browser path.
   */
  const refreshProviderStatus = async (): Promise<ProviderStatus> => {
    if (
      providerStatus &&
      Date.now() - providerStatusFetchedAt < 60_000
    ) {
      return providerStatus;
    }
    try {
      const res = await fetch(
        `${serverUrl.replace(/\/+$/, "")}/_agent-native/voice-providers/status`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as Partial<ProviderStatus>;
      providerStatus = {
        builder: !!data.builder,
        gemini: !!data.gemini,
        openai: !!data.openai,
        groq: !!data.groq,
        browser: true,
      };
    } catch (err) {
      console.warn(
        "[voice-dictation] provider status fetch failed, defaulting to browser-only:",
        err,
      );
      providerStatus = {
        builder: false,
        gemini: false,
        openai: false,
        groq: false,
        browser: true,
      };
    }
    providerStatusFetchedAt = Date.now();
    return providerStatus;
  };

  /**
   * Resolve the user's `provider` preference into the actual path we'll
   * take this session: "browser" (Web Speech API in WKWebView) or
   * "server" with a specific providerPref string.
   *
   * "auto" picks the highest-quality server provider that's actually
   * configured, falling through to browser if nothing is set up.
   */
  const resolveProvider = async (): Promise<
    | { kind: "browser" }
    | {
        kind: "server";
        providerPref: "auto" | "builder" | "gemini" | "openai" | "groq";
      }
  > => {
    if (provider === "browser") return { kind: "browser" };
    if (provider !== "auto") {
      // User picked a specific server provider — honor it even if the
      // status check says it's not configured. The server will return a
      // clear error which surfaces the misconfiguration.
      return { kind: "server", providerPref: provider };
    }
    const status = await refreshProviderStatus();
    if (status.gemini) return { kind: "server", providerPref: "gemini" };
    if (status.builder) return { kind: "server", providerPref: "builder" };
    if (status.groq) return { kind: "server", providerPref: "groq" };
    if (status.openai) return { kind: "server", providerPref: "openai" };
    return { kind: "browser" };
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

    const resolved = await resolveProvider();
    if (resolved.kind === "browser") {
      await startBrowser();
    } else {
      await startServer(resolved.providerPref);
    }
  };

  /**
   * Server-path: capture audio with MediaRecorder, POST it to the
   * transcribe-voice endpoint on Fn-up, paste the response text. The
   * "Polishing..." processing state is shown while we wait for the
   * remote transcription.
   */
  const startServer = async (
    providerPref: "auto" | "builder" | "gemini" | "openai" | "groq",
  ) => {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      console.error("[voice-dictation] MediaRecorder unavailable");
      return;
    }
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
        kind: "server",
        stream,
        recorder,
        chunks: [],
        audioContext: null,
        analyser: null,
        raf: null,
        mimeType: recorder.mimeType || mimeType,
        recognition: null,
        browserTranscript: "",
        startedAt: Date.now(),
        stopping: false,
        transcribeAbort: null,
        cancelled: false,
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
        if (disposed || next.cancelled || next.chunks.length === 0) {
          cleanup(next);
          return;
        }
        setFlowState("processing");
        const controller = new AbortController();
        next.transcribeAbort = controller;
        try {
          const text = await transcribe(
            serverUrl,
            next.chunks,
            next.mimeType,
            providerPref,
            controller,
          );
          if (next.cancelled) {
            cleanup(next);
            return;
          }
          if (text) {
            console.log(
              `[voice-dictation] transcribed (${text.length} chars):`,
              text.slice(0, 120),
            );
            await invoke("complete_voice_dictation", { text });
          } else {
            console.warn(
              "[voice-dictation] transcribe returned empty text — nothing to paste",
            );
          }
          setFlowState("complete");
          window.setTimeout(() => {
            if (!disposed) cleanup(next);
          }, 550);
        } catch (err) {
          if (
            next.cancelled ||
            (err as { name?: string })?.name === "AbortError"
          ) {
            cleanup(next);
            return;
          }
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
      console.error("[voice-dictation] startServer failed", err);
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

  /**
   * Browser-path: real-time on-device transcription via WKWebView's
   * webkitSpeechRecognition. No server round-trip — text is ready the
   * moment we stop the recognizer, so we paste immediately and skip
   * the "Polishing..." state entirely.
   */
  const startBrowser = async () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      console.error(
        "[voice-dictation] webkitSpeechRecognition unavailable — falling back to server path",
      );
      // Force a server attempt as a last resort. If that fails too, the
      // user gets the "no provider" error in the bar.
      await startServer("auto");
      return;
    }
    try {
      startInFlight = true;
      stopRequestedBeforeReady = false;
      await invoke("show_flow_bar");
      setFlowState("recording");
      const recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";
      recognition.maxAlternatives = 1;
      const next: VoiceSession = {
        kind: "browser",
        stream: null,
        recorder: null,
        chunks: [],
        audioContext: null,
        analyser: null,
        raf: null,
        mimeType: "",
        recognition,
        browserTranscript: "",
        startedAt: Date.now(),
        stopping: false,
        transcribeAbort: null,
        cancelled: false,
      };
      recognition.onresult = (ev) => {
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) {
            next.browserTranscript += r[0].transcript;
          }
        }
      };
      recognition.onerror = (ev) => {
        // "no-speech" / "aborted" are normal in push-to-talk; only log
        // the genuinely unexpected ones.
        if (ev.error !== "no-speech" && ev.error !== "aborted") {
          console.warn(
            "[voice-dictation] webkitSpeechRecognition error:",
            ev.error,
          );
        }
      };
      recognition.onend = async () => {
        stopMeter(next);
        if (session === next) session = null;
        const text = next.browserTranscript.trim();
        if (disposed || next.cancelled || !text) {
          cleanup(next);
          return;
        }
        try {
          console.log(
            `[voice-dictation] browser transcribed (${text.length} chars):`,
            text.slice(0, 120),
          );
          await invoke("complete_voice_dictation", { text });
        } catch (err) {
          console.error(
            "[voice-dictation] complete_voice_dictation failed:",
            err,
          );
        }
        // No "Polishing..." for the browser path — text is already final
        // when onend fires. Just dismiss.
        cleanup(next);
      };
      session = next;
      startInFlight = false;
      startSyntheticMeter(next);
      recognition.start();
      if (stopRequestedBeforeReady) {
        stop();
      }
    } catch (err) {
      console.error("[voice-dictation] startBrowser failed", err);
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

  // User clicked the X on the flow-bar. Mark cancelled (skips paste),
  // abort any in-flight HTTP, stop the recognizer / recorder, hide.
  const cancel = () => {
    const current = session;
    if (!current) {
      stopRequestedBeforeReady = true;
      invoke("hide_flow_bar").catch(() => {});
      return;
    }
    current.cancelled = true;
    current.transcribeAbort?.abort();
    if (!current.stopping) {
      current.stopping = true;
      if (current.kind === "server") {
        try {
          current.recorder?.stop();
        } catch {
          // recorder.stop can throw if not in 'recording' state — fall
          // through to the cleanup below regardless.
        }
      } else {
        try {
          current.recognition?.abort();
        } catch {
          // ignore
        }
      }
    }
    cleanup(current);
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
  // Cancel button on the flow-bar emits this. Tear down without pasting.
  listen("voice:cancel", () => {
    cancel();
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
