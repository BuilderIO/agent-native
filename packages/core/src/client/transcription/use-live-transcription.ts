/**
 * Live transcription hook — runs the browser's Web Speech API alongside
 * any recording to produce an instant transcript with no API key required.
 *
 * Designed to pair with a MediaRecorder: start when recording begins,
 * stop when the user hits stop. The accumulated transcript is available
 * immediately — no round-trip to Whisper needed.
 *
 * Higher-quality backends (Groq Whisper, OpenAI Whisper, Deepgram) can
 * refine the result afterward, but this gives users something useful
 * from second zero even without an API key.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const NETWORK_RESTART_BASE_MS = 1_000;
const NETWORK_RESTART_MAX_MS = 30_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSpeechRecognitionCtor(): any {
  if (typeof window === "undefined") return null;
  return (
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition ||
    null
  );
}

export interface UseLiveTranscriptionOptions {
  lang?: string;
}

export interface LiveTranscriptionApi {
  supported: boolean;
  isActive: boolean;
  /** Accumulated final transcript text so far. */
  transcript: string;
  /** Current interim (unconfirmed) text being spoken. */
  interimText: string;
  start: () => void;
  stop: () => string;
  stopAndWait: (timeoutMs?: number) => Promise<string>;
  pause: () => void;
  resume: () => void;
}

export function useLiveTranscription(
  options?: UseLiveTranscriptionOptions,
): LiveTranscriptionApi {
  const lang =
    options?.lang ??
    (typeof navigator !== "undefined" ? navigator.language : "en-US");

  const [isActive, setIsActive] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimText, setInterimText] = useState("");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef("");
  const stoppedManuallyRef = useRef(false);
  const stopWaiterRef = useRef<((text: string) => void) | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const networkErrorCountRef = useRef(0);
  const restartDelayRef = useRef(0);

  const supported = !!getSpeechRecognitionCtor();

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    // Clean up any prior session.
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        /* ignore */
      }
    }

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognitionRef.current = recognition;
    transcriptRef.current = "";
    stoppedManuallyRef.current = false;
    networkErrorCountRef.current = 0;
    restartDelayRef.current = 0;
    setTranscript("");
    setInterimText("");

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          transcriptRef.current += text;
          setTranscript(transcriptRef.current);
        } else {
          interim += text;
        }
      }
      setInterimText(interim);
      if (event.results.length > 0) {
        networkErrorCountRef.current = 0;
        restartDelayRef.current = 0;
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      if (
        event.error === "not-allowed" ||
        event.error === "service-not-allowed" ||
        event.error === "audio-capture"
      ) {
        stoppedManuallyRef.current = true;
        setIsActive(false);
        return;
      }
      if (event.error === "network") {
        const retryIndex = networkErrorCountRef.current++;
        restartDelayRef.current = Math.min(
          NETWORK_RESTART_BASE_MS * 2 ** retryIndex,
          NETWORK_RESTART_MAX_MS,
        );
      }
      console.warn("[live-transcription] error:", event.error);
    };

    recognition.onend = () => {
      // Web Speech sometimes stops on its own (silence timeout, network
      // hiccup). Restart automatically unless we stopped intentionally.
      if (
        !stoppedManuallyRef.current &&
        recognitionRef.current === recognition
      ) {
        const restart = () => {
          restartTimerRef.current = null;
          if (
            stoppedManuallyRef.current ||
            recognitionRef.current !== recognition
          ) {
            return;
          }
          try {
            recognition.start();
          } catch {
            setIsActive(false);
          }
        };
        const delayMs = restartDelayRef.current;
        restartDelayRef.current = 0;
        if (delayMs > 0) {
          restartTimerRef.current = window.setTimeout(restart, delayMs);
        } else {
          restart();
        }
        return;
      }
      setIsActive(false);
      if (stopWaiterRef.current) {
        stopWaiterRef.current(transcriptRef.current);
      }
    };

    try {
      recognition.start();
      setIsActive(true);
    } catch {
      /* browser may block without user gesture */
    }
  }, [lang]);

  const stop = useCallback((): string => {
    stoppedManuallyRef.current = true;
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    setInterimText("");
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    }
    setIsActive(false);
    return transcriptRef.current;
  }, []);

  const stopAndWait = useCallback((timeoutMs = 1200): Promise<string> => {
    stoppedManuallyRef.current = true;
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    setInterimText("");

    const recognition = recognitionRef.current;
    if (!recognition) {
      setIsActive(false);
      return Promise.resolve(transcriptRef.current);
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (text: string) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        if (stopWaiterRef.current === finish) {
          stopWaiterRef.current = null;
        }
        if (recognitionRef.current === recognition) {
          recognitionRef.current = null;
        }
        setIsActive(false);
        resolve(text);
      };

      const timeout = window.setTimeout(() => {
        finish(transcriptRef.current);
      }, timeoutMs);

      stopWaiterRef.current = finish;
      try {
        recognition.stop();
      } catch {
        finish(transcriptRef.current);
      }
    });
  }, []);

  const pause = useCallback(() => {
    if (!recognitionRef.current) return;
    stoppedManuallyRef.current = true;
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    try {
      recognitionRef.current.stop();
    } catch {
      /* ignore */
    }
  }, []);

  const resume = useCallback(() => {
    if (!recognitionRef.current) return;
    stoppedManuallyRef.current = false;
    try {
      recognitionRef.current.start();
      setIsActive(true);
    } catch {
      /* ignore */
    }
  }, []);

  // Clean up on unmount
  const startRef = useRef(start);
  const stopRef = useRef(stop);
  startRef.current = start;
  stopRef.current = stop;

  useEffect(() => {
    return () => {
      stopRef.current();
    };
  }, []);

  return {
    supported,
    isActive,
    transcript,
    interimText,
    start,
    stop,
    stopAndWait,
    pause,
    resume,
  };
}
