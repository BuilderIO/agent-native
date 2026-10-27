import { useCallback, useEffect, useRef, useState } from "react";

import {
  createRealtimeVoiceAudioLevelStore,
  normalizeRealtimeVoiceRms,
  type RealtimeVoiceAudioLevelStore,
  smoothRealtimeVoiceLevel,
} from "./realtime-voice-audio-level.js";
import {
  applyVoiceContextReplacements,
  type ComposerTranslate,
  type VoiceContextPack,
  useComposerRuntimeAdapters,
} from "./runtime-adapters.js";

export type VoiceProvider =
  | "auto"
  | "openai"
  | "browser"
  | "google-realtime"
  | "builder-gemini"
  | "builder"
  | "gemini"
  | "groq";

export type TranscriptionMode = "mac-native" | "google-realtime" | "batch";

export interface VoicePrefs {
  provider: VoiceProvider;
  transcriptionMode?: TranscriptionMode;
  instructions?: string;
  cleanupEnabled?: boolean;
}

export interface VoiceCleanupPrefs {
  enabled?: boolean;
}

type VoiceContextPackSource =
  | VoiceContextPack
  | (() => VoiceContextPack | undefined | Promise<VoiceContextPack | undefined>)
  | undefined;

const PREFS_KEY = "voice-transcription-prefs";
const CLEANUP_PREFS_KEY = "voice-cleanup-prefs";
const PREFS_URL = `/_agent-native/application-state/${PREFS_KEY}`;
const CLEANUP_PREFS_URL = `/_agent-native/application-state/${CLEANUP_PREFS_KEY}`;
const TRANSCRIBE_URL = "/_agent-native/transcribe-voice";
const GOOGLE_REALTIME_SESSION_URL = "/_agent-native/transcribe-stream/session";
const GOOGLE_REALTIME_WS_PROTOCOL = "google-realtime.v1";
function isVoiceProvider(value: unknown): value is VoiceProvider {
  return (
    value === "auto" ||
    value === "openai" ||
    value === "browser" ||
    value === "google-realtime" ||
    value === "builder-gemini" ||
    value === "builder" ||
    value === "gemini" ||
    value === "groq"
  );
}

function isTranscriptionMode(value: unknown): value is TranscriptionMode {
  return (
    value === "mac-native" || value === "google-realtime" || value === "batch"
  );
}

async function defaultProvider(): Promise<VoiceProvider> {
  return "auto";
}

function normalizeProviderForMode(
  mode: TranscriptionMode | undefined,
  provider: VoiceProvider | null,
): VoiceProvider | null {
  if (mode === "mac-native") return "browser";
  if (mode === "google-realtime") return "google-realtime";
  if (mode === "batch") {
    if (!provider || provider === "browser") return "auto";
    return provider === "builder" ? "builder-gemini" : provider;
  }
  if (!provider) return null;
  return provider === "builder" ? "builder-gemini" : provider;
}

export type VoiceState =
  | "idle"
  | "starting"
  | "recording"
  | "transcribing"
  | "error";

export interface UseVoiceDictationOptions {
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
  onLiveUpdate?: (finalText: string, interimText: string) => void;
  contextPack?: VoiceContextPackSource;
}

export interface VoiceDictationApi {
  state: VoiceState;
  /** Live microphone input level, read by the waveform without re-rendering the composer. */
  levels: RealtimeVoiceAudioLevelStore;
  durationMs: number;
  errorMessage: string | null;
  provider: VoiceProvider;
  supported: boolean;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
  dismissError: () => void;
}

async function readVoicePrefs(
  resolvePath: (path: string) => string,
): Promise<VoicePrefs> {
  const cleanupPrefs = await readVoiceCleanupPrefs(resolvePath);
  try {
    const res = await fetch(resolvePath(PREFS_URL));
    if (!res.ok) {
      return {
        provider: await defaultProvider(),
        cleanupEnabled: cleanupPrefs.enabled,
      };
    }
    const body = (await res.json()) as
      | VoicePrefs
      | { value?: VoicePrefs }
      | null;
    const value =
      (body as { value?: VoicePrefs } | null)?.value ??
      (body as VoicePrefs | null);
    const mode = isTranscriptionMode(value?.transcriptionMode)
      ? value.transcriptionMode
      : undefined;
    const p =
      (body as VoicePrefs | null)?.provider ??
      (body as { value?: VoicePrefs } | null)?.value?.provider;
    const instructions =
      (body as VoicePrefs | null)?.instructions ??
      (body as { value?: VoicePrefs } | null)?.value?.instructions;
    const provider = normalizeProviderForMode(
      mode,
      isVoiceProvider(p) ? p : null,
    );
    if (provider) {
      return {
        transcriptionMode: mode,
        provider,
        cleanupEnabled: cleanupPrefs.enabled,
        instructions:
          typeof instructions === "string" ? instructions.trim() : undefined,
      };
    }
  } catch {
    /* fall through */
  }
  return {
    provider: await defaultProvider(),
    cleanupEnabled: cleanupPrefs.enabled,
  };
}

async function readVoiceCleanupPrefs(
  resolvePath: (path: string) => string,
): Promise<VoiceCleanupPrefs> {
  try {
    const res = await fetch(resolvePath(CLEANUP_PREFS_URL));
    if (!res.ok) return {};
    const body = (await res.json()) as
      | VoiceCleanupPrefs
      | { value?: VoiceCleanupPrefs }
      | null;
    const value =
      (body as { value?: VoiceCleanupPrefs } | null)?.value ??
      (body as VoiceCleanupPrefs | null);
    return { enabled: value?.enabled === true };
  } catch {
    return {};
  }
}

function getSpeechRecognitionCtor(): any {
  if (typeof window === "undefined") return null;
  return (
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition ||
    null
  );
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
      /* ignore */
    }
  }
  return "audio/webm";
}

async function resolveVoiceContextPack(
  source: VoiceContextPackSource,
): Promise<VoiceContextPack | undefined> {
  try {
    const value = typeof source === "function" ? await source() : source;
    return value && typeof value === "object" ? value : undefined;
  } catch {
    return undefined;
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

export function providerForTextCleanup(provider: VoiceProvider): VoiceProvider {
  return provider === "google-realtime" ? "auto" : provider;
}

async function cleanupRecognizedText({
  text,
  provider,
  instructions,
  contextPack,
  resolvePath,
  replaceContext,
}: {
  text: string;
  provider: VoiceProvider;
  instructions?: string;
  contextPack?: VoiceContextPack;
  resolvePath: (path: string) => string;
  replaceContext: (
    text: string,
    context: VoiceContextPack | undefined,
  ) => string;
}): Promise<string> {
  if (provider === "browser") {
    return replaceContext(text, contextPack);
  }

  const form = new FormData();
  form.append("text", text);
  form.append("provider", providerForTextCleanup(provider));
  if (instructions?.trim()) {
    form.append("instructions", instructions.trim());
  }
  appendVoiceContext(form, contextPack);

  const res = await fetch(resolvePath(TRANSCRIBE_URL), {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res
      .json()
      .catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error || `Transcript cleanup failed (${res.status})`);
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim() || text;
}

type BrowserDocumentPolicy = {
  allowsFeature: (feature: string) => boolean;
};

function microphoneBlockedByPermissionsPolicy(): boolean {
  if (typeof document === "undefined") return false;
  const doc = document as Document & {
    permissionsPolicy?: BrowserDocumentPolicy;
    featurePolicy?: BrowserDocumentPolicy;
  };
  const policy = doc.permissionsPolicy ?? doc.featurePolicy ?? null;
  if (!policy?.allowsFeature) return false;
  try {
    return !policy.allowsFeature("microphone");
  } catch {
    return false;
  }
}

const MICROPHONE_ACCESS_ERROR_NAMES = new Set([
  "NotAllowedError",
  "SecurityError",
  "NotFoundError",
  "DevicesNotFoundError",
  "NotReadableError",
  "TrackStartError",
]);

/** Whether a getUserMedia rejection is about microphone access or hardware. */
export function isMicrophoneAccessError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === "string" && MICROPHONE_ACCESS_ERROR_NAMES.has(name);
}

const untranslated: ComposerTranslate = (_key, options) =>
  typeof options?.defaultValue === "string" ? options.defaultValue : "";

export function voiceDictationStartErrorMessage(
  error: unknown,
  t: ComposerTranslate = untranslated,
): string {
  const name =
    typeof (error as { name?: unknown } | null)?.name === "string"
      ? (error as { name: string }).name
      : "";
  const message =
    typeof (error as { message?: unknown } | null)?.message === "string"
      ? (error as { message: string }).message
      : "";

  if (
    microphoneBlockedByPermissionsPolicy() ||
    /permissions[- ]policy|feature policy/i.test(message)
  ) {
    return t("agentChat.voice.dictation.errors.permissionsPolicy", {
      defaultValue:
        "This app is blocking microphone access through its browser permissions policy. Reload the app, or open it directly in a browser tab.",
    });
  }

  if (
    name === "NotAllowedError" ||
    name === "SecurityError" ||
    /permission|denied|not allowed/i.test(message)
  ) {
    // Chromium reports an OS-level block as "Permission denied by system".
    if (/by system/i.test(message)) {
      return t("agentChat.voice.dictation.errors.microphoneBlockedBySystem", {
        defaultValue:
          "Your computer is blocking microphone access for this browser. Allow it in your system privacy settings, then try again.",
      });
    }
    return t("agentChat.voice.dictation.errors.microphoneBlocked", {
      defaultValue:
        "Microphone access is blocked. Click the site controls icon in the address bar, set Microphone to Allow for this app, then try again.",
    });
  }

  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return t("agentChat.voice.dictation.errors.noMicrophone", {
      defaultValue:
        "No microphone was found. Plug one in or choose a different input, then try again.",
    });
  }

  if (name === "NotReadableError" || name === "TrackStartError") {
    return t("agentChat.voice.dictation.errors.microphoneBusy", {
      defaultValue:
        "Your microphone is busy in another app. Close the other app or choose a different input, then try again.",
    });
  }

  return (
    message ||
    t("agentChat.voice.dictation.errors.startFailed", {
      defaultValue: "Could not start dictation. Try again.",
    })
  );
}

function isMicPermissionError(error: string | undefined): boolean {
  return (
    error === "not-allowed" ||
    error === "service-not-allowed" ||
    error === "audio-capture"
  );
}

export function voiceDictationSpeechErrorMessage(
  error: string | undefined,
  t: ComposerTranslate = untranslated,
): string {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return voiceDictationStartErrorMessage(
      { name: "NotAllowedError", message: error },
      t,
    );
  }
  if (error === "audio-capture") {
    return voiceDictationStartErrorMessage({ name: "NotFoundError" }, t);
  }
  if (error === "network") {
    return t("agentChat.voice.dictation.errors.speechServiceUnreachable", {
      defaultValue:
        "Speech recognition couldn't reach its service. Check your connection, or pick a different source under Voice transcription in Settings.",
    });
  }
  if (error === "aborted" || error === undefined) {
    return t("agentChat.voice.dictation.errors.noAudioCaptured", {
      defaultValue:
        "Dictation stopped before it captured any audio. Another app or tab may be using the microphone. Close it, or pick a different source under Voice transcription in Settings.",
    });
  }
  return t("agentChat.voice.dictation.errors.speechRecognitionFailed", {
    error,
    defaultValue: `Speech recognition failed: ${error}`,
  });
}

export function useVoiceDictation(
  options: UseVoiceDictationOptions,
): VoiceDictationApi {
  const adapters = useComposerRuntimeAdapters();
  const resolvePath = adapters.resolvePath!;
  const t = adapters.translate;
  const replaceContext =
    adapters.voice!.applyContextReplacements ?? applyVoiceContextReplacements;
  const { onTranscript, onError, onLiveUpdate, contextPack } = options;
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  const onLiveUpdateRef = useRef(onLiveUpdate);
  const contextPackRef = useRef(contextPack);
  onTranscriptRef.current = onTranscript;
  onErrorRef.current = onError;
  onLiveUpdateRef.current = onLiveUpdate;
  contextPackRef.current = contextPack;

  const [state, setState] = useState<VoiceState>("idle");
  const [levels] = useState(createRealtimeVoiceAudioLevelStore);
  const [durationMs, setDurationMs] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [provider, setProvider] = useState<VoiceProvider>("auto");

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);
  // start() opens a session and cancel() ends it. A late continuation (a
  // transcription response, a socket event) shares refs with any newer session,
  // so one from an ended session returns without touching them; cancel() has
  // already torn its own session down.
  const sessionRef = useRef(0);
  const speechRef = useRef<any>(null);
  const speechTranscriptRef = useRef<string>("");
  const activeProviderRef = useRef<VoiceProvider>("browser");
  const liveSpeechRef = useRef<any>(null);
  const liveTextRef = useRef<string>("");
  const realtimeSocketRef = useRef<WebSocket | null>(null);
  const realtimeFinalRef = useRef<string>("");
  const realtimeInterimRef = useRef<string>("");
  const realtimeStopTimeoutRef = useRef<number | null>(null);

  const mediaRecorderSupported =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof (window as any).MediaRecorder !== "undefined";
  const speechSupported = !!getSpeechRecognitionCtor();
  const supported = mediaRecorderSupported || speechSupported;

  const teardown = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current != null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (speechRef.current) {
      try {
        speechRef.current.abort?.();
      } catch {
        /* ignore */
      }
    }
    if (liveSpeechRef.current) {
      try {
        liveSpeechRef.current.abort?.();
      } catch {
        /* ignore */
      }
      liveSpeechRef.current = null;
    }
    if (realtimeSocketRef.current) {
      const socket = realtimeSocketRef.current;
      realtimeSocketRef.current = null;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    }
    if (realtimeStopTimeoutRef.current) {
      clearTimeout(realtimeStopTimeoutRef.current);
      realtimeStopTimeoutRef.current = null;
    }
    analyserRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    speechRef.current = null;
    speechTranscriptRef.current = "";
    liveTextRef.current = "";
    realtimeFinalRef.current = "";
    realtimeInterimRef.current = "";
    levels.reset();
  }, [levels]);

  useEffect(() => teardown, [teardown]);

  const failWith = useCallback(
    (message: string) => {
      setErrorMessage(message);
      setState("error");
      onErrorRef.current?.(message);
      teardown();
    },
    [teardown],
  );

  const getVoiceContextPack = useCallback(
    () => resolveVoiceContextPack(contextPackRef.current),
    [],
  );

  const startMeter = useCallback(
    (stream: MediaStream) => {
      try {
        // Older Safari has only the prefixed constructor.
        const audioWindow =
          typeof window !== "undefined"
            ? (window as {
                AudioContext?: typeof AudioContext;
                webkitAudioContext?: typeof AudioContext;
              })
            : undefined;
        const AudioCtor =
          audioWindow?.AudioContext || audioWindow?.webkitAudioContext || null;
        if (!AudioCtor) return;
        const ctx: AudioContext = new AudioCtor();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        audioContextRef.current = ctx;
        analyserRef.current = analyser;

        const buffer = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteTimeDomainData(buffer);
          levels.set({
            input: smoothRealtimeVoiceLevel(
              levels.getSnapshot().input,
              normalizeRealtimeVoiceRms(buffer),
            ),
            output: 0,
          });
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        // coercion-ok: the meter only animates the waveform; capture and transcription never read it.
      } catch {
        /* analyser is best-effort */
      }
    },
    [levels],
  );

  const startTimer = useCallback(() => {
    startedAtRef.current = Date.now();
    setDurationMs(0);
    timerRef.current = setInterval(() => {
      setDurationMs(Date.now() - startedAtRef.current);
    }, 100);
  }, []);

  const startOpenAi = useCallback(
    async (
      session: number,
      providerPref: VoiceProvider,
      instructions?: string,
    ) => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (session !== sessionRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      mediaStreamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        if (session !== sessionRef.current) return;
        const localChunks = chunksRef.current.slice();
        const localMime = recorder.mimeType || mimeType;
        const liveSnapshot = liveTextRef.current;
        teardown();
        if (localChunks.length === 0) {
          if (liveSnapshot) onTranscriptRef.current?.(liveSnapshot.trim());
          setState("idle");
          return;
        }
        setState("transcribing");
        try {
          const audioBlob = new Blob(localChunks, { type: localMime });
          const form = new FormData();
          form.append(
            "audio",
            audioBlob,
            `voice.${localMime.split("/")[1] ?? "webm"}`,
          );
          form.append("provider", providerPref);
          if (instructions?.trim()) {
            form.append("instructions", instructions.trim());
          }
          appendVoiceContext(form, await getVoiceContextPack());
          const res = await fetch(resolvePath(TRANSCRIBE_URL), {
            method: "POST",
            body: form,
          });
          if (session !== sessionRef.current) return;
          if (!res.ok) {
            // coercion-ok: an unreadable error body still fails with the status-coded message below.
            const body = (await res.json().catch(() => ({}))) as {
              error?: string;
            };
            throw new Error(
              body.error ||
                t(
                  "agentChat.voice.dictation.errors.transcriptionFailedStatus",
                  {
                    status: res.status,
                    defaultValue: `Transcription failed (${res.status}). Try again.`,
                  },
                ),
            );
          }
          const data = (await res.json()) as { text?: string };
          if (session !== sessionRef.current) return;
          const text = (data.text ?? "").trim();
          if (text) {
            onTranscriptRef.current?.(text);
          } else if (liveSnapshot) {
            onTranscriptRef.current?.(liveSnapshot.trim());
          }
          setState("idle");
        } catch (err) {
          if (session !== sessionRef.current) return;
          if (liveSnapshot) {
            onTranscriptRef.current?.(liveSnapshot.trim());
            setState("idle");
          } else {
            failWith(
              (err as Error)?.message ??
                t("agentChat.voice.dictation.errors.transcriptionFailed", {
                  defaultValue:
                    "Transcription failed. Check your provider under Voice transcription in Settings.",
                }),
            );
          }
        }
      };

      startMeter(stream);
      startTimer();
      setState("recording");
      recorder.start();

      const SpeechCtor = getSpeechRecognitionCtor();
      if (SpeechCtor) {
        const liveSpeech = new SpeechCtor();
        liveSpeech.continuous = true;
        liveSpeech.interimResults = true;
        liveSpeech.lang =
          (typeof navigator !== "undefined" && navigator.language) || "en-US";
        liveSpeechRef.current = liveSpeech;
        liveTextRef.current = "";

        liveSpeech.onresult = (event: any) => {
          if (session !== sessionRef.current) return;
          let interim = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            const text = result[0]?.transcript ?? "";
            if (result.isFinal) {
              liveTextRef.current += text;
            } else {
              interim += text;
            }
          }
          onLiveUpdateRef.current?.(liveTextRef.current, interim);
        };

        liveSpeech.onend = () => {
          if (liveSpeechRef.current === liveSpeech) {
            try {
              liveSpeech.start();
            } catch {
              /* ignore */
            }
          }
        };

        liveSpeech.onerror = () => {};

        try {
          liveSpeech.start();
        } catch {
          /* best effort — live preview just won't appear */
        }
      }
    },
    [
      startMeter,
      startTimer,
      teardown,
      failWith,
      getVoiceContextPack,
      resolvePath,
      t,
    ],
  );

  const startBrowser = useCallback(
    async (
      session: number,
      prefs: VoicePrefs,
      onUnavailable?: (error: string | undefined) => boolean,
    ) => {
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) {
        throw new Error(
          t("agentChat.voice.dictation.errors.speechRecognitionUnsupported", {
            defaultValue:
              "Your browser doesn't support speech recognition. Add an OpenAI API key in Settings to use Whisper transcription.",
          }),
        );
      }
      if (session !== sessionRef.current) return;

      const recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang =
        (typeof navigator !== "undefined" && navigator.language) || "en-US";
      speechRef.current = recognition;
      speechTranscriptRef.current = "";

      let capturing = false;
      let fatal = false;
      let lastError: string | undefined;

      recognition.onaudiostart = () => {
        capturing = true;
        if (session !== sessionRef.current) return;
        void Promise.resolve()
          .then(() => navigator.mediaDevices?.getUserMedia({ audio: true }))
          .then((stream) => {
            if (!stream) return;
            if (
              session !== sessionRef.current ||
              speechRef.current !== recognition
            ) {
              for (const track of stream.getTracks()) track.stop();
              return;
            }
            mediaStreamRef.current = stream;
            startMeter(stream);
          })
          .catch(() => {
            /* the meter is decoration; recognition owns the real capture */
          });
      };

      recognition.onresult = (event: any) => {
        if (session !== sessionRef.current) return;
        capturing = true;
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0]?.transcript ?? "";
          if (result.isFinal) {
            speechTranscriptRef.current += text;
          } else {
            interim += text;
          }
        }
        onLiveUpdateRef.current?.(speechTranscriptRef.current, interim);
      };
      recognition.onerror = (event: any) => {
        lastError = event?.error;
        if (event?.error === "no-speech" || event?.error === "aborted") return;
        fatal = true;
      };
      recognition.onend = () => {
        if (session !== sessionRef.current) return;
        const text = speechTranscriptRef.current.trim();
        teardown();
        if (!text) {
          if (fatal || !capturing) {
            if (onUnavailable?.(lastError)) return;
            failWith(voiceDictationSpeechErrorMessage(lastError, t));
            return;
          }
          setState("idle");
          return;
        }
        void (async () => {
          let finalText = text;
          if (prefs.cleanupEnabled) {
            setState("transcribing");
            try {
              finalText = await cleanupRecognizedText({
                text,
                provider: prefs.provider,
                instructions: prefs.instructions,
                contextPack: await getVoiceContextPack(),
                resolvePath,
                replaceContext,
              });
            } catch {
              finalText = text;
            }
          }
          if (session !== sessionRef.current) return;
          if (finalText) onTranscriptRef.current(finalText);
          setState("idle");
        })();
      };

      startTimer();
      setState("recording");
      recognition.start();
    },
    [
      startMeter,
      startTimer,
      teardown,
      failWith,
      getVoiceContextPack,
      replaceContext,
      resolvePath,
      t,
    ],
  );

  const startGoogleRealtime = useCallback(
    async (session: number, prefs: VoicePrefs) => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (session !== sessionRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      const sessionRes = await fetch(resolvePath(GOOGLE_REALTIME_SESSION_URL), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language:
            (typeof navigator !== "undefined" && navigator.language) || "en-US",
        }),
      });
      // coercion-ok: an unreadable error body still fails with the status-coded message below.
      const sessionBody = (await sessionRes.json().catch(() => ({}))) as {
        websocketUrl?: string;
        websocketProtocol?: string;
        sessionToken?: string;
        error?: string;
      };
      if (
        !sessionRes.ok ||
        !sessionBody.websocketUrl ||
        !sessionBody.sessionToken
      ) {
        for (const track of stream.getTracks()) track.stop();
        throw new Error(
          sessionBody.error ||
            t("agentChat.voice.dictation.errors.googleRealtimeStartFailed", {
              status: sessionRes.status,
              defaultValue: `Could not start Google realtime transcription (${sessionRes.status}).`,
            }),
        );
      }
      if (session !== sessionRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      mediaStreamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      realtimeFinalRef.current = "";
      realtimeInterimRef.current = "";

      let finalized = false;
      let recorderStarted = false;
      const finish = (errorMessage?: string) => {
        if (finalized) return;
        finalized = true;
        void (async () => {
          if (session !== sessionRef.current) return;
          const finalText = realtimeFinalRef.current.trim();
          const interimText = realtimeInterimRef.current.trim();
          const text = [finalText, interimText]
            .filter(Boolean)
            .join(" ")
            .trim();
          teardown();
          if (text) {
            let cleanedText = text;
            if (prefs.cleanupEnabled) {
              setState("transcribing");
              try {
                cleanedText = await cleanupRecognizedText({
                  text,
                  provider: prefs.provider,
                  instructions: prefs.instructions,
                  contextPack: await getVoiceContextPack(),
                  resolvePath,
                  replaceContext,
                });
              } catch {
                cleanedText = text;
              }
            }
            if (session !== sessionRef.current) return;
            if (cleanedText) onTranscriptRef.current(cleanedText);
            setState("idle");
            return;
          }
          if (errorMessage) {
            failWith(errorMessage);
            return;
          }
          setState("idle");
        })();
      };

      recorder.ondataavailable = async (event) => {
        if (session !== sessionRef.current) return;
        if (!event.data || event.data.size === 0) return;
        const socket = realtimeSocketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        try {
          socket.send(await event.data.arrayBuffer());
        } catch (err) {
          finish(
            (err as Partial<Error> | null | undefined)?.message ??
              t("agentChat.voice.dictation.errors.googleRealtimeUploadFailed", {
                defaultValue: "Realtime audio upload failed.",
              }),
          );
        }
      };

      recorder.onstop = () => {
        if (session !== sessionRef.current) return;
        const socket = realtimeSocketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          finish();
          return;
        }
        setState("transcribing");
        try {
          socket.send(JSON.stringify({ type: "stop" }));
        } catch {
          finish();
          return;
        }
        realtimeStopTimeoutRef.current = window.setTimeout(() => {
          const activeSocket = realtimeSocketRef.current;
          if (activeSocket?.readyState === WebSocket.OPEN) {
            try {
              activeSocket.close();
            } catch {
              finish();
            }
            return;
          }
          finish();
        }, 10000);
      };

      const socket = new WebSocket(sessionBody.websocketUrl, [
        sessionBody.websocketProtocol || GOOGLE_REALTIME_WS_PROTOCOL,
        sessionBody.sessionToken,
      ]);
      socket.binaryType = "arraybuffer";
      realtimeSocketRef.current = socket;

      socket.onmessage = (event) => {
        if (session !== sessionRef.current) return;
        const raw =
          typeof event.data === "string"
            ? event.data
            : event.data instanceof Blob
              ? null
              : new TextDecoder().decode(event.data);
        if (!raw) return;
        let message:
          | {
              type?: string;
              text?: string;
              error?: string;
            }
          | undefined;
        try {
          message = JSON.parse(raw);
        } catch {
          return;
        }
        if (!message?.type) return;
        if (message.type === "ready") {
          if (!recorderStarted) {
            recorderStarted = true;
            startMeter(stream);
            startTimer();
            setState("recording");
            recorder.start(100);
          }
          return;
        }
        if (message.type === "partial") {
          realtimeInterimRef.current = (message.text ?? "").trim();
          onLiveUpdateRef.current?.(
            realtimeFinalRef.current,
            realtimeInterimRef.current,
          );
          return;
        }
        if (message.type === "final") {
          const next = (message.text ?? "").trim();
          if (next) {
            realtimeFinalRef.current = [realtimeFinalRef.current.trim(), next]
              .filter(Boolean)
              .join(" ");
          }
          realtimeInterimRef.current = "";
          onLiveUpdateRef.current?.(realtimeFinalRef.current, "");
          return;
        }
        if (message.type === "error") {
          finish(
            message.error ||
              t("agentChat.voice.dictation.errors.googleRealtimeFailed", {
                defaultValue: "Google realtime transcription failed.",
              }),
          );
          return;
        }
        if (message.type === "end") {
          finish();
        }
      };

      socket.onerror = () => {
        finish(
          t("agentChat.voice.dictation.errors.googleRealtimeConnectionFailed", {
            defaultValue: "Google realtime transcription lost its connection.",
          }),
        );
      };

      socket.onclose = () => {
        finish();
      };

      socket.onopen = () => {
        if (session !== sessionRef.current) return;
        try {
          socket.send(
            JSON.stringify({
              type: "start",
              language:
                (typeof navigator !== "undefined" && navigator.language) ||
                "en-US",
              interimResults: true,
              mimeType,
            }),
          );
        } catch (err) {
          finish(
            (err as Partial<Error> | null | undefined)?.message ??
              t("agentChat.voice.dictation.errors.googleRealtimeStreamFailed", {
                defaultValue: "Could not start the realtime stream.",
              }),
          );
        }
      };
    },
    [
      startMeter,
      startTimer,
      teardown,
      failWith,
      getVoiceContextPack,
      replaceContext,
      resolvePath,
      t,
    ],
  );

  const start = useCallback(async () => {
    if (state === "recording" || state === "starting") return;
    setErrorMessage(null);
    setState("starting");
    const session = ++sessionRef.current;

    const prefs = await readVoicePrefs(resolvePath);
    if (session !== sessionRef.current) return;
    const pref = prefs.provider;
    setProvider(pref);

    const resolvedProvider: VoiceProvider =
      pref === "auto" && speechSupported
        ? "browser"
        : pref === "auto" ||
            pref === "builder" ||
            pref === "builder-gemini" ||
            pref === "gemini" ||
            pref === "groq"
          ? "openai"
          : pref;
    activeProviderRef.current = resolvedProvider;

    try {
      if (resolvedProvider === "openai") {
        if (!mediaRecorderSupported) {
          throw new Error(
            t("agentChat.voice.dictation.errors.recordingUnsupported", {
              defaultValue:
                "Your browser doesn't support audio recording. Pick the browser option under Voice transcription in Settings.",
            }),
          );
        }
        await startOpenAi(session, pref, prefs.instructions);
      } else if (resolvedProvider === "google-realtime") {
        if (!mediaRecorderSupported) {
          throw new Error(
            t(
              "agentChat.voice.dictation.errors.googleRealtimeRecordingUnsupported",
              {
                defaultValue:
                  "Your browser doesn't support audio recording, so Google realtime transcription can't start.",
              },
            ),
          );
        }
        await startGoogleRealtime(session, prefs);
      } else {
        await startBrowser(
          session,
          prefs,
          pref === "auto" && mediaRecorderSupported
            ? (error) => {
                if (isMicPermissionError(error)) return false;
                activeProviderRef.current = "openai";
                setState("starting");
                void startOpenAi(session, "auto", prefs.instructions).catch(
                  (err) => failWith(voiceDictationStartErrorMessage(err, t)),
                );
                return true;
              }
            : undefined,
        );
      }
    } catch (err) {
      if (session !== sessionRef.current) return;
      failWith(voiceDictationStartErrorMessage(err, t));
    }
  }, [
    state,
    speechSupported,
    mediaRecorderSupported,
    startOpenAi,
    startGoogleRealtime,
    startBrowser,
    failWith,
    t,
  ]);

  const stop = useCallback(() => {
    if (state !== "recording") return;
    if (
      (activeProviderRef.current === "openai" ||
        activeProviderRef.current === "google-realtime") &&
      mediaRecorderRef.current
    ) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        teardown();
        setState("idle");
      }
    } else if (speechRef.current) {
      try {
        speechRef.current.stop();
      } catch {
        teardown();
        setState("idle");
      }
    } else {
      teardown();
      setState("idle");
    }
  }, [state, teardown]);

  const cancel = useCallback(() => {
    if (
      state !== "recording" &&
      state !== "starting" &&
      state !== "transcribing"
    )
      return;
    sessionRef.current += 1;
    if (
      (activeProviderRef.current === "openai" ||
        activeProviderRef.current === "google-realtime") &&
      mediaRecorderRef.current
    ) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        /* ignore */
      }
    } else if (speechRef.current) {
      try {
        speechRef.current.abort?.();
      } catch {
        /* ignore */
      }
    }
    teardown();
    setState("idle");
  }, [state, teardown]);

  const dismissError = useCallback(() => {
    setErrorMessage(null);
    if (state === "error") setState("idle");
  }, [state]);

  return {
    state,
    levels,
    durationMs,
    errorMessage,
    provider,
    supported,
    start,
    stop,
    cancel,
    dismissError,
  };
}
