/**
 * Live transcription for recordings.
 *
 * Thin wrapper over the shared transcription engines. It tries local
 * whisper.cpp/macOS speech first (mic + optional system audio), then falls
 * back to Web Speech in the desktop webview when the local Rust engine is not
 * available (notably non-mac builds).
 *
 * The handle exposes `stop()` (returns the full speaker-labelled transcript,
 * after a short grace for trailing finals) and `cancel()` (stops + discards).
 */

import type { UnlistenFn } from "@tauri-apps/api/event";

import {
  appendFinalTranscript,
  onFinalTranscript,
  startTranscriptionEngine,
  stopTranscriptionEngine,
  TranscriptionEngine,
  type SourcedTranscriptSegment,
} from "./transcription-engine";

/** Grace period after stop for whisper to emit any flushed trailing finals. */
const WHISPER_STOP_SETTLE_MS = 1500;
const WEB_SPEECH_STOP_SETTLE_MS = 1200;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export interface CapturedTranscript {
  /** Speaker-labelled text, lines joined by blank lines. */
  text: string;
  /** Real whisper segments with verbatim timestamps. */
  segments: SourcedTranscriptSegment[];
  /** Source stored with `save-browser-transcript`. */
  source?: "web-speech" | "macos-native" | "whisper";
}

export interface TranscriptionCapture {
  stop(): Promise<CapturedTranscript>;
  cancel(): Promise<void>;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0?: { transcript?: string };
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function browserLanguage(): string {
  return navigator.language || "en-US";
}

function shouldUseBrowserTranscriptionFallback(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ||
    navigator.platform ||
    navigator.userAgent;

  // Keep macOS on the existing local Whisper -> SFSpeech path. Web Speech is
  // only a bridge for non-mac desktop builds where the Rust engines are absent.
  return !/mac/i.test(platform);
}

function appendTranscriptText(current: string, next: string): string {
  const cleanCurrent = current.trim();
  const cleanNext = next.trim();
  if (!cleanNext) return cleanCurrent;
  if (!cleanCurrent) return cleanNext;
  return `${cleanCurrent} ${cleanNext}`;
}

function createWebSpeechTranscriptBuffer() {
  let committedFinalText = "";
  let sessionFinalText = "";
  let interimText = "";

  return {
    update(event: SpeechRecognitionEventLike) {
      let nextFinal = "";
      let nextInterim = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          nextFinal += text;
        } else {
          nextInterim += text;
        }
      }
      sessionFinalText = nextFinal;
      interimText = nextInterim;
    },
    commitSession(opts?: { preserveInterim?: boolean }) {
      committedFinalText = appendTranscriptText(
        committedFinalText,
        sessionFinalText,
      );
      sessionFinalText = "";
      if (!opts?.preserveInterim) {
        interimText = "";
      }
    },
    text() {
      return [committedFinalText, sessionFinalText, interimText]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" ")
        .trim();
    },
  };
}

async function startBrowserTranscriptionCapture(): Promise<TranscriptionCapture | null> {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;

  const recognition = new Ctor();
  let disposed = false;
  let stopped = false;
  const transcriptBuffer = createWebSpeechTranscriptBuffer();
  let stopResolver: ((value: CapturedTranscript) => void) | null = null;
  let settleTimer: ReturnType<typeof window.setTimeout> | null = null;

  const captured = (): CapturedTranscript => ({
    text: transcriptBuffer.text(),
    segments: [],
    source: "web-speech",
  });

  const settleStop = () => {
    if (!stopResolver) return;
    if (settleTimer) {
      window.clearTimeout(settleTimer);
      settleTimer = null;
    }
    const resolve = stopResolver;
    stopResolver = null;
    disposed = true;
    resolve(captured());
  };

  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = browserLanguage();
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    transcriptBuffer.update(event);
  };

  recognition.onerror = (event) => {
    if (event.error === "no-speech" || event.error === "aborted") return;
    console.warn(
      "[clips-recorder] Web Speech transcription error:",
      event.error,
    );
  };

  recognition.onend = () => {
    if (disposed) return;
    transcriptBuffer.commitSession({ preserveInterim: stopped });
    if (stopped) {
      settleStop();
      return;
    }
    try {
      recognition.start();
    } catch (err) {
      console.warn(
        "[clips-recorder] Web Speech transcription restart failed:",
        err,
      );
    }
  };

  try {
    recognition.start();
    console.log("[clips-recorder] transcription started (web-speech mic)");
  } catch (err) {
    console.warn("[clips-recorder] Web Speech transcription unavailable:", err);
    disposed = true;
    return null;
  }

  return {
    stop() {
      stopped = true;
      return new Promise<CapturedTranscript>((resolve) => {
        stopResolver = resolve;
        settleTimer = window.setTimeout(settleStop, WEB_SPEECH_STOP_SETTLE_MS);
        try {
          recognition.stop();
        } catch {
          settleStop();
        }
      });
    },
    async cancel() {
      disposed = true;
      stopped = true;
      if (settleTimer) {
        window.clearTimeout(settleTimer);
        settleTimer = null;
      }
      try {
        recognition.abort();
      } catch {
        // ignore
      }
    },
  };
}

export const __test = { createWebSpeechTranscriptBuffer };

export async function startTranscriptionCapture(
  mic?: {
    deviceId?: string | null;
    label?: string | null;
  },
  captureSystem: boolean = true,
): Promise<TranscriptionCapture | null> {
  const lines: string[] = [];
  const segments: SourcedTranscriptSegment[] = [];
  let disposed = false;
  const unlistens: UnlistenFn[] = [];

  const cleanup = () => {
    disposed = true;
    unlistens.splice(0).forEach((unlisten) => {
      try {
        unlisten();
      } catch {
        // ignore
      }
    });
  };

  const captured = (): CapturedTranscript => ({
    text: lines.join("\n\n").trim(),
    segments,
  });

  let engine: TranscriptionEngine;
  try {
    unlistens.push(
      await onFinalTranscript((event) => {
        if (disposed) return;
        appendFinalTranscript(event, lines, segments);
      }),
    );

    engine = await startTranscriptionEngine({ mic, captureSystem });
    console.log(
      `[clips-recorder] transcription started (${engine} mic${captureSystem ? "+system" : ""})`,
    );
  } catch (err) {
    cleanup();
    console.warn("[clips-recorder] whisper transcript unavailable:", err);
    return shouldUseBrowserTranscriptionFallback()
      ? startBrowserTranscriptionCapture()
      : null;
  }

  return {
    async stop() {
      try {
        await stopTranscriptionEngine(engine);
      } catch (err) {
        console.warn("[clips-recorder] transcription stop failed:", err);
        cleanup();
        return captured();
      }
      // Whisper flushes trailing speech on stop; give the finals time to land.
      await wait(WHISPER_STOP_SETTLE_MS);
      cleanup();
      return captured();
    },
    async cancel() {
      try {
        await stopTranscriptionEngine(engine);
      } catch {
        // ignore
      }
      cleanup();
    },
  };
}
