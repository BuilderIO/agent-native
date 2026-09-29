import { callAction } from "@agent-native/core/client/hooks";

export type GmailMutationKind = "archive" | "mark-read" | "star" | "trash";

export interface GmailMutationTarget {
  id: string;
  threadId?: string;
  accountEmail?: string;
  removeLabel?: string;
  flag?: boolean;
}

interface QueuedMutation extends GmailMutationTarget {
  kind: GmailMutationKind;
  resolves: Array<() => void>;
  rejects: Array<(error: unknown) => void>;
}

const DEFAULT_DEBOUNCE_MS = 280;
const MAX_WAIT_MS = 1200;

type FlushListener = (info: {
  kind: GmailMutationKind;
  count: number;
  error?: unknown;
}) => void;

type FlushOutcome = "success" | "failure";

type TrashActionResult = {
  requested: string[];
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
};

type ArchiveActionResult = {
  requested: string[];
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
  remaining: string[];
  retryAfterSeconds?: number;
};

const MAX_ARCHIVE_BATCH_ATTEMPTS = 5;

function targetKey(
  kind: GmailMutationKind,
  target: GmailMutationTarget,
): string {
  return `${kind}:${target.id}:${target.removeLabel ?? ""}:${target.flag ?? ""}`;
}

function bulkArgs(targets: GmailMutationTarget[]) {
  return {
    id: targets.map((t) => t.id).join(","),
    threadIds: targets.map((t) => t.threadId ?? "").join(","),
    accountEmails: targets.map((t) => t.accountEmail ?? "").join(","),
  };
}

function bulkMessageArgs(targets: GmailMutationTarget[]) {
  return {
    id: targets.map((t) => t.id).join(","),
    accountEmails: targets.map((t) => t.accountEmail ?? "").join(","),
  };
}

function bulkThreadMessageArgs(targets: GmailMutationTarget[]) {
  return {
    ...bulkMessageArgs(targets),
    threadIds: targets.map((t) => t.threadId ?? "").join(","),
  };
}

function assertActionSuccess<T>(result: T): T {
  if (
    typeof result === "string" &&
    (result.startsWith("Error:") || /failed/i.test(result.slice(0, 40)))
  ) {
    throw new Error(result);
  }
  if (
    result &&
    typeof result === "object" &&
    "ok" in result &&
    (result as { ok?: boolean }).ok === false
  ) {
    const message =
      "error" in result &&
      typeof (result as { error?: unknown }).error === "string"
        ? (result as { error: string }).error
        : "Action failed";
    throw new Error(message);
  }
  if (typeof result === "string") {
    const progress = result.match(/\b(\d+)\s*\/\s*(\d+)\b/);
    if (progress && Number(progress[1]) < Number(progress[2])) {
      throw new Error(result);
    }
  }
  return result;
}

function isTrashActionResult(value: unknown): value is TrashActionResult {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as TrashActionResult).requested) &&
    Array.isArray((value as TrashActionResult).succeeded) &&
    Array.isArray((value as TrashActionResult).failed)
  );
}

function isArchiveActionResult(value: unknown): value is ArchiveActionResult {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as ArchiveActionResult).requested) &&
    Array.isArray((value as ArchiveActionResult).succeeded) &&
    Array.isArray((value as ArchiveActionResult).failed) &&
    Array.isArray((value as ArchiveActionResult).remaining)
  );
}

function isGmailQuotaCooldown(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    errorCode?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  return (
    value.errorCode === "gmail_quota_cooldown" ||
    value.statusCode === 429 ||
    value.status === 429
  );
}

function gmailQuotaRetryDelayMs(value: unknown): number {
  if (value && typeof value === "object") {
    const error = value as {
      retryAfterMs?: unknown;
      retryAfterSeconds?: unknown;
      details?: { retryAfterSeconds?: unknown };
    };
    if (typeof error.retryAfterMs === "number" && error.retryAfterMs >= 0) {
      return error.retryAfterMs;
    }
    const seconds =
      typeof error.retryAfterSeconds === "number"
        ? error.retryAfterSeconds
        : error.details?.retryAfterSeconds;
    if (typeof seconds === "number" && seconds >= 0) return seconds * 1000;
  }
  return 1_000;
}

class GmailMutationQueue {
  private pending = new Map<string, QueuedMutation>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private flushingOps: QueuedMutation[] = [];
  private flushOutcomes = new Map<string, FlushOutcome>();
  private firstEnqueueAt = 0;
  private debounceMs = DEFAULT_DEBOUNCE_MS;
  private listeners = new Set<FlushListener>();
  private installedUnload = false;

  setDebounceMs(ms: number) {
    this.debounceMs = ms;
  }

  onFlush(listener: FlushListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  size(): number {
    return this.pending.size;
  }

  private matches(
    op: QueuedMutation,
    kind: GmailMutationKind,
    id: string,
    removeLabel?: string,
  ) {
    return (
      op.kind === kind &&
      op.id === id &&
      (removeLabel === undefined || op.removeLabel === removeLabel)
    );
  }

  enqueue(kind: GmailMutationKind, target: GmailMutationTarget): Promise<void> {
    this.ensureUnloadHook();
    const key = targetKey(kind, target);
    return new Promise<void>((resolve, reject) => {
      const existing = this.pending.get(key);
      if (existing) {
        existing.resolves.push(resolve);
        existing.rejects.push(reject);
      } else {
        this.pending.set(key, {
          kind,
          ...target,
          resolves: [resolve],
          rejects: [reject],
        });
      }
      if (!this.firstEnqueueAt) this.firstEnqueueAt = Date.now();
      this.scheduleFlush();
    });
  }

  cancel(kind: GmailMutationKind, id: string, removeLabel?: string): boolean {
    let cancelled = false;
    for (const [key, op] of this.pending) {
      if (this.matches(op, kind, id, removeLabel)) {
        this.pending.delete(key);
        for (const resolve of op.resolves) resolve();
        cancelled = true;
      }
    }
    if (this.pending.size === 0) this.clearTimers();
    return cancelled;
  }

  async cancelOrWait(
    kind: GmailMutationKind,
    id: string,
    removeLabel?: string,
  ): Promise<"cancelled" | "succeeded" | "failed" | "none"> {
    let cancelled = false;
    let sawSuccess = false;
    let sawFailure = false;

    while (true) {
      cancelled = this.cancel(kind, id, removeLabel) || cancelled;
      const flushing = this.flushing;
      const ops = this.flushingOps.filter((op) =>
        this.matches(op, kind, id, removeLabel),
      );
      if (!flushing || ops.length === 0) break;

      const outcomes = this.flushOutcomes;
      await flushing;
      for (const op of ops) {
        const outcome = outcomes.get(targetKey(op.kind, op));
        sawSuccess ||= outcome === "success";
        sawFailure ||= outcome === "failure";
      }
    }

    if (sawSuccess) return "succeeded";
    if (sawFailure) return "failed";
    return cancelled ? "cancelled" : "none";
  }

  async flush(): Promise<void> {
    this.clearTimers();
    if (this.flushing) {
      await this.flushing;
      if (this.pending.size > 0) await this.flush();
      return;
    }
    if (this.pending.size === 0) return;

    const batch = [...this.pending.values()];
    this.pending.clear();
    this.firstEnqueueAt = 0;
    this.flushingOps = batch;
    this.flushOutcomes = new Map();

    this.flushing = this.runFlush(batch).finally(() => {
      this.flushing = null;
      this.flushingOps = [];
    });
    await this.flushing;
  }

  private scheduleFlush() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      void this.flush();
    }, this.debounceMs);

    if (!this.maxWaitTimer && this.firstEnqueueAt) {
      const remaining = Math.max(
        0,
        MAX_WAIT_MS - (Date.now() - this.firstEnqueueAt),
      );
      this.maxWaitTimer = setTimeout(() => {
        void this.flush();
      }, remaining);
    }
  }

  private clearTimers() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }
  }

  private async runFlush(batch: QueuedMutation[]): Promise<void> {
    const byKind = new Map<GmailMutationKind, QueuedMutation[]>();
    for (const op of batch) {
      const list = byKind.get(op.kind) ?? [];
      list.push(op);
      byKind.set(op.kind, list);
    }

    for (const [kind, ops] of byKind) {
      if (kind === "archive") {
        const byLabel = new Map<string, QueuedMutation[]>();
        for (const op of ops) {
          const labelKey = op.removeLabel ?? "";
          const list = byLabel.get(labelKey) ?? [];
          list.push(op);
          byLabel.set(labelKey, list);
        }
        for (const [, group] of byLabel) {
          await this.flushArchive(group);
        }
        continue;
      }

      if (kind === "mark-read") {
        const byFlag = new Map<boolean, QueuedMutation[]>();
        for (const op of ops) {
          const flag = op.flag !== false;
          const list = byFlag.get(flag) ?? [];
          list.push(op);
          byFlag.set(flag, list);
        }
        for (const [isRead, group] of byFlag) {
          await this.flushMarkRead(group, isRead);
        }
        continue;
      }

      if (kind === "star") {
        const byFlag = new Map<boolean, QueuedMutation[]>();
        for (const op of ops) {
          const flag = op.flag !== false;
          const list = byFlag.get(flag) ?? [];
          list.push(op);
          byFlag.set(flag, list);
        }
        for (const [isStarred, group] of byFlag) {
          await this.flushStar(group, isStarred);
        }
      }

      if (kind === "trash") {
        await this.flushTrash(ops);
      }
    }
  }

  private recordOutcome(op: QueuedMutation, outcome: FlushOutcome) {
    this.flushOutcomes.set(targetKey(op.kind, op), outcome);
  }

  private async flushArchive(ops: QueuedMutation[]): Promise<void> {
    let pending = [...ops];
    let firstError: unknown;

    for (let attempt = 0; pending.length > 0; attempt += 1) {
      let result: unknown;
      try {
        result = await callAction("archive-email", {
          ...bulkArgs(pending),
          removeLabel: pending[0]?.removeLabel,
        }).then(assertActionSuccess);
      } catch (error) {
        if (isGmailQuotaCooldown(error)) {
          if (attempt + 1 < MAX_ARCHIVE_BATCH_ATTEMPTS) {
            await new Promise<void>((resolve) =>
              setTimeout(resolve, gmailQuotaRetryDelayMs(error)),
            );
            continue;
          }
          firstError = error;
          for (const op of pending) {
            this.recordOutcome(op, "failure");
            for (const reject of op.rejects) reject(error);
          }
          pending = [];
          break;
        }

        const fallbackError = await this.flushIndividually(pending, (op) =>
          callAction("archive-email", {
            id: op.id,
            threadId: op.threadId,
            accountEmail: op.accountEmail,
            removeLabel: op.removeLabel,
          }).then(assertActionSuccess),
        );
        if (fallbackError) firstError ??= fallbackError;
        pending = [];
        break;
      }

      if (!isArchiveActionResult(result)) {
        try {
          if (typeof result !== "string") {
            throw new Error("Archive action returned an invalid result");
          }
          for (const op of pending) {
            this.recordOutcome(op, "success");
            for (const resolve of op.resolves) resolve();
          }
          pending = [];
          break;
        } catch (error) {
          const fallbackError = await this.flushIndividually(pending, (op) =>
            callAction("archive-email", {
              id: op.id,
              threadId: op.threadId,
              accountEmail: op.accountEmail,
              removeLabel: op.removeLabel,
            }).then(assertActionSuccess),
          );
          if (fallbackError) firstError ??= fallbackError;
          pending = [];
          break;
        }
      }

      const succeeded = new Set(result.succeeded);
      const remainingIds = new Set(result.remaining);
      const failures = new Map(
        result.failed.map(({ id, error }) => [id, error]),
      );
      const nextPending: QueuedMutation[] = [];

      for (const op of pending) {
        if (succeeded.has(op.id)) {
          this.recordOutcome(op, "success");
          for (const resolve of op.resolves) resolve();
        } else if (failures.has(op.id)) {
          const error = new Error(failures.get(op.id)!);
          firstError ??= error;
          this.recordOutcome(op, "failure");
          for (const reject of op.rejects) reject(error);
        } else if (remainingIds.has(op.id)) {
          nextPending.push(op);
        } else {
          const error = new Error("Archive action omitted a target outcome");
          firstError ??= error;
          this.recordOutcome(op, "failure");
          for (const reject of op.rejects) reject(error);
        }
      }

      pending = nextPending;
      if (pending.length === 0) break;

      if (attempt + 1 >= MAX_ARCHIVE_BATCH_ATTEMPTS) {
        const error = new Error("Archive remains incomplete after retries");
        firstError ??= error;
        for (const op of pending) {
          this.recordOutcome(op, "failure");
          for (const reject of op.rejects) reject(error);
        }
        pending = [];
        break;
      }

      const delayMs =
        typeof result.retryAfterSeconds === "number" &&
        result.retryAfterSeconds > 0
          ? result.retryAfterSeconds * 1000
          : 0;
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }

    this.emit(
      firstError
        ? { kind: "archive", count: ops.length, error: firstError }
        : { kind: "archive", count: ops.length },
    );
  }

  private async flushMarkRead(
    ops: QueuedMutation[],
    isRead: boolean,
  ): Promise<void> {
    // Bulk reads with thread hints clear UNREAD from every cached message in
    // each selected thread. Unread mutations stay message-scoped so Gmail can
    // mark the conversation unread from its newest message.
    const threadTargetMode =
      isRead && ops.length > 1 && ops.every((op) => Boolean(op.threadId));
    let pending = [...ops];
    let firstError: unknown;

    for (let attempt = 0; pending.length > 0; attempt += 1) {
      let result: unknown;
      try {
        result = await callAction("mark-read", {
          ...(threadTargetMode
            ? bulkThreadMessageArgs(pending)
            : bulkMessageArgs(pending)),
          unread: !isRead,
        }).then(assertActionSuccess);
      } catch (error) {
        if (isGmailQuotaCooldown(error)) {
          if (attempt + 1 < MAX_ARCHIVE_BATCH_ATTEMPTS) {
            await new Promise<void>((resolve) =>
              setTimeout(resolve, gmailQuotaRetryDelayMs(error)),
            );
            continue;
          }
          firstError = error;
          for (const op of pending) {
            this.recordOutcome(op, "failure");
            for (const reject of op.rejects) reject(error);
          }
          pending = [];
          break;
        }

        if (threadTargetMode) {
          firstError ??= error;
          for (const op of pending) {
            this.recordOutcome(op, "failure");
            for (const reject of op.rejects) reject(error);
          }
        } else {
          const fallbackError = await this.flushIndividually(pending, (op) =>
            callAction("mark-read", {
              id: op.id,
              accountEmail: op.accountEmail,
              unread: !isRead,
            }).then(assertActionSuccess),
          );
          if (fallbackError) firstError ??= fallbackError;
        }
        pending = [];
        break;
      }

      if (!isArchiveActionResult(result)) {
        for (const op of pending) {
          this.recordOutcome(op, "success");
          for (const resolve of op.resolves) resolve();
        }
        pending = [];
        break;
      }

      const succeeded = new Set(result.succeeded);
      const remainingIds = new Set(result.remaining);
      const failures = new Map(
        result.failed.map(({ id, error }) => [id, error]),
      );
      const nextPending: QueuedMutation[] = [];
      for (const op of pending) {
        if (succeeded.has(op.id)) {
          this.recordOutcome(op, "success");
          for (const resolve of op.resolves) resolve();
        } else if (failures.has(op.id)) {
          const error = new Error(failures.get(op.id)!);
          firstError ??= error;
          this.recordOutcome(op, "failure");
          for (const reject of op.rejects) reject(error);
        } else if (remainingIds.has(op.id)) {
          nextPending.push(op);
        } else {
          const error = new Error("Mark-read action omitted a target outcome");
          firstError ??= error;
          this.recordOutcome(op, "failure");
          for (const reject of op.rejects) reject(error);
        }
      }
      pending = nextPending;
      if (pending.length === 0) break;

      if (attempt + 1 >= MAX_ARCHIVE_BATCH_ATTEMPTS) {
        const error = new Error("Mark-read remains incomplete after retries");
        firstError ??= error;
        for (const op of pending) {
          this.recordOutcome(op, "failure");
          for (const reject of op.rejects) reject(error);
        }
        pending = [];
        break;
      }

      if (typeof result.retryAfterSeconds === "number") {
        const delayMs = Math.max(0, result.retryAfterSeconds * 1000);
        if (delayMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    this.emit(
      firstError
        ? { kind: "mark-read", count: ops.length, error: firstError }
        : { kind: "mark-read", count: ops.length },
    );
  }

  private async flushStar(
    ops: QueuedMutation[],
    isStarred: boolean,
  ): Promise<void> {
    let pending = [...ops];
    let firstError: unknown;

    for (let attempt = 0; pending.length > 0; attempt += 1) {
      let result: unknown;
      try {
        result = await callAction("star-email", {
          ...bulkArgs(pending),
          unstar: !isStarred,
        }).then(assertActionSuccess);
      } catch (error) {
        if (isGmailQuotaCooldown(error)) {
          if (attempt + 1 < MAX_ARCHIVE_BATCH_ATTEMPTS) {
            await new Promise<void>((resolve) =>
              setTimeout(resolve, gmailQuotaRetryDelayMs(error)),
            );
            continue;
          }
          firstError = error;
          for (const op of pending) {
            this.recordOutcome(op, "failure");
            for (const reject of op.rejects) reject(error);
          }
        } else {
          const fallbackError = await this.flushIndividually(pending, (op) =>
            callAction("star-email", {
              id: op.id,
              accountEmail: op.accountEmail,
              unstar: !isStarred,
            }).then(assertActionSuccess),
          );
          firstError = fallbackError;
        }
        pending = [];
        break;
      }

      if (!isArchiveActionResult(result)) {
        for (const op of pending) {
          this.recordOutcome(op, "success");
          for (const resolve of op.resolves) resolve();
        }
        pending = [];
        break;
      }

      const succeeded = new Set(result.succeeded);
      const remainingIds = new Set(result.remaining);
      const failures = new Map(
        result.failed.map(({ id, error }) => [id, error]),
      );
      const nextPending: QueuedMutation[] = [];
      for (const op of pending) {
        if (succeeded.has(op.id)) {
          this.recordOutcome(op, "success");
          for (const resolve of op.resolves) resolve();
        } else if (failures.has(op.id)) {
          const error = new Error(failures.get(op.id)!);
          firstError ??= error;
          this.recordOutcome(op, "failure");
          for (const reject of op.rejects) reject(error);
        } else if (remainingIds.has(op.id)) {
          nextPending.push(op);
        } else {
          const error = new Error("Star action omitted a target outcome");
          firstError ??= error;
          this.recordOutcome(op, "failure");
          for (const reject of op.rejects) reject(error);
        }
      }
      pending = nextPending;
      if (pending.length === 0) break;

      if (attempt + 1 >= MAX_ARCHIVE_BATCH_ATTEMPTS) {
        const error = new Error("Star remains incomplete after retries");
        firstError ??= error;
        for (const op of pending) {
          this.recordOutcome(op, "failure");
          for (const reject of op.rejects) reject(error);
        }
        pending = [];
        break;
      }

      const delayMs =
        typeof result.retryAfterSeconds === "number" &&
        result.retryAfterSeconds > 0
          ? result.retryAfterSeconds * 1000
          : 0;
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }

    this.emit(
      firstError
        ? { kind: "star", count: ops.length, error: firstError }
        : { kind: "star", count: ops.length },
    );
  }

  private async flushTrash(ops: QueuedMutation[]): Promise<void> {
    try {
      const result = await callAction("trash-email", bulkArgs(ops)).then(
        assertActionSuccess,
      );
      if (!isTrashActionResult(result) && typeof result !== "string") {
        throw new Error("Trash action returned an invalid result");
      }

      const failures = isTrashActionResult(result)
        ? new Map(result.failed.map((failure) => [failure.id, failure.error]))
        : new Map<string, string>();
      let firstError: Error | undefined;
      for (const op of ops) {
        const message = failures.get(op.id);
        if (message) {
          const error = new Error(message);
          firstError ??= error;
          this.recordOutcome(op, "failure");
          for (const reject of op.rejects) reject(error);
        } else {
          this.recordOutcome(op, "success");
          for (const resolve of op.resolves) resolve();
        }
      }
      this.emit(
        firstError
          ? { kind: "trash", count: ops.length, error: firstError }
          : { kind: "trash", count: ops.length },
      );
    } catch (error) {
      for (const op of ops) {
        this.recordOutcome(op, "failure");
        for (const reject of op.rejects) reject(error);
      }
      this.emit({ kind: "trash", count: ops.length, error });
    }
  }

  private async flushIndividually(
    ops: QueuedMutation[],
    send: (op: QueuedMutation) => Promise<unknown>,
  ): Promise<unknown> {
    let firstError: unknown;
    for (const op of ops) {
      try {
        await send(op);
        this.recordOutcome(op, "success");
        for (const resolve of op.resolves) resolve();
      } catch (error) {
        this.recordOutcome(op, "failure");
        firstError ??= error;
        for (const reject of op.rejects) reject(error);
      }
    }
    return firstError;
  }

  private emit(info: {
    kind: GmailMutationKind;
    count: number;
    error?: unknown;
  }) {
    for (const listener of this.listeners) {
      try {
        listener(info);
      } catch {
        // ignore listener errors
      }
    }
  }

  private ensureUnloadHook() {
    if (this.installedUnload || typeof window === "undefined") return;
    this.installedUnload = true;
    const flushSync = () => {
      void this.flush();
    };
    window.addEventListener("pagehide", flushSync);
    window.addEventListener("beforeunload", flushSync);
  }

  resetForTests() {
    this.clearTimers();
    for (const op of this.pending.values()) {
      for (const resolve of op.resolves) resolve();
    }
    this.pending.clear();
    this.firstEnqueueAt = 0;
    this.flushing = null;
    this.flushingOps = [];
    this.flushOutcomes.clear();
  }
}

export const gmailMutationQueue = new GmailMutationQueue();
