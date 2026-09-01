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
  resetTranscriptionTimeline,
  startTranscriptionEngine,
  stopTranscriptionEngine,
  TranscriptionEngine,
  transcriptFullText,
  transcriptSegments,
  type SourcedTranscriptSegment,
  type TranscriptLine,
} from "./transcription-engine";

/** Grace period after stop for whisper to emit any flushed trailing finals. */
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
    pause() {
      if (!running) return;
      elapsedMs = current();
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
  /** Speaker-labelled text, lines joined by blank lines. */
  text: string;
  /** Whisper's verbatim timestamps where the engine reported them, else one
   *  synthesized segment per line — the mic-only engines report no timings,
   *  and a dropped line would lose its speaker along with its text. */
  segments: SourcedTranscriptSegment[];
  /** Source stored with `save-browser-transcript`. */
  source?: "web-speech" | "macos-native" | "whisper";
  /** Set when capture died partway. Text plus a reason is what tells the server
   *  this transcript is truncated and has to be re-transcribed in the cloud;
   *  omitting it saves a partial capture as a complete one. */
  failureReason?: string;
}

export interface TranscriptionCapture {
  stop(): Promise<CapturedTranscript>;
  cancel(): Promise<void>;
  /** Suspend the audio engine without discarding the captured transcript. */
  pause(): Promise<void>;
  /** Restart the audio engine after a `pause()`. */
  resume(): Promise<void>;
  /** Rebase timestamped segments to the actual recording start. */
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

  // Chrome ends the recognizer on its own roughly every minute, and always
  // throws if start() is called synchronously from inside `onend`. Nothing
  // starts, so no further `onend` arrives — the retry has to live here or the
  // first failure ends transcription for the rest of the recording.
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
    // A non-benign error drops audio until `onend` restarts recognition. That
    // restart usually succeeds, so without recording the gap here the transcript
    // saves as complete and the server never schedules cloud transcription for
    // the missing stretch. Deliberately not cleared by a later successful
    // restart: recovering the engine does not recover the lost speech.
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
    // While paused, keep the committed transcript but don't restart the engine.
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
        // `paused` is already false, so the recording is live through the
        // failed start and the retry delay. A later successful retry does not
        // recover that speech, so the gap is recorded durably and the server
        // still schedules cloud transcription.
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

/**
 * Local transcription opens a microphone capture of its own. System-only
 * recordings must wait for post-upload transcription instead of sampling the
 * Mac's default microphone.
 */
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
  // When a pause stops the engine, Whisper still flushes trailing finals
  // asynchronously. Track when those are expected to have landed so a stop
  // soon after a pause waits for them instead of dropping the last words.
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

  // `source` reports the engine that actually produced this transcript, not
  // the one we asked for: `startTranscriptionEngine` may have fallen back to
  // mic-only macos-native. Omitting it made the server default to "whisper"
  // and treat a mic-only capture as mixed mic + system audio.
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
      // Recordings only persist final segments. Meetings use the same engine
      // directly and retain live partials, but repeatedly inferring partials
      // here burns CPU without any recording UI consuming them.
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

  // Pause/resume run fire-and-forget from the recorder, so a quick
  // pause→resume can arrive while a transition is still awaiting the engine.
  // Track the desired state and re-apply once the in-flight transition settles
  // so the last request always wins (instead of being dropped).
  const applyAudioState = async () => {
    if (transitioning || disposed || desiredPaused === paused) return;
    transitioning = true;
    try {
      if (desiredPaused) {
        await stopTranscriptionEngine(engine);
        timeline.pause();
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
        // stop()/cancel() can run during the await above; if it did, the new
        // engine would leak (mic/system capture stays live). Tear it down.
        if (disposed) {
          await stopTranscriptionEngine(nextEngine).catch(() => {});
          return;
        }
        // A resumed Whisper capture is a fresh native session whose timestamps
        // otherwise begin at zero. Rebase it to the recorder's active elapsed
        // time, excluding the pause, before any new speech can finalize.
        try {
          await resetTranscriptionTimeline(nextEngine, timeline.current());
        } catch (err) {
          await stopTranscriptionEngine(nextEngine).catch(() => {});
          throw err;
        }
        engine = nextEngine;
        timeline.resume();
        paused = false;
        console.log(`[clips-recorder] transcription resumed (${engine})`);
      }
    } catch (err) {
      // Transition failed. Keep `desiredPaused` as the still-unmet intent (don't
      // reset it) so the next pause/resume toggle retries and converges, and
      // return early so we don't busy-loop re-applying a persistently failing
      // transition. `paused` still reflects the real engine state.
      transitionFailure = `Local transcription ${desiredPaused ? "pause" : "resume"} failed; engine still ${paused ? "paused" : "live"}.`;
      console.warn(
        `[clips-recorder] transcription ${desiredPaused ? "pause" : "resume"} failed; engine still ${paused ? "paused" : "live"}:`,
        err,
      );
      // `finally` resets `transitioning`; returning skips the auto re-apply.
      return;
    } finally {
      transitioning = false;
    }
    // Reached only when the transition landed, so a failure the next toggle
    // converged on is no longer a reason to re-transcribe in the cloud.
    transitionFailure = null;
    // Re-apply in case the desired state changed mid-transition.
    void applyAudioState();
  };

  return {
    async stop() {
      // Already paused: the engine is stopped, but the pause-time flush may
      // still be in flight. Wait out any remaining settle window so trailing
      // finals land before we drop the listener.
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
      // Whisper flushes trailing speech on stop; give the finals time to land.
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
