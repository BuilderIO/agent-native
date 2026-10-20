import {
  WORKFLOW_STORE_LIMITS,
  WorkflowStoreError,
  type ItemStatusWriter,
  type WorkflowScope,
  type WorkflowStore,
} from "../adapter.js";
import {
  loopCounterKey,
  type EndOutcome,
  type ItemEvent,
  type ItemEventKind,
  type ItemState,
  type RunMode,
  type Wake,
  type WorkflowErrorCode,
} from "../contract.js";
import { EVENT_SUMMARY_BYTES, fitText } from "./bounds.js";
import {
  ATTEMPTS_COUNTER,
  END_STATUS,
  HOLD_GRACE_MS,
  ROUNDS_COUNTER,
  UNHELD_COUNTER,
} from "./constants.js";
import { heldByOf, holdContext, rowsOf } from "./holds.js";
import type { InvariantReport } from "./tripwire.js";
import type { FlowItem, ItemFailure } from "./types.js";

interface ItemRuntimeDeps {
  store: WorkflowStore;
  scope: WorkflowScope;
  workflowId: string;
  runId: string;
  graphVersion: number;
  mode: RunMode;
  /** Names this tick on every lease it takes. */
  leasedBy: string;
  items: ItemStatusWriter;
  signal: AbortSignal;
  now: () => Date;
  invariantBroken?: (report: InvariantReport) => void;
}

interface RecordedEventBase {
  itemId: string;
  nodeId?: string;
  summary: string;
  port?: string;
  receiptKey?: string;
  threadId?: string;
}

/** An `ended` event says how it ended and an `error` event says why, in fields of their own. */
type RecordedEvent =
  | (RecordedEventBase & { kind: Exclude<ItemEventKind, "ended" | "error"> })
  | (RecordedEventBase & { kind: "ended"; outcome: EndOutcome })
  | (RecordedEventBase & { kind: "error"; code: WorkflowErrorCode });

type EndResult = { ok: true } | { ok: false; failure: ItemFailure };

function chunks<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}

/**
 * Everything a tick does to items goes through here: leases, attempt counters,
 * the event trail, and moving an inbox item to its final status. In a dry or
 * test run the same calls are answered from memory and nothing item-shaped is
 * written but the events, which carry the run's mode.
 */
export class ItemRuntime {
  private readonly counters = new Map<string, Record<string, number>>();
  /**
   * What a loop pass has added to an item's counters in memory only. It is
   * written when the item parks again, in the same statement as the park, so a
   * pass that dies partway is repeated with the same counters and so the same
   * receipt keys, and does not count as a pass it never finished.
   */
  private readonly unwritten = new Map<string, Record<string, number>>();
  private readonly held = new Set<string>();
  /** Items whose row this tick holds parked: ending one clears its parking. */
  private readonly parkedRows = new Set<string>();
  private pending: ItemEvent[] = [];
  readonly ended: Record<EndOutcome, number> = {
    done: 0,
    dismissed: 0,
    needsManual: 0,
    released: 0,
  };
  /** Run totals: items taken by sources, and items that failed or were flagged. */
  taken = 0;
  failed = 0;
  needsCheck = 0;
  /** Waiting: items parked at a Wait, woken from one, or looked at and left waiting. */
  parked = 0;
  woke = 0;
  stillWaiting = 0;
  /** Loops: items sent back around, and items that ran out of passes. */
  sentBack = 0;
  loopLimited = 0;
  /** Parked items whose Wait was gone or changed, ended for a person. */
  graphChanged = 0;
  /** Retries: items parked after a failure, and items that re-entered the node they failed at. */
  retryParked = 0;
  retried = 0;
  /** Items a stopped run did not get to, set aside for the next tick, and items picked up again from there. */
  setAside = 0;
  continued = 0;
  /** Sources of a live run whose cursor was left unsaved because the engine dropped items the cursor covers. */
  readonly cursorsHeld: string[] = [];
  /** Rows a source's provider read and could not turn into items, for want of a title or a time. */
  skippedRows = 0;
  /**
   * Items this run could not set aside for the next one and left to be built
   * again from their source: while there are any, the run has not accounted for
   * everything it took, so the window and the cursors stay where they were.
   */
  heldBack = 0;
  private heldBackNote: string | undefined;
  /** When the last write of each item went out this tick: the moment its question was asked. */
  private readonly wroteAt = new Map<string, string>();
  /** How each item that ended this tick ended. */
  private readonly outcomes = new Map<string, EndOutcome>();
  /** Items a node folded into another one: nothing carries them on, so what is parked for them goes once the walk is settled. */
  private readonly folded: { item: FlowItem; nodeId: string }[] = [];
  /** Items a Split took apart, and the ids of what it made. */
  private readonly splits = new Map<
    string,
    { parent: FlowItem; nodeId: string; children: readonly string[] }
  >();

  constructor(private readonly deps: ItemRuntimeDeps) {}

  get live(): boolean {
    return this.deps.mode === "live";
  }

  private iso(): string {
    return this.deps.now().toISOString();
  }

  /**
   * Takes the items another tick does not hold or have parked. A dry run
   * takes nothing, so it sees every item and changes none.
   */
  async lease(
    items: readonly FlowItem[],
  ): Promise<{ won: FlowItem[]; skipped: FlowItem[] }> {
    if (!this.live || items.length === 0) {
      this.taken += items.length;
      return { won: [...items], skipped: [] };
    }
    const wonIds = new Set<string>();
    for (const ids of chunks(
      items.map((item) => item.id),
      WORKFLOW_STORE_LIMITS.itemBatchMax,
    )) {
      const states = await this.deps.store.leaseItems(this.deps.scope, {
        workflowId: this.deps.workflowId,
        graphVersion: this.deps.graphVersion,
        itemIds: ids,
        leasedBy: this.deps.leasedBy,
        now: this.iso(),
        skipParked: true,
      });
      for (const state of states) {
        wonIds.add(state.itemId);
        this.held.add(state.itemId);
        this.counters.set(state.itemId, { ...state.counters });
      }
    }
    this.taken += wonIds.size;
    return {
      won: items.filter((item) => wonIds.has(item.id)),
      skipped: items.filter((item) => !wonIds.has(item.id)),
    };
  }

  /**
   * Takes parked items whose wait may be over, for the resume pass. An item
   * another tick holds is left to it. What comes back is each row as it is
   * now, so an item another tick finished since the list was read shows up as
   * no longer parked.
   */
  async leaseParked(states: readonly ItemState[]): Promise<ItemState[]> {
    if (!this.live || states.length === 0) return [];
    const won: ItemState[] = [];
    for (const ids of chunks(
      states.map((state) => state.itemId),
      WORKFLOW_STORE_LIMITS.itemBatchMax,
    )) {
      const leased = await this.deps.store.leaseItems(this.deps.scope, {
        workflowId: this.deps.workflowId,
        graphVersion: this.deps.graphVersion,
        itemIds: ids,
        leasedBy: this.deps.leasedBy,
        now: this.iso(),
      });
      for (const state of leased) {
        this.held.add(state.itemId);
        this.counters.set(state.itemId, { ...state.counters });
        if (state.parkedAtNode !== undefined) {
          this.parkedRows.add(state.itemId);
        }
        won.push(state);
      }
    }
    return won;
  }

  /** An item that has no row yet gets one, so its counters have somewhere to live. */
  private async hold(itemId: string): Promise<void> {
    if (this.held.has(itemId)) return;
    const [state] = await this.deps.store.leaseItems(this.deps.scope, {
      workflowId: this.deps.workflowId,
      graphVersion: this.deps.graphVersion,
      itemIds: [itemId],
      leasedBy: this.deps.leasedBy,
      now: this.iso(),
    });
    if (!state) {
      throw new WorkflowStoreError(
        "lease_lost",
        `Item "${itemId}" is held by another run, so this one cannot count on it.`,
        { workflowId: this.deps.workflowId, itemId },
      );
    }
    this.held.add(itemId);
    this.counters.set(itemId, { ...state.counters });
  }

  async countersOf(itemId: string): Promise<Readonly<Record<string, number>>> {
    const cached = this.counters.get(itemId);
    if (cached) return cached;
    const state = await this.deps.store.getItemState(
      this.deps.scope,
      this.deps.workflowId,
      itemId,
    );
    const values = state ? { ...state.counters } : {};
    this.counters.set(itemId, values);
    return values;
  }

  /** Notes that the item's write went out at `at`: a reply Wait after it listens from then on. */
  wrote(itemId: string, at: string): void {
    const earlier = this.wroteAt.get(itemId);
    if (earlier === undefined || Date.parse(at) > Date.parse(earlier)) {
      this.wroteAt.set(itemId, at);
    }
  }

  lastWriteAt(itemId: string): string | undefined {
    return this.wroteAt.get(itemId);
  }

  /** Takes counters back to zero. A dry run does it in memory only. */
  private async clearCounter(itemId: string, counter: string): Promise<void> {
    const current = await this.countersOf(itemId);
    if (this.live) {
      await this.deps.store.clearCounters(this.deps.scope, {
        workflowId: this.deps.workflowId,
        itemId,
        counters: [counter],
      });
    }
    const { [counter]: _spent, ...rest } = current;
    this.counters.set(itemId, rest);
  }

  /**
   * Items came through a node, so the failures that came before it no longer
   * count against them: attempts are for one stretch of trouble, not for the
   * life of an item that is offered again every day.
   */
  async passed(items: readonly FlowItem[]): Promise<void> {
    for (const item of items) {
      const counters = await this.countersOf(item.id);
      if ((counters[ATTEMPTS_COUNTER] ?? 0) > 0) {
        await this.clearCounter(item.id, ATTEMPTS_COUNTER);
      }
    }
  }

  /** An item that could not be set aside and has no row to say so: the run is left unsettled. */
  holdBack(note: string): void {
    this.heldBack += 1;
    this.heldBackNote ??= note;
  }

  get heldBackMessage(): string | undefined {
    return this.heldBackNote;
  }

  /** Adds to a counter and returns the new value. A dry run counts in memory only. */
  async bump(itemId: string, counter: string, by = 1): Promise<number> {
    const current = await this.countersOf(itemId);
    let next: number;
    if (this.live) {
      await this.hold(itemId);
      // What a loop pass added in memory goes in with this write, so the
      // stored value is the one the caller already sees.
      const owed = this.unwritten.get(itemId)?.[counter] ?? 0;
      next = await this.deps.store.incrementCounter(this.deps.scope, {
        workflowId: this.deps.workflowId,
        itemId,
        counter,
        by: by + owed,
      });
      const left = { ...this.unwritten.get(itemId) };
      delete left[counter];
      this.unwritten.set(itemId, left);
    } else {
      next = (current[counter] ?? 0) + by;
    }
    this.counters.set(itemId, { ...current, [counter]: next });
    return next;
  }

  /**
   * Sends an item back around a loop: the pass counter goes up one, and so
   * does the round, so the writes of the next pass get keys of their own. Both
   * are in memory until the item parks again.
   */
  async sendBack(itemId: string, edgeId: string): Promise<number> {
    const current = await this.countersOf(itemId);
    const loopKey = loopCounterKey(edgeId);
    const iteration = (current[loopKey] ?? 0) + 1;
    this.counters.set(itemId, {
      ...current,
      [loopKey]: iteration,
      [ROUNDS_COUNTER]: (current[ROUNDS_COUNTER] ?? 0) + 1,
    });
    const owed = this.unwritten.get(itemId) ?? {};
    this.unwritten.set(itemId, {
      ...owed,
      [loopKey]: (owed[loopKey] ?? 0) + 1,
      [ROUNDS_COUNTER]: (owed[ROUNDS_COUNTER] ?? 0) + 1,
    });
    return iteration;
  }

  /**
   * Parks an item at a Wait, or parks it again with a later check. Its
   * counters go in with it, including what a loop pass has added. A dry or test
   * run writes nothing.
   */
  async park(
    item: FlowItem,
    args: { nodeId: string; wake: Wake; context: Record<string, unknown> },
  ): Promise<void> {
    if (!this.live) return;
    await this.hold(item.id);
    const counters = { ...(await this.countersOf(item.id)) };
    await this.parkedRowMustExist(item.id, args.nodeId, () =>
      this.deps.store.parkItem(this.deps.scope, {
        workflowId: this.deps.workflowId,
        itemId: item.id,
        leasedBy: this.deps.leasedBy,
        graphVersion: this.deps.graphVersion,
        nodeId: args.nodeId,
        wake: args.wake,
        context: args.context,
        counters,
      }),
    );
    // Parking ended the lease, and what was owed has been written.
    this.unwritten.delete(item.id);
    this.parkedRows.delete(item.id);
    this.held.delete(item.id);
    await this.holdRows(item, args);
  }

  /**
   * An item built from inbox rows (a list, a group, a whole-list answer) that
   * waits for a later run holds those rows too: parked for it, due after it,
   * so the source does not offer them again and build a second item from them
   * that would send the same thing twice. They are let go when the item ends,
   * leaves or is parked again, and by the resume pass if a run died before it
   * could.
   */
  private async holdRows(
    item: FlowItem,
    args: { nodeId: string; wake: Wake },
  ): Promise<void> {
    const rows = rowsOf(item);
    if (rows.length === 0) return;
    const until = new Date(
      Math.max(Date.parse(args.wake.dueAt), this.deps.now().getTime()) +
        HOLD_GRACE_MS,
    ).toISOString();
    for (const rowId of rows) {
      if (!(await this.leaseForHold(rowId))) {
        this.deps.invariantBroken?.({
          invariant: "tick_overlap",
          severity: "warn",
          nodeId: args.nodeId,
          details: { reason: "row_leased_elsewhere", itemId: item.id, rowId },
        });
        continue;
      }
      await this.parkedRowMustExist(rowId, args.nodeId, () =>
        this.deps.store.parkItem(this.deps.scope, {
          workflowId: this.deps.workflowId,
          itemId: rowId,
          leasedBy: this.deps.leasedBy,
          graphVersion: this.deps.graphVersion,
          nodeId: args.nodeId,
          wake: { wait: "retry", dueAt: until },
          context: holdContext(item.id, this.iso()),
        }),
      );
      this.parkedRows.delete(rowId);
      this.held.delete(rowId);
      this.record({
        itemId: rowId,
        nodeId: args.nodeId,
        kind: "parked",
        summary: `held for ${item.id}, which waits for the next run: this row is not offered again until it is done`,
      });
    }
  }

  /** Takes a row so it can be held; false when another run has it. */
  private async leaseForHold(itemId: string): Promise<boolean> {
    if (this.held.has(itemId)) return true;
    const [state] = await this.deps.store.leaseItems(this.deps.scope, {
      workflowId: this.deps.workflowId,
      graphVersion: this.deps.graphVersion,
      itemIds: [itemId],
      leasedBy: this.deps.leasedBy,
      now: this.iso(),
    });
    if (!state) return false;
    this.held.add(itemId);
    this.counters.set(itemId, { ...state.counters });
    return true;
  }

  /**
   * The resume pass has taken a parked item built from rows: take the rows it
   * holds too, so the source cannot offer them in this tick, and so ending the
   * item lets them go.
   */
  async adoptHolds(state: ItemState): Promise<void> {
    if (!this.live || state.context.inbox === true) return;
    const { members } = state.context;
    if (!Array.isArray(members)) return;
    const ids = members.filter(
      (member): member is string =>
        typeof member === "string" && !this.held.has(member),
    );
    for (const batch of chunks(ids, WORKFLOW_STORE_LIMITS.itemBatchMax)) {
      const leased = await this.deps.store.leaseItems(this.deps.scope, {
        workflowId: this.deps.workflowId,
        graphVersion: this.deps.graphVersion,
        itemIds: batch,
        leasedBy: this.deps.leasedBy,
        now: this.iso(),
      });
      for (const row of leased) {
        this.held.add(row.itemId);
        this.counters.set(row.itemId, { ...row.counters });
        if (row.parkedAtNode !== undefined && heldByOf(row) === state.itemId) {
          this.parkedRows.add(row.itemId);
        }
      }
    }
  }

  /**
   * A hold the resume pass found due: nothing has ended or moved the item it
   * was held for. Held on while that item is still waiting; otherwise given
   * back, so the row is offered again.
   */
  async reconsiderHold(state: ItemState): Promise<"kept" | "released"> {
    const owner = heldByOf(state);
    const nodeId = state.parkedAtNode ?? "";
    // This tick has the item in hand: ending it or parking it again settles the hold.
    if (owner !== undefined && this.held.has(owner)) return "kept";
    const ownerState =
      owner === undefined
        ? null
        : await this.deps.store.getItemState(
            this.deps.scope,
            this.deps.workflowId,
            owner,
          );
    const now = this.deps.now().getTime();
    const working =
      ownerState?.leaseUntil !== undefined &&
      Date.parse(ownerState.leaseUntil) > now;
    if (ownerState?.parkedAtNode !== undefined || working) {
      const dueAt = Date.parse(ownerState?.wake?.dueAt ?? "");
      const until = new Date(
        Math.max(Number.isNaN(dueAt) ? now : dueAt, now) + HOLD_GRACE_MS,
      ).toISOString();
      await this.parkedRowMustExist(state.itemId, nodeId, () =>
        this.deps.store.parkItem(this.deps.scope, {
          workflowId: this.deps.workflowId,
          itemId: state.itemId,
          leasedBy: this.deps.leasedBy,
          graphVersion: this.deps.graphVersion,
          nodeId,
          wake: { wait: "retry", dueAt: until },
          context: state.context,
        }),
      );
      this.parkedRows.delete(state.itemId);
      this.held.delete(state.itemId);
      return "kept";
    }
    await this.clearOwnParking(state.itemId, nodeId);
    this.record({
      itemId: state.itemId,
      nodeId,
      kind: "woke",
      summary: `released from its hold: ${owner ?? "the item"} it was held for is no longer waiting, so this row is offered again`,
    });
    return "released";
  }

  /** Gives a row this tick holds parked back, so it is offered again. */
  private async clearOwnParking(itemId: string, nodeId: string): Promise<void> {
    if (!this.live || !this.parkedRows.has(itemId)) return;
    await this.parkedRowMustExist(itemId, nodeId, () =>
      this.deps.store.clearParking(this.deps.scope, {
        workflowId: this.deps.workflowId,
        itemId,
        leasedBy: this.deps.leasedBy,
      }),
    );
    this.parkedRows.delete(itemId);
    this.held.delete(itemId);
  }

  /**
   * A node folded these items into one other item (a Combine's list, a
   * whole-list answer). An item that is not an inbox row has nothing of its own
   * to carry on, so what is parked for it is let go once the walk is settled.
   */
  fold(items: readonly FlowItem[], nodeId: string): void {
    for (const item of items) {
      if (!item.inbox) this.folded.push({ item, nodeId });
    }
  }

  /** A Split took `parent` apart into `children`; see `settleConsumed`. */
  split(parent: FlowItem, nodeId: string, children: readonly FlowItem[]): void {
    this.splits.set(parent.id, {
      parent,
      nodeId,
      children: children.map((child) => child.id),
    });
  }

  /**
   * Once the walk has accounted for everything it took: lets go of what is
   * parked for the items that were folded into others or taken apart, none of
   * which has an End of its own, so they are not woken again in every run.
   *
   * The rows an item that was split stood for are carried on by its children
   * when the children are those rows (a list split back into its reports). When
   * they are not (a message split into tasks of its own), the rows end with
   * their children, the way they would have through an End: handed to a person
   * if any child was, open again if any was released, done otherwise. A row
   * left out of a split that did carry others on is let go to be offered again,
   * never ended for work nobody did.
   */
  async settleConsumed(): Promise<void> {
    for (const { item, nodeId } of this.folded) {
      await this.clearOwnParking(item.id, nodeId);
    }
    this.folded.length = 0;
    for (const { parent, nodeId, children } of this.splits.values()) {
      const rows = parent.inbox ? [parent.id] : (parent.members ?? []);
      const carried = new Set(children);
      if (rows.length === 0 || rows.some((row) => carried.has(row))) {
        await this.clearOwnParking(parent.id, nodeId);
        for (const row of rows) {
          if (!carried.has(row)) await this.clearOwnParking(row, nodeId);
        }
        continue;
      }
      const ended = children.flatMap((child) => {
        const outcome = this.outcomes.get(child);
        return outcome === undefined ? [] : [outcome];
      });
      const outcome: EndOutcome = ended.includes("released")
        ? "released"
        : ended.includes("needsManual")
          ? "needsManual"
          : ended.length > 0 && ended.every((entry) => entry === "dismissed")
            ? "dismissed"
            : "done";
      const result = await this.end(parent, {
        nodeId,
        outcome,
        status: END_STATUS[outcome],
        reason: `split into ${children.length} item${children.length === 1 ? "" : "s"}`,
      });
      if (!result.ok) {
        this.record({
          itemId: parent.id,
          nodeId,
          kind: "error",
          code: result.failure.code,
          summary: `${result.failure.code}: ${result.failure.message}`,
        });
        this.failed += 1;
      }
    }
    this.splits.clear();
  }

  /**
   * Runs a write to the row of an item this tick holds parked. The store
   * saying it has no such row is reported, and the error goes on unchanged.
   */
  private async parkedRowMustExist<T>(
    itemId: string,
    nodeId: string,
    write: () => Promise<T>,
  ): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (
        error instanceof WorkflowStoreError &&
        error.code === "not_found" &&
        this.parkedRows.has(itemId)
      ) {
        this.deps.invariantBroken?.({
          invariant: "parked_item_state_missing",
          severity: "error",
          nodeId,
          details: { itemId },
        });
      }
      throw error;
    }
  }

  record(event: RecordedEvent): void {
    this.pending.push({
      workflowId: this.deps.workflowId,
      runId: this.deps.runId,
      itemId: event.itemId,
      ...(event.nodeId === undefined ? {} : { nodeId: event.nodeId }),
      kind: event.kind,
      at: this.iso(),
      mode: this.deps.mode,
      summary: fitText(event.summary, EVENT_SUMMARY_BYTES),
      ...(event.port === undefined ? {} : { port: event.port }),
      ...(event.receiptKey === undefined
        ? {}
        : { receiptKey: event.receiptKey }),
      ...(event.threadId === undefined ? {} : { threadId: event.threadId }),
      ...(event.kind === "ended" ? { outcome: event.outcome } : {}),
      ...(event.kind === "error" ? { code: event.code } : {}),
    });
  }

  async flushEvents(): Promise<void> {
    const batch = this.pending;
    this.pending = [];
    for (const events of chunks(batch, WORKFLOW_STORE_LIMITS.eventsBatchMax)) {
      await this.deps.store.appendItemEvents(this.deps.scope, events);
    }
  }

  /**
   * Finishes an item. A synthetic item (a list, a group) ends the inbox items
   * it stands for. The status write comes first, so a failed write leaves no
   * `ended` event behind for an item that did not end; the caller records the
   * failure it gets back.
   */
  async end(
    item: FlowItem,
    args: {
      nodeId: string;
      outcome: EndOutcome;
      status: string | null;
      reason?: string;
      /** Written with the status, onto every inbox item this end finishes. */
      extras?: Readonly<Record<string, unknown>>;
    },
  ): Promise<EndResult> {
    const targets = item.inbox ? [item.id] : [...(item.members ?? [])];
    if (this.live && args.status !== null) {
      for (const itemId of targets) {
        const written = await this.deps.items.setStatus({
          workflowId: this.deps.workflowId,
          runId: this.deps.runId,
          itemId,
          status: args.status,
          ...(args.reason === undefined ? {} : { reason: args.reason }),
          ...(args.extras === undefined ? {} : { extras: args.extras }),
          signal: this.deps.signal,
        });
        if (!written.ok) {
          return {
            ok: false,
            failure: {
              code: written.code,
              message: `Could not set ${itemId} to "${args.status}": ${written.message}`,
              ...(written.retryable ? { retryable: true } : {}),
            },
          };
        }
      }
    }
    const summary = `${args.outcome}${args.reason === undefined ? "" : `: ${args.reason}`}${args.status === null ? "" : ` (status ${args.status})`}`;
    this.record({
      itemId: item.id,
      nodeId: args.nodeId,
      kind: "ended",
      outcome: args.outcome,
      summary,
    });
    for (const itemId of targets) {
      if (itemId === item.id) continue;
      this.record({
        itemId,
        nodeId: args.nodeId,
        kind: "ended",
        outcome: args.outcome,
        summary: `${summary}, through ${item.id}`,
      });
    }
    this.ended[args.outcome] += 1;
    this.outcomes.set(item.id, args.outcome);
    if (args.outcome === "released") {
      // Back next tick for a new visit: its writes get new keys, and what failed in this one is behind it.
      await this.bump(item.id, ROUNDS_COUNTER);
      if (((await this.countersOf(item.id))[ATTEMPTS_COUNTER] ?? 0) > 0) {
        await this.clearCounter(item.id, ATTEMPTS_COUNTER);
      }
    }
    if (((await this.countersOf(item.id))[UNHELD_COUNTER] ?? 0) > 0) {
      await this.clearCounter(item.id, UNHELD_COUNTER);
    }
    // Last, so an item that did not finish ending is found parked again next tick.
    for (const itemId of new Set([item.id, ...targets])) {
      await this.clearOwnParking(itemId, args.nodeId);
    }
    return { ok: true };
  }

  /** Gives every lease back, so what this tick left undone can be taken next tick. */
  async releaseAll(): Promise<void> {
    if (!this.live) return;
    for (const itemIds of chunks(
      [...this.held],
      WORKFLOW_STORE_LIMITS.itemBatchMax,
    )) {
      await this.deps.store.releaseLeases(this.deps.scope, {
        workflowId: this.deps.workflowId,
        itemIds,
        leasedBy: this.deps.leasedBy,
      });
    }
    this.held.clear();
  }
}
