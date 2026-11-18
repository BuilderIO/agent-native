export interface ProviderWriteClientProgress {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "uncertain";
  attempts: number;
  reason: string | null;
  resumeAt: number | null;
}

function readProgress(value: unknown): ProviderWriteClientProgress | null {
  if (!value || typeof value !== "object") return null;
  const progress =
    "_providerWrite" in value
      ? value._providerWrite
      : "progress" in value
        ? value.progress
        : undefined;
  if (!("_providerWrite" in value) && !("progress" in value)) return null;
  if (
    !progress ||
    typeof progress !== "object" ||
    !("id" in progress) ||
    typeof progress.id !== "string" ||
    !progress.id.trim() ||
    !("status" in progress) ||
    typeof progress.status !== "string" ||
    !["queued", "running", "completed", "failed", "uncertain"].includes(
      progress.status,
    ) ||
    !("attempts" in progress) ||
    typeof progress.attempts !== "number" ||
    !Number.isSafeInteger(progress.attempts) ||
    progress.attempts < 0 ||
    !("reason" in progress) ||
    (progress.reason !== null && typeof progress.reason !== "string") ||
    !("resumeAt" in progress) ||
    (progress.resumeAt !== null &&
      (typeof progress.resumeAt !== "number" ||
        !Number.isSafeInteger(progress.resumeAt)))
  )
    throw new TypeError("Unreadable provider write progress.");
  return {
    id: progress.id,
    status: progress.status as ProviderWriteClientProgress["status"],
    attempts: progress.attempts,
    reason: progress.reason,
    resumeAt: progress.resumeAt,
  };
}

export class ProviderWritePendingError extends Error {
  readonly errorCode = "provider_write_pending";
  constructor(
    readonly progress: ProviderWriteClientProgress,
    options?: ErrorOptions,
  ) {
    super(
      "The provider write is still pending. Its progress can be checked with its write id.",
      options,
    );
    this.name = "ProviderWritePendingError";
  }
}

export class ProviderWriteFailedError extends Error {
  readonly errorCode = "provider_write_failed";
  constructor(readonly progress: ProviderWriteClientProgress) {
    super("The provider rejected this write.");
    this.name = "ProviderWriteFailedError";
  }
}

export class ProviderWriteUncertainError extends Error {
  readonly errorCode: string = "provider_write_uncertain";
  constructor(readonly progress: ProviderWriteClientProgress) {
    super(
      progress.reason === "result_unavailable"
        ? "The provider applied the write, but its result could not be stored. Verify the saved item before retrying."
        : "The provider write outcome is unconfirmed. Verify it before retrying.",
    );
    this.name = "ProviderWriteUncertainError";
  }
}

export class ProviderWriteAbandonedError extends ProviderWriteUncertainError {
  override readonly errorCode = "provider_write_abandoned";
  constructor(progress: ProviderWriteClientProgress) {
    super(progress);
    this.name = "ProviderWriteAbandonedError";
    this.message =
      "You stopped tracking this write. It may have been applied by the provider. Verify the saved item before retrying.";
  }
}

export async function waitForProviderWriteResult<T>(
  initial: T,
  options: {
    resume: (id: string) => Promise<T>;
    onProgress?: (progress: ProviderWriteClientProgress) => void;
    signal?: AbortSignal;
    maxWaitMs?: number;
  },
): Promise<T> {
  let result = initial;
  const deadline = Date.now() + (options.maxWaitMs ?? 10 * 60_000);
  let lastProgress: ProviderWriteClientProgress | undefined;
  for (;;) {
    options.signal?.throwIfAborted();
    let progress: ProviderWriteClientProgress | null;
    try {
      progress = readProgress(result);
    } catch (error) {
      if (lastProgress)
        throw new ProviderWritePendingError(lastProgress, { cause: error });
      throw error;
    }
    if (!progress) {
      if (lastProgress)
        throw new ProviderWritePendingError(lastProgress, {
          cause: new TypeError(
            "Provider write completed envelope is unavailable.",
          ),
        });
      return result;
    }
    if (lastProgress && progress.id !== lastProgress.id)
      throw new ProviderWritePendingError(lastProgress, {
        cause: new TypeError("Provider write progress changed identity."),
      });
    if (progress.status === "completed") {
      if (
        !result ||
        typeof result !== "object" ||
        !("progress" in result) ||
        !("result" in result) ||
        result.result === undefined
      ) {
        if (lastProgress)
          throw new ProviderWritePendingError(lastProgress, {
            cause: new TypeError("Completed provider write has no result."),
          });
        throw new TypeError("Completed provider write has no result.");
      }
      options.onProgress?.(progress);
      // The server validates the stored result with its registered handler.
      return result.result as T;
    }
    lastProgress = progress;
    options.onProgress?.(progress);
    if (progress.status === "failed") {
      if (progress.reason === "outcome_abandoned")
        throw new ProviderWriteAbandonedError(progress);
      throw new ProviderWriteFailedError(progress);
    }
    if (progress.status === "uncertain")
      throw new ProviderWriteUncertainError(progress);
    if (
      Date.now() >= deadline ||
      (progress.resumeAt === null && progress.reason !== null)
    )
      throw new ProviderWritePendingError(progress);
    const wait = Math.min(
      10_000,
      Math.max(1_000, (progress.resumeAt ?? Date.now()) - Date.now()),
    );
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        options.signal?.removeEventListener("abort", abort);
        resolve();
      };
      const timer = setTimeout(finish, wait);
      const abort = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        reject(options.signal?.reason);
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
    });
    try {
      result = await options.resume(progress.id);
    } catch (error) {
      // Leaving the caller cancels its polling, not the durable provider write.
      options.signal?.throwIfAborted();
      throw new ProviderWritePendingError(progress, { cause: error });
    }
  }
}
