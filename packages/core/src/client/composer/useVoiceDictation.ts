/**
 * Voice dictation hook for the agent composer.
 *
 * Wires voice providers behind a single state machine:
 *   - "openai" / "builder" / "builder-gemini" / "gemini" / "groq"
 *     — MediaRecorder → POST /_agent-native/transcribe-voice
 *   - "browser" — Web Speech API (low quality, offline capable)
 *
 * Provider preference lives in application_state under
 * `voice-transcription-prefs` (`{ provider: VoiceProvider, instructions?: string }`).
 * The composer reads it on every start so settings changes take effect
 * immediately without unmounting the composer.
 *
 * The hook exposes amplitude (0..1) and duration (ms) so the composer can
 * render the Lovable-style live waveform + MM:SS timer.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { agentNativePath } from "../api-path.js";

export type VoiceProvider =
  | "openai"
  | "browser"
  | "builder-gemini"
  | "builder"
  | "gemini"
  | "groq";

export interface VoicePrefs {
  provider: VoiceProvider;
  instructions?: string;
}

const PREFS_KEY = "voice-transcription-prefs";
const PREFS_URL = agentNativePath(
  `/_agent-native/application-state/${PREFS_KEY}`,
);
const TRANSCRIBE_URL = agentNativePath("/_agent-native/transcribe-voice");
const PROVIDER_STATUS_URL = agentNativePath(
  "/_agent-native/voice-providers/status",
);

interface ProviderStatus {
  builder?: boolean;
}

function isVoiceProvider(value: unknown): value is VoiceProvider {
  return (
    value === "openai" ||
    value === "browser" ||
    value === "builder-gemini" ||
    value === "builder" ||
    value === "gemini" ||
    value === "groq"
  );
}

async function defaultProvider(): Promise<VoiceProvider> {
  try {
    const res = await fetch(PROVIDER_STATUS_URL);
    if (!res.ok) return "browser";
    const status = (await res.json()) as ProviderStatus | null;
    if (status?.builder) return "builder-gemini";
  } catch {
    /* fall through */
  }
  return "browser";
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
}

async function readVoicePrefs(): Promise<VoicePrefs> {
  try {
    const res = await fetch(PREFS_URL);
    if (!res.ok) return { provider: await defaultProvider() };
    const body = (await res.json()) as
      | VoicePrefs
      | { value?: VoicePrefs }
      | null;
    const p =
      (body as VoicePrefs | null)?.provider ??
      (body as { value?: VoicePrefs } | null)?.value?.provider;
    const instructions =
      (body as VoicePrefs | null)?.instructions ??
      (body as { value?: VoicePrefs } | null)?.value?.instructions;
    if (isVoiceProvider(p)) {
      return {
        provider: p === "builder" ? "builder-gemini" : p,
        instructions:
          typeof instructions === "string" ? instructions.trim() : undefined,
      };
    }
  } catch {
    /* fall through */
  }
  return { provider: await defaultProvider() };
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

export function useVoiceDictation(
  options: UseVoiceDictationOptions,
): VoiceDictationApi {
  const { onTranscript, onError, onLiveUpdate } = options;
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  const onLiveUpdateRef = useRef(onLiveUpdate);
  onTranscriptRef.current = onTranscript;
  onErrorRef.current = onError;
  onLiveUpdateRef.current = onLiveUpdate;

  const [state, setState] = useState<VoiceState>("idle");
  const [amplitude, setAmplitude] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [provider, setProvider] = useState<VoiceProvider>("browser");

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
    analyserRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    speechRef.current = null;
    speechTranscriptRef.current = "";
    liveTextRef.current = "";
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
          const data = (await res.json()) as { text?: string };
          const text = (data.text ?? "").trim();
          if (text) {
            onTranscriptRef.current?.(text);
          } else if (liveSnapshot) {
            onTranscriptRef.current?.(liveSnapshot.trim());
          }
          setState("idle");
        } catch (err) {
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
    [startMeter, startTimer, teardown, failWith],
  );

  const startBrowser = useCallback(async () => {
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
      failWith(
        event?.error === "not-allowed"
          ? "Microphone permission denied. Enable it in your browser settings."
          : `Speech recognition error: ${event?.error ?? "unknown"}`,
      );
    };
    recognition.onend = () => {
      const text = speechTranscriptRef.current.trim();
      const wasCancelled = cancelledRef.current;
      cancelledRef.current = false;
      teardown();
      if (!wasCancelled && text) onTranscriptRef.current?.(text);
      setState("idle");
    };

    startTimer();
    setState("recording");
    recognition.start();
  }, [startMeter, startTimer, teardown, failWith]);

  const start = useCallback(async () => {
    if (state === "recording" || state === "starting") return;
    setErrorMessage(null);
    setState("starting");
    cancelledRef.current = false;

    const prefs = await readVoicePrefs();
    const pref = prefs.provider;
    setProvider(pref);

    // Server providers all use the same client-side flow as "openai"
    // (MediaRecorder -> POST to /_agent-native/transcribe-voice).
    // The server route handles routing to the right backend.
    const resolvedProvider: VoiceProvider =
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
      } else {
        await startBrowser();
      }
    } catch (err) {
      const message =
        (err as Error)?.name === "NotAllowedError"
          ? "Microphone permission denied. Enable it in your browser settings."
          : ((err as Error)?.message ?? "Could not start recording");
      failWith(message);
    }
  }, [state, mediaRecorderSupported, startOpenAi, startBrowser, failWith]);

  const stop = useCallback(() => {
    if (state !== "recording") return;
    cancelledRef.current = false;
    if (activeProviderRef.current === "openai" && mediaRecorderRef.current) {
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
    if (state !== "recording" && state !== "starting") return;
    cancelledRef.current = true;
    if (activeProviderRef.current === "openai" && mediaRecorderRef.current) {
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
  };
}
