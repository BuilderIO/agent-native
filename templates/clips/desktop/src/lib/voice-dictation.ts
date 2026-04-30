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
  | "macos-native"
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
  // Apple's SFSpeechRecognizer + AVAudioEngine driven from Rust. The
  // server reports `true` whenever the desktop client builds for macOS;
  // non-macOS builds shouldn't see this picked.
  native: boolean;
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
  // webkitSpeechRecognition (works in Safari and Chromium WebViews,
  // broken in Tauri WKWebView). "native" sessions drive Apple's
  // SFSpeechRecognizer + AVAudioEngine through Tauri commands —
  // on-device, real-time partials, free, macOS-only.
  kind: "server" | "browser" | "native";
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
  // Native-only: invoked once the post-stop final transcript lands (or
  // a safety timer fires). The callback pastes + lingers + dismisses.
  // Lets the install-time `voice:final-transcript` listener trigger
  // the lingered finalize without it having to know the timer state.
  onNativeFinalize?: (() => void) | null;
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

// Pick the built-in MacBook microphone over any Bluetooth / external input.
// Bluetooth headsets force macOS into a tighter audio-session mode that
// pauses + glitches whatever's playing the moment we open getUserMedia,
// and we don't get the dictation experience right unless we sidestep that
// by always pinning to the built-in mic. Returns null when labels are
// empty (no prior permission grant) — the caller falls back to plain
// `audio: true` so the first-time grant prompt still goes through.
async function pickBuiltInMicId(): Promise<string | null> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return null;
    // Device labels are only populated AFTER permission has been granted
    // at least once. Caller falls back to default when label is empty.
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === "audioinput");
    const isBuiltIn = (label: string) => {
      const l = label.toLowerCase();
      return (
        l.includes("macbook") ||
        l.includes("built-in") ||
        l.includes("built in") ||
        l.includes("internal microphone")
      );
    };
    const builtIn = inputs.find((d) => isBuiltIn(d.label));
    if (builtIn) return builtIn.deviceId;
    return null;
  } catch {
    return null;
  }
}

// Warm-up audio stream — opened once at install time and kept alive for the
// life of the popover webview so subsequent dictation presses don't pay
// the getUserMedia/audio-session-switch cost (which is what was cutting
// off the first ~300ms of speech and pausing/glitching playing audio).
let warmStream: MediaStream | null = null;
let warmStreamDeviceId: string | null = null;
let warmStreamPromise: Promise<MediaStream | null> | null = null;

async function prewarmMicStream(): Promise<MediaStream | null> {
  if (
    warmStream &&
    warmStream.getAudioTracks().some((t) => t.readyState === "live")
  ) {
    return warmStream;
  }
  if (warmStreamPromise) return warmStreamPromise;
  warmStreamPromise = (async () => {
    if (!navigator.mediaDevices?.getUserMedia) return null;
    try {
      const builtInId = await pickBuiltInMicId();
      const constraints: MediaStreamConstraints = builtInId
        ? { audio: { deviceId: { exact: builtInId } } }
        : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      // If we couldn't get the built-in mic by label (no permission yet),
      // re-enumerate now that the OS prompt has resolved and switch the
      // track to built-in if a different device leaked through.
      if (!builtInId) {
        const id = await pickBuiltInMicId();
        if (id) {
          const track = stream.getAudioTracks()[0];
          if (track && track.getSettings().deviceId !== id) {
            try {
              await track.applyConstraints({ deviceId: { exact: id } });
            } catch {
              // applyConstraints may not switch hardware; keep current track.
            }
          }
          warmStreamDeviceId = id;
        }
      } else {
        warmStreamDeviceId = builtInId;
      }
      // Disable the track until a session actually wants it. With the
      // track disabled the mic indicator goes off, no audio is captured,
      // but the audio session stays open — flipping `enabled = true`
      // resumes capture instantly with no system audio glitch.
      stream.getAudioTracks().forEach((t) => (t.enabled = false));
      warmStream = stream;
      return stream;
    } catch (err) {
      console.warn("[voice-dictation] prewarm getUserMedia failed:", err);
      return null;
    } finally {
      warmStreamPromise = null;
    }
  })();
  return warmStreamPromise;
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
  // Aggressive timeout — short clips should transcribe in well under
  // 2 seconds with Gemini Flash Lite or Whisper. If the server hasn't
  // come back in 8s it's hanging; abort and let the bar dismiss with an
  // error rather than leaving "Polishing..." up for 45 seconds.
  const timeout = window.setTimeout(() => controller.abort(), 8_000);
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
    if (providerStatus && Date.now() - providerStatusFetchedAt < 60_000) {
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
        native: !!data.native,
      };
      providerStatusFetchedAt = Date.now();
      return providerStatus;
    } catch (err) {
      console.warn("[voice-dictation] provider status fetch failed:", err);
      // CRITICAL: do NOT cache a failed lookup. Otherwise a transient
      // server-down (dev server still booting, auth churn, network
      // blip) poisons the cache for 60s and every dictation press in
      // that window resolves to "browser" → no webkitSpeechRecognition
      // in WKWebView → fallback to startServer("auto") → server 400s.
      // Letting the next press re-attempt the fetch is the right
      // failure mode.
      providerStatus = null;
      providerStatusFetchedAt = 0;
      // Return a transient browser-only snapshot so the immediate call
      // has something to work with, but don't persist it.
      return {
        builder: false,
        gemini: false,
        openai: false,
        groq: false,
        browser: true,
        native: false,
      };
    }
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
    | { kind: "native" }
    | {
        kind: "server";
        providerPref: "auto" | "builder" | "gemini" | "openai" | "groq";
      }
  > => {
    if (provider === "browser") return { kind: "browser" };
    if (provider === "macos-native") return { kind: "native" };
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
    } else if (resolved.kind === "native") {
      await startNative();
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
      console.log("[voice-dictation] startServer:", providerPref);
      // Per-press getUserMedia, but still pinned to the built-in mic when
      // we can identify it. The warm-stream pre-warm caused silent
      // recordings (track.enabled toggling between sessions left WebKit's
      // MediaRecorder pipeline reading silence even after the re-enable)
      // — opening fresh per press fixes that. Built-in-mic pinning is
      // independent of warming and still required: opening getUserMedia
      // through a Bluetooth headset puts macOS in a tighter audio-session
      // mode that pauses/glitches whatever is playing, so AirPods users
      // would otherwise see audio cut out the moment they start dictation.
      const builtInId = await pickBuiltInMicId();
      const stream = await navigator.mediaDevices.getUserMedia(
        builtInId
          ? { audio: { deviceId: { exact: builtInId } } }
          : { audio: true },
      );
      if (disposed || stopRequestedBeforeReady) {
        stream.getTracks().forEach((track) => track.stop());
        startInFlight = false;
        stopRequestedBeforeReady = false;
        setFlowState("idle");
        invoke("hide_flow_bar").catch(() => {});
        return;
      }
      await invoke("show_flow_bar");
      setFlowState("recording");
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
          // Dismiss the bar immediately — no "Polishing..." lag after the
          // text already landed in the focused field.
          if (!disposed) cleanup(next);
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
      // CRITICAL: clear `session` if we'd assigned it. Without this, a
      // post-`session = next` throw leaves the global session pointing
      // at a defunct recorder, and every subsequent start() bails at
      // its "if (session) return" guard — manifesting as "Fn does
      // nothing." We can safely null it because start() only proceeds
      // when session is null (and any concurrent start would have
      // bailed on `startInFlight`).
      session = null;
      setFlowState("error");
      window.setTimeout(() => {
        if (disposed || session) return;
        setFlowState("idle");
        invoke("hide_flow_bar").catch(() => {});
      }, 800);
    }
  };

  /**
   * Native macOS path: drive Apple's SFSpeechRecognizer + AVAudioEngine
   * from Rust via the `native_speech_*` Tauri commands. Partial and final
   * transcripts arrive as `voice:partial-transcript` / `voice:final-transcript`
   * Tauri events (wired up below at install time) and we accumulate them
   * into `next.browserTranscript` so the existing immediate-paste logic in
   * `stop()` works the same way as for the browser path.
   *
   * No `getUserMedia()` here — the audio engine handles the mic on the Rust
   * side. The synthetic meter still drives the flow-bar's waveform.
   */
  const startNative = async () => {
    console.log("[voice-dictation] startNative: invoke native_speech_start");
    try {
      startInFlight = true;
      stopRequestedBeforeReady = false;
      // Open a parallel mic stream JUST for the live audio meter. This
      // is safe with the native path because SFSpeechRecognizer's audio
      // capture lives in Rust (AVAudioEngine, separate bus) — multiple
      // mic consumers coexist fine on macOS. We deliberately don't do
      // this on the browser path because webkitSpeechRecognition fights
      // a sibling getUserMedia in WKWebView.
      //
      // Disable echoCancellation / noiseSuppression / autoGainControl so
      // we stay in standard mic mode. With them ON, macOS may switch
      // into voice-call mode which conflicts with AVAudioEngine's
      // input bus and causes getUserMedia to silently return a dead
      // stream that produces no audio levels.
      const meterStream = await navigator.mediaDevices
        .getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        })
        .catch((err) => {
          console.warn(
            `[voice-dictation] meter getUserMedia failed (${(err as Error)?.name ?? "Error"}): ${(err as Error)?.message ?? String(err)} — falling back to synthetic meter`,
          );
          return null;
        });
      if (meterStream) {
        const tracks = meterStream.getAudioTracks();
        console.log(
          `[voice-dictation] meter mic ready: ${tracks.length} track(s)`,
          tracks[0]?.label || "unlabeled",
        );
      }
      await invoke("show_flow_bar");
      setFlowState("recording");
      // Reset any prior partial transcript display in the flow-bar.
      emit("voice:partial-transcript", { text: "" }).catch(() => {});
      const next: VoiceSession = {
        kind: "native",
        stream: meterStream,
        recorder: null,
        chunks: [],
        audioContext: null,
        analyser: null,
        raf: null,
        mimeType: "",
        recognition: null,
        browserTranscript: "",
        startedAt: Date.now(),
        stopping: false,
        transcribeAbort: null,
        cancelled: false,
      };
      session = next;
      startInFlight = false;
      // Real audio meter from the parallel mic stream — bars bounce with
      // the user's voice + volume. Falls back to synthetic if the mic
      // stream couldn't be opened (e.g. permission denied just for
      // getUserMedia).
      if (meterStream) {
        startMeter(next);
      } else {
        startSyntheticMeter(next);
      }
      try {
        await invoke("native_speech_start", {
          locale: navigator.language || "en-US",
        });
        console.log("[voice-dictation] native_speech_start ok");
      } catch (err) {
        console.error("[voice-dictation] native_speech_start failed:", err);
        if (session === next) session = null;
        throw err;
      }
      if (stopRequestedBeforeReady) {
        stop();
      }
    } catch (err) {
      console.error("[voice-dictation] startNative failed", err);
      startInFlight = false;
      stopRequestedBeforeReady = false;
      session = null;
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
    console.log("[voice-dictation] startBrowser: opening mic + recognition");
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      console.error(
        "[voice-dictation] webkitSpeechRecognition unavailable — falling back to server",
      );
      await startServer("auto");
      return;
    }
    try {
      startInFlight = true;
      stopRequestedBeforeReady = false;
      // IMPORTANT: do NOT call getUserMedia here — opening a parallel
      // MediaStream conflicts with webkitSpeechRecognition's own mic
      // capture in WKWebView (they fight over the input device, and
      // recognition.onresult silently never fires). The synthetic
      // waveform meter below is good-enough visual feedback; the user
      // sees the bar pulsing while they speak. We tried real meters
      // and broke voice capture every time.
      await invoke("show_flow_bar");
      setFlowState("recording");
      // Reset any prior partial transcript display in the flow-bar.
      emit("voice:partial-transcript", { text: "" }).catch(() => {});
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
      // Lifecycle diagnostics — when something silently fails (common in
      // WKWebView Web Speech), missing logs tell us exactly which stage
      // is broken. Cheap to keep enabled.
      (recognition as unknown as { onstart: (() => void) | null }).onstart =
        () => console.log("[voice-dictation] recognition.onstart");
      (
        recognition as unknown as { onaudiostart: (() => void) | null }
      ).onaudiostart = () => {
        console.log("[voice-dictation] recognition.onaudiostart");
        // After recognition has the mic, open a sibling getUserMedia
        // stream just for the live meter. Doing it AFTER onaudiostart
        // (rather than before recognition.start()) lets recognition
        // claim the device first; the second consumer rides along on
        // macOS's multi-tap mic. If we can't open it, the synthetic
        // meter started below stays running.
        navigator.mediaDevices
          .getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
          })
          .then((meterStream) => {
            if (next.cancelled || session !== next) {
              meterStream.getTracks().forEach((t) => t.stop());
              return;
            }
            next.stream = meterStream;
            stopMeter(next);
            startMeter(next);
            console.log(
              "[voice-dictation] meter mic ready (browser):",
              meterStream.getAudioTracks()[0]?.label || "unlabeled",
            );
          })
          .catch((err) => {
            console.warn(
              `[voice-dictation] browser parallel mic failed (${(err as Error)?.name ?? "Error"}): ${(err as Error)?.message ?? err} — synthetic meter stays`,
            );
          });
      };
      (
        recognition as unknown as { onspeechstart: (() => void) | null }
      ).onspeechstart = () =>
        console.log("[voice-dictation] recognition.onspeechstart");
      recognition.onresult = (ev) => {
        // Build current full text (final segments + latest interim).
        let finalSoFar = "";
        let interim = "";
        for (let i = 0; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) {
            finalSoFar += r[0].transcript;
          } else {
            interim += r[0].transcript;
          }
        }
        // Include interim in browserTranscript so an abort() in stop()
        // captures the words the user just said — without it we'd lose
        // the tail because Web Speech only marks a segment as `isFinal`
        // after a confidence-threshold pass.
        next.browserTranscript = (finalSoFar + interim).trim();
        // Stream the live transcript to the flow-bar.
        emit("voice:partial-transcript", {
          text: next.browserTranscript,
        }).catch(() => {});
      };
      recognition.onerror = (ev) => {
        if (ev.error !== "no-speech" && ev.error !== "aborted") {
          console.warn("[voice-dictation] recognition error:", ev.error);
        } else {
          console.log(
            "[voice-dictation] recognition error (benign):",
            ev.error,
          );
        }
      };
      recognition.onend = async () => {
        console.log("[voice-dictation] recognition.onend");
        stopMeter(next);
        stopTracks(next);
        if (session === next) session = null;
        const text = next.browserTranscript.trim();
        if (disposed || next.cancelled || !text) {
          console.log(
            "[voice-dictation] no usable text on onend (cancelled/empty)",
          );
          // Clear the live transcript display.
          emit("voice:partial-transcript", { text: "" }).catch(() => {});
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
        emit("voice:partial-transcript", { text: "" }).catch(() => {});
        cleanup(next);
      };
      session = next;
      startInFlight = false;
      // Synthetic meter — we deliberately don't open a parallel
      // getUserMedia stream (it conflicts with webkitSpeechRecognition's
      // mic capture in WKWebView and silently kills onresult).
      startSyntheticMeter(next);
      try {
        recognition.start();
        console.log("[voice-dictation] recognition.start() returned");
      } catch (err) {
        console.error("[voice-dictation] recognition.start threw:", err);
        // Recognition failed after we handed the stream to `next` — close
        // it through the session so we don't leak the mic.
        stopTracks(next);
        if (session === next) session = null;
        throw err;
      }
      if (stopRequestedBeforeReady) {
        stop();
      }
    } catch (err) {
      console.error("[voice-dictation] startBrowser failed", err);
      startInFlight = false;
      stopRequestedBeforeReady = false;
      // See note in startServer's catch — clear leaked session so the
      // next Fn press isn't blocked on a stale `if (session) return`.
      session = null;
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
      } else if (current.kind === "native") {
        // Tear the Rust-side session down without delivering a final
        // transcript.
        invoke("native_speech_cancel").catch((err) => {
          console.warn("[voice-dictation] native_speech_cancel failed:", err);
        });
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
      // Too brief to be a deliberate dictation — tear down without
      // running the transcription path. Treat it as a cancel so onend
      // for browser sessions also skips the paste.
      current.cancelled = true;
      if (current.kind === "browser") {
        try {
          current.recognition?.abort();
        } catch {
          // ignore
        }
      } else if (current.kind === "native") {
        invoke("native_speech_cancel").catch(() => {});
      }
      cleanup(current);
      return;
    }
    try {
      if (current.kind === "server") {
        current.recorder?.stop();
      } else if (current.kind === "native") {
        // NATIVE PATH: dismiss the pill *immediately* (snappy UX) but
        // leave the transcript chip lingering. Tell Rust to `endAudio()`
        // so SFSpeechRecognizer can deliver its final hypothesis. When
        // `voice:final-transcript` lands (or after a safety timeout),
        // paste the text and let the chip sit for ~1s with the final
        // word visible — like a notification fading — then dismiss.
        invoke("native_speech_stop").catch((err) => {
          console.warn("[voice-dictation] native_speech_stop failed:", err);
        });
        // Pill goes RIGHT NOW. The flow-bar window stays open (we'll
        // hide it after the linger) but renders only the transcript
        // chip in idle state.
        setFlowState("idle");
        // Free the global session-startup guards immediately, matching the
        // browser paths below. Deferring these to the end of the 1.2s
        // linger meant a rapid second Fn tap during linger silently no-op'd
        // because `start()` early-returns while `startInFlight` is true.
        // The captured `current` ref is what `finalize()` and the timers
        // operate on, so detaching `session`/flags from it here is safe.
        if (session === current) session = null;
        startInFlight = false;
        stopRequestedBeforeReady = false;
        stopMeter(current);
        stopTracks(current);

        const lingering = current;
        const stopAtMs = Date.now();
        console.log(
          "[voice-dictation] native stop — pill dismissed, awaiting final",
        );
        let finalized = false;
        const finalize = (reason: "final" | "timeout" | "manual") => {
          if (finalized) return;
          finalized = true;
          console.log(
            `[voice-dictation] native finalize (${reason}, +${Date.now() - stopAtMs}ms)`,
          );
          // If the user cancelled (X button) during the wait window or a
          // brand-new session has started (Fn re-tapped during linger),
          // skip paste + linger. cleanup() already ran via cancel() in the
          // cancelled case; in the new-session case the new `session` owns
          // the flow-bar now and we'd otherwise paste stale text against
          // it.
          if (lingering.cancelled) return;
          if (session && session !== lingering) return;
          const text = lingering.browserTranscript.trim();
          lingering.browserTranscript = "";
          if (text) {
            console.log(
              `[voice-dictation] native paste (${text.length} chars):`,
              text.slice(0, 120),
            );
            invoke("complete_voice_dictation", { text }).catch((err) => {
              console.error("[voice-dictation] paste failed:", err);
            });
            // Make sure the chip displays the FINAL text (the
            // install-time final listener also pushes this, but we
            // emit explicitly so the chip is up-to-date in case the
            // listener fired before HMR refreshed the flow-bar).
            emit("voice:partial-transcript", { text }).catch(() => {});
          } else {
            console.warn(
              "[voice-dictation] no transcript captured — native recognizer didn't produce results",
            );
          }
          // Linger ~1.2s with the transcript chip visible (no pill,
          // just the floating text), then clear the chip + hide the
          // window. Don't clobber a new session's flow-bar if one started.
          console.log("[voice-dictation] starting linger");
          window.setTimeout(() => {
            console.log("[voice-dictation] linger done — dismissing");
            if (disposed) return;
            if (session && session !== lingering) return;
            invoke("hide_flow_bar").catch(() => {});
            emit("voice:partial-transcript", { text: "" }).catch(() => {});
          }, 1200);
        };

        // The install-time `voice:final-transcript` listener calls
        // `current.onNativeFinalize` when the final result arrives.
        lingering.onNativeFinalize = () => finalize("final");
        // Safety timer: if final never arrives (unsupported locale,
        // crash, etc.), proceed after 3s with whatever partial we have.
        window.setTimeout(() => finalize("timeout"), 3000);
      } else {
        // BROWSER PATH: conditional dismiss based on whether we
        // captured any words.
        //
        // Empty transcript (accidental Fn tap, or user released before
        // speaking): snappy dismiss — pill + everything goes RIGHT
        // away, no tail capture.
        //
        // Transcript present (user actually dictated): pill goes away
        // immediately for snappiness, but we keep recognition alive
        // for ~1500ms to catch the trailing word(s) the user hadn't
        // finished saying when they lifted Fn. The transcript chip
        // stays visible during this tail-capture window AND for an
        // additional ~1000ms linger after we paste, so the user can
        // read what landed.
        const initialText = current.browserTranscript.trim();
        if (!initialText) {
          // Snappy path — accidental tap.
          current.browserTranscript = "";
          if (session === current) session = null;
          startInFlight = false;
          stopRequestedBeforeReady = false;
          setFlowState("idle");
          invoke("hide_flow_bar").catch(() => {});
          emit("voice:partial-transcript", { text: "" }).catch(() => {});
          try {
            current.recognition?.abort();
          } catch {
            // ignore
          }
          stopMeter(current);
          stopTracks(current);
          console.warn(
            "[voice-dictation] no transcript captured — recognition didn't produce results",
          );
        } else {
          // Tail-capture path. Hide pill but keep recognition listening
          // so onresult continues to grow browserTranscript for ~1.5s.
          // Clear the global session slot now so a new Fn press isn't
          // blocked by the lingering one (the captured `current` ref
          // still works through onresult's closure).
          const lingering = current;
          if (session === current) session = null;
          startInFlight = false;
          stopRequestedBeforeReady = false;
          setFlowState("idle");
          stopMeter(lingering);
          console.log(
            `[voice-dictation] tail-capture starting (${initialText.length} chars so far): "${initialText.slice(0, 60)}..."`,
          );
          window.setTimeout(() => {
            if (lingering.cancelled || disposed) return;
            // A new Fn-tap during tail-capture starts a fresh session that
            // owns the flow-bar now. Don't paste this lingering session's
            // text against it, and don't wipe its UI on dismiss. Mirrors
            // the native finalize guard above.
            if (session && session !== lingering) return;
            const finalText = lingering.browserTranscript.trim();
            lingering.browserTranscript = "";
            try {
              lingering.recognition?.abort();
            } catch {
              // ignore
            }
            stopTracks(lingering);
            if (finalText) {
              const tailGain = finalText.length - initialText.length;
              console.log(
                `[voice-dictation] tail-capture done (${finalText.length} chars, +${tailGain} from tail): "${finalText.slice(0, 80)}"`,
              );
              invoke("complete_voice_dictation", { text: finalText }).catch(
                (err) => {
                  console.error("[voice-dictation] paste failed:", err);
                },
              );
              // Linger ~1s with the chip showing the final text, then
              // dismiss everything.
              window.setTimeout(() => {
                if (disposed) return;
                if (session && session !== lingering) return;
                invoke("hide_flow_bar").catch(() => {});
                emit("voice:partial-transcript", { text: "" }).catch(() => {});
              }, 1000);
            } else {
              // Edge case: tail capture wiped the transcript somehow.
              invoke("hide_flow_bar").catch(() => {});
              emit("voice:partial-transcript", { text: "" }).catch(() => {});
            }
          }, 1500);
        }
      }
    } catch (err) {
      console.error("[voice-dictation] stop failed", err);
      setFlowState("error");
      window.setTimeout(() => {
        if (!disposed) cleanup(current);
      }, 800);
    }
  };

  // Prime the provider-status cache in the background so the first Fn
  // press doesn't pay a round-trip latency to figure out which provider
  // to use.
  refreshProviderStatus().catch(() => {});

  // Native (SFSpeechRecognizer) event subscriptions. These are always
  // installed — the events only fire when the Rust side has an active
  // session, so subscribing on non-native sessions is harmless. The
  // flow-bar listens to `voice:partial-transcript` independently so we
  // don't re-emit it here.
  listen<{ text: string }>("voice:partial-transcript", (ev) => {
    const current = session;
    if (!current || current.kind !== "native") return;
    if (current.cancelled || current.stopping) return;
    current.browserTranscript = (ev.payload.text || "").trim();
  })
    .then((u) => unlistens.push(u))
    .catch(() => {});
  listen<{ text: string }>("voice:final-transcript", (ev) => {
    const current = session;
    if (!current || current.kind !== "native") return;
    if (current.cancelled) return;
    // Final beats partial — overwrite so a `complete_voice_dictation`
    // from a late stop() picks up the better text.
    current.browserTranscript = (ev.payload.text || "").trim();
    // If stop() is waiting on this event before lingering, trigger the
    // finalize sequence now (paste → 1s linger → dismiss).
    current.onNativeFinalize?.();
  })
    .then((u) => unlistens.push(u))
    .catch(() => {});
  listen<{ error: string }>("voice:speech-error", (ev) => {
    const current = session;
    console.error("[voice-dictation] native speech error:", ev.payload.error);
    if (!current || current.kind !== "native") return;
    setFlowState("error");
    window.setTimeout(() => {
      if (!disposed && session === current) cleanup(current);
    }, 800);
  })
    .then((u) => unlistens.push(u))
    .catch(() => {});

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

  console.log(
    "[voice-dictation] installed v3 (no-warm-stream): provider=" + provider,
  );

  return () => {
    disposed = true;
    enabled = false;
    serverUrl = "";
    shortcut = "both";
    mode = "push-to-talk";
    provider = "auto";
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
