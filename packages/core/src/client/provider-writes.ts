export interface ProviderWriteClientProgress {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "uncertain";
  attempts: number;
  reason: string | null;
  resumeAt: number | null;
}

function readProgress(value: unknown): ProviderWriteClientProgress | null {
  if (!value || typeof value !== "object" || !("_providerWrite" in value))
    return null;
  const progress = value._providerWrite;
  if (
    !progress ||
    typeof progress !== "object" ||
    !("id" in progress) ||
    typeof progress.id !== "string" ||
    !("status" in progress) ||
    !["queued", "running", "completed", "failed", "uncertain"].includes(
      String(progress.status),
    ) ||
    !("attempts" in progress) ||
    typeof progress.attempts !== "number" ||
    !("reason" in progress) ||
    (progress.reason !== null && typeof progress.reason !== "string") ||
    !("resumeAt" in progress) ||
    (progress.resumeAt !== null && typeof progress.resumeAt !== "number")
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
  constructor(readonly progress: ProviderWriteClientProgress) {
    super(
      "The provider write is still queued. Its progress can be checked with its write id.",
    );
    this.name = "ProviderWritePendingError";
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
  let id: string | undefined;
  let lastProgress: ProviderWriteClientProgress | undefined;
  for (;;) {
    options.signal?.throwIfAborted();
    const progress = readProgress(result);
    if (!progress) {
      if (lastProgress)
        options.onProgress?.({
          ...lastProgress,
          status: "completed",
          reason: null,
          resumeAt: null,
        });
      return result;
    }
    lastProgress = progress;
    if (id !== undefined && progress.id !== id)
      throw new TypeError("Provider write progress changed identity.");
    id = progress.id;
    options.onProgress?.(progress);
    if (
      progress.status === "failed" ||
      progress.status === "uncertain" ||
      Date.now() >= deadline ||
      progress.resumeAt === null
    )
      throw new ProviderWritePendingError(progress);
    const wait = Math.min(
      10_000,
      Math.max(1_000, progress.resumeAt - Date.now()),
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
    result = await options.resume(id);
  }
}
