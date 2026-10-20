import type { RunRecord, WorkflowHost, WorkflowScope } from "../adapter.js";
import type {
  ItemState,
  NodeKind,
  RunMode,
  WorkflowErrorCode,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeOfKind,
} from "../contract.js";
import type { LoopInfo } from "./graph-order.js";
import type { ItemRuntime } from "./item-runtime.js";
import type { EngineBudget } from "./run-budget.js";
import type { StepBuilder } from "./step-builder.js";
import type { InvariantReport } from "./tripwire.js";

/**
 * One thing moving through the graph. Nodes never change one: attaching a
 * result makes a new object, so two branches fed from one port cannot see
 * each other's work.
 */
export interface FlowItem {
  readonly id: string;
  /** What `{{ item.* }}` reads. */
  readonly data: Readonly<Record<string, unknown>>;
  /** What earlier nodes attached, read as `{{ nodes.<name>.* }}`. */
  readonly nodes: Readonly<Record<string, unknown>>;
  /** True when `id` is a row in Factory's inbox, so its status can change. */
  readonly inbox: boolean;
  /**
   * Inbox ids a synthetic item (a combined list, a group, a whole-list AI
   * result) stands for. Ending the synthetic item ends these.
   */
  readonly members?: readonly string[];
  /**
   * Tells apart the writes of an item whose id stays the same while what it
   * stands for changes: a group keeps one id per key, so each set of members
   * needs a receipt of its own. Counters stay on the id.
   */
  readonly receiptSalt?: string;
  /**
   * Set by a source that had more than it took. A combined list reads it, so
   * "100 of 340 commits" can be said and a cut-off is not hidden.
   */
  readonly cut?: { readonly taken: number; readonly totalAvailable: number };
}

export type PortItems = Readonly<Record<string, readonly FlowItem[]>>;

export interface RunWindow {
  /** From the stored last-trigger time, so a retried or late run covers what the last one did not. */
  readonly start: string;
  readonly end: string;
  readonly firstRun: boolean;
}

export interface ItemFailure {
  readonly code: WorkflowErrorCode;
  readonly message: string;
  /**
   * The failure had no effect outside and is worth another try later, so the
   * item may be parked for a retry. Absent is not retryable: a failure that
   * says nothing about this is never retried blindly.
   */
  readonly retryable?: boolean;
}

/** Why a node stopped before it finished its input. The walk halts after recording it. */
export interface StopReason {
  readonly code: "budget_paused" | "ai_cap_reached";
  readonly message: string;
}

export interface TickContext {
  readonly host: WorkflowHost;
  readonly scope: WorkflowScope;
  readonly workflowId: string;
  readonly ownerEmail: string;
  readonly graphVersion: number;
  readonly graph: WorkflowGraph;
  /** Every loop in the graph, for `{{ loop.* }}` and for sending items back. */
  readonly loops: readonly LoopInfo[];
  readonly run: RunRecord;
  readonly mode: RunMode;
  readonly window: RunWindow;
  /** The scheduled instant of a live tick; null for a manual, dry, or test run. */
  readonly scheduledFor: string | null;
  readonly runtime: ItemRuntime;
  readonly budget: EngineBudget;
  readonly signal: AbortSignal;
  now(): Date;
  /** What a parked item's due time is measured against: `now()` and a little after it, so a tick that comes slightly early does not leave it waiting another cadence. */
  dueNow(): Date;
  /** Non-null once the soft deadline has passed or the hard one has aborted the run. */
  stopReason(): StopReason | null;
  /** Records a broken invariant on the host's tripwire. Observe only. */
  invariantBroken(report: InvariantReport): void;
}

export interface NodeOutcome {
  readonly itemsByPort: PortItems;
  /**
   * The node stopped before it finished its input. The items it did finish are
   * in `itemsByPort` and go on; the ones it did not reach are `unfinished`, or,
   * when a node leaves that out, the last `deferred` items of its input (the
   * step field every stopping node sets).
   */
  readonly stop?: StopReason;
  readonly unfinished?: readonly FlowItem[];
  /**
   * Runs once the walk has settled: it completed, or it stopped with every
   * item still in flight set aside for the next tick. What it persists (a
   * source's cursor) never marks input as handled for a run that failed or
   * left items nowhere.
   */
  readonly commit?: () => Promise<void>;
}

export interface NodeCall<N extends WorkflowNode = WorkflowNode> {
  readonly ctx: TickContext;
  readonly node: N;
  /** Everything routed to this node this tick; empty when upstream sent nothing. */
  readonly input: readonly FlowItem[];
  readonly step: StepBuilder;
  /**
   * Only a Wait is given any: the rows of items parked there whose time or
   * check has come, leased to this tick.
   */
  readonly parked: readonly ItemState[];
}

/**
 * Runs one node over its whole batch. Throw a `WorkflowError` to fail the
 * step; report one item's failure through `failItem` so the rest carry on.
 */
export type NodeExecutor<N extends WorkflowNode = WorkflowNode> = (
  call: NodeCall<N>,
) => Promise<NodeOutcome>;

export type NodeExecutorFor<K extends NodeKind> = NodeExecutor<
  WorkflowNodeOfKind<K>
>;
