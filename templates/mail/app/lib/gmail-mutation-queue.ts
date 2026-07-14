/**
 * Debounced client-side buffer for Gmail state mutations.
 *
 * Rapid archive / mark-read / star must feel instant (optimistic UI), but
 * each keypress hitting Gmail as its own modify burns quota. We keep the
 * React Query optimistic path, then coalesce outbound calls into the
 * existing bulk actions (one messages.batchModify per account).
 */

import { callAction } from "@agent-native/core/client";

export type GmailMutationKind = "archive" | "mark-read" | "star";

export interface GmailMutationTarget {
  id: string;
  threadId?: string;
  accountEmail?: string;
  /** Archive-from-label view: also remove this label. */
  removeLabel?: string;
  /** mark-read: true = read, false = unread. star: true = star. */
  flag?: boolean;
}

interface QueuedMutation extends GmailMutationTarget {
  kind: GmailMutationKind;
  resolve: () => void;
  reject: (error: unknown) => void;
}

const DEFAULT_DEBOUNCE_MS = 280;
const MAX_WAIT_MS = 1200;

type FlushListener = (info: {
  kind: GmailMutationKind;
  count: number;
  error?: unknown;
}) => void;

function targetKey(
  kind: GmailMutationKind,
  target: GmailMutationTarget,
): string {
  // Coalesce by message id + kind + removeLabel so re-pressing `e` on the
  // same thread replaces the pending op instead of stacking duplicates.
  return `${kind}:${target.id}:${target.removeLabel ?? ""}:${target.flag ?? ""}`;
}

function bulkArgs(targets: GmailMutationTarget[]) {
  return {
    id: targets.map((t) => t.id).join(","),
    threadIds: targets.map((t) => t.threadId ?? "").join(","),
    accountEmails: targets.map((t) => t.accountEmail ?? "").join(","),
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
  return result;
}

class GmailMutationQueue {
  private pending = new Map<string, QueuedMutation>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private firstEnqueueAt = 0;
  private debounceMs = DEFAULT_DEBOUNCE_MS;
  private listeners = new Set<FlushListener>();
  private installedUnload = false;

  /** Test-only: override debounce. */
  setDebounceMs(ms: number) {
    this.debounceMs = ms;
  }

  onFlush(listener: FlushListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Pending op count — useful in tests. */
  size(): number {
    return this.pending.size;
  }

  enqueue(kind: GmailMutationKind, target: GmailMutationTarget): Promise<void> {
    this.ensureUnloadHook();
    const key = targetKey(kind, target);
    return new Promise<void>((resolve, reject) => {
      const existing = this.pending.get(key);
      if (existing) {
        // Drop the superseded waiter as success — the newer op owns the flush.
        existing.resolve();
      }
      this.pending.set(key, { kind, ...target, resolve, reject });
      if (!this.firstEnqueueAt) this.firstEnqueueAt = Date.now();
      this.scheduleFlush();
    });
  }

  /**
   * Drop a pending op without sending it (e.g. user undid an archive before
   * the debounce window closed). Resolves waiters so callers don't hang.
   */
  cancel(kind: GmailMutationKind, id: string, removeLabel?: string): boolean {
    let cancelled = false;
    for (const [key, op] of this.pending) {
      if (
        op.kind === kind &&
        op.id === id &&
        (removeLabel === undefined || op.removeLabel === removeLabel)
      ) {
        this.pending.delete(key);
        op.resolve();
        cancelled = true;
      }
    }
    if (this.pending.size === 0) this.clearTimers();
    return cancelled;
  }

  /** Force-send everything now. Safe to call while a flush is already running. */
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

    this.flushing = this.runFlush(batch).finally(() => {
      this.flushing = null;
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
      // Group archives that share the same removeLabel so label-view archives
      // stay correct without blocking the default bulk INBOX path.
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
    }
  }

  private async flushArchive(ops: QueuedMutation[]): Promise<void> {
    try {
      await callAction("archive-email", {
        ...bulkArgs(ops),
        removeLabel: ops[0]?.removeLabel,
      }).then(assertActionSuccess);
      for (const op of ops) op.resolve();
      this.emit({ kind: "archive", count: ops.length });
    } catch (error) {
      for (const op of ops) op.reject(error);
      this.emit({ kind: "archive", count: ops.length, error });
    }
  }

  private async flushMarkRead(
    ops: QueuedMutation[],
    isRead: boolean,
  ): Promise<void> {
    try {
      await callAction("mark-read", {
        ...bulkArgs(ops),
        unread: !isRead,
      }).then(assertActionSuccess);
      for (const op of ops) op.resolve();
      this.emit({ kind: "mark-read", count: ops.length });
    } catch (error) {
      for (const op of ops) op.reject(error);
      this.emit({ kind: "mark-read", count: ops.length, error });
    }
  }

  private async flushStar(
    ops: QueuedMutation[],
    isStarred: boolean,
  ): Promise<void> {
    try {
      await callAction("star-email", {
        ...bulkArgs(ops),
        unstar: !isStarred,
      }).then(assertActionSuccess);
      for (const op of ops) op.resolve();
      this.emit({ kind: "star", count: ops.length });
    } catch (error) {
      for (const op of ops) op.reject(error);
      this.emit({ kind: "star", count: ops.length, error });
    }
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
      // Best-effort: kick flush; can't reliably await on unload.
      void this.flush();
    };
    window.addEventListener("pagehide", flushSync);
    window.addEventListener("beforeunload", flushSync);
  }

  /** Test helper: wipe pending state. */
  resetForTests() {
    this.clearTimers();
    for (const op of this.pending.values()) op.resolve();
    this.pending.clear();
    this.firstEnqueueAt = 0;
    this.flushing = null;
  }
}

export const gmailMutationQueue = new GmailMutationQueue();
