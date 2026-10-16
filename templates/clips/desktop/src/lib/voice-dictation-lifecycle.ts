export type DictationLifecyclePhase =
  | "initializing"
  | "capturing"
  | "finalizing"
  | "transcribing"
  | "processing"
  | "inserting"
  | "saving-history"
  | "completed"
  | "copied"
  | "cancelled"
  | "failed";

export type DictationFailure =
  | "permission"
  | "microphone-unavailable"
  | "no-speech"
  | "provider"
  | "paste"
  | "history-save";
export type DictationEmptyFailure = Exclude<
  DictationFailure,
  "paste" | "history-save"
>;

export type DictationInsertion = "inserted" | "copied";
export type DictationFinalizationStage =
  | "cleaning"
  | "pasting"
  | "saving-history";

export type DictationFinalizationResult =
  | { kind: "cancelled" }
  | {
      kind: "failed";
      failure:
        | "permission"
        | "microphone-unavailable"
        | "no-speech"
        | "provider";
    }
  | {
      kind: "failed";
      failure: "paste";
      recoverable: true;
      historySaved: boolean;
      insertion: null;
      cleanupFailed: boolean;
      backtrackFailed: boolean;
      transcript: string;
      originalTranscript?: string;
    }
  | {
      kind: "failed";
      failure: "history-save";
      insertion: DictationInsertion;
      recoverable: true;
      historySaved: false;
      cleanupFailed: boolean;
      backtrackFailed: boolean;
      transcript: string;
      originalTranscript?: string;
    }
  | {
      kind: "completed";
      insertion: DictationInsertion;
      historySaved: true;
      cleanupFailed: boolean;
      backtrackFailed: boolean;
    };

export interface DictationFinalizerOptions {
  rawText: string;
  cancelled: () => boolean;
  emptyFailure?: DictationEmptyFailure;
  signal?: AbortSignal;
  cleanup?: (text: string, signal: AbortSignal) => Promise<string>;
  insert: (text: string) => Promise<DictationInsertion>;
  copy: (text: string) => Promise<void>;
  onInsertion?: (insertion: DictationInsertion) => void;
  saveHistory: (rawText: string, cleanedText: string | null) => Promise<void>;
  applyBacktrack: (text: string) => string;
  onStage: (stage: DictationFinalizationStage) => void;
  cleanupTimeoutMs?: number;
}

export interface DictationHistoryRequestOptions {
  url: string;
  id: string;
  body: Record<string, unknown> & { id: string };
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

export async function saveDictationHistoryRequest(
  options: DictationHistoryRequestOptions,
): Promise<void> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const fetcher = options.fetcher ?? fetch;
  try {
    const request = (async () => {
      const response = await fetcher(options.url, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "X-Agent-Native-CSRF": "1",
        },
        body: JSON.stringify(options.body),
        signal: controller.signal,
      });
      const responseText = await response.text();
      let payload: unknown;
      if (responseText) {
        try {
          payload = JSON.parse(responseText);
        } catch {
          throw new Error("History save returned an invalid response.");
        }
      }
      if (!response.ok) {
        const body = payload as
          | { error?: string; message?: string }
          | undefined;
        throw new Error(
          body?.error ||
            body?.message ||
            `History save failed (${response.status}).`,
        );
      }
      const body = payload as
        | { id?: unknown; result?: { id?: unknown } }
        | undefined;
      const confirmedId = body?.result?.id ?? body?.id;
      if (typeof confirmedId !== "string" || confirmedId !== options.id) {
        throw new Error("History save did not confirm this dictation.");
      }
    })();
    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error("History save timed out."));
      }, options.timeoutMs ?? 4_000);
    });
    await Promise.race([request, timedOut]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

const terminalPhases = new Set<DictationLifecyclePhase>([
  "completed",
  "copied",
  "cancelled",
  "failed",
]);

const runIdStorageKey = "clips.voice-dictation.last-run-id";
const runIdRegistry = globalThis as typeof globalThis & {
  __clipsVoiceDictationLastRunId?: number;
};

type StoredRunIdResult =
  | { status: "available"; value: number }
  | { status: "not-browser" }
  | { status: "unavailable"; error: unknown };

const readStoredRunId = (): StoredRunIdResult => {
  if (typeof window === "undefined") return { status: "not-browser" };
  try {
    const raw = window.sessionStorage.getItem(runIdStorageKey);
    if (raw === null) return { status: "available", value: 0 };
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("Stored dictation run ID is invalid.");
    }
    return { status: "available", value };
  } catch (error) {
    console.warn("[voice-dictation] run ID storage could not be read:", error);
    return { status: "unavailable", error };
  }
};

const storedRunId = readStoredRunId();
let runIdStorageUnavailable = storedRunId.status === "unavailable";
let lastRunId = Math.max(
  Date.now() * 1_024,
  storedRunId.status === "available" ? storedRunId.value : 0,
  Number.isSafeInteger(runIdRegistry.__clipsVoiceDictationLastRunId)
    ? runIdRegistry.__clipsVoiceDictationLastRunId!
    : 0,
);

export function allocateVoiceRunId(): number {
  if (runIdStorageUnavailable) {
    throw new Error("Dictation run ID storage is unavailable.");
  }
  const nextRunId = Math.max(lastRunId + 1, Date.now() * 1_024);
  if (!Number.isSafeInteger(nextRunId)) {
    throw new Error("Dictation run ID exceeded the safe integer range.");
  }
  if (storedRunId.status === "available") {
    try {
      window.sessionStorage.setItem(runIdStorageKey, String(nextRunId));
    } catch (error) {
      runIdStorageUnavailable = true;
      console.error(
        "[voice-dictation] run ID storage could not be updated:",
        error,
      );
      throw new Error("Dictation run ID storage is unavailable.");
    }
  }
  lastRunId = nextRunId;
  runIdRegistry.__clipsVoiceDictationLastRunId = nextRunId;
  return nextRunId;
}

const allowedTransitions: Record<
  Exclude<
    DictationLifecyclePhase,
    "completed" | "copied" | "cancelled" | "failed"
  >,
  readonly DictationLifecyclePhase[]
> = {
  initializing: ["capturing", "failed", "cancelled"],
  capturing: ["finalizing", "failed", "cancelled"],
  finalizing: [
    "transcribing",
    "processing",
    "inserting",
    "failed",
    "cancelled",
  ],
  transcribing: ["finalizing", "failed", "cancelled"],
  processing: ["inserting", "failed", "cancelled"],
  inserting: ["saving-history", "failed"],
  "saving-history": ["completed", "copied", "failed"],
};

export interface DictationLifecycleSnapshot {
  runId: number;
  phase: DictationLifecyclePhase;
}

type DictationRunAuthority = Pick<
  ReturnType<typeof createVoiceDictationLifecycle>,
  "isActive"
>;

export function isCurrentDictationRun(
  lifecycle: DictationRunAuthority,
  activeRunId: number,
  eventRunId: number | undefined,
): boolean {
  return eventRunId === activeRunId && lifecycle.isActive(activeRunId);
}

export function createVoiceDictationLifecycle() {
  let current: DictationLifecycleSnapshot | null = null;

  return {
    begin(): number | null {
      if (current && !terminalPhases.has(current.phase)) return null;
      current = { runId: allocateVoiceRunId(), phase: "initializing" };
      return current.runId;
    },

    transition(runId: number, phase: DictationLifecyclePhase): boolean {
      if (current?.runId !== runId || terminalPhases.has(current.phase)) {
        return false;
      }
      if (current.phase === phase) return true;
      const allowed =
        allowedTransitions[current.phase as keyof typeof allowedTransitions];
      if (!allowed?.includes(phase)) return false;
      current = { runId, phase };
      return true;
    },

    finish(
      runId: number,
      phase: Extract<
        DictationLifecyclePhase,
        "completed" | "copied" | "cancelled" | "failed"
      >,
    ): boolean {
      if (current?.runId !== runId || terminalPhases.has(current.phase)) {
        return false;
      }
      current = { runId, phase };
      return true;
    },

    retryHistory(runId: number): boolean {
      if (current?.runId !== runId || current.phase !== "failed") return false;
      current = { runId, phase: "saving-history" };
      return true;
    },

    isActive(runId: number): boolean {
      return current?.runId === runId && !terminalPhases.has(current.phase);
    },

    isLatest(runId: number): boolean {
      return current?.runId === runId;
    },

    isBusy(): boolean {
      return !!current && !terminalPhases.has(current.phase);
    },

    snapshot(): DictationLifecycleSnapshot | null {
      return current && { ...current };
    },
  };
}

function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    task,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        onTimeout();
        reject(new Error("Optional text processing timed out"));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export async function finalizeDictationText(
  options: DictationFinalizerOptions,
): Promise<DictationFinalizationResult> {
  const rawText = options.rawText.trim();
  if (!rawText) {
    return { kind: "failed", failure: options.emptyFailure ?? "no-speech" };
  }
  if (options.cancelled()) return { kind: "cancelled" };

  let outputText = rawText;
  let cleanupFailed = false;
  let backtrackFailed = false;
  if (options.cleanup) {
    options.onStage("cleaning");
    const controller = new AbortController();
    const abortForCancel = () => controller.abort();
    try {
      const externalSignal = options.signal;
      if (externalSignal?.aborted) controller.abort();
      else
        externalSignal?.addEventListener("abort", abortForCancel, {
          once: true,
        });
      const result = options.cleanup(rawText, controller.signal);
      const cleaned = await withTimeout(
        result,
        options.cleanupTimeoutMs ?? 2_500,
        () => controller.abort(),
      );
      if (options.cancelled()) return { kind: "cancelled" };
      if (cleaned.trim()) outputText = cleaned.trim();
      else cleanupFailed = true;
    } catch {
      if (options.cancelled()) return { kind: "cancelled" };
      cleanupFailed = true;
      outputText = rawText;
    } finally {
      controller.abort();
      const externalSignal = options.signal;
      externalSignal?.removeEventListener("abort", abortForCancel);
    }
  }
  if (options.cancelled()) return { kind: "cancelled" };

  const preBacktrackText = outputText;
  try {
    outputText = options.applyBacktrack(outputText).trim() || outputText;
  } catch {
    outputText = preBacktrackText;
    backtrackFailed = true;
  }

  options.onStage("pasting");
  let insertion: DictationInsertion | null = null;
  try {
    insertion = await options.insert(outputText);
    options.onInsertion?.(insertion);
  } catch {
    try {
      await options.copy(outputText);
      insertion = "copied";
      options.onInsertion?.(insertion);
    } catch {
      insertion = null;
    }
  }

  // Native insertion cannot be rolled back, so persist history after the commit point.
  options.onStage("saving-history");
  let historySaved = false;
  try {
    await options.saveHistory(
      rawText,
      outputText === rawText ? null : outputText,
    );
    historySaved = true;
  } catch {
    historySaved = false;
  }

  if (insertion === null) {
    return {
      kind: "failed",
      failure: "paste",
      recoverable: true,
      historySaved,
      insertion: null,
      cleanupFailed,
      backtrackFailed,
      transcript: outputText,
      ...(outputText === rawText ? {} : { originalTranscript: rawText }),
    };
  }
  if (!historySaved) {
    return {
      kind: "failed",
      failure: "history-save",
      insertion,
      recoverable: true,
      historySaved: false,
      cleanupFailed,
      backtrackFailed,
      transcript: outputText,
      ...(outputText === rawText ? {} : { originalTranscript: rawText }),
    };
  }
  return {
    kind: "completed",
    insertion,
    historySaved: true,
    cleanupFailed,
    backtrackFailed,
  };
}
