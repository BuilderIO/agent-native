import type { CanvasStyleKind } from "./canvas-style-kind";
import { trackDesignRelay } from "./design-relay-tracking";
import { isRejectedRestoreClaimError } from "./design-save-outbox";

/**
 * Outcome counts for canvas edits. Each canvas command counts exactly one
 * outcome; counts with the same operation, outcome, reason, label and design
 * are summed and sent as one `canvas_edit_outcome_counts` event with a `count`,
 * every 15 s, at once for the first failure of a kind, or after the page shows
 * again. `design_id` is a join key, not a dimension to chart by: a page holds
 * one design, so it adds no keys in practice.
 */
export const CANVAS_OUTCOME_COUNTS_EVENT = "canvas_edit_outcome_counts";

export const CANVAS_OUTCOME_FLUSH_MS = 15_000;
const MAX_PENDING_KEYS = 50;

const CANVAS_OPERATIONS = [
  "canvas_load",
  "save",
  "save_replay",
  "style_commit",
  "text_edit",
  "text_retry",
] as const;
export type CanvasOperation = (typeof CANVAS_OPERATIONS)[number];

const CANVAS_OUTCOMES = [
  "succeeded",
  "failed",
  "skipped",
  "deferred",
  "unsettled",
] as const;
export type CanvasOutcome = (typeof CANVAS_OUTCOMES)[number];
type ReportedOutcome = Exclude<CanvasOutcome, "unsettled">;

export const CANVAS_OUTCOME_REASONS = [
  "none",
  "exception",
  "unknown",
  "overflow",
  // canvas_load
  "hidden_during_load",
  "stalled",
  // save / save_replay
  "aborted",
  "conflict",
  "dropped",
  "error",
  "invalid_html",
  "offline",
  "offline_queued",
  "rebased",
  "stale_mirror",
  "superseded",
  // style_commit
  "client_rendered_shell",
  "edit_blocked",
  "empty_styles",
  "integrity_failed",
  "linked_edit_queued",
  "linked_scope_unsupported",
  "linked_source_unsupported",
  "no_edit_rights",
  "no_rendered_box",
  "node_unresolved",
  "not_persisted",
  "patch_failed",
  "runtime_pending",
  "save_unfinished",
  "selector_ambiguous",
  "selector_missing",
  "shader_write_failed",
  "snapshot_not_loaded",
  // text_edit / text_retry
  "fallback_queued",
  "not_written",
  "refused",
] as const;
export type CanvasOutcomeReason = (typeof CANVAS_OUTCOME_REASONS)[number];

export type CanvasLoadReadyBucket = "lt_1s" | "1_to_4s" | "gt_4s";

export interface CanvasOperationHandle {
  succeed(): void;
  fail(reason: CanvasOutcomeReason): void;
  skip(reason: CanvasOutcomeReason): void;
  defer(reason: CanvasOutcomeReason): void;
  /**
   * Keeps the operation open until the returned function runs. That function
   * always runs its work, even after the operation was counted: tracking
   * observes an edit and never decides whether it happens. An operation still
   * open when the page closes is not counted, since a save in flight then is
   * finished by its keepalive request.
   */
  continueLater(): (run: (op: CanvasOperationHandle) => void) => void;
  /** Labels a `style_commit` by kind of change; ignored for other operations. */
  setStyleKind(kind: CanvasStyleKind): void;
}

const KNOWN_REASONS = new Set<string>(CANVAS_OUTCOME_REASONS);

// Higher wins when one operation reports several outcomes.
const OUTCOME_RANK: Record<ReportedOutcome, number> = {
  skipped: 1,
  succeeded: 2,
  deferred: 3,
  failed: 4,
};

function normalizeReason(reason: unknown): CanvasOutcomeReason {
  return typeof reason === "string" && KNOWN_REASONS.has(reason)
    ? (reason as CanvasOutcomeReason)
    : "unknown";
}

const UNTRACKED_HANDLE: CanvasOperationHandle = {
  succeed: () => {},
  fail: () => {},
  skip: () => {},
  defer: () => {},
  setStyleKind: () => {},
  continueLater: () => (run) => run(UNTRACKED_HANDLE),
};

class Operation {
  private outcome: ReportedOutcome | null = null;
  private reason: CanvasOutcomeReason = "none";
  private styleKind: CanvasStyleKind | undefined;
  private openParts = 1;
  private recorded = false;

  readonly handle: CanvasOperationHandle = {
    succeed: () => this.report("succeeded", "none"),
    fail: (reason) => this.report("failed", reason),
    skip: (reason) => this.report("skipped", reason),
    defer: (reason) => this.report("deferred", reason),
    setStyleKind: (kind) => {
      this.styleKind ??= kind;
    },
    continueLater: () => {
      if (this.recorded) return (run) => run(UNTRACKED_HANDLE);
      this.openParts += 1;
      let resumed = false;
      return (run) => {
        if (resumed || this.recorded) return run(UNTRACKED_HANDLE);
        resumed = true;
        this.runPart(run);
      };
    },
  };

  constructor(
    private readonly operation: CanvasOperation,
    // Fixed at the start: a save can finish after the user changed design.
    private readonly designId: string | undefined,
  ) {}

  runPart<T>(run: (op: CanvasOperationHandle) => T): T {
    const previous = activeOperation;
    activeOperation = this;
    let result: T;
    try {
      result = run(this.handle);
    } catch (error) {
      this.report("failed", "exception");
      this.releasePart();
      throw error;
    } finally {
      activeOperation = previous;
    }
    if (!isPromiseLike(result)) {
      this.releasePart();
      return result;
    }
    return result.then(
      (value) => {
        this.releasePart();
        return value;
      },
      (error: unknown) => {
        this.report("failed", "exception");
        this.releasePart();
        throw error;
      },
    ) as T;
  }

  private report(outcome: ReportedOutcome, reason: CanvasOutcomeReason): void {
    if (this.recorded) return;
    if (this.outcome && OUTCOME_RANK[this.outcome] >= OUTCOME_RANK[outcome]) {
      return;
    }
    this.outcome = outcome;
    this.reason = outcome === "succeeded" ? "none" : normalizeReason(reason);
  }

  private releasePart(): void {
    this.openParts -= 1;
    if (this.openParts > 0 || this.recorded) return;
    this.recorded = true;
    recordCanvasOutcome(
      this.operation,
      this.outcome ?? "unsettled",
      this.outcome ? this.reason : "none",
      { designId: this.designId, styleKind: this.styleKind },
    );
  }
}

function isPromiseLike<T>(value: T): value is T & PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

let activeOperation: Operation | null = null;

/**
 * Runs one canvas command and counts exactly one outcome for it. A command
 * that runs inside another one reports into the outer operation, so a nudge
 * that commits styles counts once. Nesting is tracked only synchronously:
 * work after an `await` or a timer is its own operation unless it is resumed
 * through `continueLater()`.
 */
export function runCanvasOperation<T>(
  operation: CanvasOperation,
  run: (op: CanvasOperationHandle) => T,
): T {
  if (activeOperation) return run(activeOperation.handle);
  return new Operation(operation, currentDesignId).runPart(run);
}

/**
 * Like `runCanvasOperation`, but never joins an operation already running.
 * For work that outlives the edit that started it, such as a queued save,
 * which also passes the design it was queued for.
 */
export function runDetachedCanvasOperation<T>(
  operation: CanvasOperation,
  run: (op: CanvasOperationHandle) => T,
  options: { designId?: string } = {},
): T {
  const previous = activeOperation;
  activeOperation = null;
  try {
    const designId = "designId" in options ? options.designId : currentDesignId;
    return new Operation(operation, designId).runPart(run);
  } finally {
    activeOperation = previous;
  }
}

interface PendingCount {
  operation: CanvasOperation | "overflow";
  outcome: CanvasOutcome;
  reason: CanvasOutcomeReason;
  readyBucket?: CanvasLoadReadyBucket;
  styleKind?: CanvasStyleKind;
  designId: string | undefined;
  count: number;
}

const pendingCounts = new Map<string, PendingCount>();
const failuresSentThisPage = new Set<string>();
let windowStartedAt: number | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let listenersInstalled = false;
let currentDesignId: string | undefined;
let viewerSignedIn: boolean | undefined;

/** Counts outcomes directly, for boundaries that already know them. */
export function recordCanvasOutcome(
  operation: CanvasOperation,
  outcome: CanvasOutcome,
  reason: CanvasOutcomeReason,
  options: {
    count?: number;
    readyBucket?: CanvasLoadReadyBucket;
    styleKind?: CanvasStyleKind;
    designId?: string;
  } = {},
): void {
  // Tracking runs inside edit and save paths, so it must never throw into them.
  try {
    const count = options.count ?? 1;
    if (!Number.isInteger(count) || count <= 0) return;
    const normalizedReason = normalizeReason(reason);
    const { key, entry } = addCount(
      {
        operation,
        outcome,
        reason: normalizedReason,
        readyBucket:
          operation === "canvas_load" ? options.readyBucket : undefined,
        styleKind: operation === "style_commit" ? options.styleKind : undefined,
        designId: "designId" in options ? options.designId : currentDesignId,
      },
      count,
    );
    installListeners();

    const failureKey = `${operation}|${normalizedReason}`;
    if (
      (outcome === "failed" || outcome === "unsettled") &&
      entry.operation !== "overflow" &&
      !failuresSentThisPage.has(failureKey)
    ) {
      failuresSentThisPage.add(failureKey);
      sendKeys([key]);
    }
    armFlushTimer();
  } catch {
    // coercion-ok: losing a count is preferable to failing the edit it describes.
  }
}

function addCount(
  fields: Omit<PendingCount, "count">,
  count: number,
): { key: string; entry: PendingCount } {
  let key = [
    fields.operation,
    fields.outcome,
    fields.reason,
    fields.readyBucket ?? "",
    fields.styleKind ?? "",
    fields.designId ?? "",
  ].join("|");
  let entry = pendingCounts.get(key);
  if (!entry && pendingCounts.size >= MAX_PENDING_KEYS) {
    // The overflow key keeps the outcome so the success rate stays honest.
    key = `overflow|${fields.outcome}|${fields.designId ?? ""}`;
    entry = pendingCounts.get(key);
    fields = {
      operation: "overflow",
      outcome: fields.outcome,
      reason: "overflow",
      designId: fields.designId,
    };
  }
  if (!entry) {
    entry = {
      operation: fields.operation,
      outcome: fields.outcome,
      reason: fields.reason,
      ...(fields.readyBucket ? { readyBucket: fields.readyBucket } : {}),
      ...(fields.styleKind ? { styleKind: fields.styleKind } : {}),
      designId: fields.designId,
      count: 0,
    };
    pendingCounts.set(key, entry);
  }
  entry.count += count;
  windowStartedAt ??= Date.now();
  return { key, entry };
}

function newBatchId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

// Nothing is sent while the page is hidden: the editor's own keepalive save
// runs at close, keepalive requests share one 64 KiB budget, and a count sent
// then could get that save rejected. Counts wait in memory until the page
// shows again. A tab hides before it closes, so closing it loses what is
// pending: at most one window, never a failure already sent at once.
function sendKeys(keys: string[]): void {
  if (pageIsHidden()) return;
  // The relay needs a session, so counts wait until the viewer is known; a
  // signed-out viewer's go through the browser beacon instead.
  if (viewerSignedIn === undefined) return;
  const windowMs = windowStartedAt === null ? 0 : Date.now() - windowStartedAt;
  const batchId = newBatchId();
  for (const entry of keys.flatMap((key) => pendingCounts.get(key) ?? [])) {
    trackDesignRelay(
      CANVAS_OUTCOME_COUNTS_EVENT,
      {
        operation: entry.operation,
        outcome: entry.outcome,
        reason: entry.reason,
        ...(entry.readyBucket ? { ready_bucket: entry.readyBucket } : {}),
        ...(entry.styleKind ? { style_kind: entry.styleKind } : {}),
        count: entry.count,
        ...(entry.designId ? { design_id: entry.designId } : {}),
        batch_id: batchId,
        window_ms: windowMs,
      },
      { signedIn: viewerSignedIn },
    );
  }
  clearPending(keys);
}

function clearPending(keys: string[]): void {
  for (const key of keys) pendingCounts.delete(key);
  if (pendingCounts.size > 0) return;
  windowStartedAt = null;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
}

function armFlushTimer(): void {
  if (pendingCounts.size === 0 || flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushCanvasOutcomeCounts();
  }, CANVAS_OUTCOME_FLUSH_MS);
}

/** Sends every pending count now. Safe to call when nothing is pending. */
export function flushCanvasOutcomeCounts(): void {
  try {
    if (pendingCounts.size > 0) sendKeys([...pendingCounts.keys()]);
  } catch {
    // coercion-ok: losing a count is preferable to failing the page.
  }
}

function pageIsHidden(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

function handleVisibilityChange(): void {
  if (!pageIsHidden()) flushCanvasOutcomeCounts();
}

function installListeners(): void {
  if (listenersInstalled) return;
  try {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    listenersInstalled = true;
  } catch {
    // coercion-ok: without listeners counts still go out on the timer.
  }
}

/**
 * Who later counts belong to. `signedIn` is undefined while the session loads,
 * and counts wait for it. Counts already pending keep the design they were
 * recorded under.
 */
export function setCanvasOutcomeContext(context: {
  designId: string | undefined;
  signedIn: boolean | undefined;
}): void {
  try {
    currentDesignId = context.designId;
    viewerSignedIn = context.signedIn;
    installListeners();
    armFlushTimer();
  } catch {
    // coercion-ok: tracking context must never break the editor.
  }
}

/** The design new counts belong to, for work that reports later. */
export function currentCanvasOutcomeDesignId(): string | undefined {
  return currentDesignId;
}

/**
 * The editor closed its design: send what is pending and stop attributing new
 * counts to it. The viewer stays known, so late saves still go out.
 */
export function clearCanvasOutcomeDesign(): void {
  currentDesignId = undefined;
  flushCanvasOutcomeCounts();
}

type ReplayedEntry = { actionName?: string; key: string };

// Outbox keys of saves queued or in flight. A drain does not wait for them and
// can replay the same entry, which the live save already counts.
const liveSaveKeys = new Map<string, number>();

/** Marks a save's outbox entry as live until the returned function runs. */
export function holdLiveSaveFromReplayCounts(
  outboxKey: string | undefined,
): () => void {
  if (!outboxKey) return () => {};
  liveSaveKeys.set(outboxKey, (liveSaveKeys.get(outboxKey) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const open = (liveSaveKeys.get(outboxKey) ?? 1) - 1;
    if (open > 0) liveSaveKeys.set(outboxKey, open);
    else liveSaveKeys.delete(outboxKey);
  };
}

/**
 * Counts the file saves one outbox drain finished. The outbox also replays
 * frame geometry and tweaks, which are not canvas saves. Entries that failed
 * stay queued and return on the next drain, which runs on every return to the
 * tab, so counting them would repeat one edit.
 */
export function recordSaveReplayOutcomes(
  result: {
    saved: ReadonlyArray<ReplayedEntry>;
    rebased: ReadonlyArray<{ entry: ReplayedEntry; error: unknown }>;
    dropped: ReadonlyArray<{ entry: ReplayedEntry }>;
  },
  designId: string | undefined,
): void {
  const fileSaves = (entries: ReadonlyArray<ReplayedEntry>) =>
    entries.filter(
      (entry) =>
        entry.actionName === "update-file" && !liveSaveKeys.has(entry.key),
    ).length;
  const replays = [
    ["succeeded", "none", fileSaves(result.saved)],
    [
      "failed",
      "rebased",
      // A rejected restore claim is reconciled and replayed again, so only a
      // save the server's newer content replaced is a final rebase.
      fileSaves(
        result.rebased
          .filter(({ error }) => !isRejectedRestoreClaimError(error))
          .map(({ entry }) => entry),
      ),
    ],
    ["failed", "dropped", fileSaves(result.dropped.map(({ entry }) => entry))],
  ] as const;
  for (const [outcome, reason, count] of replays) {
    recordCanvasOutcome("save_replay", outcome, reason, { count, designId });
  }
}

/** Resets module state; the viewer starts unknown, as on a fresh page. */
export function __resetCanvasOutcomeTrackingForTests(): void {
  if (listenersInstalled) {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    listenersInstalled = false;
  }
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  pendingCounts.clear();
  failuresSentThisPage.clear();
  activeOperation = null;
  liveSaveKeys.clear();
  windowStartedAt = null;
  currentDesignId = undefined;
  viewerSignedIn = undefined;
}
