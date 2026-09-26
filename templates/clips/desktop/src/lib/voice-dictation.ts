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
  onAudioLevel,
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
  | "error";
type FlowProcessingStage = "finalizing" | "cleaning" | "pasting";
type VoiceInsertionResult = "inserted" | "copied";
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

interface VoiceSession {
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
  triggerSource?: VoiceShortcutSource;
  startedAt: number;
  releasedAtMs?: number;
  meterHasRealSignal?: boolean;
  stopping: boolean;
  transcribeAbort: AbortController | null;
  cancelled: boolean;
  onNativeFinalize?: (() => void) | null;
  cleanupProvider?: ServerVoiceProvider | null;
  historySaved?: boolean;
  onLateFinalText?: ((text: string) => void) | null;
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

async function pickBuiltInMicId(): Promise<string | null> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return null;
    // Device labels are only populated AFTER permission has been granted
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

function setFlowState(state: FlowState, stage?: FlowProcessingStage): void {
  emit("voice:state-change", {
    state,
    stage,
    ...(state === "recording" ? { startedAtMs: Date.now() } : {}),
  }).catch(() => {});
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
      emit("voice:audio-level", { level }).catch(() => {});
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
    emit("voice:audio-level", { level, synthetic: true }).catch(() => {});
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

  const cleanup = (target: VoiceSession | null = null, hide = true) => {
    if (target) {
      stopMeter(target);
      stopTracks(target);
    }
    if (target && session !== target) {
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
      setHandsFreeActive(false);
      setFlowState("error");
      window.setTimeout(() => {
        if (disposed || session) return;
        setFlowState("idle");
        invoke("hide_flow_bar").catch(() => {});
      }, 800);
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
  ): Promise<VoiceInsertionResult> => {
    const original = rawText.trim();
    if (!original) return "inserted";
    target.onLateFinalText = (lateText) => {
      if (target.historySaved) return;
      saveDictationHistory(target, lateText, lateText);
    };
    let text = original;
    if (target.cleanupProvider) {
      setFlowState("processing", "cleaning");
      const cleanupStartedAtMs = monotonicNow();
      logDictationTiming(
        target,
        "cleanup",
        "start",
        cleanupStartedAtMs,
        undefined,
        {
          provider: target.cleanupProvider,
        },
      );
      const controller = new AbortController();
      target.transcribeAbort = controller;
      let cleanupOutcome: "completed" | "fallback" = "completed";
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
        cleanupOutcome = "fallback";
      } finally {
        target.transcribeAbort = null;
        logDictationTiming(
          target,
          "cleanup",
          "complete",
          monotonicNow(),
          cleanupStartedAtMs,
          { outcome: cleanupOutcome },
        );
      }
    } else {
      logDictationTiming(
        target,
        "cleanup",
        "skipped",
        monotonicNow(),
        undefined,
        {
          reason: "no-provider",
        },
      );
    }
    if (target.cancelled || disposed) return "inserted";
    try {
      text = applyBacktrack(text) || text;
    } catch (err) {
      console.warn("[voice-dictation] backtrack failed, pasting raw:", err);
    }
    const pasteStartedAtMs = monotonicNow();
    setFlowState("processing", "pasting");
    logDictationTiming(target, "paste", "start", pasteStartedAtMs);
    let insertionResult: VoiceInsertionResult = "inserted";
    try {
      insertionResult = await invoke<VoiceInsertionResult>(
        "complete_voice_dictation",
        { text },
      );
      logDictationTiming(
        target,
        "paste",
        "complete",
        monotonicNow(),
        pasteStartedAtMs,
        { textLength: text.length },
      );
    } catch (err) {
      logDictationTiming(
        target,
        "paste",
        "complete",
        monotonicNow(),
        pasteStartedAtMs,
        { outcome: "failed" },
      );
      throw err;
    }
    try {
      recordPasteForLearn(text);
    } catch (err) {
      console.warn("[voice-dictation] vocab learn-monitor failed:", err);
    }
    saveDictationHistory(target, original, text);
    setFlowState(insertionResult === "copied" ? "copied" : "complete");
    return insertionResult === "copied" ? "copied" : "inserted";
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
      await invoke("show_flow_bar");
      if (disposed || stopRequestedBeforeReady) {
        abortPendingStart();
        return;
      }
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
        setFlowState("processing", "finalizing");
        let successState: "complete" | "copied" = "complete";
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
          if (text) {
            console.log(
              `[voice-dictation] transcribed (${text.length} chars):`,
              text.slice(0, 120),
            );
            logDictationTiming(
              next,
              "cleanup",
              "skipped",
              monotonicNow(),
              undefined,
              {
                reason: "server-transcription-path",
              },
            );
            const pasteStartedAtMs = monotonicNow();
            setFlowState("processing", "pasting");
            logDictationTiming(next, "paste", "start", pasteStartedAtMs);
            const insertionResult = await invoke<VoiceInsertionResult>(
              "complete_voice_dictation",
              { text },
            );
            logDictationTiming(
              next,
              "paste",
              "complete",
              monotonicNow(),
              pasteStartedAtMs,
              { textLength: text.length },
            );
            saveDictationHistory(next, text, text);
            successState = insertionResult === "copied" ? "copied" : "complete";
            setFlowState(successState);
          } else {
            console.warn(
              "[voice-dictation] transcribe returned empty text — nothing to paste",
            );
            setFlowState("error");
          }
          window.setTimeout(
            () => {
              if (disposed || session) return;
              setFlowState("idle");
              invoke("hide_flow_bar").catch(() => {});
            },
            text && successState === "copied" ? 1800 : text ? 600 : 800,
          );
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
      session = null;
      setHandsFreeActive(false);
      setFlowState("error");
      window.setTimeout(() => {
        if (disposed || session) return;
        setFlowState("idle");
        invoke("hide_flow_bar").catch(() => {});
      }, 800);
    }
  };

  const startNative = async (
    cleanupProvider?: ServerVoiceProvider,
    triggerSource?: VoiceShortcutSource,
  ) => {
    console.log("[voice-dictation] startNative: invoke native_speech_start");
    try {
      await invoke("show_flow_bar");
      if (disposed || stopRequestedBeforeReady) {
        abortPendingStart();
        return;
      }
      enterRecordingState();
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
      try {
        const vocabularyEntries = await loadVocabularyEntries().catch(() => []);
        const contextualStrings = vocabularyEntries.map((v) => v.replacement);
        await invoke("native_speech_set_vocabulary", {
          strings: contextualStrings,
        }).catch(() => {});
        await invoke("native_speech_start", nativeSpeechArgs());
        console.log(
          `[voice-dictation] native_speech_start ok (vocab=${contextualStrings.length})`,
        );
        startSyntheticMeter(next);
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
      const wasStopRequested = stopRequestedBeforeReady;
      startInFlight = false;
      stopRequestedBeforeReady = false;
      session = null;
      // native start (mic permission denial, engine-busy) can't wedge every
      setHandsFreeActive(false);
      if (
        String(err).includes("unavailable in tauri dev") &&
        !disposed &&
        !wasStopRequested
      ) {
        console.warn(
          "[voice-dictation] native Speech is unavailable in tauri dev; falling back to local Whisper",
        );
        await startWhisper(cleanupProvider, triggerSource);
        return;
      }
      setFlowState("error");
      window.setTimeout(() => {
        if (disposed || session) return;
        setFlowState("idle");
        invoke("hide_flow_bar").catch(() => {});
      }, 800);
    }
  };

  const startWhisper = async (
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
      setHandsFreeActive(false);
      setFlowState("error");
      window.setTimeout(() => {
        if (disposed || session) return;
        setFlowState("idle");
        invoke("hide_flow_bar").catch(() => {});
      }, 800);
    }
  };

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
      await invoke("show_flow_bar");
      if (disposed || stopRequestedBeforeReady) {
        abortPendingStart();
        return;
      }
      enterRecordingState();
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
          emit("voice:partial-transcript", { text: "" }).catch(() => {});
          cleanup(next);
          return;
        }
        try {
          console.log(
            `[voice-dictation] browser transcribed (${text.length} chars):`,
            text.slice(0, 120),
          );
          setFlowState("processing", "finalizing");
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
        }
        emit("voice:partial-transcript", { text: "" }).catch(() => {});
        cleanup(next);
      };
      session = next;
      startInFlight = false;
      startSyntheticMeter(next);
      try {
        recognition.start();
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
      startInFlight = false;
      stopRequestedBeforeReady = false;
      session = null;
      setHandsFreeActive(false);
      setFlowState("error");
      window.setTimeout(() => {
        if (disposed || session) return;
        setFlowState("idle");
        invoke("hide_flow_bar").catch(() => {});
      }, 800);
    }
  };

  const cancel = () => {
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
        invoke("native_speech_cancel").catch(() => {});
      } else if (current.kind === "whisper") {
        invoke("audio_transcription_stop").catch(() => {});
      }
      cleanup(current);
      return;
    }
    setHandsFreeActive(false);
    current.releasedAtMs = monotonicNow();
    logDictationTiming(current, "release", "complete", current.releasedAtMs);
    try {
      if (current.kind === "server") {
        current.recorder?.stop();
      } else if (current.kind === "native" || current.kind === "whisper") {
        const stopCmd =
          current.kind === "whisper"
            ? "audio_transcription_stop"
            : "native_speech_stop";
        invoke(stopCmd).catch((err) => {
          console.warn(`[voice-dictation] ${stopCmd} failed:`, err);
        });
        setFlowState("processing", "finalizing");
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
        let pasted = false;
        let finalized = false;
        const finalize = (reason: "final" | "timeout" | "manual") => {
          if (finalized) {
            if (reason === "final" && pasted) {
              const lateText = lingering.browserTranscript.trim();
              lingering.browserTranscript = "";
              if (lateText) lingering.onLateFinalText?.(lateText);
            }
            return;
          }
          finalized = true;
          const finalizationAtMs = monotonicNow();
          const finalText = lingering.browserTranscript.trim();
          logDictationTiming(
            lingering,
            "finalization",
            "complete",
            finalizationAtMs,
            undefined,
            { reason, textLength: finalText.length },
          );
          console.log(
            `[voice-dictation] native finalize (${reason}, +${Date.now() - stopAtMs}ms)`,
          );
          if (lingering.cancelled) {
            if (lingeringSession === lingering) lingeringSession = null;
            return;
          }
          if (session && session !== lingering) {
            if (lingeringSession === lingering) lingeringSession = null;
            return;
          }
          const text = finalText;
          lingering.browserTranscript = "";
          if (text) {
            console.log(
              `[voice-dictation] native paste (${text.length} chars, reason=${reason}):`,
              text.slice(0, 120),
            );
            pasted = true;
            if (reason === "timeout") {
              window.setTimeout(() => {
                if (lingeringSession === lingering) lingeringSession = null;
              }, 2000);
            } else if (lingeringSession === lingering) {
              lingeringSession = null;
            }
            void (async () => {
              let insertionResult: VoiceInsertionResult = "inserted";
              try {
                insertionResult = await completeText(text, lingering);
              } catch (err) {
                console.error("[voice-dictation] paste failed:", err);
                setFlowState("error");
              }
              console.log("[voice-dictation] starting dismissal linger");
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
                insertionResult === "copied"
                  ? 1800
                  : lingering.cleanupProvider
                    ? 500
                    : 1200,
              );
            })();
          } else {
            console.warn(
              "[voice-dictation] no transcript captured — native recognizer didn't produce results",
            );
            if (lingeringSession === lingering) lingeringSession = null;
            setFlowState("error");
            window.setTimeout(() => {
              if (disposed || session) return;
              setFlowState("idle");
              invoke("hide_flow_bar").catch(() => {});
            }, 800);
            emit("voice:partial-transcript", { text: "" }).catch(() => {});
          }
        };

        lingering.onNativeFinalize = () => finalize("final");
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

        if (!initialText) {
          current.browserTranscript = "";
          if (session === current) session = null;
          startInFlight = false;
          stopRequestedBeforeReady = false;
          setFlowState("processing", "finalizing");
          invoke("hide_flow_bar").catch(() => {});
          emit("voice:partial-transcript", { text: "" }).catch(() => {});
          detachAndAbort(current);
          stopMeter(current);
          stopTracks(current);
          console.warn(
            "[voice-dictation] no transcript captured — recognition didn't produce results",
          );
        } else if (userFellSilent) {
          const lingering = current;
          if (session === current) session = null;
          startInFlight = false;
          stopRequestedBeforeReady = false;
          setFlowState("processing", "finalizing");
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
          logDictationTiming(
            lingering,
            "finalization",
            "complete",
            monotonicNow(),
            undefined,
            { textLength: finalText.length, reason: "quiet-release" },
          );
          void (async () => {
            let insertionResult: VoiceInsertionResult = "inserted";
            try {
              insertionResult = await completeText(finalText, lingering);
            } catch (err) {
              console.error("[voice-dictation] paste failed:", err);
              setFlowState("error");
            }
            window.setTimeout(
              () => {
                if (disposed) return;
                if (session && session !== lingering) return;
                invoke("hide_flow_bar").catch(() => {});
                emit("voice:partial-transcript", { text: "" }).catch(() => {});
              },
              insertionResult === "copied"
                ? 1800
                : lingering.cleanupProvider
                  ? 500
                  : 1000,
            );
          })();
        } else {
          const lingering = current;
          if (session === current) session = null;
          startInFlight = false;
          stopRequestedBeforeReady = false;
          setFlowState("processing", "finalizing");
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
          console.log(
            `[voice-dictation] tail-capture starting (active ${sinceLastResult}ms ago, ${initialText.length} chars so far): "${initialText.slice(0, 60)}..."`,
          );
          window.setTimeout(() => {
            if (disposed) return;
            const supersededByNewSession = !!session && session !== lingering;
            if (supersededByNewSession) lingering.cancelled = true;
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
              void (async () => {
                logDictationTiming(
                  lingering,
                  "finalization",
                  "complete",
                  monotonicNow(),
                  undefined,
                  { textLength: finalText.length, reason: "tail-capture" },
                );
                let insertionResult: VoiceInsertionResult = "inserted";
                try {
                  insertionResult = await completeText(finalText, lingering);
                } catch (err) {
                  console.error("[voice-dictation] paste failed:", err);
                  setFlowState("error");
                }
                window.setTimeout(
                  () => {
                    if (disposed) return;
                    if (session && session !== lingering) return;
                    invoke("hide_flow_bar").catch(() => {});
                    emit("voice:partial-transcript", { text: "" }).catch(
                      () => {},
                    );
                  },
                  insertionResult === "copied"
                    ? 1800
                    : lingering.cleanupProvider
                      ? 500
                      : 1000,
                );
              })();
            } else {
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
    onAudioLevel(({ source, synthetic }) => {
      if (source !== "mic" || synthetic) return;
      const current = session;
      if (current?.kind === "native" || current?.kind === "whisper") {
        current.meterHasRealSignal = true;
      }
    }),
  );
  registerListener(
    onPartialTranscript(({ text }) => {
      const current = session;
      if (!current || (current.kind !== "native" && current.kind !== "whisper"))
        return;
      if (current.cancelled || current.stopping) return;
      setInterimTranscript(current, text);
    }),
  );
  registerListener(
    onFinalTranscript(({ text }) => {
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
    }),
  );
  registerListener(
    onSpeechError(({ error }) => {
      const current = session;
      console.error("[voice-dictation] native speech error:", error);
      if (!current || (current.kind !== "native" && current.kind !== "whisper"))
        return;
      setFlowState("error");
      window.setTimeout(() => {
        if (!disposed && session === current) cleanup(current);
      }, 800);
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
    forceStopSession(session);
    if (lingeringSession && lingeringSession !== session) {
      forceStopSession(lingeringSession);
    }
    cleanup(session);
  };
}
