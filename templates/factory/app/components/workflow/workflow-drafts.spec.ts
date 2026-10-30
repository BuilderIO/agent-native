import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkflowGraph } from "@/lib/workflow-editor";

import {
  DRAFT_DELAY_MS,
  DraftSync,
  draftIntent,
  planRestore,
  type DraftWire,
} from "./workflow-drafts";

function graphOf(...ids: string[]): WorkflowGraph {
  return {
    nodes: ids.map((id) => ({ id })),
    edges: [],
    settings: {},
  } as unknown as WorkflowGraph;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness(options: { held?: DraftWire | true } = {}) {
  const writes: Array<{ wire: DraftWire; done: ReturnType<typeof deferred> }> =
    [];
  const discards: Array<ReturnType<typeof deferred>> = [];
  const hideWrites: DraftWire[] = [];
  const state = { hideAccepts: true };
  const onWriteFailure = vi.fn();
  const onDiscardFailure = vi.fn();
  const sync = new DraftSync({
    write: (wire) => {
      const done = deferred();
      writes.push({ wire, done });
      return done.promise;
    },
    discard: () => {
      const done = deferred();
      discards.push(done);
      return done.promise;
    },
    writeOnHide: (wire) => {
      if (!state.hideAccepts) return null;
      hideWrites.push(wire);
      return Promise.resolve();
    },
    onWriteFailure,
    onDiscardFailure,
    held: options.held,
  });
  return {
    sync,
    writes,
    discards,
    hideWrites,
    state,
    onWriteFailure,
    onDiscardFailure,
  };
}

/** Lets the promise callbacks of a settled request run. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("DraftSync writes", () => {
  it("sends one draft after the canvas has been still, not one per edit", async () => {
    const { sync, writes } = harness();
    sync.schedule({ baseVersion: 3, graph: graphOf("a") });
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS - 100);
    sync.schedule({ baseVersion: 3, graph: graphOf("a", "b") });
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS - 100);
    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.wire).toEqual({
      baseVersion: 3,
      graph: JSON.stringify(graphOf("a", "b")),
    });
  });

  it("holds an edit made during a write and sends it after, latest wins", async () => {
    const { sync, writes } = harness();
    sync.schedule({ baseVersion: 1, graph: graphOf("a") });
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
    expect(writes).toHaveLength(1);

    sync.schedule({ baseVersion: 1, graph: graphOf("b") });
    sync.schedule({ baseVersion: 1, graph: graphOf("c") });
    // The delay runs out while the first write is still out: still one request at a time.
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS * 2);
    expect(writes).toHaveLength(1);

    writes[0]?.done.resolve();
    await settle();
    expect(writes).toHaveLength(2);
    expect(writes[1]?.wire.graph).toBe(JSON.stringify(graphOf("c")));
  });

  it("sends an edit made during a write once its own delay has run out, not before", async () => {
    const { sync, writes } = harness();
    sync.schedule({ baseVersion: 1, graph: graphOf("a") });
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
    sync.schedule({ baseVersion: 1, graph: graphOf("b") });
    writes[0]?.done.resolve();
    await settle();
    expect(writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
    expect(writes).toHaveLength(2);
  });

  it("does not send a draft the server already holds", async () => {
    const held = { baseVersion: 4, graph: JSON.stringify(graphOf("a")) };
    const { sync, writes } = harness({ held });
    sync.schedule({ baseVersion: 4, graph: graphOf("a") });
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
    expect(writes).toHaveLength(0);
    sync.schedule({ baseVersion: 5, graph: graphOf("a") });
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
    expect(writes).toHaveLength(1);
  });

  it("cancel drops what waits, as a running save does", async () => {
    const { sync, writes } = harness();
    sync.schedule({ baseVersion: 1, graph: graphOf("a") });
    sync.cancel();
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS * 2);
    expect(writes).toHaveLength(0);
  });

  it("flush sends what waits at once", async () => {
    const { sync, writes } = harness();
    sync.schedule({ baseVersion: 1, graph: graphOf("a") });
    sync.flush();
    expect(writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS * 2);
    expect(writes).toHaveLength(1);
  });
});

describe("DraftSync failures", () => {
  it("reports one failure per streak, keeps trying on later edits, and starts a new streak after a success", async () => {
    const { sync, writes, onWriteFailure } = harness();
    const edit = (id: string) => {
      sync.schedule({ baseVersion: 1, graph: graphOf(id) });
      return vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
    };

    await edit("a");
    writes[0]?.done.reject(new Error("down"));
    await settle();
    await edit("b");
    writes[1]?.done.reject(new Error("still down"));
    await settle();
    expect(writes).toHaveLength(2);
    expect(onWriteFailure).toHaveBeenCalledTimes(1);

    await edit("c");
    writes[2]?.done.resolve();
    await settle();
    await edit("d");
    writes[3]?.done.reject(new Error("down again"));
    await settle();
    expect(onWriteFailure).toHaveBeenCalledTimes(2);
  });

  it("retries the same graph after a failed write instead of skipping it as a repeat", async () => {
    const { sync, writes } = harness();
    sync.schedule({ baseVersion: 1, graph: graphOf("a") });
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
    writes[0]?.done.reject(new Error("down"));
    await settle();
    sync.schedule({ baseVersion: 1, graph: graphOf("a") });
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
    expect(writes).toHaveLength(2);
  });
});

describe("DraftSync clear", () => {
  it("does nothing when no draft can exist, and drops an edit still waiting", async () => {
    const { sync, writes, discards } = harness();
    sync.schedule({ baseVersion: 1, graph: graphOf("a") });
    sync.clear();
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS * 2);
    expect(writes).toHaveLength(0);
    expect(discards).toHaveLength(0);
  });

  it("discards a draft the editor opened from", () => {
    const { sync, discards } = harness({ held: true });
    sync.clear();
    expect(discards).toHaveLength(1);
  });

  it("discards a draft this session wrote, once, and then has nothing left to discard", async () => {
    const { sync, writes, discards } = harness();
    sync.schedule({ baseVersion: 1, graph: graphOf("a") });
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
    writes[0]?.done.resolve();
    await settle();

    sync.clear();
    expect(discards).toHaveLength(1);
    discards[0]?.resolve();
    await settle();
    sync.clear();
    expect(discards).toHaveLength(1);
  });

  it("queues the discard behind a write still in flight so the write cannot bring the draft back", async () => {
    const { sync, writes, discards } = harness();
    sync.schedule({ baseVersion: 1, graph: graphOf("a") });
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
    sync.clear();
    expect(discards).toHaveLength(0);
    writes[0]?.done.resolve();
    await settle();
    expect(discards).toHaveLength(1);
  });

  it("lets an edit made after a clear win over the queued discard", async () => {
    const { sync, writes, discards } = harness();
    sync.schedule({ baseVersion: 1, graph: graphOf("a") });
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
    sync.clear();
    sync.schedule({ baseVersion: 1, graph: graphOf("b") });
    writes[0]?.done.resolve();
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
    expect(discards).toHaveLength(0);
    expect(writes).toHaveLength(2);
  });

  it("reports a failed discard and keeps the draft on record so a later clear tries again", async () => {
    const { sync, discards, onDiscardFailure } = harness({ held: true });
    sync.clear();
    discards[0]?.reject(new Error("down"));
    await settle();
    expect(onDiscardFailure).toHaveBeenCalledTimes(1);
    sync.clear();
    expect(discards).toHaveLength(2);
  });
});

describe("DraftSync when the page is hidden", () => {
  it("sends what waits in a request that outlives the page", async () => {
    const { sync, writes, hideWrites } = harness();
    sync.schedule({ baseVersion: 2, graph: graphOf("a") });
    sync.flushOnHide();
    expect(hideWrites).toEqual([
      { baseVersion: 2, graph: JSON.stringify(graphOf("a")) },
    ]);
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS * 2);
    expect(writes).toHaveLength(0);
  });

  it("sends a draft the client will not send that way the ordinary way at once, not on the timer", () => {
    const { sync, writes, hideWrites, state } = harness();
    state.hideAccepts = false;
    sync.schedule({ baseVersion: 2, graph: graphOf("a") });
    sync.flushOnHide();
    expect(hideWrites).toHaveLength(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.wire).toEqual({
      baseVersion: 2,
      graph: JSON.stringify(graphOf("a")),
    });
  });

  it("waits for a write in flight instead of racing it, then sends what waits at once", async () => {
    const { sync, writes, hideWrites } = harness();
    sync.schedule({ baseVersion: 2, graph: graphOf("a") });
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
    expect(writes).toHaveLength(1);

    sync.schedule({ baseVersion: 2, graph: graphOf("a", "b") });
    sync.flushOnHide();
    // The older write is still out: nothing else goes until it settles, so the two cannot arrive out of order.
    expect(hideWrites).toHaveLength(0);
    expect(writes).toHaveLength(1);

    writes[0]?.done.resolve();
    await settle();
    expect(writes).toHaveLength(2);
    expect(writes[1]?.wire.graph).toBe(JSON.stringify(graphOf("a", "b")));
  });

  it("counts a draft sent that way as one the server may hold", async () => {
    const { sync, discards } = harness();
    sync.schedule({ baseVersion: 2, graph: graphOf("a") });
    sync.flushOnHide();
    await settle();
    sync.clear();
    expect(discards).toHaveLength(1);
  });
});

describe("draftIntent", () => {
  it("holds while a save runs, writes unsaved edits, and clears a canvas at the saved graph", () => {
    expect(draftIntent({ dirty: false, saving: true })).toBe("hold");
    expect(draftIntent({ dirty: true, saving: true })).toBe("hold");
    expect(draftIntent({ dirty: true, saving: false })).toBe("write");
    expect(draftIntent({ dirty: false, saving: false })).toBe("clear");
  });
});

describe("planRestore", () => {
  const saved = graphOf("a");
  const stored = (graph: string, baseVersion = 3) => ({
    status: "read" as const,
    draft: { baseVersion, graph, updatedAt: "2026-01-01T00:00:00.000Z" },
  });

  it("changes nothing when there is no draft", () => {
    expect(planRestore({ status: "read", draft: null }, saved)).toEqual({
      kind: "none",
    });
  });

  it("opens from the draft, based on the version the draft names", () => {
    const text = JSON.stringify(graphOf("a", "b"));
    expect(planRestore(stored(text, 2), saved)).toEqual({
      kind: "restore",
      graph: graphOf("a", "b"),
      baseVersion: 2,
      wire: { baseVersion: 2, graph: text },
    });
  });

  it("opens the saved graph and discards quietly when the draft is the saved graph", () => {
    expect(planRestore(stored(JSON.stringify(saved)), saved)).toEqual({
      kind: "same",
    });
  });

  it("opens the saved version when the server says the draft is unreadable", () => {
    expect(
      planRestore({ status: "failed", errorCode: "draft_unreadable" }, saved),
    ).toEqual({ kind: "unreadable" });
  });

  it("treats text that is not a graph as unreadable", () => {
    for (const text of [
      "not json",
      "[]",
      "null",
      '{"nodes":[]}',
      '{"nodes":1,"edges":[]}',
    ]) {
      expect(planRestore(stored(text), saved)).toEqual({ kind: "unreadable" });
    }
  });

  it("does not open the editor for any other read failure", () => {
    for (const errorCode of [null, "factory_not_found", "internal_error"]) {
      expect(planRestore({ status: "failed", errorCode }, saved)).toEqual({
        kind: "failed",
      });
    }
  });
});
