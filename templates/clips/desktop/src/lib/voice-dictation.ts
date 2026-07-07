import type { VoiceContextPack } from "@agent-native/core/voice";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

import { applyBacktrack } from "./backtrack";
import {
  configureVocabularyClient,
  loadVocabulary,
  loadVocabularyEntries,
  recordPasteForLearn,
} from "./personal-vocabulary";
import {
  onFinalTranscript,
  onPartialTranscript,
  onSpeechError,
} from "./transcription-engine";

export type VoiceShortcutPreference =
  | "fn"
  | "cmd-shift-space"
  | "ctrl-shift-space"
  | "custom"
  | "both";
export type VoiceMode = "push-to-talk" | "toggle";

/**
 * Which transcription backend to use. The desktop app surfaces this in
 * Settings → Voice transcription as three modes: native on-device,
 * Builder.io cleanup, or bring-your-own-key cleanup. Legacy "auto" still
 * picks a configured server-side provider, falling through to macOS native
 * dictation or the browser's Web Speech API if nothing is set up.
 */
export type VoiceProvider =
  | "auto"
  | "browser"
  | "macos-native"
  | "whisper"
  | "builder-gemini"
  | "builder"
  | "gemini"
  | "groq";
type ServerVoiceProvider =
  | "auto"
  | "builder-gemini"
  | "builder"
  | "gemini"
  | "groq";

type FlowState = "idle" | "recording" | "processing" | "complete" | "error";
type VoiceShortcutSource =
  | "fn"
  | "cmd-shift-space"
  | "ctrl-shift-space"
  | "custom";

interface ProviderStatus {
  builder: boolean;
  gemini: boolean;
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
  micDeviceId?: string | null;
  micDeviceLabel?: string | null;
  instructions?: string;
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
  // on-device, real-time partials, free, macOS-only. "whisper" sessions
  // drive the local whisper.cpp engine via audio_transcription_* commands,
  // mic-only (captureSystem: false), no API key required.
  kind: "server" | "browser" | "native" | "whisper";
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
  // Native / Whisper engines can emit one final segment per pause. Keep
  // committed segments separate from the current partial so long dictations
  // survive natural pauses.
  finalTranscriptParts: string[];
  interimTranscript: string;
  // browser-only: monotonic timestamp of the most recent
  // recognition.onresult event. stop() reads this to decide whether
  // the user was actively speaking up to Fn release (worth a tail-
  // capture window for trailing words) or had clearly fallen silent
  // (paste right away, no extra delay).
  lastResultAt: number;
  // common
  // Which hotkey (if any) started this session — carried through to the
  // create-dictation history row (R12) so the /dictate tab can show how
  // the user triggered it. Undefined for the in-webview Dictate panel's
  // own record button (that flow doesn't go through this module).
  triggerSource?: VoiceShortcutSource;
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
  // Optional LLM cleanup provider. Native/browser sessions still provide
  // real-time transcript text; this provider does a short cleanup pass
  // after stop and before paste.
  cleanupProvider?: ServerVoiceProvider | null;
  // R12 history persistence: set once `completeText` has fired the
  // fire-and-forget create-dictation call for this session, so the D3
  // late-final path (safety-timeout already pasted a partial) knows not
  // to insert a second history row when the real final arrives afterward.
  historySaved?: boolean;
  // D3 late-final hook: when the safety timeout has already pasted a
  // partial and a late `voice:final-transcript` subsequently lands, this
  // lets that late text improve the (not-yet-saved) history row without
  // re-pasting into the focused app.
  onLateFinalText?: ((text: string) => void) | null;
}

function normalizedMediaDeviceId(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function isPseudoMediaDeviceId(value: string | null | undefined): boolean {
  const id = normalizedMediaDeviceId(value).toLowerCase();
  return id === "default" || id === "communications";
}

function concreteMediaDeviceId(value: string | null | undefined): string {
  const id = normalizedMediaDeviceId(value);
  return id && !isPseudoMediaDeviceId(id) ? id : "";
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
    const inputs = devices.filter(
      (d) => d.kind === "audioinput" && concreteMediaDeviceId(d.deviceId),
    );
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

function setFlowState(state: FlowState): void {
  emit("voice:state-change", { state }).catch(() => {});
}

let lastStartPingAt = 0;

function playStartPing(): void {
  const now = Date.now();
  if (now - lastStartPingAt < 250) return;
  lastStartPingAt = now;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime;
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, start);
    osc.frequency.exponentialRampToValueAtTime(1174.66, start + 0.08);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.08, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.14);
    window.setTimeout(() => {
      ctx.close().catch(() => {});
    }, 250);
  } catch {
    // Sound feedback is best-effort; the moving bars remain the visual cue.
  }
}

function enterRecordingState(): void {
  setFlowState("recording");
  playStartPing();
}

function joinedTranscript(parts: string[], interim: string): string {
  return [...parts, interim].filter(Boolean).join(" ").trim();
}

function appendFinalTranscript(session: VoiceSession, text: string): void {
  const clean = text.trim();
  if (!clean) return;
  const committed = joinedTranscript(session.finalTranscriptParts, "");
  if (!committed) {
    session.finalTranscriptParts = [clean];
  } else if (clean === committed || clean.startsWith(`${committed} `)) {
    // Some recognizers send the whole dictation as their final result.
    session.finalTranscriptParts = [clean];
  } else if (session.finalTranscriptParts.at(-1) !== clean) {
    session.finalTranscriptParts.push(clean);
  }
  session.interimTranscript = "";
  session.browserTranscript = joinedTranscript(
    session.finalTranscriptParts,
    "",
  );
}

function setInterimTranscript(session: VoiceSession, text: string): void {
  session.interimTranscript = text.trim();
  session.browserTranscript = joinedTranscript(
    session.finalTranscriptParts,
    session.interimTranscript,
  );
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
 * Browser-path / native-path placeholder meter: pulses a low-amplitude
 * sine wave so the bar reads as "listening" even when we don't have a
 * real mic stream to analyse. Bails out the moment a real meter takes
 * over (either because the parallel `getUserMedia` succeeded mid-
 * session, or because the session ended).
 */
function startSyntheticMeter(session: VoiceSession): void {
  const tick = () => {
    if (session.cancelled || session.stopping) return;
    // Real meter has taken over once `session.stream` is set —
    // startMeter will own session.raf from here. Bail so we don't
    // keep emitting synthetic levels that overwrite the real ones
    // and make the bars fight visually. (Cancelling raf alone isn't
    // enough — a tick currently in flight would still reschedule.)
    if (session.stream) return;
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
  providerPref: ServerVoiceProvider,
  controller: AbortController,
  instructions?: string,
  contextPack?: VoiceContextPack,
  language?: string,
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
  // server default (Builder Gemini → Gemini → Groq fallback chain),
  // anything else pins to that one provider with no fallback.
  form.append("provider", providerPref);
  const trimmedInstructions = instructions?.trim();
  if (trimmedInstructions) {
    form.append("instructions", trimmedInstructions);
  }
  // P3: server fully supports a `language` hint (packages/core's
  // transcribe-voice.ts) but no client ever sent it. There's no dedicated
  // language setting in desktop Settings, so reuse the same locale already
  // sourced for the native/browser recognizers (nativeSpeechArgs/
  // recognition.lang) rather than adding new settings UI in this pass.
  if (language) form.append("language", language);
  appendVoiceContext(form, contextPack);
  // Aggressive timeout — short clips should transcribe in well under
  // 2 seconds with Gemini Flash Lite or Whisper. If the server hasn't
  // come back in 8s it's hanging; abort and let the bar dismiss with an
  // error rather than leaving "Cleaning up..." up for 45 seconds.
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

async function cleanupTranscript(
  serverUrl: string,
  text: string,
  providerPref: ServerVoiceProvider,
  controller: AbortController,
  instructions?: string,
  contextPack?: VoiceContextPack,
  language?: string,
): Promise<string> {
  const form = new FormData();
  form.append("text", text);
  form.append("provider", providerPref);
  const trimmedInstructions = instructions?.trim();
  if (trimmedInstructions) {
    form.append("instructions", trimmedInstructions);
  }
  // P3: same language hint as transcribe() — the server's cleanup branch
  // also reads the `language` form field (transcribe-voice.ts's textPart
  // path), so thread it through here too.
  if (language) form.append("language", language);
  appendVoiceContext(form, contextPack);

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
    if (!res.ok) {
      const body = await res
        .json()
        .catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(body?.error || `Cleanup failed (${res.status})`);
    }
    const data = (await res.json()) as { text?: string };
    return (data.text ?? "").trim();
  } finally {
    window.clearTimeout(timeout);
  }
}

function appendVoiceContext(
  form: FormData,
  contextPack: VoiceContextPack | undefined,
): void {
  if (!contextPack) return;
  try {
    form.append("voiceContext", JSON.stringify(contextPack));
  } catch {
    /* best effort */
  }
}

export function installDesktopVoiceDictation(
  options: DesktopVoiceDictationOptions,
): () => void {
  let disposed = false;
  let session: VoiceSession | null = null;
  // After stop() in the native path, `session` is cleared immediately so
  // a rapid second Fn tap can start fresh. But the install-time
  // `voice:final-transcript` listener still needs to find the lingering
  // session so it can fire `onNativeFinalize` and run the paste. This
  // ref holds that session through the wait + linger window; cleared
  // once the linger callback completes.
  let lingeringSession: VoiceSession | null = null;
  let serverUrl = options.serverUrl;
  let enabled = options.enabled;
  let shortcut = options.shortcut;
  let mode = options.mode;
  let provider = options.provider;
  let micDeviceId = concreteMediaDeviceId(options.micDeviceId);
  let micDeviceLabel = options.micDeviceLabel ?? "";
  let instructions = options.instructions ?? "";
  let startInFlight = false;
  let stopRequestedBeforeReady = false;
  // Cached provider availability fetched once at install time. Used by
  // resolveProvider() so an "auto" preference can pick browser when no
  // server-side provider is configured. Refreshed lazily when start()
  // sees a stale cache.
  let providerStatus: ProviderStatus | null = null;
  let providerStatusFetchedAt = 0;
  // P4 (Wispr double-tap hands-free, push-to-talk only): when a
  // press-release cycle is too brief for a deliberate dictation (the
  // existing <500ms accidental-tap discard in stop()), we note the
  // timestamp here instead of just discarding. If a second press lands
  // within HANDS_FREE_UPGRADE_WINDOW_MS, that second press upgrades to a
  // hands-free session instead of being discarded as its own accidental
  // tap. Cleared once consumed or once the window elapses.
  let pendingHandsFreeTapAt: number | null = null;
  // True for the lifetime of a hands-free session: it ignores the
  // shortcut's release edge and instead waits for the next full press to
  // stop + paste. Reset on stop, cancel, and dispose so it can never leak
  // into a later ordinary push-to-talk session.
  let handsFreeActive = false;
  const HANDS_FREE_UPGRADE_WINDOW_MS = 400;
  const unlistens: Array<() => void> = [];

  // Hands-free sessions outlive the physical key press that started them, but
  // Rust's Escape registration is otherwise driven by physical key edges and
  // disarms when the triggering key is released. Route every hands-free state
  // transition through this helper so Escape remains armed for the whole
  // hands-free session and disarms on every exit path.
  const setHandsFreeActive = (active: boolean) => {
    if (handsFreeActive === active) return;
    handsFreeActive = active;
    invoke("set_dictation_escape_active", { active }).catch((err) => {
      console.warn(
        "[voice-dictation] set_dictation_escape_active failed:",
        err,
      );
    });
  };

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
  const refreshProviderStatus = async (
    opts: { logFailures?: boolean } = {},
  ): Promise<ProviderStatus> => {
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
        groq: !!data.groq,
        browser: true,
        native: !!data.native,
      };
      providerStatusFetchedAt = Date.now();
      return providerStatus;
    } catch (err) {
      if (opts.logFailures) {
        console.warn("[voice-dictation] provider status fetch failed:", err);
      }
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
    | { kind: "browser"; cleanupProvider?: ServerVoiceProvider }
    | { kind: "native"; cleanupProvider?: ServerVoiceProvider }
    | { kind: "whisper"; cleanupProvider?: ServerVoiceProvider }
    | {
        kind: "server";
        providerPref: ServerVoiceProvider;
      }
  > => {
    if (provider === "browser") {
      // Web Speech captures the OS default input and exposes no device
      // selector. If the user picked a concrete mic on macOS, use the native
      // path so the selection is honored instead of silently opening default.
      if (
        concreteMediaDeviceId(micDeviceId) &&
        typeof navigator !== "undefined" &&
        /Mac/i.test(navigator.platform)
      ) {
        return { kind: "native" };
      }
      return { kind: "browser" };
    }
    if (provider === "macos-native") return { kind: "native" };
    if (provider === "whisper") return { kind: "whisper" };
    if (provider !== "auto") {
      const cleanupProvider =
        provider === "builder" ? "builder-gemini" : provider;
      if (typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)) {
        return { kind: "native", cleanupProvider };
      }
      if (getSpeechRecognitionCtor()) {
        return { kind: "browser", cleanupProvider };
      }
      // No live local recognizer is available, so fall back to the older
      // audio-upload transcription path. The server will surface a clear
      // provider/key error if this provider is unavailable.
      return { kind: "server", providerPref: cleanupProvider };
    }
    const status = await refreshProviderStatus({ logFailures: true });
    if (status.builder)
      return { kind: "server", providerPref: "builder-gemini" };
    if (status.gemini) return { kind: "server", providerPref: "gemini" };
    if (status.groq) return { kind: "server", providerPref: "groq" };
    if (
      status.native &&
      typeof navigator !== "undefined" &&
      /Mac/i.test(navigator.platform)
    ) {
      return { kind: "native" };
    }
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

  const abortPendingStart = () => {
    startInFlight = false;
    stopRequestedBeforeReady = false;
    setFlowState("idle");
    invoke("hide_flow_bar").catch(() => {});
  };

  const start = async (triggerSource?: VoiceShortcutSource) => {
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

    startInFlight = true;
    stopRequestedBeforeReady = false;

    try {
      const resolved = await resolveProvider();
      if (disposed || stopRequestedBeforeReady) {
        abortPendingStart();
        return;
      }
      if (resolved.kind === "browser") {
        await startBrowser(resolved.cleanupProvider, triggerSource);
      } else if (resolved.kind === "native") {
        await startNative(resolved.cleanupProvider, triggerSource);
      } else if (resolved.kind === "whisper") {
        await startWhisper(resolved.cleanupProvider, triggerSource);
      } else {
        await startServer(resolved.providerPref, triggerSource);
      }
    } catch (err) {
      console.error("[voice-dictation] start failed", err);
      startInFlight = false;
      stopRequestedBeforeReady = false;
      // A failed start must not leave hands-free mode latched without a
      // session; the next shortcut would otherwise try to stop a null session.
      setHandsFreeActive(false);
      setFlowState("error");
      window.setTimeout(() => {
        if (disposed || session) return;
        setFlowState("idle");
        invoke("hide_flow_bar").catch(() => {});
      }, 800);
    }
  };

  // R12: map the hotkey that triggered a session onto create-dictation's
  // accepted `source` enum (fn-hold|cmd-shift-space|manual|other|fn|custom).
  const dictationHistorySource = (
    triggerSource: VoiceShortcutSource | undefined,
  ): "fn-hold" | "cmd-shift-space" | "custom" | "other" => {
    if (triggerSource === "fn") return "fn-hold";
    if (
      triggerSource === "cmd-shift-space" ||
      triggerSource === "ctrl-shift-space"
    ) {
      return "cmd-shift-space";
    }
    if (triggerSource === "custom") return "custom";
    return "other";
  };

  // R12: persist a history row for a completed hotkey dictation so it shows
  // up in the /dictate tab, same as the in-webview Dictate panel's own
  // record button already does via useActionMutation("create-dictation").
  // Fire-and-forget by design — must never delay paste/pill dismissal, and
  // desktop offline/errors must stay silent (no UI surface for this here).
  const saveDictationHistory = (
    target: VoiceSession,
    fullText: string,
    cleanedText: string,
  ): void => {
    if (target.historySaved) return;
    target.historySaved = true;
    const durationMs = Math.max(0, Date.now() - target.startedAt);
    void fetch(
      `${serverUrl.replace(/\/+$/, "")}/_agent-native/actions/create-dictation`,
      {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullText,
          cleanedText: cleanedText !== fullText ? cleanedText : null,
          durationMs,
          source: dictationHistorySource(target.triggerSource),
        }),
      },
    ).catch((err) => {
      console.warn(
        "[voice-dictation] create-dictation history save failed:",
        err,
      );
    });
  };

  const completeText = async (
    rawText: string,
    target: VoiceSession,
  ): Promise<string> => {
    const original = rawText.trim();
    if (!original) return "";
    // Install the late-final hook before any await below. Native final text can
    // arrive while cleanup or paste completion is still in flight, and the
    // hook lets it update history before the first save wins.
    target.onLateFinalText = (lateText) => {
      if (target.historySaved) return;
      saveDictationHistory(target, lateText, lateText);
    };
    let text = original;
    if (target.cleanupProvider) {
      setFlowState("processing");
      const controller = new AbortController();
      target.transcribeAbort = controller;
      try {
        const contextPack = await buildDesktopVoiceContextPack();
        text =
          (await cleanupTranscript(
            serverUrl,
            original,
            target.cleanupProvider,
            controller,
            instructions,
            contextPack,
            dictationLanguage(),
          )) || original;
      } catch (err) {
        if ((err as { name?: string })?.name !== "AbortError") {
          console.warn(
            "[voice-dictation] cleanup failed, pasting raw transcript:",
            (err as Error)?.message ?? err,
          );
        }
        text = original;
      } finally {
        target.transcribeAbort = null;
      }
    }
    if (target.cancelled || disposed) return "";
    // Wispr-style backtrack: apply "scratch that" / "delete word" / new-line
    // edits AND punctuation-by-name *before* the cleanup-pass-massaged text
    // hits the focused field. Pure / fail-soft — if the regex blows up we
    // log and paste the raw text.
    try {
      text = applyBacktrack(text) || text;
    } catch (err) {
      console.warn("[voice-dictation] backtrack failed, pasting raw:", err);
    }
    await invoke("complete_voice_dictation", { text });
    // Wispr-style auto-learn: snapshot the field for ~10s post-paste; any
    // single-word user edit becomes a persisted vocabulary entry.
    try {
      recordPasteForLearn(text);
    } catch (err) {
      console.warn("[voice-dictation] vocab learn-monitor failed:", err);
    }
    saveDictationHistory(target, original, text);
    // onLateFinalText is wired up at the top of this function so a late final
    // that lands mid-cleanup or mid-paste can still improve the just-saved
    // history row instead of being dropped.
    if (target.cleanupProvider) setFlowState("idle");
    return text;
  };

  const selectedMicConstraints = (): MediaStreamConstraints | null => {
    const deviceId = concreteMediaDeviceId(micDeviceId);
    return deviceId
      ? {
          audio: { deviceId: { exact: deviceId } },
          video: false,
        }
      : null;
  };

  const preferredMicConstraints = async (): Promise<MediaStreamConstraints> => {
    const selected = selectedMicConstraints();
    if (selected) return selected;

    const builtInId = await pickBuiltInMicId();
    return builtInId
      ? { audio: { deviceId: { exact: builtInId } }, video: false }
      : { audio: true, video: false };
  };

  const nativeSpeechArgs = () => ({
    locale: navigator.language || "en-US",
    micDeviceId: concreteMediaDeviceId(micDeviceId) || null,
    micDeviceLabel: micDeviceLabel || null,
  });

  // P3: no dedicated language setting exists in desktop Settings, so the
  // server-side `language` hint reuses the same locale source already used
  // for the on-device native/browser recognizers (nativeSpeechArgs/
  // recognition.lang), trimmed to the 8-char cap the server applies.
  const dictationLanguage = (): string | undefined =>
    (navigator.language || "en-US").slice(0, 8);

  const buildDesktopVoiceContextPack = async (): Promise<
    VoiceContextPack | undefined
  > => {
    const vocabulary = await loadVocabularyEntries().catch(() => []);
    const terms = vocabulary.map((entry) => ({
      term: entry.term,
      replacement: entry.replacement,
      confidence: entry.confidence,
      source: "learned-correction",
      scope: "user",
    }));
    const snippets: NonNullable<VoiceContextPack["snippets"]> = [
      { label: "Target surface", value: "Desktop dictation paste" },
    ];
    if (micDeviceLabel) {
      snippets.push({ label: "Microphone", value: micDeviceLabel });
    }
    if (instructions.trim()) {
      snippets.push({
        label: "Saved voice instructions",
        value: instructions.trim().slice(0, 1200),
      });
    }
    return {
      surface: "clips-desktop",
      mode: "dictation",
      snippets,
      terms,
      metadata: {
        provider,
        locale: navigator.language || "en-US",
        micDeviceLabel: micDeviceLabel || null,
      },
    };
  };

  /**
   * Server-path: capture audio with MediaRecorder, POST it to the
   * transcribe-voice endpoint on Fn-up, paste the response text. The
   * "Cleaning up..." processing state is shown while we wait for the
   * remote transcription.
   */
  const startServer = async (
    providerPref: ServerVoiceProvider,
    triggerSource?: VoiceShortcutSource,
  ) => {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      console.error("[voice-dictation] MediaRecorder unavailable");
      abortPendingStart();
      return;
    }
    try {
      console.log("[voice-dictation] startServer:", providerPref);
      // Show the bar BEFORE getUserMedia (mirrors startNative/startWhisper/
      // startBrowser) so a first-time mic permission prompt has visible
      // context, and releasing the hotkey mid-prompt hides a bar the user
      // actually saw instead of silently no-oping (D6).
      await invoke("show_flow_bar");
      if (disposed || stopRequestedBeforeReady) {
        abortPendingStart();
        return;
      }
      // Per-press getUserMedia, but still pinned to the built-in mic when
      // we can identify it. The warm-stream pre-warm caused silent
      // recordings (track.enabled toggling between sessions left WebKit's
      // MediaRecorder pipeline reading silence even after the re-enable)
      // — opening fresh per press fixes that. Built-in-mic pinning is
      // independent of warming and still required: opening getUserMedia
      // through a Bluetooth headset puts macOS in a tighter audio-session
      // mode that pauses/glitches whatever is playing, so AirPods users
      // would otherwise see audio cut out the moment they start dictation.
      const stream = await navigator.mediaDevices.getUserMedia(
        await preferredMicConstraints(),
      );
      if (disposed || stopRequestedBeforeReady) {
        stream.getTracks().forEach((track) => track.stop());
        abortPendingStart();
        return;
      }
      enterRecordingState();
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
        finalTranscriptParts: [],
        interimTranscript: "",
        lastResultAt: 0,
        triggerSource,
        startedAt: Date.now(),
        stopping: false,
        transcribeAbort: null,
        cancelled: false,
        cleanupProvider: null,
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
          const contextPack = await buildDesktopVoiceContextPack();
          const text = await transcribe(
            serverUrl,
            next.chunks,
            next.mimeType,
            providerPref,
            controller,
            instructions,
            contextPack,
            dictationLanguage(),
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
            saveDictationHistory(next, text, text);
          } else {
            console.warn(
              "[voice-dictation] transcribe returned empty text — nothing to paste",
            );
          }
          // Dismiss the bar immediately — no "Cleaning up..." lag after the
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
      // Same wedge as start()'s outer catch: a failed hands-free upgrade must
      // not leave handsFreeActive stuck true.
      setHandsFreeActive(false);
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
  const startNative = async (
    cleanupProvider?: ServerVoiceProvider,
    triggerSource?: VoiceShortcutSource,
  ) => {
    console.log("[voice-dictation] startNative: invoke native_speech_start");
    try {
      // No parallel meter mic — Rust's AVAudioEngine is the only mic
      // consumer in this path. We previously opened a sibling
      // getUserMedia stream so the AnalyserNode could drive a voice-
      // tracking waveform, but having two consumers on macOS turned out
      // to (a) sometimes return a dead stream that produced flat zero
      // levels (so the waveform looked frozen), and (b) keep the orange
      // mic indicator lit after teardown — `track.stop()` didn't fully
      // release once the stream entered the degraded state. The
      // synthetic meter pulses the bars at a low amplitude so the bar
      // still reads as "listening". Voice-tracking levels can come back
      // later by having Rust compute RMS in the installTapOnBus block
      // and emit `voice:audio-level` events from there — single mic
      // consumer = clean release + real levels.
      await invoke("show_flow_bar");
      if (disposed || stopRequestedBeforeReady) {
        abortPendingStart();
        return;
      }
      enterRecordingState();
      // Reset any prior partial transcript display in the flow-bar.
      emit("voice:partial-transcript", { text: "" }).catch(() => {});
      const next: VoiceSession = {
        kind: "native",
        stream: null,
        recorder: null,
        chunks: [],
        audioContext: null,
        analyser: null,
        raf: null,
        mimeType: "",
        recognition: null,
        browserTranscript: "",
        finalTranscriptParts: [],
        interimTranscript: "",
        lastResultAt: 0,
        triggerSource,
        startedAt: Date.now(),
        stopping: false,
        transcribeAbort: null,
        cancelled: false,
        cleanupProvider: cleanupProvider ?? null,
      };
      session = next;
      startInFlight = false;
      startSyntheticMeter(next);
      try {
        // Bias the recognizer toward the user's learned vocabulary. Stage
        // the list via a separate command so meeting capture can pass mic
        // metadata to `native_speech_start` without also carrying vocabulary.
        // Best-effort — if the load failed we just stage an empty list and
        // the recognizer behaves as before.
        const vocabularyEntries = await loadVocabularyEntries().catch(() => []);
        const contextualStrings = vocabularyEntries.map((v) => v.replacement);
        await invoke("native_speech_set_vocabulary", {
          strings: contextualStrings,
        }).catch(() => {});
        await invoke("native_speech_start", nativeSpeechArgs());
        console.log(
          `[voice-dictation] native_speech_start ok (vocab=${contextualStrings.length})`,
        );
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
      // Clear the hands-free flag alongside session so a failed
      // native start (mic permission denial, engine-busy) can't wedge every
      // future press into a no-op stop() branch.
      setHandsFreeActive(false);
      setFlowState("error");
      window.setTimeout(() => {
        if (disposed || session) return;
        setFlowState("idle");
        invoke("hide_flow_bar").catch(() => {});
      }, 800);
    }
  };

  /**
   * Whisper path: local whisper.cpp engine via audio_transcription_* Tauri
   * commands. Mic-only (captureSystem: false) — same linger/finalize flow
   * as the native path, same voice:*-transcript events from Rust.
   */
  const startWhisper = async (
    cleanupProvider?: ServerVoiceProvider,
    triggerSource?: VoiceShortcutSource,
  ) => {
    console.log(
      "[voice-dictation] startWhisper: invoke audio_transcription_start",
    );
    try {
      // Open the mic BEFORE showing the bar so audio is capturing by the time
      // the user sees the recording state and starts speaking. The inverse order
      // (bar first, then start) causes the mic to open ~100-300ms late and the
      // first spoken words are lost inside audio_transcription_start's
      // ensure_model + create_state + start_raw_mic_capture sequence.
      await invoke("audio_transcription_start", {
        meetingId: null,
        locale: navigator.language || "en-US",
        micDeviceId: concreteMediaDeviceId(micDeviceId) || null,
        micDeviceLabel: micDeviceLabel || null,
        captureSystem: false,
        owner: "dictation",
      });
      console.log("[voice-dictation] audio_transcription_start ok");
      if (disposed || stopRequestedBeforeReady) {
        invoke("audio_transcription_stop").catch(() => {});
        abortPendingStart();
        return;
      }
      await invoke("show_flow_bar");
      if (disposed || stopRequestedBeforeReady) {
        invoke("audio_transcription_stop").catch(() => {});
        abortPendingStart();
        return;
      }
      enterRecordingState();
      emit("voice:partial-transcript", { text: "" }).catch(() => {});
      const next: VoiceSession = {
        kind: "whisper",
        stream: null,
        recorder: null,
        chunks: [],
        audioContext: null,
        analyser: null,
        raf: null,
        mimeType: "",
        recognition: null,
        browserTranscript: "",
        finalTranscriptParts: [],
        interimTranscript: "",
        lastResultAt: 0,
        triggerSource,
        startedAt: Date.now(),
        stopping: false,
        transcribeAbort: null,
        cancelled: false,
        cleanupProvider: cleanupProvider ?? null,
      };
      session = next;
      startInFlight = false;
      startSyntheticMeter(next);
      if (stopRequestedBeforeReady) {
        stop();
      }
    } catch (err) {
      console.error("[voice-dictation] startWhisper failed", err);
      startInFlight = false;
      stopRequestedBeforeReady = false;
      session = null;
      // See startNative's catch: must clear alongside session.
      setHandsFreeActive(false);
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
   * moment we stop the recognizer, so we paste immediately unless an LLM
   * cleanup provider is selected.
   */
  const startBrowser = async (
    cleanupProvider?: ServerVoiceProvider,
    triggerSource?: VoiceShortcutSource,
  ) => {
    console.log("[voice-dictation] startBrowser: opening mic + recognition");
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      console.error(
        "[voice-dictation] webkitSpeechRecognition unavailable — falling back to server",
      );
      await startServer("auto", triggerSource);
      return;
    }
    try {
      // IMPORTANT: do NOT call getUserMedia here — opening a parallel
      // MediaStream conflicts with webkitSpeechRecognition's own mic
      // capture in WKWebView (they fight over the input device, and
      // recognition.onresult silently never fires). The synthetic
      // waveform meter below is good-enough visual feedback; the user
      // sees the bar pulsing while they speak. We tried real meters
      // and broke voice capture every time.
      await invoke("show_flow_bar");
      if (disposed || stopRequestedBeforeReady) {
        abortPendingStart();
        return;
      }
      enterRecordingState();
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
        finalTranscriptParts: [],
        interimTranscript: "",
        lastResultAt: 0,
        triggerSource,
        startedAt: Date.now(),
        stopping: false,
        transcribeAbort: null,
        cancelled: false,
        cleanupProvider: cleanupProvider ?? null,
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
        // meter started below stays running. Try a plain `audio: true`
        // first — adding echo/noise/agc constraints on macOS sometimes
        // forces the audio session into a different mode that conflicts
        // with the recognizer, which silently returns a dead stream.
        console.log("[voice-dictation] requesting parallel mic for live meter");
        navigator.mediaDevices
          .getUserMedia(
            selectedMicConstraints() ?? { audio: true, video: false },
          )
          .then((meterStream) => {
            if (next.cancelled || session !== next) {
              meterStream.getTracks().forEach((t) => t.stop());
              return;
            }
            next.stream = meterStream;
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
        // Mark "still hearing speech" so stop() can decide whether to
        // wait out a tail-capture window or paste immediately.
        next.lastResultAt = Date.now();
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
          await completeText(text, next);
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
      // See note in startServer's catch: clear leaked session so the
      // next Fn press isn't blocked on a stale `if (session) return`.
      session = null;
      // See startNative's catch: must clear alongside session.
      setHandsFreeActive(false);
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
    // P4: Esc (or the flow-bar X button) always exits hands-free, even if
    // there's no live session to tear down (e.g. cancel arriving in the
    // narrow gap between the terminating tap's stop() and this call).
    setHandsFreeActive(false);
    pendingHandsFreeTapAt = null;
    const current = session ?? lingeringSession;
    const isLingeringOnly = !!current && session !== current;
    if (!current) {
      stopRequestedBeforeReady = true;
      invoke("hide_flow_bar").catch(() => {});
      return;
    }
    current.cancelled = true;
    current.transcribeAbort?.abort();
    if (lingeringSession === current) lingeringSession = null;
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
      } else if (current.kind === "whisper") {
        invoke("audio_transcription_stop").catch((err) => {
          console.warn(
            "[voice-dictation] audio_transcription_stop (cancel) failed:",
            err,
          );
        });
      } else {
        try {
          current.recognition?.abort();
        } catch {
          // ignore
        }
      }
    }
    if (isLingeringOnly) {
      stopMeter(current);
      stopTracks(current);
      setFlowState("idle");
      invoke("hide_flow_bar").catch(() => {});
      emit("voice:partial-transcript", { text: "" }).catch(() => {});
      return;
    }
    cleanup(current);
  };

  const stop = () => {
    const current = session;
    if (!current) {
      if (startInFlight) {
        stopRequestedBeforeReady = true;
        setFlowState("idle");
        invoke("hide_flow_bar").catch(() => {});
        // If start() hangs (e.g. getUserMedia awaiting a permission dialog
        // the user dismissed), keep the request latched but hide any UI now.
        // The eventual start path sees stopRequestedBeforeReady and bails.
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
    if (Date.now() - current.startedAt < 500) {
      // Too brief to be a deliberate dictation — tear down without
      // running the transcription path. Treat it as a cancel so onend
      // for browser sessions also skips the paste. Matches Wispr's
      // documented ~0.5s minimum: "audio saves only if you spoke for at
      // least half a second" (design-refs/wispr-ux.md §1) (P8).
      //
      // P4: in push-to-talk mode, note the timestamp instead of just
      // discarding — a second press within HANDS_FREE_UPGRADE_WINDOW_MS
      // upgrades to a hands-free session (Wispr's double-tap gesture)
      // rather than being discarded again as its own accidental tap. Not
      // set for an already-hands-free session (its own stop is a
      // deliberate finalize even if unusually fast).
      if (mode === "push-to-talk" && !handsFreeActive) {
        pendingHandsFreeTapAt = Date.now();
      }
      // If this is re-stopping a session that was just upgraded to hands-free
      // (release-before-500ms of the upgrading press), this discard tears the
      // session down like any other accidental tap. handsFreeActive must come
      // down with it, or later shortcuts keep trying to stop a null session.
      if (handsFreeActive) {
        setHandsFreeActive(false);
      }
      current.cancelled = true;
      if (current.kind === "browser") {
        try {
          current.recognition?.abort();
        } catch {
          // ignore
        }
      } else if (current.kind === "native") {
        invoke("native_speech_cancel").catch(() => {});
      } else if (current.kind === "whisper") {
        invoke("audio_transcription_stop").catch(() => {});
      }
      cleanup(current);
      return;
    }
    // P4: this stop() call is a deliberate finalize (past the accidental-tap
    // discard above). If it's ending a hands-free session, clear the flag
    // now so the very next fresh press starts an ordinary push-to-talk
    // session rather than being misread as hands-free's own release.
    setHandsFreeActive(false);
    try {
      if (current.kind === "server") {
        current.recorder?.stop();
      } else if (current.kind === "native" || current.kind === "whisper") {
        // NATIVE / WHISPER PATH: dismiss the pill *immediately* (snappy UX)
        // but leave the transcript chip lingering. Tell Rust to end the
        // engine so it can deliver its final hypothesis. When
        // `voice:final-transcript` lands (or after a safety timeout),
        // paste the text and let the chip sit for ~1s with the final
        // word visible — like a notification fading — then dismiss.
        const stopCmd =
          current.kind === "whisper"
            ? "audio_transcription_stop"
            : "native_speech_stop";
        invoke(stopCmd).catch((err) => {
          console.warn(`[voice-dictation] ${stopCmd} failed:`, err);
        });
        // Pill goes RIGHT NOW. The flow-bar window stays open (we'll
        // hide it after the linger) but renders only the transcript
        // chip in idle state.
        setFlowState("idle");
        // Free the global session-startup guards immediately, matching the
        // browser paths below. Deferring these to the end of the 1.2s
        // linger meant a rapid second Fn tap during linger silently no-op'd
        // because `start()` early-returns on a non-null `session`. We
        // park the lingering session in `lingeringSession` so the
        // install-time `voice:final-transcript` listener can still route
        // the final event to `onNativeFinalize` while a brand-new
        // `session` is being set up by the next tap.
        const lingering = current;
        lingeringSession = current;
        if (session === current) session = null;
        startInFlight = false;
        stopRequestedBeforeReady = false;
        stopMeter(current);
        stopTracks(current);
        const stopAtMs = Date.now();
        console.log(
          "[voice-dictation] native stop — pill dismissed, awaiting final",
        );
        // Already-pasted guard for the timeout path: if the safety timer
        // fires and pastes a partial, a late `voice:final-transcript` must
        // never trigger a second `completeText`/paste — it can only refine
        // the text used for the history row (see completeText's
        // onLateFinal hook below).
        let pasted = false;
        let finalized = false;
        const finalize = (reason: "final" | "timeout" | "manual") => {
          if (finalized) {
            if (reason === "final" && pasted) {
              // Late final after a timeout-triggered paste: don't paste
              // again, just let the history row (R12) learn the improved
              // text if it hasn't already been recorded.
              const lateText = lingering.browserTranscript.trim();
              lingering.browserTranscript = "";
              if (lateText) lingering.onLateFinalText?.(lateText);
            }
            return;
          }
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
          if (lingering.cancelled) {
            if (lingeringSession === lingering) lingeringSession = null;
            return;
          }
          if (session && session !== lingering) {
            // A new session took over during the wait window. Drop the
            // lingering ref so it doesn't outlive its safety timer and
            // accidentally route a late final-transcript here.
            if (lingeringSession === lingering) lingeringSession = null;
            return;
          }
          const text = lingering.browserTranscript.trim();
          lingering.browserTranscript = "";
          if (text) {
            console.log(
              `[voice-dictation] native paste (${text.length} chars, reason=${reason}):`,
              text.slice(0, 120),
            );
            pasted = true;
            if (reason === "timeout") {
              // Keep routing a late final for a bit longer so the true
              // final (which may still be flushing on the Rust side) can
              // still improve the history row even though the pill has
              // already pasted the partial. lingeringSession stays put
              // until this fires or a new session takes over.
              window.setTimeout(() => {
                if (lingeringSession === lingering) lingeringSession = null;
              }, 2000);
            } else if (lingeringSession === lingering) {
              lingeringSession = null;
            }
            void (async () => {
              try {
                await completeText(text, lingering);
              } catch (err) {
                console.error("[voice-dictation] paste failed:", err);
              }
              console.log("[voice-dictation] starting linger");
              window.setTimeout(
                () => {
                  console.log("[voice-dictation] linger done — dismissing");
                  if (reason !== "timeout" && lingeringSession === lingering) {
                    lingeringSession = null;
                  }
                  if (disposed) return;
                  if (session && session !== lingering) return;
                  invoke("hide_flow_bar").catch(() => {});
                  emit("voice:partial-transcript", { text: "" }).catch(
                    () => {},
                  );
                },
                lingering.cleanupProvider ? 500 : 1200,
              );
            })();
          } else {
            console.warn(
              "[voice-dictation] no transcript captured — native recognizer didn't produce results",
            );
            if (lingeringSession === lingering) lingeringSession = null;
            invoke("hide_flow_bar").catch(() => {});
            emit("voice:partial-transcript", { text: "" }).catch(() => {});
          }
        };

        // The install-time `voice:final-transcript` listener calls
        // `current.onNativeFinalize` when the final result arrives.
        lingering.onNativeFinalize = () => finalize("final");
        // Safety timer duration: SFSpeechRecognizer's endAudio() is
        // fire-and-forget with no bounded flush guarantee, so native's 3s
        // base is a heuristic "recognizer probably crashed" fallback.
        // Whisper's stop command (whisper_speech.rs macos::stop) blocks up
        // to 4s server-side to flush a long trailing utterance through
        // whisper.cpp inference, so its floor must clear that budget.
        // Scale up with how long the user actually dictated — a long
        // utterance's final hypothesis takes proportionally longer to
        // produce, and the fixed 3s window was dropping those tails
        // entirely instead of just pasting them a bit late.
        const heldSeconds = (stopAtMs - lingering.startedAt) / 1000;
        const timeoutBaseMs = lingering.kind === "whisper" ? 4500 : 3000;
        const finalizeTimeoutMs = Math.min(
          8000,
          Math.max(timeoutBaseMs, timeoutBaseMs + 100 * heldSeconds),
        );
        window.setTimeout(() => finalize("timeout"), finalizeTimeoutMs);
      } else {
        // BROWSER PATH: three branches based on what we captured AND
        // whether the user was still actively speaking at Fn release.
        //
        // 1. Empty transcript (accidental Fn tap, or user released
        //    before speaking): snappy dismiss — pill + everything goes
        //    RIGHT away, no tail capture. Mic released immediately.
        //
        // 2. Transcript present + user fell silent before release
        //    ("now please paste this." pause "*lifts Fn*"): paste
        //    RIGHT NOW. No 1.5s wait. Mic released immediately.
        //
        // 3. Transcript present + user still speaking up to release
        //    ("...the last thing*lifts Fn*"): keep recognition alive
        //    for ~1.5s so the tail of the sentence has time to land.
        //    Pill fades out immediately, transcript chip lingers.
        //
        // Quiet detection: the recognizer fires onresult continuously
        // while it hears speech and stops firing once the user falls
        // quiet. lastResultAt captures that — if no result has fired
        // in the last QUIET_MS, the user clearly stopped, and there's
        // nothing for tail-capture to catch.
        const initialText = current.browserTranscript.trim();
        const sinceLastResult =
          current.lastResultAt > 0
            ? Date.now() - current.lastResultAt
            : Infinity;
        const QUIET_MS = 600;
        const userFellSilent = sinceLastResult > QUIET_MS;

        // Helper: detach recognition handlers before abort. abort()
        // synchronously triggers onend, and our existing onend handler
        // would `emit("voice:partial-transcript", "")` and clear the
        // chip mid-linger. Detaching gives us full control of dismissal
        // timing in stop()'s post-abort code below.
        const detachAndAbort = (s: VoiceSession) => {
          if (!s.recognition) return;
          s.recognition.onresult = null;
          s.recognition.onerror = null;
          s.recognition.onend = null;
          try {
            s.recognition.abort();
          } catch {
            // ignore
          }
          s.recognition = null;
        };

        if (!initialText) {
          // Snappy path — accidental tap.
          current.browserTranscript = "";
          if (session === current) session = null;
          startInFlight = false;
          stopRequestedBeforeReady = false;
          setFlowState("idle");
          invoke("hide_flow_bar").catch(() => {});
          emit("voice:partial-transcript", { text: "" }).catch(() => {});
          detachAndAbort(current);
          stopMeter(current);
          stopTracks(current);
          console.warn(
            "[voice-dictation] no transcript captured — recognition didn't produce results",
          );
        } else if (userFellSilent) {
          // Snappy paste — user clearly stopped speaking before
          // releasing Fn, so there's nothing for tail-capture to add.
          // Release everything NOW so the macOS mic indicator goes
          // off immediately.
          const lingering = current;
          if (session === current) session = null;
          startInFlight = false;
          stopRequestedBeforeReady = false;
          setFlowState("idle");
          stopMeter(lingering);
          if (lingering.stream) {
            lingering.stream.getTracks().forEach((t) => {
              try {
                t.stop();
              } catch {
                // ignore
              }
            });
            lingering.stream = null;
          }
          detachAndAbort(lingering);
          const finalText = lingering.browserTranscript.trim();
          lingering.browserTranscript = "";
          console.log(
            `[voice-dictation] snappy paste (quiet ${sinceLastResult}ms, ${finalText.length} chars): "${finalText.slice(0, 80)}"`,
          );
          // Re-pin the chip text to the final value (paranoia in case
          // the last interim differed from final).
          emit("voice:partial-transcript", { text: finalText }).catch(() => {});
          void (async () => {
            try {
              await completeText(finalText, lingering);
            } catch (err) {
              console.error("[voice-dictation] paste failed:", err);
            }
            // Linger with the chip showing the pasted text, then dismiss.
            window.setTimeout(
              () => {
                if (disposed) return;
                if (session && session !== lingering) return;
                invoke("hide_flow_bar").catch(() => {});
                emit("voice:partial-transcript", { text: "" }).catch(() => {});
              },
              lingering.cleanupProvider ? 500 : 1000,
            );
          })();
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
          // Release the parallel-mic meter stream RIGHT NOW. The pill is
          // fading out so we don't need the visualizer any more, and
          // holding a second mic consumer open during tail-capture +
          // linger keeps macOS's orange mic indicator on for ~2.5s
          // longer than necessary. Recognition keeps its OWN internal
          // mic for the next 1.5s — that's required for the tail-capture
          // feature — but cutting our sibling stream cuts ours.
          if (lingering.stream) {
            lingering.stream.getTracks().forEach((t) => {
              try {
                t.stop();
              } catch {
                // ignore
              }
            });
            lingering.stream = null;
          }
          console.log(
            `[voice-dictation] tail-capture starting (active ${sinceLastResult}ms ago, ${initialText.length} chars so far): "${initialText.slice(0, 60)}..."`,
          );
          window.setTimeout(() => {
            if (disposed) return;
            // If a new Fn-tap took over during tail-capture, mark the
            // old session cancelled BEFORE aborting so paste is skipped
            // (otherwise complete_voice_dictation would type stale
            // transcript into the new session's focused field).
            const supersededByNewSession = !!session && session !== lingering;
            if (supersededByNewSession) lingering.cancelled = true;
            // Always release the lingering session's mic + recognizer
            // — even if cancelled or superseded. Skipping detach/stop
            // would leave the old recognizer listening and the mic open.
            detachAndAbort(lingering);
            stopTracks(lingering);
            if (lingering.cancelled) return;
            if (supersededByNewSession) return;
            const finalText = lingering.browserTranscript.trim();
            lingering.browserTranscript = "";
            if (finalText) {
              const tailGain = finalText.length - initialText.length;
              console.log(
                `[voice-dictation] tail-capture done (${finalText.length} chars, +${tailGain} from tail): "${finalText.slice(0, 80)}"`,
              );
              emit("voice:partial-transcript", { text: finalText }).catch(
                () => {},
              );
              void (async () => {
                try {
                  await completeText(finalText, lingering);
                } catch (err) {
                  console.error("[voice-dictation] paste failed:", err);
                }
                // Linger with the chip showing the final text, then dismiss.
                window.setTimeout(
                  () => {
                    if (disposed) return;
                    if (session && session !== lingering) return;
                    invoke("hide_flow_bar").catch(() => {});
                    emit("voice:partial-transcript", { text: "" }).catch(
                      () => {},
                    );
                  },
                  lingering.cleanupProvider ? 500 : 1000,
                );
              })();
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
  refreshProviderStatus({ logFailures: false }).catch(() => {});
  // Configure the vocabulary client + warm its cache so the first Fn press
  // can pass `contextualStrings` to SFSpeechRecognizer without a round-trip.
  configureVocabularyClient(serverUrl);
  loadVocabulary().catch(() => {});

  // Detachable pill on focus blur (Wispr / Granola round-3). When the main
  // app window loses focus to another macOS app, flip the pill into its
  // floating top-right detached mode (smaller, drag-handle visible). On
  // refocus, flip back. We filter to the `main` / `popover` windows so we
  // don't react to the pill window's own focus changes (which would cause
  // an infinite ping-pong).
  interface FocusEventPayload {
    windowLabel?: string;
  }
  const isMainWindow = (label?: string) =>
    label === "main" || label === "popover";
  listen<FocusEventPayload>("tauri://blur", (ev) => {
    if (!isMainWindow(ev.payload?.windowLabel)) return;
    invoke("recording_pill_set_detached", { detached: true }).catch(() => {});
  })
    .then((u) => unlistens.push(u))
    .catch(() => {});
  listen<FocusEventPayload>("tauri://focus", (ev) => {
    if (!isMainWindow(ev.payload?.windowLabel)) return;
    invoke("recording_pill_set_detached", { detached: false }).catch(() => {});
  })
    .then((u) => unlistens.push(u))
    .catch(() => {});

  // Native (SFSpeechRecognizer) event subscriptions. These are always
  // installed — the events only fire when the Rust side has an active
  // session, so subscribing on non-native sessions is harmless. The
  // flow-bar listens to `voice:partial-transcript` independently so we
  // don't re-emit it here.
  onPartialTranscript(({ text }) => {
    const current = session;
    if (!current || (current.kind !== "native" && current.kind !== "whisper"))
      return;
    if (current.cancelled || current.stopping) return;
    setInterimTranscript(current, text);
  })
    .then((u) => unlistens.push(u))
    .catch(() => {});
  onFinalTranscript(({ text }) => {
    // Whisper emits final segments throughout a long dictation whenever the
    // speaker pauses. Native speech emits its final after stop, when the
    // stopped session is parked in lingeringSession. Native final events do not
    // carry a session id, so never fall back to an active native session here:
    // a late final from the previous stop could otherwise be appended to a new
    // dictation.
    const current = lingeringSession
      ? lingeringSession
      : session && session.kind === "whisper" && !session.stopping
        ? session
        : null;
    if (!current) return;
    if (current.cancelled) return;
    appendFinalTranscript(current, text);
    if (current === lingeringSession) {
      current.onNativeFinalize?.();
    }
  })
    .then((u) => unlistens.push(u))
    .catch(() => {});
  onSpeechError(({ error }) => {
    const current = session;
    console.error("[voice-dictation] native speech error:", error);
    if (!current || (current.kind !== "native" && current.kind !== "whisper"))
      return;
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
    // P4 (Wispr double-tap hands-free): a third press while a hands-free
    // session is already running is the "tap again to finish" gesture —
    // finalize + paste, same as a normal push-to-talk release.
    if (mode === "push-to-talk" && handsFreeActive) {
      stop();
      return;
    }
    // A press landing within the upgrade window of a just-discarded
    // accidental tap is the second half of the double-tap gesture: start
    // (or restart, since the first tap's session was already torn down)
    // a session and mark it hands-free so its own release is ignored and
    // it persists until the next standalone tap.
    const upgradeToHandsFree =
      mode === "push-to-talk" &&
      pendingHandsFreeTapAt !== null &&
      Date.now() - pendingHandsFreeTapAt < HANDS_FREE_UPGRADE_WINDOW_MS;
    pendingHandsFreeTapAt = null;
    if (upgradeToHandsFree) {
      setHandsFreeActive(true);
    }
    void start(event.payload?.source).then(() => {
      // Race guard: the physical key-up of this same upgrade press (a
      // hands-free tap is typically brief) independently calls
      // Rust's `set_dictation_active_and_sync_escape(false)` and can land
      // after our arm-on-upgrade invoke above, disarming Escape for a
      // session that's actually still live. Re-assert once start() has
      // settled (by then the key-edge noise from this press is over) so
      // the two writers can't leave Escape stuck disarmed. No-op unless
      // still hands-free (start failed / was superseded clears the flag
      // via setHandsFreeActive(false) already).
      if (upgradeToHandsFree && handsFreeActive) {
        invoke("set_dictation_escape_active", { active: true }).catch(() => {});
      }
    });
  })
    .then((u) => unlistens.push(u))
    .catch(() => {});
  listen<VoiceShortcutEvent>("voice:shortcut-stop", (event) => {
    if (!acceptsShortcut(event.payload?.source)) return;
    if (mode === "toggle") return;
    // P4: while hands-free, the release edge is a no-op — the session
    // stays open until the next full press (handled above) stops it.
    if (handsFreeActive) return;
    stop();
  })
    .then((u) => unlistens.push(u))
    .catch(() => {});
  // Cancel button on the flow-bar emits this. Tear down without pasting.
  // `cancel()` itself hides the bar synchronously. R21: flow-bar.tsx used
  // to ALSO fire its own unconditional 250ms-delayed `hide_flow_bar` as a
  // defensive backstop — but if a new session started in that window (fast
  // re-press right after clicking cancel), that stale delayed hide would
  // close the brand-new session's bar. Own the backstop here instead,
  // gated on "no new session has started since," and keep flow-bar dumb
  // (it now only emits the event).
  listen("voice:cancel", () => {
    cancel();
    const sessionAtCancel = session;
    const lingeringAtCancel = lingeringSession;
    window.setTimeout(() => {
      if (disposed) return;
      // Only fire the defensive hide if nothing new has taken ownership
      // of the bar since the cancel was requested.
      if (
        session !== sessionAtCancel ||
        lingeringSession !== lingeringAtCancel
      ) {
        return;
      }
      invoke("hide_flow_bar").catch(() => {});
    }, 250);
  })
    .then((u) => unlistens.push(u))
    .catch(() => {});

  console.log(
    "[voice-dictation] installed v3 (no-warm-stream): provider=" + provider,
  );

  // R13: settings changing mid-session (e.g. every keystroke in the Voice
  // Instructions textarea re-runs the installing useEffect) must not leak
  // a live native/whisper/browser engine with no UI left to stop it.
  // `cleanup()` alone only releases the meter + MediaStream tracks — for
  // native/whisper (no `stream`) and browser (never touches `recognition`)
  // that's a no-op, so the Rust-side SFSpeechRecognizer/whisper.cpp worker
  // or the WKWebView recognizer kept running indefinitely. Force-stop by
  // kind, mirroring `cancel()`, before the disposer tears down listeners.
  const forceStopSession = (target: VoiceSession | null) => {
    if (!target || target.stopping) return;
    target.stopping = true;
    target.cancelled = true;
    target.transcribeAbort?.abort();
    if (target.kind === "server") {
      try {
        target.recorder?.stop();
      } catch {
        // recorder.stop can throw if not in 'recording' state.
      }
    } else if (target.kind === "native") {
      invoke("native_speech_cancel").catch((err) => {
        console.warn(
          "[voice-dictation] native_speech_cancel (dispose) failed:",
          err,
        );
      });
    } else if (target.kind === "whisper") {
      invoke("audio_transcription_stop").catch((err) => {
        console.warn(
          "[voice-dictation] audio_transcription_stop (dispose) failed:",
          err,
        );
      });
    } else {
      try {
        target.recognition?.abort();
      } catch {
        // ignore
      }
    }
  };

  return () => {
    disposed = true;
    enabled = false;
    serverUrl = "";
    shortcut = "both";
    mode = "push-to-talk";
    provider = "auto";
    setHandsFreeActive(false);
    pendingHandsFreeTapAt = null;
    unlistens.forEach((u) => {
      try {
        u();
      } catch {
        // ignore
      }
    });
    unlistens.length = 0;
    // Idempotent: forceStopSession no-ops on a session already stopping,
    // and cleanup() only touches global state when `target === session`
    // (a superseded session it's called on is a harmless no-op).
    forceStopSession(session);
    if (lingeringSession && lingeringSession !== session) {
      forceStopSession(lingeringSession);
    }
    cleanup(session);
  };
}
