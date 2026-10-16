import type { VoiceContextPack } from "@agent-native/core/voice";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { applyBacktrack } from "./backtrack";
import {
  configureVocabularyClient,
  loadVocabulary,
  loadVocabularyEntries,
  recordPasteForLearn,
} from "./personal-vocabulary";
import {
  onAudioLevel,
  onFinalTranscript,
  onPartialTranscript,
  onSpeechError,
} from "./transcription-engine";
import {
  createVoiceDictationLifecycle,
  finalizeDictationText,
  isCurrentDictationRun,
  saveDictationHistoryRequest,
} from "./voice-dictation-lifecycle";
import type {
  DictationFailure,
  DictationEmptyFailure,
  DictationFinalizationResult,
  DictationFinalizationStage,
  DictationLifecyclePhase,
  DictationInsertion,
} from "./voice-dictation-lifecycle";

export type VoiceShortcutPreference =
  | "fn"
  | "cmd-shift-space"
  | "ctrl-shift-space"
  | "custom"
  | "both";
export type VoiceMode = "push-to-talk" | "toggle";

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

type FlowState =
  | "idle"
  | "recording"
  | "processing"
  | "complete"
  | "copied"
  | "cancelled"
  | "error";
type FlowProcessingStage =
  | "initializing"
  | "finalizing"
  | "transcribing"
  | "cleaning"
  | "pasting"
  | "saving-history";
interface FlowStateDetails {
  runId?: number;
  failure?: DictationFailure;
  insertion?: DictationInsertion | null;
  recoverable?: boolean;
  historySaved?: boolean;
  retryHistory?: boolean;
  cleanupFailed?: boolean;
  backtrackFailed?: boolean;
  transcript?: string;
  originalTranscript?: string;
}
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

interface DictationHistoryContext {
  runId: number;
  historyId: string;
  startedAt: number;
  triggerSource?: VoiceShortcutSource;
  historyFullText?: string;
  historyCleanedText?: string | null;
  historySaved?: boolean;
  historySavePromise?: Promise<void> | null;
  terminalFailure?: DictationFailure;
  insertionOutcome?: DictationInsertion;
}

interface VoiceSession extends DictationHistoryContext {
  kind: "server" | "browser" | "native" | "whisper";
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  audioContext: AudioContext | null;
  analyser: AnalyserNode | null;
  raf: number | null;
  mimeType: string;
  recognition: SpeechRecognition | null;
  browserTranscript: string;
  finalTranscriptParts: string[];
  interimTranscript: string;
  lastResultAt: number;
  releasedAtMs?: number;
  meterHasRealSignal?: boolean;
  stopping: boolean;
  starting?: boolean;
  transcribeAbort: AbortController | null;
  cancelled: boolean;
  recognitionFailure?: DictationEmptyFailure;
  nativeFinalizationStarted?: boolean;
  browserFinalizationStarted?: boolean;
  onNativeFinalize?: (() => void) | null;
  cleanupProvider?: ServerVoiceProvider | null;
  finalizationStage?: DictationFinalizationStage;
  finalizationPromise?: Promise<DictationFinalizationResult>;
}

type DictationTimingPhase = "release" | "finalization" | "cleanup" | "paste";
type DictationTimingEvent = "start" | "complete" | "skipped";

const monotonicNow = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

function logDictationTiming(
  target: VoiceSession,
  phase: DictationTimingPhase,
  event: DictationTimingEvent,
  atMs = monotonicNow(),
  startedAtMs?: number,
  details?: Record<string, unknown>,
): void {
  console.info(`[voice-dictation] timing ${phase}:${event}`, {
    kind: target.kind,
    phaseDurationMs:
      startedAtMs === undefined ? undefined : Math.round(atMs - startedAtMs),
    releaseToPhaseMs:
      target.releasedAtMs === undefined
        ? undefined
        : Math.round(atMs - target.releasedAtMs),
    ...details,
  });
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

function setFlowState(
  state: FlowState,
  stage?: FlowProcessingStage,
  details: FlowStateDetails = {},
): void {
  const payload = {
    state,
    stage,
    ...details,
    ...(state === "recording" ? { startedAtMs: Date.now() } : {}),
  };
  latestFlowStatePayload = payload;
  emit("voice:state-change", payload).catch(() => {});
}

let latestFlowStatePayload: Record<string, unknown> = {
  state: "idle",
  runId: 0,
};

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

function newDictationHistoryId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `dictation_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
    session.finalTranscriptParts = [clean];
  } else if (
    session.finalTranscriptParts[session.finalTranscriptParts.length - 1] !==
    clean
  ) {
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
  emit("voice:audio-level", { level: 0, runId: session.runId }).catch(() => {});
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
  if (!session.stream) return;
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
      emit("voice:audio-level", { level, runId: session.runId }).catch(
        () => {},
      );
      session.raf = requestAnimationFrame(tick);
    };
    session.raf = requestAnimationFrame(tick);
  } catch (err) {
    console.warn("[voice-dictation] audio meter unavailable", err);
  }
}

function startSyntheticMeter(session: VoiceSession): void {
  const tick = () => {
    if (
      session.cancelled ||
      session.stopping ||
      session.stream ||
      session.meterHasRealSignal
    ) {
      session.raf = null;
      return;
    }
    const t = (Date.now() - session.startedAt) / 1000;
    const level = 0.18 + 0.08 * Math.sin(t * 4);
    emit("voice:audio-level", {
      level,
      synthetic: true,
      runId: session.runId,
    }).catch(() => {});
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
  form.append("provider", providerPref);
  const trimmedInstructions = instructions?.trim();
  if (trimmedInstructions) {
    form.append("instructions", trimmedInstructions);
  }
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
        headers: { "X-Agent-Native-CSRF": "1" },
        signal: controller.signal,
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
  } finally {
    window.clearTimeout(timeout);
  }
}

async function cleanupTranscript(
  serverUrl: string,
  text: string,
  providerPref: ServerVoiceProvider,
  signal: AbortSignal,
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
  if (language) form.append("language", language);
  appendVoiceContext(form, contextPack);

  const res = await fetch(
    `${serverUrl.replace(/\/+$/, "")}/_agent-native/transcribe-voice`,
    {
      method: "POST",
      body: form,
      credentials: "include",
      headers: { "X-Agent-Native-CSRF": "1" },
      signal,
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
  let lingeringSession: VoiceSession | null = null;
  let recoveryContext: DictationHistoryContext | null = null;
  const lifecycle = createVoiceDictationLifecycle();
  let serverUrl = options.serverUrl;
  let enabled = options.enabled;
  let shortcut = options.shortcut;
  let mode = options.mode;
  let provider = options.provider;
  let micDeviceId = concreteMediaDeviceId(options.micDeviceId);
  let micDeviceLabel = options.micDeviceLabel ?? "";
  let instructions = options.instructions ?? "";
  let startInFlight = false;
  let startInFlightRunId: number | null = null;
  let stopRequestedBeforeReady = false;
  let providerStatus: ProviderStatus | null = null;
  let providerStatusFetchedAt = 0;
  let pendingHandsFreeTapAt: number | null = null;
  let handsFreeActive = false;
  const HANDS_FREE_UPGRADE_WINDOW_MS = 400;
  const unlistens: Array<() => void> = [];
  const registerListener = (listener: Promise<() => void>) => {
    listener
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          unlistens.push(unlisten);
        }
      })
      .catch(() => {});
  };

  const transitionRun = (
    runId: number,
    phase: Exclude<
      DictationLifecyclePhase,
      "completed" | "copied" | "cancelled" | "failed"
    >,
    state: FlowState,
    stage?: FlowProcessingStage,
    details: Omit<FlowStateDetails, "runId"> = {},
  ): boolean => {
    if (!lifecycle.transition(runId, phase)) return false;
    setFlowState(state, stage, { ...details, runId });
    return true;
  };

  const enterRecordingState = (runId: number): boolean => {
    const entered = transitionRun(runId, "capturing", "recording");
    if (entered) playStartPing();
    return entered;
  };

  const dismissRunAfter = (runId: number, delayMs: number) => {
    window.setTimeout(() => {
      if (disposed || !lifecycle.isLatest(runId) || lifecycle.isBusy()) return;
      setFlowState("idle", undefined, { runId });
      invoke("hide_flow_bar").catch(() => {});
    }, delayMs);
  };

  const finishRun = (
    runId: number,
    state: "complete" | "copied" | "cancelled" | "error",
    details: Omit<FlowStateDetails, "runId"> = {},
    dismissAfterMs?: number,
  ): boolean => {
    const phase =
      state === "complete" ? "completed" : state === "error" ? "failed" : state;
    if (!lifecycle.finish(runId, phase)) return false;
    setFlowState(state, undefined, { ...details, runId });
    if (dismissAfterMs !== undefined) dismissRunAfter(runId, dismissAfterMs);
    return true;
  };

  const failRun = (
    runId: number,
    failure: DictationFailure,
    details: Omit<FlowStateDetails, "runId" | "failure"> = {},
  ) => finishRun(runId, "error", { ...details, failure });

  const isRunActive = (target: VoiceSession): boolean =>
    !disposed && !target.cancelled && lifecycle.isActive(target.runId);

  const isPermissionError = (error: unknown): boolean => {
    const name = (error as { name?: string } | null)?.name?.toLowerCase();
    const message = String(error).toLowerCase();
    return (
      name === "notallowederror" ||
      name === "permissiondeniederror" ||
      message.includes("permission") ||
      message.includes("not allowed") ||
      message.includes("not authorized") ||
      message.includes("authorization")
    );
  };

  const microphoneFailure = (error: unknown): DictationFailure =>
    isPermissionError(error) ? "permission" : "microphone-unavailable";

  const recognitionFailure = (error: string): DictationEmptyFailure => {
    switch (error) {
      case "not-allowed":
      case "service-not-allowed":
        return "permission";
      case "audio-capture":
        return "microphone-unavailable";
      case "no-speech":
        return "no-speech";
      default:
        return "provider";
    }
  };

  const speechFailure = (error: string): DictationFailure => {
    const message = error.toLowerCase();
    if (
      message.includes("no-speech") ||
      message.includes("no speech") ||
      message.includes("no usable speech")
    ) {
      return "no-speech";
    }
    if (message.includes("permission") || message.includes("authoriz")) {
      return "permission";
    }
    if (message.includes("not allowed") || message.includes("denied")) {
      return "permission";
    }
    if (message.includes("microphone") || message.includes("audio capture")) {
      return "microphone-unavailable";
    }
    return "provider";
  };

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
      providerStatus = null;
      providerStatusFetchedAt = 0;
      return {
        builder: false,
        gemini: false,
        groq: false,
        browser: true,
        native: false,
      };
    }
  };

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

  const releaseStart = (runId: number) => {
    if (startInFlightRunId !== runId) return;
    startInFlightRunId = null;
    startInFlight = false;
    stopRequestedBeforeReady = false;
  };

  const cleanup = (target: VoiceSession | null = null, hide = true) => {
    if (target) {
      stopMeter(target);
      stopTracks(target);
    }
    if (target) {
      if (session !== target && lingeringSession !== target) return;
      if (session === target) session = null;
      if (lingeringSession === target) lingeringSession = null;
      if (target.starting) {
        stopRequestedBeforeReady = true;
      }
      if (lifecycle.isActive(target.runId))
        finishRun(target.runId, "cancelled", {}, 700);
      releaseStart(target.runId);
      return;
    }
    const startingRunId = startInFlightRunId;
    if (startingRunId !== null) releaseStart(startingRunId);
    const runId = lifecycle.snapshot()?.runId;
    setFlowState("idle", undefined, { runId });
    if (hide) invoke("hide_flow_bar").catch(() => {});
  };

  const abortPendingStart = (runId: number) => {
    finishRun(runId, "cancelled", {}, 700);
    releaseStart(runId);
    void invoke("native_speech_cancel", {
      owner: "dictation",
      runId,
    }).catch((err) => {
      console.warn(
        "[voice-dictation] pending native start cancel failed:",
        err,
      );
    });
    void invoke("audio_transcription_stop", {
      owner: "dictation",
      runId,
    }).catch((err) => {
      console.warn(
        "[voice-dictation] pending Whisper start cancel failed:",
        err,
      );
    });
  };

  const start = async (triggerSource?: VoiceShortcutSource) => {
    if (disposed || !enabled) return;
    const waitStart = Date.now();
    while (
      !disposed &&
      (startInFlight || (session && session.stopping)) &&
      Date.now() - waitStart < 800
    ) {
      await new Promise((r) => window.setTimeout(r, 30));
    }
    if (disposed || session || startInFlight) return;

    let runId: number | null;
    try {
      runId = lifecycle.begin();
    } catch (error) {
      console.error("[voice-dictation] could not allocate a run ID:", error);
      void invoke("show_flow_bar").catch(() => {});
      setFlowState("error", undefined, {
        runId: lifecycle.snapshot()?.runId ?? Date.now() * 1_024,
        failure: "provider",
      });
      return;
    }
    if (runId === null) return;

    recoveryContext = null;
    startInFlight = true;
    startInFlightRunId = runId;
    stopRequestedBeforeReady = false;
    setFlowState("processing", "initializing", { runId });
    void invoke("show_flow_bar").catch(() => {});

    try {
      const resolved = await resolveProvider();
      if (disposed || stopRequestedBeforeReady || !lifecycle.isActive(runId)) {
        abortPendingStart(runId);
        return;
      }
      if (resolved.kind === "browser") {
        await startBrowser(runId, resolved.cleanupProvider, triggerSource);
      } else if (resolved.kind === "native") {
        await startNative(runId, resolved.cleanupProvider, triggerSource);
      } else if (resolved.kind === "whisper") {
        await startWhisper(runId, resolved.cleanupProvider, triggerSource);
      } else {
        await startServer(runId, resolved.providerPref, triggerSource);
      }
    } catch (err) {
      console.error("[voice-dictation] start failed", err);
      releaseStart(runId);
      if (!lifecycle.isActive(runId)) return;
      setHandsFreeActive(false);
      failRun(runId, microphoneFailure(err));
    }
  };

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

  const saveDictationHistory = (
    target: DictationHistoryContext,
    fullText: string,
    cleanedText: string | null,
  ): Promise<void> => {
    if (target.historySaved) return Promise.resolve();
    if (target.historySavePromise) return target.historySavePromise;
    if (target.historyFullText === undefined) {
      target.historyFullText = fullText;
      target.historyCleanedText = cleanedText;
    }
    const stableFullText = target.historyFullText;
    const save = async () => {
      await saveDictationHistoryRequest({
        url: `${serverUrl.replace(/\/+$/, "")}/_agent-native/actions/create-dictation`,
        id: target.historyId,
        body: {
          id: target.historyId,
          fullText: stableFullText,
          cleanedText: target.historyCleanedText ?? null,
          durationMs: Math.max(0, Date.now() - target.startedAt),
          source: dictationHistorySource(target.triggerSource),
        },
      });
      target.historySaved = true;
    };
    const pending = save().finally(() => {
      if (target.historySavePromise === pending) {
        target.historySavePromise = null;
      }
    });
    target.historySavePromise = pending;
    return pending;
  };

  const rememberHistoryRecovery = (target: VoiceSession) => {
    recoveryContext = {
      runId: target.runId,
      historyId: target.historyId,
      startedAt: target.startedAt,
      triggerSource: target.triggerSource,
      historyFullText: target.historyFullText,
      historyCleanedText: target.historyCleanedText,
      historySaved: target.historySaved,
      terminalFailure: target.terminalFailure,
      insertionOutcome: target.insertionOutcome,
    };
  };

  const completeText = (
    rawText: string,
    target: VoiceSession,
  ): Promise<DictationFinalizationResult> => {
    if (target.finalizationPromise) return target.finalizationPromise;
    const completion = (async () => {
      const cleanupController = new AbortController();
      target.transcribeAbort = cleanupController;
      const cleanupStartedAtMs = monotonicNow();
      const result = await finalizeDictationText({
        rawText,
        cancelled: () =>
          target.cancelled || disposed || !lifecycle.isActive(target.runId),
        emptyFailure: target.recognitionFailure,
        signal: cleanupController.signal,
        cleanup: target.cleanupProvider
          ? async (text, signal) => {
              const contextPack = await buildDesktopVoiceContextPack();
              return cleanupTranscript(
                serverUrl,
                text,
                target.cleanupProvider as ServerVoiceProvider,
                signal,
                instructions,
                contextPack,
                dictationLanguage(),
              );
            }
          : undefined,
        insert: async (text) => {
          const pasteStartedAtMs = monotonicNow();
          const insertionResult = await invoke<unknown>(
            "complete_voice_dictation",
            { text },
          );
          if (insertionResult !== "inserted" && insertionResult !== "copied") {
            throw new Error("The insertion action returned an unknown result.");
          }
          try {
            recordPasteForLearn(text);
          } catch (err) {
            console.warn("[voice-dictation] vocab learn-monitor failed:", err);
          }
          logDictationTiming(
            target,
            "paste",
            "complete",
            monotonicNow(),
            pasteStartedAtMs,
            { textLength: text.length, outcome: insertionResult },
          );
          return insertionResult;
        },
        copy: async (text) => {
          try {
            await invoke("copy_voice_dictation", { text });
          } catch {
            await writeText(text);
          }
        },
        onInsertion: (insertion) => {
          target.insertionOutcome = insertion;
        },
        saveHistory: (original, cleaned) =>
          saveDictationHistory(target, original, cleaned),
        applyBacktrack,
        onStage: (stage: DictationFinalizationStage) => {
          target.finalizationStage = stage;
          if (stage === "cleaning") {
            logDictationTiming(
              target,
              "cleanup",
              "start",
              cleanupStartedAtMs,
              undefined,
              { provider: target.cleanupProvider },
            );
            transitionRun(target.runId, "processing", "processing", "cleaning");
            return;
          }
          if (stage === "pasting") {
            logDictationTiming(target, "cleanup", "skipped", monotonicNow());
            transitionRun(target.runId, "inserting", "processing", "pasting");
            return;
          }
          transitionRun(
            target.runId,
            "saving-history",
            "processing",
            "saving-history",
          );
        },
      });
      target.transcribeAbort = null;
      if (target.cleanupProvider) {
        logDictationTiming(
          target,
          "cleanup",
          "complete",
          monotonicNow(),
          cleanupStartedAtMs,
          { outcome: result.kind === "completed" ? "completed" : "fallback" },
        );
      }
      if (result.kind === "cancelled") {
        finishRun(target.runId, "cancelled", {}, 700);
        return result;
      }
      if (result.kind === "failed") {
        if (result.failure === "paste" || result.failure === "history-save") {
          target.terminalFailure = result.failure;
          if (result.failure === "history-save" || !result.historySaved) {
            rememberHistoryRecovery(target);
          } else {
            recoveryContext = null;
          }
          failRun(target.runId, result.failure, {
            recoverable: result.recoverable,
            insertion: result.insertion,
            historySaved: result.historySaved,
            retryHistory: !result.historySaved,
            cleanupFailed: result.cleanupFailed,
            backtrackFailed: result.backtrackFailed,
            transcript: result.transcript,
            originalTranscript: result.originalTranscript,
          });
        } else {
          failRun(target.runId, result.failure);
        }
        return result;
      }
      finishRun(
        target.runId,
        result.insertion === "copied" ? "copied" : "complete",
        {
          insertion: result.insertion,
          historySaved: true,
          cleanupFailed: result.cleanupFailed,
          backtrackFailed: result.backtrackFailed,
        },
        result.insertion === "copied" ? 1_800 : 1_200,
      );
      return result;
    })();
    target.finalizationPromise = completion;
    return completion;
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

  const nativeSpeechArgs = (runId: number) => ({
    locale: navigator.language || "en-US",
    micDeviceId: concreteMediaDeviceId(micDeviceId) || null,
    micDeviceLabel: micDeviceLabel || null,
    owner: "dictation",
    runId,
  });

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

  const startServer = async (
    runId: number,
    providerPref: ServerVoiceProvider,
    triggerSource?: VoiceShortcutSource,
  ) => {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      console.error("[voice-dictation] MediaRecorder unavailable");
      releaseStart(runId);
      failRun(runId, "microphone-unavailable");
      return;
    }
    let stream: MediaStream | null = null;
    try {
      console.log("[voice-dictation] startServer:", providerPref);
      if (disposed || !lifecycle.isActive(runId) || stopRequestedBeforeReady) {
        abortPendingStart(runId);
        return;
      }
      stream = await navigator.mediaDevices.getUserMedia(
        await preferredMicConstraints(),
      );
      if (disposed || stopRequestedBeforeReady || !lifecycle.isActive(runId)) {
        stream.getTracks().forEach((track) => track.stop());
        abortPendingStart(runId);
        return;
      }
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      const next: VoiceSession = {
        runId,
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
        historyId: newDictationHistoryId(),
      };
      session = next;
      releaseStart(runId);
      recorder.ondataavailable = (event) => {
        if (event.data?.size) next.chunks.push(event.data);
      };
      recorder.onstop = async () => {
        stopMeter(next);
        stopTracks(next);
        if (session === next) session = null;
        releaseStart(runId);
        if (!isRunActive(next)) {
          cleanup(next);
          return;
        }
        lingeringSession = next;
        if (!next.chunks.length) {
          failRun(runId, "no-speech");
          if (lingeringSession === next) lingeringSession = null;
          return;
        }
        transitionRun(runId, "finalizing", "processing", "finalizing");
        const controller = new AbortController();
        next.transcribeAbort = controller;
        try {
          transitionRun(runId, "transcribing", "processing", "transcribing");
          const contextPack = await buildDesktopVoiceContextPack();
          if (!isRunActive(next)) return;
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
          if (!isRunActive(next)) return;
          logDictationTiming(
            next,
            "finalization",
            "complete",
            monotonicNow(),
            undefined,
            {
              textLength: text.length,
              reason: "server-transcription",
            },
          );
          transitionRun(runId, "finalizing", "processing", "finalizing");
          await completeText(text, next);
        } catch (err) {
          if (next.cancelled || disposed || !lifecycle.isActive(runId)) {
            cleanup(next);
            return;
          }
          const message = err instanceof Error ? err.message : String(err);
          console.error("[voice-dictation] transcription failed:", message);
          failRun(runId, "provider");
          cleanup(next);
        } finally {
          next.transcribeAbort = null;
          if (session === next) session = null;
          if (lingeringSession === next) lingeringSession = null;
        }
      };
      startMeter(next);
      recorder.start();
      next.starting = false;
      releaseStart(runId);
      if (!enterRecordingState(runId)) {
        cleanup(next);
        return;
      }
      if (stopRequestedBeforeReady) {
        stop();
      }
    } catch (err) {
      console.error("[voice-dictation] startServer failed", err);
      stream?.getTracks().forEach((track) => track.stop());
      releaseStart(runId);
      if (session?.runId === runId) session = null;
      if (!lifecycle.isActive(runId)) return;
      setHandsFreeActive(false);
      failRun(runId, microphoneFailure(err));
    }
  };

  const startNative = async (
    runId: number,
    cleanupProvider?: ServerVoiceProvider,
    triggerSource?: VoiceShortcutSource,
  ) => {
    console.log("[voice-dictation] startNative: invoke native_speech_start");
    try {
      if (disposed || stopRequestedBeforeReady || !lifecycle.isActive(runId)) {
        abortPendingStart(runId);
        return;
      }
      emit("voice:partial-transcript", { text: "", runId }).catch(() => {});
      const next: VoiceSession = {
        runId,
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
        starting: true,
        transcribeAbort: null,
        cancelled: false,
        cleanupProvider: cleanupProvider ?? null,
        historyId: newDictationHistoryId(),
      };
      session = next;
      try {
        const vocabularyEntries = await loadVocabularyEntries().catch(() => []);
        const contextualStrings = vocabularyEntries.map((v) => v.replacement);
        await invoke("native_speech_set_vocabulary", {
          strings: contextualStrings,
        }).catch(() => {});
        if (!isRunActive(next) || stopRequestedBeforeReady) {
          abortPendingStart(runId);
          cleanup(next);
          return;
        }
        await invoke("native_speech_start", nativeSpeechArgs(runId));
        if (!isRunActive(next)) {
          await invoke("native_speech_cancel", {
            owner: "dictation",
            runId,
          }).catch(() => {});
          abortPendingStart(runId);
          return;
        }
        next.starting = false;
        releaseStart(runId);
        if (!enterRecordingState(runId)) {
          invoke("native_speech_cancel", { owner: "dictation", runId }).catch(
            () => {},
          );
          cleanup(next);
          return;
        }
        console.log(
          `[voice-dictation] native_speech_start ok (vocab=${contextualStrings.length})`,
        );
        startSyntheticMeter(next);
      } catch (err) {
        console.error("[voice-dictation] native_speech_start failed:", err);
        if (session === next) session = null;
        if (lingeringSession === next) lingeringSession = null;
        throw err;
      }
      if (stopRequestedBeforeReady) {
        stop();
      }
    } catch (err) {
      console.error("[voice-dictation] startNative failed", err);
      const wasStopRequested = stopRequestedBeforeReady;
      releaseStart(runId);
      if (session?.runId === runId) session = null;
      if (lingeringSession?.runId === runId) lingeringSession = null;
      if (!lifecycle.isActive(runId)) return;
      // Clear the hands-free flag alongside session so a failed
      // native start (mic permission denial, engine-busy) can't wedge every
      // future press into a no-op stop() branch.
      setHandsFreeActive(false);
      if (
        String(err).includes("unavailable in tauri dev") &&
        !disposed &&
        !wasStopRequested &&
        lifecycle.isActive(runId)
      ) {
        console.warn(
          "[voice-dictation] native Speech is unavailable in tauri dev; falling back to local Whisper",
        );
        await startWhisper(runId, cleanupProvider, triggerSource);
        return;
      }
      if (lifecycle.isActive(runId)) {
        failRun(runId, speechFailure(String(err)));
      }
    }
  };

  const startWhisper = async (
    runId: number,
    cleanupProvider?: ServerVoiceProvider,
    triggerSource?: VoiceShortcutSource,
  ) => {
    console.log(
      "[voice-dictation] startWhisper: invoke audio_transcription_start",
    );
    try {
      await invoke("audio_transcription_start", {
        meetingId: null,
        locale: navigator.language || "en-US",
        micDeviceId: concreteMediaDeviceId(micDeviceId) || null,
        micDeviceLabel: micDeviceLabel || null,
        captureSystem: false,
        voiceProcessing: true,
        owner: "dictation",
        runId,
      });
      console.log("[voice-dictation] audio_transcription_start ok");
      if (disposed || stopRequestedBeforeReady || !lifecycle.isActive(runId)) {
        invoke("audio_transcription_stop", { owner: "dictation", runId }).catch(
          () => {},
        );
        abortPendingStart(runId);
        return;
      }
      emit("voice:partial-transcript", { text: "", runId }).catch(() => {});
      const next: VoiceSession = {
        runId,
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
        historyId: newDictationHistoryId(),
      };
      session = next;
      releaseStart(runId);
      if (!enterRecordingState(runId)) {
        invoke("audio_transcription_stop", { owner: "dictation", runId }).catch(
          () => {},
        );
        cleanup(next);
        return;
      }
      startSyntheticMeter(next);
      if (stopRequestedBeforeReady) {
        stop();
      }
    } catch (err) {
      console.error("[voice-dictation] startWhisper failed", err);
      releaseStart(runId);
      if (session?.runId === runId) session = null;
      if (!lifecycle.isActive(runId)) return;
      setHandsFreeActive(false);
      if (lifecycle.isActive(runId)) {
        failRun(runId, speechFailure(String(err)));
      }
    }
  };

  const startBrowser = async (
    runId: number,
    cleanupProvider?: ServerVoiceProvider,
    triggerSource?: VoiceShortcutSource,
  ) => {
    console.log("[voice-dictation] startBrowser: opening mic + recognition");
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      console.error(
        "[voice-dictation] webkitSpeechRecognition unavailable — falling back to server",
      );
      await startServer(runId, "auto", triggerSource);
      return;
    }
    try {
      if (disposed || stopRequestedBeforeReady || !lifecycle.isActive(runId)) {
        abortPendingStart(runId);
        return;
      }
      emit("voice:partial-transcript", { text: "", runId }).catch(() => {});
      const recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";
      recognition.maxAlternatives = 1;
      const next: VoiceSession = {
        runId,
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
        historyId: newDictationHistoryId(),
      };
      (recognition as unknown as { onstart: (() => void) | null }).onstart =
        () => console.log("[voice-dictation] recognition.onstart");
      (
        recognition as unknown as { onaudiostart: (() => void) | null }
      ).onaudiostart = () => {
        console.log("[voice-dictation] recognition.onaudiostart");
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
        next.lastResultAt = Date.now();
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
        if (ev.error !== "aborted") {
          next.recognitionFailure = recognitionFailure(ev.error);
        }
      };
      recognition.onend = async () => {
        if (next.browserFinalizationStarted) return;
        next.browserFinalizationStarted = true;
        console.log("[voice-dictation] recognition.onend");
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        stopMeter(next);
        stopTracks(next);
        if (session === next) session = null;
        const text = next.browserTranscript.trim();
        if (disposed || next.cancelled || !lifecycle.isActive(runId)) {
          emit("voice:partial-transcript", { text: "", runId }).catch(() => {});
          cleanup(next);
          return;
        }
        lingeringSession = next;
        try {
          transitionRun(runId, "finalizing", "processing", "finalizing");
          logDictationTiming(
            next,
            "finalization",
            "complete",
            monotonicNow(),
            undefined,
            { textLength: text.length, reason: "recognition-end" },
          );
          await completeText(text, next);
        } catch (err) {
          console.error(
            "[voice-dictation] complete_voice_dictation failed:",
            err,
          );
          if (lifecycle.isActive(runId)) {
            failRun(runId, "provider", {
              recoverable: !!text,
              transcript: text || undefined,
            });
          }
        } finally {
          if (lingeringSession === next) lingeringSession = null;
          if (session === next) session = null;
        }
        emit("voice:partial-transcript", { text: "", runId }).catch(() => {});
      };
      session = next;
      startSyntheticMeter(next);
      try {
        recognition.start();
        releaseStart(runId);
        if (!enterRecordingState(runId)) {
          recognition.abort();
          cleanup(next);
          return;
        }
        console.log("[voice-dictation] recognition.start() returned");
      } catch (err) {
        console.error("[voice-dictation] recognition.start threw:", err);
        stopTracks(next);
        if (session === next) session = null;
        throw err;
      }
      if (stopRequestedBeforeReady) {
        stop();
      }
    } catch (err) {
      console.error("[voice-dictation] startBrowser failed", err);
      releaseStart(runId);
      if (session?.runId === runId) session = null;
      if (!lifecycle.isActive(runId)) return;
      setHandsFreeActive(false);
      if (lifecycle.isActive(runId)) failRun(runId, speechFailure(String(err)));
    }
  };

  const cancel = () => {
    setHandsFreeActive(false);
    pendingHandsFreeTapAt = null;
    const current = session ?? lingeringSession;
    if (!current) {
      stopRequestedBeforeReady = true;
      const runId = lifecycle.snapshot()?.runId;
      if (startInFlight && runId && lifecycle.isActive(runId)) {
        abortPendingStart(runId);
      } else {
        invoke("hide_flow_bar").catch(() => {});
      }
      return;
    }
    if (
      current.finalizationStage === "pasting" ||
      current.finalizationStage === "saving-history"
    ) {
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
        invoke("native_speech_cancel", {
          owner: "dictation",
          runId: current.runId,
        }).catch((err) => {
          console.warn("[voice-dictation] native_speech_cancel failed:", err);
        });
      } else if (current.kind === "whisper") {
        invoke("audio_transcription_stop", {
          owner: "dictation",
          runId: current.runId,
        }).catch((err) => {
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
    cleanup(current);
    emit("voice:partial-transcript", { text: "", runId: current.runId }).catch(
      () => {},
    );
  };

  const stop = () => {
    const current = session;
    if (!current) {
      if (startInFlight) {
        stopRequestedBeforeReady = true;
        const runId = lifecycle.snapshot()?.runId;
        if (runId && lifecycle.isActive(runId)) {
          abortPendingStart(runId);
        }
      }
      return;
    }
    if (current.stopping) return;
    current.stopping = true;
    if (current.starting || Date.now() - current.startedAt < 500) {
      if (mode === "push-to-talk" && !handsFreeActive) {
        pendingHandsFreeTapAt = Date.now();
      }
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
        invoke("native_speech_cancel", {
          owner: "dictation",
          runId: current.runId,
        }).catch(() => {});
      } else if (current.kind === "whisper") {
        invoke("audio_transcription_stop", {
          owner: "dictation",
          runId: current.runId,
        }).catch(() => {});
      }
      cleanup(current);
      return;
    }
    setHandsFreeActive(false);
    current.releasedAtMs = monotonicNow();
    logDictationTiming(current, "release", "complete", current.releasedAtMs);
    try {
      if (current.kind === "server") {
        if (
          !transitionRun(
            current.runId,
            "finalizing",
            "processing",
            "finalizing",
          )
        ) {
          cleanup(current);
          return;
        }
        current.recorder?.stop();
      } else if (current.kind === "native" || current.kind === "whisper") {
        const stopCmd =
          current.kind === "whisper"
            ? "audio_transcription_stop"
            : "native_speech_stop";
        transitionRun(current.runId, "finalizing", "processing", "finalizing");
        const stopRequest = invoke(
          stopCmd,
          current.kind === "native"
            ? { owner: "dictation", runId: current.runId }
            : { owner: "dictation", runId: current.runId },
        );
        const lingering = current;
        lingeringSession = current;
        if (session === current) session = null;
        releaseStart(current.runId);
        stopMeter(current);
        stopTracks(current);
        const stopAtMs = Date.now();
        const finalize = (reason: "final" | "timeout") => {
          if (lingering.nativeFinalizationStarted) return;
          lingering.nativeFinalizationStarted = true;
          if (!isRunActive(lingering)) {
            cleanup(lingering);
            return;
          }
          const text = lingering.browserTranscript.trim();
          lingering.browserTranscript = "";
          logDictationTiming(
            lingering,
            "finalization",
            "complete",
            monotonicNow(),
            undefined,
            { reason, textLength: text.length },
          );
          void completeText(text, lingering)
            .catch((err) => {
              console.error("[voice-dictation] finalization failed:", err);
              if (lifecycle.isActive(lingering.runId)) {
                failRun(lingering.runId, "provider", {
                  recoverable: !!text,
                  transcript: text || undefined,
                });
              }
            })
            .finally(() => {
              if (lingeringSession === lingering) lingeringSession = null;
              if (session === lingering) session = null;
              emit("voice:partial-transcript", {
                text: "",
                runId: lingering.runId,
              }).catch(() => {});
            });
        };
        lingering.onNativeFinalize = () => finalize("final");
        void stopRequest.catch((err) => {
          console.warn(`[voice-dictation] ${stopCmd} failed:`, err);
          if (lifecycle.isActive(lingering.runId)) {
            failRun(lingering.runId, "provider");
            cleanup(lingering);
          }
        });
        const heldSeconds = (stopAtMs - lingering.startedAt) / 1000;
        const timeoutBaseMs = lingering.kind === "whisper" ? 4500 : 3000;
        const finalizeTimeoutMs = Math.min(
          8000,
          Math.max(timeoutBaseMs, timeoutBaseMs + 100 * heldSeconds),
        );
        window.setTimeout(() => finalize("timeout"), finalizeTimeoutMs);
      } else {
        const initialText = current.browserTranscript.trim();
        const sinceLastResult =
          current.lastResultAt > 0
            ? Date.now() - current.lastResultAt
            : Infinity;
        const QUIET_MS = 600;
        const userFellSilent = sinceLastResult > QUIET_MS;

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

        const lingering = current;
        if (session === current) session = null;
        lingeringSession = lingering;
        releaseStart(current.runId);
        transitionRun(current.runId, "finalizing", "processing", "finalizing");
        stopMeter(lingering);
        if (lingering.stream) {
          lingering.stream.getTracks().forEach((track) => {
            try {
              track.stop();
            } catch (error) {
              console.warn("[voice-dictation] audio track stop failed:", error);
            }
          });
          lingering.stream = null;
        }
        const finishBrowser = (reason: "quiet-release" | "tail-capture") => {
          if (lingering.browserFinalizationStarted) return;
          lingering.browserFinalizationStarted = true;
          if (!isRunActive(lingering)) {
            cleanup(lingering);
            return;
          }
          detachAndAbort(lingering);
          stopTracks(lingering);
          const finalText = lingering.browserTranscript.trim();
          lingering.browserTranscript = "";
          logDictationTiming(
            lingering,
            "finalization",
            "complete",
            monotonicNow(),
            undefined,
            { textLength: finalText.length, reason },
          );
          void completeText(finalText, lingering)
            .catch((err) => {
              console.error(
                "[voice-dictation] browser finalization failed:",
                err,
              );
              if (lifecycle.isActive(lingering.runId)) {
                failRun(lingering.runId, "provider", {
                  recoverable: !!finalText,
                  transcript: finalText || undefined,
                });
              }
            })
            .finally(() => {
              if (lingeringSession === lingering) lingeringSession = null;
              if (session === lingering) session = null;
              emit("voice:partial-transcript", {
                text: "",
                runId: lingering.runId,
              }).catch(() => {});
            });
        };
        if (!initialText || userFellSilent) {
          finishBrowser("quiet-release");
        } else {
          window.setTimeout(() => finishBrowser("tail-capture"), 1_500);
        }
      }
    } catch (err) {
      console.error("[voice-dictation] stop failed", err);
      failRun(current.runId, "provider", {
        recoverable: !!current.browserTranscript.trim(),
        transcript: current.browserTranscript.trim() || undefined,
      });
      cleanup(current);
    }
  };

  refreshProviderStatus({ logFailures: false }).catch(() => {});
  configureVocabularyClient(serverUrl);
  loadVocabulary().catch(() => {});

  interface FocusEventPayload {
    windowLabel?: string;
  }
  const isMainWindow = (label?: string) =>
    label === "main" || label === "popover";
  registerListener(
    listen<FocusEventPayload>("tauri://blur", (ev) => {
      if (!isMainWindow(ev.payload?.windowLabel)) return;
      invoke("recording_pill_set_detached", { detached: true }).catch(() => {});
    }),
  );
  registerListener(
    listen<FocusEventPayload>("tauri://focus", (ev) => {
      if (!isMainWindow(ev.payload?.windowLabel)) return;
      invoke("recording_pill_set_detached", { detached: false }).catch(
        () => {},
      );
    }),
  );

  registerListener(
    listen("voice:flow-bar-ready", () => {
      emit("voice:state-change", latestFlowStatePayload).catch(() => {});
    }),
  );
  registerListener(
    onAudioLevel(({ source, synthetic, runId }) => {
      if (source !== "mic" || synthetic) return;
      const current = session;
      if (current?.kind === "native" || current?.kind === "whisper") {
        if (!isCurrentDictationRun(lifecycle, current.runId, runId)) return;
        current.meterHasRealSignal = true;
      }
    }),
  );
  registerListener(
    onPartialTranscript(({ text, runId, source }) => {
      if (source !== "mic") return;
      const current = session;
      if (!current || (current.kind !== "native" && current.kind !== "whisper"))
        return;
      if (
        current.cancelled ||
        current.stopping ||
        !isCurrentDictationRun(lifecycle, current.runId, runId)
      ) {
        return;
      }
      setInterimTranscript(current, text);
    }),
  );
  registerListener(
    onFinalTranscript(({ text, runId, source }) => {
      if (source !== "mic") return;
      const current = [session, lingeringSession].find(
        (candidate) => candidate?.runId === runId,
      );
      if (
        !current ||
        (current.kind !== "native" && current.kind !== "whisper") ||
        current.cancelled ||
        current.nativeFinalizationStarted ||
        !isCurrentDictationRun(lifecycle, current.runId, runId)
      ) {
        return;
      }
      appendFinalTranscript(current, text);
      if (current === lingeringSession) {
        current.onNativeFinalize?.();
      }
    }),
  );
  registerListener(
    onSpeechError(({ error, runId, source }) => {
      if (
        source !== "mic" ||
        typeof runId !== "number" ||
        !Number.isSafeInteger(runId)
      ) {
        return;
      }
      const current = [session, lingeringSession].find(
        (candidate) => candidate?.runId === runId,
      );
      console.error("[voice-dictation] native speech error:", error);
      if (
        !current ||
        (current.kind !== "native" && current.kind !== "whisper") ||
        current.cancelled ||
        current.nativeFinalizationStarted ||
        !isCurrentDictationRun(lifecycle, current.runId, runId)
      ) {
        return;
      }
      const text = current.browserTranscript.trim();
      if (!text) {
        failRun(runId, speechFailure(error));
        cleanup(current);
        return;
      }
      current.nativeFinalizationStarted = true;
      if (session === current) session = null;
      lingeringSession = current;
      transitionRun(runId, "finalizing", "processing", "finalizing");
      if (current.kind === "native") {
        invoke("native_speech_cancel", { owner: "dictation", runId }).catch(
          () => {},
        );
      } else {
        invoke("audio_transcription_stop", { owner: "dictation", runId }).catch(
          () => {},
        );
      }
      stopMeter(current);
      stopTracks(current);
      current.browserTranscript = "";
      void completeText(text, current)
        .catch((err) => {
          console.error(
            "[voice-dictation] speech error finalization failed:",
            err,
          );
          if (lifecycle.isActive(runId)) {
            failRun(runId, "provider", {
              recoverable: true,
              transcript: text,
            });
          }
        })
        .finally(() => {
          if (lingeringSession === current) lingeringSession = null;
          if (session === current) session = null;
        });
    }),
  );

  registerListener(
    listen<{ runId?: number }>("voice:retry-history", (event) => {
      const requestedRunId = event.payload?.runId;
      if (
        typeof requestedRunId !== "number" ||
        !Number.isSafeInteger(requestedRunId)
      ) {
        return;
      }
      const target = recoveryContext;
      if (
        !target ||
        target.runId !== requestedRunId ||
        !lifecycle.isLatest(target.runId) ||
        target.historySaved ||
        !target.historyFullText ||
        !lifecycle.retryHistory(target.runId)
      ) {
        return;
      }
      setFlowState("processing", "saving-history", { runId: target.runId });
      void saveDictationHistory(
        target,
        target.historyFullText,
        target.historyCleanedText ?? null,
      )
        .then(() => {
          if (!lifecycle.isLatest(target.runId)) return;
          if (
            target.terminalFailure === "history-save" &&
            target.insertionOutcome
          ) {
            const state =
              target.insertionOutcome === "copied" ? "copied" : "complete";
            const phase =
              target.insertionOutcome === "copied" ? "copied" : "completed";
            if (!lifecycle.finish(target.runId, phase)) return;
            recoveryContext = null;
            setFlowState(state, undefined, {
              runId: target.runId,
              insertion: target.insertionOutcome,
              historySaved: true,
            });
            return;
          }
          if (!lifecycle.finish(target.runId, "failed")) return;
          recoveryContext = null;
          setFlowState("error", undefined, {
            runId: target.runId,
            failure: "paste",
            insertion: null,
            recoverable: true,
            historySaved: true,
            transcript: target.historyCleanedText || target.historyFullText,
            ...(target.historyCleanedText &&
            target.historyCleanedText !== target.historyFullText
              ? { originalTranscript: target.historyFullText }
              : {}),
          });
        })
        .catch(() => {
          if (
            !lifecycle.isLatest(target.runId) ||
            !lifecycle.finish(target.runId, "failed")
          ) {
            return;
          }
          setFlowState("error", undefined, {
            runId: target.runId,
            failure: target.terminalFailure ?? "history-save",
            insertion: target.insertionOutcome ?? null,
            recoverable: !!target.historyFullText,
            retryHistory: true,
            historySaved: false,
            transcript: target.historyCleanedText || target.historyFullText,
            ...(target.historyCleanedText &&
            target.historyCleanedText !== target.historyFullText
              ? { originalTranscript: target.historyFullText }
              : {}),
          });
        });
    }),
  );

  registerListener(
    listen<VoiceShortcutEvent>("voice:shortcut-start", (event) => {
      if (!acceptsShortcut(event.payload?.source)) return;
      if (mode === "toggle" && (session || startInFlight)) {
        stop();
        return;
      }
      if (mode === "push-to-talk" && handsFreeActive) {
        stop();
        return;
      }
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
          invoke("set_dictation_escape_active", { active: true }).catch(
            () => {},
          );
        }
      });
    }),
  );
  registerListener(
    listen<VoiceShortcutEvent>("voice:shortcut-stop", (event) => {
      if (!acceptsShortcut(event.payload?.source)) return;
      if (mode === "toggle") return;
      if (handsFreeActive) return;
      stop();
    }),
  );
  registerListener(
    listen("voice:accept", () => {
      if (session && !session.stopping) stop();
    }),
  );
  registerListener(
    listen("voice:cancel", () => {
      cancel();
      const sessionAtCancel = session;
      const lingeringAtCancel = lingeringSession;
      window.setTimeout(() => {
        if (disposed) return;
        if (
          session !== sessionAtCancel ||
          lingeringSession !== lingeringAtCancel
        ) {
          return;
        }
        invoke("hide_flow_bar").catch(() => {});
      }, 250);
    }),
  );

  console.log(
    "[voice-dictation] installed v3 (no-warm-stream): provider=" + provider,
  );

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
      invoke("native_speech_cancel", {
        owner: "dictation",
        runId: target.runId,
      }).catch((err) => {
        console.warn(
          "[voice-dictation] native_speech_cancel (dispose) failed:",
          err,
        );
      });
    } else if (target.kind === "whisper") {
      invoke("audio_transcription_stop", {
        owner: "dictation",
        runId: target.runId,
      }).catch((err) => {
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
    forceStopSession(session);
    if (lingeringSession && lingeringSession !== session) {
      forceStopSession(lingeringSession);
    }
    cleanup(session);
  };
}
