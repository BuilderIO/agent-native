/**
 * Voice dictation hook for the agent composer.
 *
 * Wires voice providers behind a single state machine:
 *   - "auto" / "openai" / "builder" / "builder-gemini" / "gemini" / "groq"
 *     — MediaRecorder → POST /_agent-native/transcribe-voice
 *   - "google-realtime"
 *     — MediaRecorder chunks → POST /_agent-native/transcribe-stream/session
 *       → managed WebSocket → Google Speech-to-Text streaming
 *   - "browser" — Web Speech API (low quality, offline capable)
 *
 * Provider preference lives in application_state under
 * `voice-transcription-prefs` (`{ transcriptionMode, provider, instructions }`).
 * The composer reads it on every start so settings changes take effect
 * immediately without unmounting the composer.
 *
 * The hook exposes amplitude (0..1) and duration (ms) so the composer can
 * render the Lovable-style live waveform + MM:SS timer.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  applyVoiceContextReplacements,
  type VoiceContextPack,
} from "../../voice/index.js";
import { agentNativePath } from "../api-path.js";

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
const PREFS_URL = agentNativePath(
  `/_agent-native/application-state/${PREFS_KEY}`,
);
const CLEANUP_PREFS_URL = agentNativePath(
  `/_agent-native/application-state/${CLEANUP_PREFS_KEY}`,
);
const TRANSCRIBE_URL = agentNativePath("/_agent-native/transcribe-voice");
const GOOGLE_REALTIME_SESSION_URL = agentNativePath(
  "/_agent-native/transcribe-stream/session",
);
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
  /** Called with (accumulatedFinalText, currentInterimText) as speech is recognized in real time. */
  onLiveUpdate?: (finalText: string, interimText: string) => void;
  contextPack?: VoiceContextPackSource;
}

export interface VoiceDictationApi {
  state: VoiceState;
  amplitude: number;
  durationMs: number;
  errorMessage: string | null;
  provider: VoiceProvider;
  supported: boolean;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
  dismissError: () => void;
}

async function readVoicePrefs(): Promise<VoicePrefs> {
  const cleanupPrefs = await readVoiceCleanupPrefs();
  try {
    const res = await fetch(PREFS_URL);
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

async function readVoiceCleanupPrefs(): Promise<VoiceCleanupPrefs> {
  try {
    const res = await fetch(CLEANUP_PREFS_URL);
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
}: {
  text: string;
  provider: VoiceProvider;
  instructions?: string;
  contextPack?: VoiceContextPack;
}): Promise<string> {
  if (provider === "browser") {
    return applyVoiceContextReplacements(text, contextPack);
  }

  const form = new FormData();
  form.append("text", text);
  form.append("provider", providerForTextCleanup(provider));
  if (instructions?.trim()) {
    form.append("instructions", instructions.trim());
  }
  appendVoiceContext(form, contextPack);

  const res = await fetch(TRANSCRIBE_URL, {
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

export function voiceDictationStartErrorMessage(error: unknown): string {
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
    return "This app is blocking microphone access through its browser permissions policy. Reload the app, or open it directly in a browser tab.";
  }

  if (
    name === "NotAllowedError" ||
    name === "SecurityError" ||
    /permission|denied|not allowed/i.test(message)
  ) {
    return "Microphone access is blocked. Click the site controls icon in the address bar, set Microphone to Allow for this app, then try again.";
  }

  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone was found. Plug one in or choose a different input, then try again.";
  }

  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Your microphone is busy in another app. Close the other app or choose a different input, then try again.";
  }

  return message || "Could not start recording";
}

function voiceDictationSpeechErrorMessage(error: string | undefined): string {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return voiceDictationStartErrorMessage({
      name: "NotAllowedError",
      message: error,
    });
  }
  if (error === "audio-capture") {
    return "No microphone was found. Plug one in or choose a different input, then try again.";
  }
  return `Speech recognition error: ${error ?? "unknown"}`;
}

export function useVoiceDictation(
  options: UseVoiceDictationOptions,
): VoiceDictationApi {
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
  const [amplitude, setAmplitude] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [provider, setProvider] = useState<VoiceProvider>("auto");

  // Keep refs for teardown / cross-branch access.
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);
  const cancelledRef = useRef(false);
  const speechRef = useRef<any>(null);
  const speechTranscriptRef = useRef<string>("");
  const activeProviderRef = useRef<VoiceProvider>("browser");
  // Parallel live recognition for OpenAI mode (provides instant preview while MediaRecorder captures)
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
      // Stop the Web Speech session before dropping the ref so the browser
      // releases the mic and stops dispatching onresult events into a stale
      // closure. abort() is fire-and-forget (no final result); stop() would
      // deliver remaining partials but we've already cleared state.
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
    setAmplitude(0);
  }, []);

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

  const startMeter = useCallback((stream: MediaStream) => {
    try {
      const AudioCtor =
        typeof window !== "undefined"
          ? window.AudioContext || (window as any).webkitAudioContext || null
          : null;
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
        let sumSquares = 0;
        for (let i = 0; i < buffer.length; i++) {
          const n = (buffer[i] - 128) / 128;
          sumSquares += n * n;
        }
        const rms = Math.sqrt(sumSquares / buffer.length);
        setAmplitude(Math.min(1, rms * 2.5));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      /* analyser is best-effort */
    }
  }, []);

  const startTimer = useCallback(() => {
    startedAtRef.current = Date.now();
    setDurationMs(0);
    timerRef.current = setInterval(() => {
      setDurationMs(Date.now() - startedAtRef.current);
    }, 100);
  }, []);

  const startOpenAi = useCallback(
    async (providerPref: VoiceProvider, instructions?: string) => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // User may have pressed Escape (cancel) while the permission prompt was
      // open. If so, stop the stream and bail before we start recording.
      if (cancelledRef.current) {
        for (const track of stream.getTracks()) track.stop();
        cancelledRef.current = false;
        setState("idle");
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
        const localChunks = chunksRef.current.slice();
        const localMime = recorder.mimeType || mimeType;
        const liveSnapshot = liveTextRef.current;
        teardown();
        if (cancelledRef.current) {
          cancelledRef.current = false;
          setState("idle");
          return;
        }
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
          const res = await fetch(TRANSCRIBE_URL, {
            method: "POST",
            body: form,
          });
          if (!res.ok) {
            const body = await res
              .json()
              .catch(() => ({ error: `HTTP ${res.status}` }));
            throw new Error(
              body.error || `Transcription failed (${res.status})`,
            );
          }
          if (cancelledRef.current) {
            cancelledRef.current = false;
            setState("idle");
            return;
          }
          const data = (await res.json()) as { text?: string };
          const text = (data.text ?? "").trim();
          if (text) {
            onTranscriptRef.current?.(text);
          } else if (liveSnapshot) {
            onTranscriptRef.current?.(liveSnapshot.trim());
          }
          setState("idle");
        } catch (err) {
          if (cancelledRef.current) {
            cancelledRef.current = false;
            setState("idle");
            return;
          }
          if (liveSnapshot) {
            onTranscriptRef.current?.(liveSnapshot.trim());
            setState("idle");
          } else {
            failWith(
              (err as Error)?.message ??
                "Transcription failed. Check your voice transcription provider in settings.",
            );
          }
        }
      };

      startMeter(stream);
      startTimer();
      setState("recording");
      recorder.start();

      // Start parallel Web Speech recognition for live preview text.
      // This runs alongside MediaRecorder so the user sees words appear
      // immediately while the server provider processes the full recording later.
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
    [startMeter, startTimer, teardown, failWith, getVoiceContextPack],
  );

  const startBrowser = useCallback(
    async (prefs: VoicePrefs) => {
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) {
        throw new Error(
          "Your browser doesn't support speech recognition. Add an OpenAI API key in settings for Whisper transcription.",
        );
      }
      // Still request mic to drive the amplitude meter, so the UI doesn't look
      // dead while the user talks. SpeechRecognition manages its own capture
      // under the hood in most browsers.
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        startMeter(stream);
      } catch {
        /* non-fatal — recognition can still work without our analyser */
      }

      if (cancelledRef.current) {
        if (stream) for (const track of stream.getTracks()) track.stop();
        mediaStreamRef.current = null;
        cancelledRef.current = false;
        setState("idle");
        return;
      }

      const recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang =
        (typeof navigator !== "undefined" && navigator.language) || "en-US";
      speechRef.current = recognition;
      speechTranscriptRef.current = "";

      recognition.onresult = (event: any) => {
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
        if (event?.error === "no-speech" || event?.error === "aborted") return;
        failWith(voiceDictationSpeechErrorMessage(event?.error));
      };
      recognition.onend = () => {
        const text = speechTranscriptRef.current.trim();
        const wasCancelled = cancelledRef.current;
        cancelledRef.current = false;
        teardown();
        if (wasCancelled || !text) {
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
              });
            } catch {
              finalText = text;
            }
          }
          if (!cancelledRef.current && finalText) {
            onTranscriptRef.current?.(finalText);
          }
          cancelledRef.current = false;
          setState("idle");
        })();
      };

      startTimer();
      setState("recording");
      recognition.start();
    },
    [startMeter, startTimer, teardown, failWith, getVoiceContextPack],
  );

  const startGoogleRealtime = useCallback(
    async (prefs: VoicePrefs) => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (cancelledRef.current) {
        for (const track of stream.getTracks()) track.stop();
        cancelledRef.current = false;
        setState("idle");
        return;
      }

      const sessionRes = await fetch(GOOGLE_REALTIME_SESSION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language:
            (typeof navigator !== "undefined" && navigator.language) || "en-US",
        }),
      });
      const sessionBody = (await sessionRes
        .json()
        .catch(() => ({ error: `HTTP ${sessionRes.status}` }))) as {
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
            `Could not start Google realtime transcription (${sessionRes.status})`,
        );
      }
      if (cancelledRef.current) {
        for (const track of stream.getTracks()) track.stop();
        cancelledRef.current = false;
        setState("idle");
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
          const finalText = realtimeFinalRef.current.trim();
          const interimText = realtimeInterimRef.current.trim();
          const text = [finalText, interimText]
            .filter(Boolean)
            .join(" ")
            .trim();
          teardown();
          if (cancelledRef.current) {
            cancelledRef.current = false;
            setState("idle");
            return;
          }
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
                });
              } catch {
                cleanedText = text;
              }
            }
            if (!cancelledRef.current && cleanedText) {
              onTranscriptRef.current?.(cleanedText);
            }
            cancelledRef.current = false;
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
        if (!event.data || event.data.size === 0) return;
        const socket = realtimeSocketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        try {
          socket.send(await event.data.arrayBuffer());
        } catch (err) {
          finish((err as Error)?.message ?? "Realtime audio upload failed");
        }
      };

      recorder.onstop = () => {
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
        if (cancelledRef.current) {
          finish();
          return;
        }
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
          finish(message.error || "Google realtime transcription failed");
          return;
        }
        if (message.type === "end") {
          finish();
        }
      };

      socket.onerror = () => {
        finish("Google realtime transcription connection failed");
      };

      socket.onclose = () => {
        finish();
      };

      socket.onopen = () => {
        if (cancelledRef.current) {
          finish();
          return;
        }
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
          finish((err as Error)?.message ?? "Could not start realtime stream");
        }
      };
    },
    [startMeter, startTimer, teardown, failWith, getVoiceContextPack],
  );

  const start = useCallback(async () => {
    if (state === "recording" || state === "starting") return;
    setErrorMessage(null);
    setState("starting");
    cancelledRef.current = false;

    const prefs = await readVoicePrefs();
    const pref = prefs.provider;
    setProvider(pref);

    // In "auto" mode, prefer browser-native SpeechRecognition when available.
    // It requires no server-side API key, streams words incrementally into the
    // composer, and matches the macros-app record-button experience. Fall back
    // to the server upload path only when SpeechRecognition isn't supported.
    // Explicit server providers (builder, gemini, groq, openai) always use the
    // MediaRecorder → server upload path regardless.
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
            "Your browser doesn't support audio recording. Use the browser provider in Settings → Voice Transcription.",
          );
        }
        await startOpenAi(pref, prefs.instructions);
      } else if (resolvedProvider === "google-realtime") {
        if (!mediaRecorderSupported) {
          throw new Error(
            "Your browser doesn't support audio recording, so Google realtime transcription can't start.",
          );
        }
        await startGoogleRealtime(prefs);
      } else {
        await startBrowser(prefs);
      }
    } catch (err) {
      if (cancelledRef.current) {
        cancelledRef.current = false;
        teardown();
        setState("idle");
        return;
      }
      failWith(voiceDictationStartErrorMessage(err));
    }
  }, [
    state,
    speechSupported,
    mediaRecorderSupported,
    startOpenAi,
    startGoogleRealtime,
    startBrowser,
    failWith,
  ]);

  const stop = useCallback(() => {
    if (state !== "recording") return;
    cancelledRef.current = false;
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
    cancelledRef.current = true;
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

  // Auto-dismiss error after 8s so a stale "permission denied" message doesn't
  // sit forever after the user fixes the underlying permission. Manual dismiss
  // (via dismissError) and click-to-retry both also clear the error sooner.
  useEffect(() => {
    if (state !== "error") return;
    const handle = setTimeout(() => {
      setErrorMessage(null);
      setState("idle");
    }, 8000);
    return () => clearTimeout(handle);
  }, [state]);

  const dismissError = useCallback(() => {
    setErrorMessage(null);
    if (state === "error") setState("idle");
  }, [state]);

  return {
    state,
    amplitude,
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
