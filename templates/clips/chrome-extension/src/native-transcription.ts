export interface NativeTranscriptResult {
  text: string;
  failureReason: string | null;
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
  error?: string;
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

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export interface NativeTranscriptionCapture {
  supported: boolean;
  start(): void;
  stop(): Promise<NativeTranscriptResult>;
  cancel(): void;
  pause(): void;
  resume(): void;
}

const STOP_SETTLE_MS = 1_500;
const RESTART_DELAY_MS = 250;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

function appendTranscript(current: string, next: string): string {
  const cleanNext = next.trim();
  if (!cleanNext) return current;
  return current ? `${current} ${cleanNext}` : cleanNext;
}

export function createNativeTranscriptionCapture(options?: {
  enabled?: boolean;
  lang?: string;
}): NativeTranscriptionCapture {
  const Ctor = getSpeechRecognitionCtor();
  const enabled = options?.enabled ?? true;
  const language =
    options?.lang ??
    (typeof navigator !== "undefined" ? navigator.language : "en-US");
  const unsupportedReason = !enabled
    ? "Native speech transcription requires microphone capture."
    : !Ctor
      ? "Chrome Web Speech recognition is unavailable in this context."
      : null;

  let recognition: SpeechRecognitionLike | null = null;
  let finalText = "";
  let interimText = "";
  let stopped = false;
  let paused = false;
  let disposed = false;
  let failureReason = unsupportedReason;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let stopPromise: Promise<NativeTranscriptResult> | null = null;
  let resolveStop: ((result: NativeTranscriptResult) => void) | null = null;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;

  const result = (): NativeTranscriptResult => {
    const text = appendTranscript(finalText, interimText).trim();
    return {
      text,
      failureReason:
        text.length > 0
          ? null
          : failureReason ||
            "Chrome Web Speech recognition returned no transcript.",
    };
  };

  const settleStop = (): void => {
    if (!resolveStop) return;
    if (stopTimer !== null) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }
    const resolve = resolveStop;
    resolveStop = null;
    disposed = true;
    recognition = null;
    resolve(result());
  };

  const scheduleRestart = (): void => {
    if (restartTimer !== null) return;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (disposed || stopped || paused || !recognition) return;
      try {
        recognition.start();
      } catch (error) {
        failureReason =
          error instanceof Error
            ? `Chrome Web Speech recognition could not restart: ${error.message}`
            : "Chrome Web Speech recognition could not restart.";
      }
    }, RESTART_DELAY_MS);
  };

  const start = (): void => {
    if (!Ctor || !enabled || disposed || stopped || recognition) return;

    const nextRecognition = new Ctor();
    recognition = nextRecognition;
    nextRecognition.continuous = true;
    nextRecognition.interimResults = true;
    nextRecognition.lang = language;
    nextRecognition.maxAlternatives = 1;
    nextRecognition.onresult = (event) => {
      let nextInterim = "";
      for (
        let index = event.resultIndex;
        index < event.results.length;
        index++
      ) {
        const item = event.results[index];
        const text = item?.[0]?.transcript ?? "";
        if (item?.isFinal) finalText = appendTranscript(finalText, text);
        else nextInterim = appendTranscript(nextInterim, text);
      }
      interimText = nextInterim;
    };
    nextRecognition.onerror = (event) => {
      const error = event.error;
      if (!error || error === "no-speech" || error === "aborted") return;
      failureReason = `Chrome Web Speech recognition error: ${error}.`;
      if (error === "not-allowed" || error === "service-not-allowed") {
        stopped = true;
      }
    };
    nextRecognition.onend = () => {
      if (disposed) return;
      if (stopped) {
        settleStop();
        return;
      }
      if (!paused) scheduleRestart();
    };

    try {
      nextRecognition.start();
    } catch (error) {
      failureReason =
        error instanceof Error
          ? `Chrome Web Speech recognition could not start: ${error.message}`
          : "Chrome Web Speech recognition could not start.";
      recognition = null;
    }
  };

  const stop = (): Promise<NativeTranscriptResult> => {
    if (stopPromise) return stopPromise;
    stopped = true;
    paused = false;
    if (restartTimer !== null) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    if (!recognition) {
      disposed = true;
      return Promise.resolve(result());
    }

    stopPromise = new Promise<NativeTranscriptResult>((resolve) => {
      resolveStop = resolve;
      stopTimer = setTimeout(settleStop, STOP_SETTLE_MS);
      try {
        recognition?.stop();
      } catch {
        settleStop();
      }
    });
    return stopPromise;
  };

  const cancel = (): void => {
    stopped = true;
    disposed = true;
    if (restartTimer !== null) clearTimeout(restartTimer);
    if (stopTimer !== null) clearTimeout(stopTimer);
    resolveStop = null;
    try {
      recognition?.abort();
    } catch {
      // Ignore teardown failures.
    }
    recognition = null;
  };

  const pause = (): void => {
    if (!recognition || stopped || disposed) return;
    paused = true;
    try {
      recognition.stop();
    } catch {
      // The onend handler will settle the stopped recognition.
    }
  };

  const resume = (): void => {
    if (!recognition || stopped || disposed) return;
    paused = false;
    try {
      recognition.start();
    } catch {
      failureReason = "Chrome Web Speech recognition could not resume.";
    }
  };

  return {
    supported: Boolean(Ctor && enabled),
    start,
    stop,
    cancel,
    pause,
    resume,
  };
}
