import type { UnlistenFn } from "@tauri-apps/api/event";

import {
  appendFinalTranscript,
  onFinalTranscript,
  resetTranscriptionTimeline,
  startTranscriptionEngine,
  stopTranscriptionEngine,
  TranscriptionEngine,
  transcriptFullText,
  transcriptSegments,
  type SourcedTranscriptSegment,
  type TranscriptLine,
} from "./transcription-engine";

const WHISPER_STOP_SETTLE_MS = 1500;
const WEB_SPEECH_STOP_SETTLE_MS = 1200;
const WEB_SPEECH_RESTART_RETRY_BASE_MS = 400;
const WEB_SPEECH_MAX_RESTART_ATTEMPTS = 8;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function createActiveTimeline(now: () => number = Date.now) {
  let elapsedMs = 0;
  let running = true;
  let runningSinceMs = now();

  const current = () =>
    elapsedMs + (running ? Math.max(0, now() - runningSinceMs) : 0);

  return {
    current,
    pause(elapsedAtPauseMs: number = current()) {
      if (!running) return;
      elapsedMs = elapsedAtPauseMs;
      running = false;
    },
    resume() {
      if (running) return;
      runningSinceMs = now();
      running = true;
    },
    reset(shouldRun: boolean = true) {
      elapsedMs = 0;
      runningSinceMs = now();
      running = shouldRun;
    },
  };
}

export interface CapturedTranscript {
  text: string;
  segments: SourcedTranscriptSegment[];
  source?: "web-speech" | "macos-native" | "whisper";
  failureReason?: string;
}

export interface TranscriptionCapture {
  stop(): Promise<CapturedTranscript>;
  cancel(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  resetTimeline(): Promise<void>;
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
  let paused = false;
  const transcriptBuffer = createWebSpeechTranscriptBuffer();
  let stopResolver: ((value: CapturedTranscript) => void) | null = null;
  let settleTimer: ReturnType<typeof window.setTimeout> | null = null;
  let restartTimer: ReturnType<typeof window.setTimeout> | null = null;
  let restartFailures = 0;
  let failureReason: string | null = null;

  const captured = (): CapturedTranscript => ({
    text: transcriptBuffer.text(),
    segments: [],
    source: "web-speech",
    failureReason: failureReason ?? undefined,
  });

  const clearRestartTimer = () => {
    if (restartTimer === null) return;
    window.clearTimeout(restartTimer);
    restartTimer = null;
  };

  const scheduleRestart = (delayMs: number) => {
    if (restartTimer !== null) return;
    restartTimer = window.setTimeout(() => {
      restartTimer = null;
      if (disposed || stopped || paused) return;
      try {
        recognition.start();
        restartFailures = 0;
      } catch (err) {
        const attempt = ++restartFailures;
        if (attempt >= WEB_SPEECH_MAX_RESTART_ATTEMPTS) {
          failureReason =
            "Web Speech transcription stopped mid-recording and could not be restarted.";
          console.warn(
            "[clips-recorder] Web Speech transcription restart failed:",
            err,
          );
          return;
        }
        scheduleRestart(WEB_SPEECH_RESTART_RETRY_BASE_MS * attempt);
      }
    }, delayMs);
  };

  const settleStop = () => {
    if (!stopResolver) return;
    clearRestartTimer();
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
    failureReason ??= `Web Speech transcription dropped audio after a "${event.error}" error.`;
    console.warn(
      "[clips-recorder] Web Speech transcription error:",
      event.error,
    );
  };

  recognition.onend = () => {
    if (disposed) return;
    transcriptBuffer.commitSession({ preserveInterim: stopped || paused });
    if (stopped) {
      settleStop();
      return;
    }
    if (paused) return;
    scheduleRestart(0);
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
      clearRestartTimer();
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
    async pause() {
      if (disposed || stopped || paused) return;
      paused = true;
      console.log("[clips-recorder] transcription paused (web-speech)");
      try {
        recognition.stop();
      } catch {
        // ignore
      }
    },
    async resume() {
      if (disposed || stopped || !paused) return;
      paused = false;
      restartFailures = 0;
      console.log("[clips-recorder] transcription resumed (web-speech)");
      try {
        recognition.start();
      } catch {
        failureReason ??=
          "Web Speech transcription dropped audio while resuming after a pause.";
        scheduleRestart(WEB_SPEECH_RESTART_RETRY_BASE_MS);
      }
    },
    async resetTimeline() {
      // Web Speech does not emit timestamped segments.
    },
  };
}

export const __test = {
  createActiveTimeline,
  createWebSpeechTranscriptBuffer,
  startBrowserTranscriptionCapture,
};

export function shouldStartLocalRecordingTranscription(
  microphoneEnabled: boolean,
): boolean {
  return microphoneEnabled;
}

export async function startTranscriptionCapture(
  mic?: {
    deviceId?: string | null;
    label?: string | null;
  },
  captureSystem: boolean = true,
  opts?: {
    voiceProcessing?: boolean;
  },
): Promise<TranscriptionCapture | null> {
  const lines: TranscriptLine[] = [];
  let disposed = false;
  let paused = false;
  let desiredPaused = false;
  let transitioning = false;
  let pauseFinalsSettleUntil = 0;
  let transitionFailure: string | null = null;
  const unlistens: UnlistenFn[] = [];
  const timeline = createActiveTimeline();

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
    text: transcriptFullText(lines),
    segments: transcriptSegments(lines),
    source: engine,
    failureReason: transitionFailure ?? undefined,
  });

  let engine: TranscriptionEngine;
  try {
    unlistens.push(
      await onFinalTranscript((event) => {
        if (disposed) return;
        appendFinalTranscript(event, lines);
      }),
    );

    engine = await startTranscriptionEngine({
      mic,
      captureSystem,
      voiceProcessing: opts?.voiceProcessing,
      emitPartials: false,
    });
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

  const applyAudioState = async () => {
    if (transitioning || disposed || desiredPaused === paused) return;
    transitioning = true;
    try {
      if (desiredPaused) {
        const pauseBoundaryMs = timeline.current();
        await stopTranscriptionEngine(engine);
        timeline.pause(pauseBoundaryMs);
        paused = true;
        pauseFinalsSettleUntil = Date.now() + WHISPER_STOP_SETTLE_MS;
        console.log(`[clips-recorder] transcription paused (${engine})`);
      } else {
        const nextEngine = await startTranscriptionEngine({
          mic,
          captureSystem,
          voiceProcessing: opts?.voiceProcessing,
          emitPartials: false,
        });
        if (disposed) {
          await stopTranscriptionEngine(nextEngine).catch(() => {});
          return;
        }
        try {
          await resetTranscriptionTimeline(nextEngine, timeline.current());
        } catch (err) {
          await stopTranscriptionEngine(nextEngine).catch(() => {});
          throw err;
        }
        if (disposed) {
          await stopTranscriptionEngine(nextEngine).catch(() => {});
          return;
        }
        engine = nextEngine;
        timeline.resume();
        paused = false;
        console.log(`[clips-recorder] transcription resumed (${engine})`);
      }
    } catch (err) {
      transitionFailure = `Local transcription ${desiredPaused ? "pause" : "resume"} failed; engine still ${paused ? "paused" : "live"}.`;
      console.warn(
        `[clips-recorder] transcription ${desiredPaused ? "pause" : "resume"} failed; engine still ${paused ? "paused" : "live"}:`,
        err,
      );
      return;
    } finally {
      transitioning = false;
    }
    transitionFailure = null;
    void applyAudioState();
  };

  return {
    async stop() {
      if (paused) {
        const remaining = pauseFinalsSettleUntil - Date.now();
        if (remaining > 0) await wait(remaining);
        cleanup();
        return captured();
      }
      try {
        await stopTranscriptionEngine(engine);
      } catch (err) {
        console.warn("[clips-recorder] transcription stop failed:", err);
        cleanup();
        return captured();
      }
      await wait(WHISPER_STOP_SETTLE_MS);
      cleanup();
      return captured();
    },
    async cancel() {
      if (!paused) {
        try {
          await stopTranscriptionEngine(engine);
        } catch {
          // ignore
        }
      }
      cleanup();
    },
    async pause() {
      if (disposed) return;
      desiredPaused = true;
      await applyAudioState();
    },
    async resume() {
      if (disposed) return;
      desiredPaused = false;
      await applyAudioState();
    },
    async resetTimeline() {
      timeline.reset(!desiredPaused);
      await resetTranscriptionTimeline(engine, timeline.current());
    },
  };
}
