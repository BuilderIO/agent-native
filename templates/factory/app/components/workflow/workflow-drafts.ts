import type { WorkflowGraph } from "@/lib/workflow-editor";

import { isGraphDirty } from "./workflow-editor-state";

/** How long the canvas must sit still before its draft is sent. */
export const DRAFT_DELAY_MS = 1_500;

/** A draft as the server holds it: the graph is the JSON text the editor sent. */
export interface DraftWire {
  baseVersion: number;
  graph: string;
}

/** What the page wants stored: the graph is serialized only when it is sent, so an edit costs nothing until then. */
export interface DraftInput {
  baseVersion: number;
  graph: WorkflowGraph;
}

type Pending =
  | { kind: "write"; draft: DraftInput }
  | { kind: "discard" }
  | undefined;

interface DraftSyncOptions {
  write: (draft: DraftWire) => Promise<unknown>;
  discard: () => Promise<unknown>;
  /** Sends a draft in a request that outlives the page; null when the client will not send it. */
  writeOnHide: (draft: DraftWire) => Promise<unknown> | null;
  /** Called once per streak of failed writes; the next success ends the streak. */
  onWriteFailure: (error: unknown) => void;
  onDiscardFailure: (error: unknown) => void;
  /** The draft the server already holds, when the editor opened from one. */
  held?: DraftWire | true | undefined;
  delayMs?: number;
}

/**
 * Keeps the server's draft in step with the canvas: one request at a time, the
 * latest edit wins, and a discard queues behind a write still in flight so a
 * late write can never bring a discarded draft back.
 */
export class DraftSync {
  private pending: Pending;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = 0;
  // Whether the server may hold a draft: one was found, or a write has been sent since the last discard.
  private held: boolean;
  private persisted: DraftWire | undefined;
  private failing = false;

  constructor(private readonly options: DraftSyncOptions) {
    this.held = options.held !== undefined;
    this.persisted =
      typeof options.held === "object" ? options.held : undefined;
  }

  /** The canvas differs from the saved graph: send this after the delay, replacing any draft still waiting. */
  schedule(draft: DraftInput): void {
    this.pending = { kind: "write", draft };
    this.stopTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.drain();
    }, this.options.delayMs ?? DRAFT_DELAY_MS);
  }

  /** The canvas is held (a save is running): nothing waiting goes out. */
  cancel(): void {
    this.stopTimer();
    if (this.pending?.kind === "write") this.pending = undefined;
  }

  /** The edits are gone: drop what waits and discard the server's draft, if it may have one. */
  clear(): void {
    this.stopTimer();
    if (!this.held) {
      this.pending = undefined;
      return;
    }
    this.pending = { kind: "discard" };
    this.drain();
  }

  /** The page is going away: what waits goes out now. */
  flush(): void {
    this.stopTimer();
    this.drain();
  }

  /** The page is being hidden: what waits goes out now, in a request that survives it when one can. */
  flushOnHide(): void {
    if (this.pending?.kind !== "write") return;
    this.stopTimer();
    // A write in flight sends what waits the moment it settles, so the two cannot reach the server out of order.
    if (this.inFlight > 0) return;
    const wire = this.serialize(this.pending.draft);
    if (this.sameAsPersisted(wire)) {
      this.pending = undefined;
      return;
    }
    const sent = this.options.writeOnHide(wire);
    // Too large for such a request: send it the ordinary way now, since a timer may never run on a page that is going away.
    if (!sent) {
      this.drain();
      return;
    }
    this.pending = undefined;
    this.inFlight += 1;
    this.held = true;
    this.trackWrite(wire, sent);
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private serialize(draft: DraftInput): DraftWire {
    return {
      baseVersion: draft.baseVersion,
      graph: JSON.stringify(draft.graph),
    };
  }

  private sameAsPersisted(wire: DraftWire): boolean {
    return (
      this.persisted !== undefined &&
      this.persisted.baseVersion === wire.baseVersion &&
      this.persisted.graph === wire.graph
    );
  }

  private drain(): void {
    if (this.inFlight > 0 || !this.pending) return;
    const next = this.pending;
    this.pending = undefined;
    if (next.kind === "discard") {
      this.inFlight += 1;
      this.options
        .discard()
        .then(
          () => {
            this.held = false;
            this.persisted = undefined;
          },
          (error: unknown) => this.options.onDiscardFailure(error),
        )
        .finally(() => this.settle());
      return;
    }
    const wire = this.serialize(next.draft);
    if (this.sameAsPersisted(wire)) return;
    this.inFlight += 1;
    this.held = true;
    this.trackWrite(wire, this.options.write(wire));
  }

  private trackWrite(wire: DraftWire, sent: Promise<unknown>): void {
    sent
      .then(
        () => {
          this.persisted = wire;
          this.failing = false;
        },
        (error: unknown) => {
          // The server may or may not have taken it, so a retry must not be skipped as a repeat.
          this.persisted = undefined;
          if (this.failing) return;
          this.failing = true;
          this.options.onWriteFailure(error);
        },
      )
      .finally(() => this.settle());
  }

  // What arrived during the request goes next: a discard at once, an edit when its delay has run out.
  private settle(): void {
    this.inFlight -= 1;
    if (this.pending && (this.pending.kind === "discard" || !this.timer)) {
      this.drain();
    }
  }
}

/**
 * What the page asks of the draft for the editor's state: a running save holds
 * everything (a refused save keeps the edits, so only its outcome decides),
 * unsaved edits are written, and a canvas back at the saved graph clears it.
 */
export function draftIntent(state: {
  dirty: boolean;
  saving: boolean;
}): "hold" | "write" | "clear" {
  if (state.saving) return "hold";
  return state.dirty ? "write" : "clear";
}

export interface StoredDraft {
  baseVersion: number;
  graph: string;
  updatedAt: string;
}

export type DraftRead =
  | { status: "read"; draft: StoredDraft | null }
  | { status: "failed"; errorCode: string | null };

export type RestorePlan =
  | { kind: "none" }
  /** The draft is the graph the workflow already has: open it and discard the draft quietly. */
  | { kind: "same" }
  | {
      kind: "restore";
      graph: WorkflowGraph;
      baseVersion: number;
      wire: DraftWire;
    }
  /** The draft cannot be read: open the saved version, discard the draft, and say so. */
  | { kind: "unreadable" }
  /** The read failed for another reason: the editor must not open, or the next autosave would overwrite the real draft. */
  | { kind: "failed" };

function parseDraftGraph(text: string): WorkflowGraph | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // coercion-ok: text that does not parse is the `unreadable` plan, which the page tells the person about.
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const { nodes, edges } = value as Record<string, unknown>;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return undefined;
  return value as WorkflowGraph;
}

/** Decides how the editor opens from the draft read and the saved graph it opens over. */
export function planRestore(
  read: DraftRead,
  savedGraph: WorkflowGraph,
): RestorePlan {
  if (read.status === "failed") {
    return read.errorCode === "draft_unreadable"
      ? { kind: "unreadable" }
      : { kind: "failed" };
  }
  if (!read.draft) return { kind: "none" };
  const graph = parseDraftGraph(read.draft.graph);
  if (!graph) return { kind: "unreadable" };
  if (!isGraphDirty(graph, savedGraph)) return { kind: "same" };
  return {
    kind: "restore",
    graph,
    baseVersion: read.draft.baseVersion,
    wire: { baseVersion: read.draft.baseVersion, graph: read.draft.graph },
  };
}
