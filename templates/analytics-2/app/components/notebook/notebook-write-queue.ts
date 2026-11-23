import type { z } from "zod";

import { draftAppLayout } from "../../../shared/app-layout";
import {
  duplicateContents,
  editContents,
  gapPosition,
  insertContents,
  symbolNames,
} from "../../../shared/notebook-cell-edits";
import {
  notebookCommandSchema,
  operationReceiptSchema,
  type NotebookCell,
  type NotebookChange,
  type NotebookCommand,
  type NotebookEvent,
  type NotebookSnapshot,
  type OperationReceipt,
  type notebookChangesInputSchema,
  type notebookChangesReadSchema,
  type notebookOperationReadSchema,
  type notebookSnapshotReadSchema,
  type Revision,
} from "../../../shared/notebook-operations";
import { notebookSectionInsertPosition } from "../../../shared/notebook-sections";
import { CONTRACT_VERSION } from "../../../shared/notebook-snapshot-contract";
import { normalizeProjectTitle } from "../../lib/model/contracts";
import { compareOrder, orderForInsertion } from "../../lib/model/order";

type SnapshotRef = NotebookSnapshot["snapshot"];
type AppliedReceipt = Extract<OperationReceipt, { status: "applied" }>;
type QueuedChange = Exclude<NotebookChange, { type: "set-app" }>;

export type NotebookOperationScope = {
  accountId: string;
  workspaceId: string;
  projectId: string;
  workingVersionId: string;
};

export type NotebookOperationTransport = {
  apply(
    command: NotebookCommand,
    signal: AbortSignal,
  ): Promise<OperationReceipt>;
  receipt(
    input: { projectId: string; opId: string },
    signal: AbortSignal,
  ): Promise<z.infer<typeof notebookOperationReadSchema>>;
  changes(
    input: Omit<z.input<typeof notebookChangesInputSchema>, "projectId"> & {
      projectId: string;
    },
    signal: AbortSignal,
  ): Promise<z.infer<typeof notebookChangesReadSchema>>;
  snapshot(
    input: { projectId: string },
    signal: AbortSignal,
  ): Promise<z.infer<typeof notebookSnapshotReadSchema>>;
};

type PendingStatus =
  | "queued"
  | "sending"
  | "awaiting_receipt"
  | "conflict"
  | "failed";
type PauseReason = "offline" | "access" | "lineage";
type BarrierTarget =
  | { type: "run"; cellIds: readonly string[] }
  | { type: "order" }
  | { type: "full" };

type PendingOperation = {
  opId: string;
  changes: QueuedChange[];
  observedHead: SnapshotRef["head"];
  keys: Set<string>;
  status: PendingStatus;
  readyAt: number;
  sealed: boolean;
  attempts: number;
  command?: NotebookCommand;
  receipt?: OperationReceipt | undefined;
  error?: unknown;
  result: Promise<OperationReceipt>;
  resolve: (receipt: OperationReceipt) => void;
  reject: (error: unknown) => void;
};

type OperationView = {
  accepted: NotebookSnapshot | null;
  effective: NotebookSnapshot | null;
  pending: readonly Readonly<
    Pick<PendingOperation, "opId" | "changes" | "status" | "receipt" | "error">
  >[];
  hasUnsavedChanges: boolean;
  paused: boolean;
  pauseReason: PauseReason | null;
  error: unknown;
};

const DEBOUNCE_MS = 500;
const RETRY_LIMIT = 3;
const INITIAL_REVISION =
  notebookCommandSchema.shape.observedHead.shape.revision.parse("0");

class NotebookQueueError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function textEdit(
  change: NotebookChange,
): change is Extract<NotebookChange, { type: "set-code" | "set-text" }> {
  return change.type === "set-code" || change.type === "set-text";
}

function cellKey(id: string) {
  return `cell:${id}`;
}

function labelKey(id: string) {
  return `label:${id}`;
}

function changeKeys(change: QueuedChange): string[] {
  switch (change.type) {
    case "set-metadata":
      return ["metadata"];
    case "set-label":
      return [labelKey(change.cellId)];
    case "move":
    case "move-to-section":
    case "group-section":
    case "remove-section":
      return ["order"];
    case "insert":
    case "delete":
      return ["order", cellKey(change.cellId), labelKey(change.cellId)];
    case "duplicate":
      return [
        "order",
        cellKey(change.cellId),
        labelKey(change.cellId),
        cellKey(change.fromCellId),
        labelKey(change.fromCellId),
      ];
    case "set-chart-config":
    case "set-metric-config":
    case "set-code":
    case "set-input-config":
    case "set-input-default":
    case "set-output-name":
    case "set-source":
    case "set-section":
    case "set-text":
      return [cellKey(change.cellId)];
  }
}

function overlaps(keys: Set<string>, other: Set<string>) {
  return [...keys].some((key) => other.has(key));
}

function applyDelta(
  base: NotebookSnapshot,
  receipt: AppliedReceipt,
): NotebookSnapshot {
  const cells = new Map(base.cells.map((cell) => [cell.id, cell]));
  for (const { cellId } of receipt.delta.tombstones) cells.delete(cellId);
  for (const cell of receipt.delta.cells) cells.set(cell.id, cell);
  const ordered = [...cells.values()].sort((a, b) =>
    compareOrder(a.contents.order, b.contents.order),
  );
  const layoutRevision = receipt.delta.resources.layoutRevision;
  const appLayout =
    receipt.delta.appLayout ??
    (layoutRevision === base.resources.layoutRevision
      ? base.appLayout
      : draftAppLayout(ordered, layoutRevision));
  return {
    ...base,
    snapshot: receipt.impact.snapshot,
    resources: receipt.delta.resources,
    metadata: receipt.delta.metadata ?? base.metadata,
    cells: ordered,
    ...(appLayout ? { appLayout } : {}),
  };
}

function projectPending(
  base: NotebookSnapshot,
  pending: PendingOperation[],
): NotebookSnapshot {
  let metadata = base.metadata;
  let cells = base.cells;
  for (const entry of pending) {
    const retained = entry.status === "conflict" || entry.status === "failed";
    for (const change of entry.changes) {
      if (retained && !textEdit(change)) continue;
      if (change.type === "set-metadata") {
        const { title, description, statusId } = change.metadata;
        metadata = {
          title:
            title === undefined ? metadata.title : normalizeProjectTitle(title),
          description: description ?? metadata.description,
          statusId: statusId === undefined ? metadata.statusId : statusId,
        };
        continue;
      }
      const cell = cells.find(({ id }) => id === change.cellId);
      if (
        change.type === "group-section" ||
        change.type === "move-to-section" ||
        change.type === "remove-section"
      )
        continue;
      if (change.type === "delete") {
        cells = cells.filter(({ id }) => id !== change.cellId);
        continue;
      }
      if (
        change.type === "insert" ||
        change.type === "duplicate" ||
        change.type === "move"
      ) {
        const others = cells.filter(({ id }) => id !== change.cellId);
        const parentSectionId =
          change.type === "insert" ? change.parentSectionId : undefined;
        const position =
          parentSectionId === undefined
            ? gapPosition(others, change.gap)
            : notebookSectionInsertPosition(
                others,
                parentSectionId,
                change.gap,
              );
        if (position === null) continue;
        const order = orderForInsertion(
          others.map(({ contents }) => contents.order),
          position,
        );
        let next: NotebookCell;
        if (change.type === "move") {
          if (!cell) continue;
          next = { ...cell, contents: { ...cell.contents, order } };
        } else {
          if (cell) continue;
          const names = symbolNames(others);
          const source =
            change.type === "duplicate"
              ? cells.find(({ id }) => id === change.fromCellId)
              : undefined;
          if (change.type === "duplicate" && !source) continue;
          const contents =
            change.type === "insert"
              ? insertContents(change.contents, change.cellId, order, names)
              : source && {
                  ...duplicateContents(source.contents, names),
                  id: change.cellId,
                  order,
                };
          if (!contents) continue;
          const timestamp = new Date(entry.readyAt).toISOString();
          next = {
            id: change.cellId,
            projectId: base.snapshot.projectId,
            versionId: base.snapshot.head.versionId,
            contents:
              parentSectionId == null
                ? contents
                : { ...contents, parentSectionId },
            createdAt: timestamp,
            updatedAt: timestamp,
            revision: INITIAL_REVISION,
            labelRevision: INITIAL_REVISION,
          };
        }
        others.splice(position, 0, next);
        cells = others;
        continue;
      }
      if (!cell) continue;
      const contents = editContents(cell.contents, change);
      if (contents)
        cells = cells.map((row) =>
          row === cell ? { ...cell, contents } : row,
        );
    }
  }
  return { ...base, metadata, cells };
}

function statusOf(error: unknown) {
  if (typeof error !== "object" || error === null || !("status" in error))
    return undefined;
  return typeof error.status === "number" ? error.status : undefined;
}

function conflictReceipt(error: unknown) {
  if (
    statusOf(error) !== 409 ||
    typeof error !== "object" ||
    error === null ||
    !("errorCode" in error) ||
    error.errorCode !== "notebook_conflict" ||
    !("details" in error) ||
    typeof error.details !== "object" ||
    error.details === null ||
    !("receipt" in error.details)
  )
    return undefined;
  const parsed = operationReceiptSchema.safeParse(error.details.receipt);
  return parsed.success && parsed.data.status === "conflict"
    ? parsed.data
    : undefined;
}

function accessLost(error: unknown) {
  const status = statusOf(error);
  if (status === 401 || status === 403) return true;
  return (
    status === 404 &&
    typeof error === "object" &&
    error !== null &&
    (!("errorCode" in error) || error.errorCode === "project_not_found")
  );
}

function retryable(error: unknown) {
  const status = statusOf(error);
  return (
    status === undefined ||
    status >= 500 ||
    status === 408 ||
    status === 425 ||
    status === 429
  );
}

function belongsToScope(ref: SnapshotRef, scope: NotebookOperationScope) {
  return (
    ref.workspaceId === scope.workspaceId && ref.projectId === scope.projectId
  );
}

function follows(base: NotebookSnapshot, receipt: AppliedReceipt) {
  return (
    BigInt(receipt.eventSeq) === BigInt(base.snapshot.eventSeq) + 1n &&
    receipt.previousHead.versionId === base.snapshot.head.versionId &&
    receipt.previousHead.revision === base.snapshot.head.revision &&
    BigInt(receipt.nextHead.revision) >= BigInt(base.snapshot.head.revision)
  );
}

type GuardUpdate = { before: Revision; after: Revision };

function localGuardUpdates(command: NotebookCommand, receipt: AppliedReceipt) {
  const updated = new Map<string, GuardUpdate>();
  const deltaCells = new Map(
    receipt.delta.cells.map((cell) => [cell.id, cell]),
  );
  for (const change of command.changes) {
    if (change.type === "set-app") continue;
    if ("expectedOrderRevision" in change)
      updated.set("order", {
        before: change.expectedOrderRevision,
        after: receipt.delta.resources.orderRevision,
      });
    if (change.type === "set-metadata") {
      updated.set("metadata", {
        before: change.expectedMetadataRevision,
        after: receipt.delta.resources.metadataRevision,
      });
      continue;
    }
    const cell = deltaCells.get(change.cellId);
    if (!cell) continue;
    if (change.type === "insert" || change.type === "duplicate") {
      updated.set(cellKey(cell.id), {
        before: INITIAL_REVISION,
        after: cell.revision,
      });
      updated.set(labelKey(cell.id), {
        before: INITIAL_REVISION,
        after: cell.labelRevision,
      });
    } else if (change.type === "set-label") {
      updated.set(labelKey(cell.id), {
        before: change.expectedLabelRevision,
        after: cell.labelRevision,
      });
    } else if (change.type !== "delete" && "expectedRevision" in change) {
      updated.set(cellKey(cell.id), {
        before: change.expectedRevision,
        after: cell.revision,
      });
    }
  }
  return updated;
}

function updateLocalGuards(
  change: QueuedChange,
  updates: Map<string, GuardUpdate>,
): QueuedChange {
  const revision = (key: string, expected: Revision) => {
    const update = updates.get(key);
    return update?.before === expected ? update.after : expected;
  };
  if (change.type === "set-metadata")
    return {
      ...change,
      expectedMetadataRevision: revision(
        "metadata",
        change.expectedMetadataRevision,
      ),
    };
  if (change.type === "set-label")
    return {
      ...change,
      expectedLabelRevision: revision(
        labelKey(change.cellId),
        change.expectedLabelRevision,
      ),
    };
  if (change.type === "duplicate")
    return {
      ...change,
      expectedRevision: revision(
        cellKey(change.fromCellId),
        change.expectedRevision,
      ),
      expectedOrderRevision: revision("order", change.expectedOrderRevision),
    };
  if (change.type === "delete")
    return {
      ...change,
      expectedRevision: revision(
        cellKey(change.cellId),
        change.expectedRevision,
      ),
      expectedOrderRevision: revision("order", change.expectedOrderRevision),
    };
  if ("expectedOrderRevision" in change)
    return {
      ...change,
      expectedOrderRevision: revision("order", change.expectedOrderRevision),
    };
  return {
    ...change,
    expectedRevision: revision(cellKey(change.cellId), change.expectedRevision),
  };
}

function barrierIncludes(target: BarrierTarget, entry: PendingOperation) {
  if (target.type === "full") return true;
  if (target.type === "order") return entry.keys.has("order");
  return entry.changes.some((change) => {
    if (change.type === "set-metadata" || change.type === "set-label")
      return false;
    return target.cellIds.includes(change.cellId);
  });
}

export class NotebookOperations {
  private accepted: NotebookSnapshot | null = null;
  private entries: PendingOperation[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller = new AbortController();
  private catchup: Promise<void> | undefined;
  private wakeVersion = 0;
  private pauseReason: PauseReason | null = null;
  private needsSnapshot = false;
  private disposed = false;
  private error: unknown = null;
  private listeners = new Set<() => void>();
  private barriers = new Set<Set<PendingOperation>>();
  private view: OperationView;

  constructor(
    private readonly scope: NotebookOperationScope,
    private readonly transport: NotebookOperationTransport,
    initial?: NotebookSnapshot,
  ) {
    if (
      initial &&
      belongsToScope(initial.snapshot, scope) &&
      initial.snapshot.head.versionId === scope.workingVersionId
    )
      this.accepted = initial;
    this.view = this.currentView();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.view;

  private currentView(): OperationView {
    const accepted =
      this.needsSnapshot || this.pauseReason === "lineage"
        ? null
        : this.accepted;
    return {
      accepted,
      effective: accepted && projectPending(accepted, this.entries),
      pending: accepted
        ? this.entries.map(({ opId, changes, status, error, receipt }) => ({
            opId,
            changes,
            status,
            error,
            receipt,
          }))
        : [],
      hasUnsavedChanges: this.entries.length > 0,
      paused: this.pauseReason !== null,
      pauseReason: this.pauseReason,
      error: this.error,
    };
  }

  private publish() {
    this.view = this.currentView();
    for (const listener of this.listeners) listener();
    this.schedule();
  }

  dispatch = (input: NotebookChange | NotebookChange[]) => {
    const base = this.getSnapshot().accepted;
    if (!base || this.disposed)
      throw new NotebookQueueError("notebook_unavailable");
    const { changes, opId } = notebookCommandSchema.parse({
      protocol: CONTRACT_VERSION,
      projectId: this.scope.projectId,
      workingVersionId: this.scope.workingVersionId,
      observedHead: base.snapshot.head,
      opId: crypto.randomUUID(),
      changes: Array.isArray(input) ? input : [input],
    });
    if (!changes.every((change) => change.type !== "set-app"))
      throw new NotebookQueueError("layout_change_requires_set_app");
    for (const change of changes) {
      if (change.type === "set-code")
        change.source = change.source.replaceAll("\r\n", "\n");
      if (change.type === "set-text")
        change.text = change.text.replaceAll("\r\n", "\n");
    }
    const keys = new Set(changes.flatMap(changeKeys));
    const onlyChange = changes.length === 1 ? changes[0] : undefined;
    const debounced = onlyChange && textEdit(onlyChange);
    const now = Date.now();
    const last = debounced
      ? [...this.entries].reverse().find((entry) => overlaps(entry.keys, keys))
      : this.entries.at(-1);
    if (last?.status === "queued" && !last.sealed) {
      const prior = last.changes.length === 1 ? last.changes[0] : undefined;
      if (
        debounced &&
        prior &&
        textEdit(prior) &&
        prior.cellId === onlyChange.cellId &&
        prior.type === onlyChange.type
      ) {
        last.changes = [
          { ...onlyChange, expectedRevision: prior.expectedRevision },
        ];
        last.readyAt = now + DEBOUNCE_MS;
        this.publish();
        return { opId: last.opId, receipt: last.result };
      }
      if (
        !debounced &&
        !(prior && textEdit(prior)) &&
        last.observedHead.revision === base.snapshot.head.revision &&
        last.changes.length + changes.length <= 200 &&
        !overlaps(last.keys, keys)
      ) {
        last.changes = [...last.changes, ...changes];
        for (const key of keys) last.keys.add(key);
        this.publish();
        return { opId: last.opId, receipt: last.result };
      }
    }

    const promise = new Promise<OperationReceipt>((resolve, reject) => {
      this.entries.push({
        opId,
        changes,
        keys,
        resolve,
        reject,
        observedHead: base.snapshot.head,
        status: "queued",
        readyAt: now + (debounced ? DEBOUNCE_MS : 0),
        sealed: false,
        attempts: 0,
        get result() {
          return promise;
        },
      });
    });
    void promise.catch(() => undefined);
    this.publish();
    return { opId, receipt: promise };
  };

  discard = (opId: string) => {
    const entry = this.entries.find((candidate) => candidate.opId === opId);
    if (
      !entry ||
      entry.status === "sending" ||
      entry.status === "awaiting_receipt"
    )
      return;
    entry.reject(new NotebookQueueError("notebook_edit_discarded"));
    this.entries = this.entries.filter((candidate) => candidate !== entry);
    this.publish();
  };

  private schedule() {
    clearTimeout(this.timer);
    if (this.pauseReason || this.needsSnapshot || this.disposed) return;
    const next = this.readyEntries().reduce(
      (earliest, entry) => Math.min(earliest, entry.readyAt),
      Infinity,
    );
    if (Number.isFinite(next))
      this.timer = setTimeout(
        () => this.drain(),
        Math.max(0, next - Date.now()),
      );
  }

  private readyEntries() {
    return this.entries.filter(
      (entry, index) =>
        (entry.status === "queued" ||
          (entry.status === "awaiting_receipt" &&
            !entry.receipt &&
            !this.catchup &&
            entry.attempts < RETRY_LIMIT)) &&
        [...this.barriers].every((allowed) => allowed.has(entry)) &&
        !this.entries
          .slice(0, index)
          .some((prior) => overlaps(prior.keys, entry.keys)),
    );
  }

  private drain() {
    if (this.pauseReason || this.needsSnapshot || this.disposed) return;
    for (const entry of this.readyEntries()) {
      if (entry.readyAt <= Date.now()) void this.send(entry);
    }
    this.schedule();
  }

  private async send(entry: PendingOperation) {
    const { signal } = this.controller;
    const recover = entry.status === "awaiting_receipt";
    const command = (entry.command ??= notebookCommandSchema.parse({
      protocol: CONTRACT_VERSION,
      projectId: this.scope.projectId,
      workingVersionId: this.scope.workingVersionId,
      observedHead: entry.observedHead,
      opId: entry.opId,
      changes: entry.changes,
    }));
    entry.status = "sending";
    entry.error = undefined;
    this.publish();
    try {
      if (recover) {
        const read = await this.transport.receipt(
          { projectId: command.projectId, opId: command.opId },
          signal,
        );
        if (signal.aborted || entry.receipt) return;
        if (read.status === "found") {
          this.join(entry, read.receipt);
          return;
        }
      }
      const receipt = await this.transport.apply(command, signal);
      if (!signal.aborted) this.join(entry, receipt);
    } catch (error) {
      if (signal.aborted || entry.receipt) return;
      const receipt = conflictReceipt(error);
      if (receipt?.opId === entry.opId) {
        this.join(entry, receipt);
        return;
      }
      entry.error = error;
      if (accessLost(error)) {
        this.pause("access");
        return;
      }
      if (retryable(error)) {
        entry.status = "awaiting_receipt";
        entry.attempts += 1;
        const baseDelay = 250 * 2 ** (entry.attempts - 1);
        const jitter = 0.75 + Math.random() * 0.5;
        entry.readyAt = Date.now() + Math.round(baseDelay * jitter);
      } else {
        entry.status = "failed";
        entry.reject(error);
      }
      this.publish();
    }
  }

  private join(entry: PendingOperation, receipt: OperationReceipt) {
    if (receipt.opId !== entry.opId)
      throw new NotebookQueueError("notebook_receipt_mismatch");
    if (entry.receipt) return;
    if (
      receipt.status === "applied" &&
      !belongsToScope(receipt.impact.snapshot, this.scope)
    )
      throw new NotebookQueueError("notebook_receipt_scope_mismatch");
    entry.receipt = receipt;
    entry.attempts = 0;
    entry.status =
      receipt.status === "conflict" ? "conflict" : "awaiting_receipt";
    entry.resolve(receipt);
    if (receipt.status === "applied" && entry.command) {
      const updates = localGuardUpdates(entry.command, receipt);
      for (const later of this.entries.slice(this.entries.indexOf(entry) + 1)) {
        if (later.status === "queued")
          later.changes = later.changes.map((change) =>
            updateLocalGuards(change, updates),
          );
      }
    }
    const gap =
      receipt.status === "applied"
        ? !this.advance(receipt)
        : !this.accepted ||
          BigInt(receipt.eventSeq) > BigInt(this.accepted.snapshot.eventSeq);
    if (receipt.status === "conflict" && receipt.reason === "lineage_changed") {
      this.needsSnapshot = true;
      void this.reconnect();
    }
    this.prune();
    this.publish();
    if (gap) void this.reconnect();
  }

  private advance(receipt: AppliedReceipt) {
    if (!this.accepted) return false;
    if (BigInt(receipt.eventSeq) <= BigInt(this.accepted.snapshot.eventSeq))
      return true;
    if (
      receipt.nextHead.versionId !== this.scope.workingVersionId ||
      !follows(this.accepted, receipt)
    )
      return false;
    this.accepted = applyDelta(this.accepted, receipt);
    return true;
  }

  private prune() {
    const cursor = this.accepted?.snapshot.eventSeq;
    this.entries = this.entries.filter(
      ({ receipt }) =>
        receipt?.status !== "no_change" &&
        (receipt?.status !== "applied" ||
          cursor === undefined ||
          BigInt(receipt.eventSeq) > BigInt(cursor)),
    );
  }

  receive = async (event: NotebookEvent) => {
    if (this.pauseReason || this.disposed) return;
    if (!this.consume(event)) await this.reconnect();
    this.publish();
  };

  private consume(event: NotebookEvent) {
    const { receipt } = event;
    if (!belongsToScope(receipt.impact.snapshot, this.scope)) return true;
    if (event.sequence !== receipt.eventSeq || !this.advance(receipt))
      return false;
    const own =
      event.principalId === this.scope.accountId &&
      this.entries.find((entry) => entry.command?.opId === receipt.opId);
    if (own) this.join(own, receipt);
    return true;
  }

  reconnect = () => {
    if (this.pauseReason || this.disposed) return Promise.resolve();
    if (this.catchup) {
      this.wakeVersion += 1;
      return this.catchup;
    }
    const { signal } = this.controller;
    this.catchup = Promise.resolve()
      .then(async () => {
        let observedWake: number;
        do {
          observedWake = this.wakeVersion;
          await this.reconcile(signal);
        } while (observedWake !== this.wakeVersion && !signal.aborted);
      })
      .catch((error: unknown) => {
        if (signal.aborted) return;
        this.error = error;
        if (accessLost(error)) this.pause("access");
      })
      .finally(() => {
        if (signal.aborted) return;
        this.catchup = undefined;
        this.prune();
        this.publish();
      });
    return this.catchup;
  };

  private async reconcile(signal: AbortSignal) {
    if (this.needsSnapshot || !this.accepted) await this.readSnapshot(signal);
    for (const entry of this.entries) {
      signal.throwIfAborted();
      if (entry.status !== "awaiting_receipt" || entry.receipt) continue;
      const read = await this.transport.receipt(
        { projectId: this.scope.projectId, opId: entry.opId },
        signal,
      );
      signal.throwIfAborted();
      if (read.status === "found") this.join(entry, read.receipt);
    }
    await this.readChanges(signal);
  }

  private async readChanges(signal: AbortSignal) {
    const projectId = this.scope.projectId;
    while (!signal.aborted && this.accepted) {
      const after = this.accepted.snapshot.eventSeq;
      const page = await this.transport.changes(
        { projectId, after, limit: 50 },
        signal,
      );
      signal.throwIfAborted();
      if (page.status === "pending")
        throw new NotebookQueueError("notebook_not_ready");
      if (
        page.status === "expired" ||
        page.events.some((event) => !this.consume(event)) ||
        BigInt(page.cursor) > BigInt(this.accepted.snapshot.eventSeq)
      ) {
        await this.readSnapshot(signal);
        break;
      }
      if (!page.hasMore) break;
      if (BigInt(this.accepted.snapshot.eventSeq) <= BigInt(after))
        throw new NotebookQueueError("notebook_cursor_not_advanced");
    }
    signal.throwIfAborted();
    this.error = null;
    for (const entry of this.entries) {
      if (
        entry.status === "awaiting_receipt" &&
        !entry.receipt &&
        entry.attempts >= RETRY_LIMIT
      ) {
        entry.attempts = 0;
        entry.readyAt = 0;
      }
    }
  }

  private async readSnapshot(signal: AbortSignal) {
    const snapshot = await this.transport.snapshot(
      { projectId: this.scope.projectId },
      signal,
    );
    if (signal.aborted) return;
    if (snapshot.status === "pending")
      throw new NotebookQueueError("notebook_not_ready");
    if (!belongsToScope(snapshot.snapshot, this.scope))
      throw new NotebookQueueError("notebook_snapshot_scope_mismatch");
    if (snapshot.snapshot.head.versionId !== this.scope.workingVersionId) {
      this.pause("lineage");
      return;
    }
    if (
      !this.accepted ||
      (BigInt(snapshot.snapshot.eventSeq) >=
        BigInt(this.accepted.snapshot.eventSeq) &&
        BigInt(snapshot.snapshot.head.revision) >=
          BigInt(this.accepted.snapshot.head.revision))
    )
      this.accepted = snapshot;
    this.needsSnapshot = false;
  }

  pause = (reason: PauseReason = "access") => {
    this.pauseReason = reason;
    this.needsSnapshot ||= reason === "access";
    clearTimeout(this.timer);
    this.controller.abort();
    this.catchup = undefined;
    for (const entry of this.entries) {
      if (entry.status === "sending") entry.status = "awaiting_receipt";
    }
    this.publish();
  };

  resume = async () => {
    if (this.disposed || this.pauseReason === "lineage") return;
    if (this.pauseReason) {
      this.pauseReason = null;
      this.controller = new AbortController();
    }
    await this.reconnect();
  };

  dispose = () => {
    this.disposed = true;
    this.pause();
    for (const entry of this.entries)
      entry.reject(new NotebookQueueError("notebook_closed"));
  };

  barrier = async (target: BarrierTarget): Promise<SnapshotRef> => {
    const allowed = new Set(this.entries);
    const selected = new Set(
      [...allowed].filter((entry) => barrierIncludes(target, entry)),
    );
    const prerequisites = new Set<string>();
    for (const entry of [...allowed].reverse()) {
      if (selected.has(entry) || overlaps(entry.keys, prerequisites)) {
        selected.add(entry);
        for (const key of entry.keys) prerequisites.add(key);
      }
    }
    this.barriers.add(allowed);
    for (const entry of allowed) entry.sealed = true;
    for (const entry of selected) {
      entry.readyAt = Math.min(entry.readyAt, Date.now());
    }
    this.drain();

    try {
      await new Promise<void>((resolve, reject) => {
        const check = () => {
          const failed = [...selected].find(
            (entry) =>
              entry.status === "failed" ||
              entry.status === "conflict" ||
              entry.attempts >= RETRY_LIMIT ||
              (!this.entries.includes(entry) && !entry.receipt),
          );
          if (this.pauseReason || this.error || failed) {
            unsubscribe();
            reject(
              failed?.error ??
                this.error ??
                new NotebookQueueError(
                  failed?.receipt?.status === "conflict"
                    ? failed.receipt.reason
                    : "notebook_barrier_unavailable",
                ),
            );
          } else if (
            [...selected].every((entry) => !this.entries.includes(entry))
          ) {
            unsubscribe();
            resolve();
          }
        };
        const unsubscribe = this.subscribe(check);
        check();
      });
      const accepted = this.getSnapshot().accepted;
      if (!accepted) throw new NotebookQueueError("notebook_unavailable");
      return accepted.snapshot;
    } finally {
      this.barriers.delete(allowed);
      this.schedule();
    }
  };
}
