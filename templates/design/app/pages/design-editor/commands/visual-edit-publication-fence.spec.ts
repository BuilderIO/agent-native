import { describe, expect, it } from "vitest";

import {
  clearEditsDiscardedLocalEdits,
  enqueueVisualEditPublication,
  runFencedVisualEditClear,
  type VisualEditClearFence,
} from "./visual-edit-publication-fence";

interface Handoff {
  revision: number;
  publisherId: string;
  edits: number;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Server-side compare-and-set mirroring clear-edits' exact-revision check. */
function createServer(initial: Handoff | null) {
  let handoff = initial;
  return {
    read: () => handoff,
    publish(publisherId: string, edits: number) {
      handoff = edits
        ? { revision: (handoff?.revision ?? 0) + 1, publisherId, edits }
        : null;
    },
    clear(expected: { revision: number; publisherId: string } | null) {
      if (
        (handoff?.revision ?? null) !== (expected?.revision ?? null) ||
        (handoff?.publisherId ?? null) !== (expected?.publisherId ?? null)
      ) {
        return { cleared: false, stale: true, handoff };
      }
      handoff = null;
      return { cleared: true, stale: false, handoff };
    },
  };
}

function createTab(server: ReturnType<typeof createServer>, id: string) {
  const queueRef = { current: Promise.resolve() };
  const clearFenceRef = { current: null as VisualEditClearFence | null };
  const errors: unknown[] = [];
  return {
    queueRef,
    clearFenceRef,
    errors,
    publish(edits: number) {
      enqueueVisualEditPublication({
        queueRef,
        clearFenceRef,
        carriesEdits: edits > 0,
        publish: async () => server.publish(id, edits),
        onError: (error) => errors.push(error),
      });
    },
    clear(beforeCompareAndSet?: () => void) {
      return runFencedVisualEditClear({
        queueRef,
        clearFenceRef,
        clear: async (prior) => {
          await prior;
          const read = server.read();
          beforeCompareAndSet?.();
          await Promise.resolve();
          return server.clear(
            read
              ? { revision: read.revision, publisherId: read.publisherId }
              : null,
          );
        },
        discardedEdits: (result) => result.cleared,
      });
    },
  };
}

describe("fenced visual edit clear", () => {
  it("clears in one attempt when this tab publishes during the pending read", async () => {
    const server = createServer({
      revision: 141,
      publisherId: "tab-a",
      edits: 1,
    });
    const tab = createTab(server, "tab-a");

    const outcome = await tab.clear(() => tab.publish(2));
    await tab.queueRef.current;

    expect(outcome).toEqual({
      status: "done",
      value: { cleared: true, stale: false, handoff: null },
    });
    // The publication snapshotted before the clear must not recreate the handoff.
    expect(server.read()).toBeNull();
    expect(tab.errors).toEqual([]);
  });

  it("waits for publications already queued before reading the revision", async () => {
    const server = createServer({
      revision: 141,
      publisherId: "tab-a",
      edits: 1,
    });
    const tab = createTab(server, "tab-a");
    const inFlight = deferred();
    enqueueVisualEditPublication({
      queueRef: tab.queueRef,
      clearFenceRef: tab.clearFenceRef,
      carriesEdits: true,
      publish: async () => {
        await inFlight.promise;
        server.publish("tab-a", 2);
      },
      onError: () => {},
    });

    const clearing = tab.clear();
    inFlight.resolve();

    await expect(clearing).resolves.toMatchObject({
      value: { cleared: true },
    });
    expect(server.read()).toBeNull();
  });

  it("keeps a collaborator's newer handoff and replays this tab's held edits", async () => {
    const server = createServer({
      revision: 141,
      publisherId: "tab-a",
      edits: 1,
    });
    const tab = createTab(server, "tab-a");

    const outcome = await tab.clear(() => {
      tab.publish(3);
      server.publish("tab-b", 5);
    });
    await tab.queueRef.current;

    expect(outcome).toMatchObject({ value: { cleared: false, stale: true } });
    expect(server.read()).toEqual({
      revision: 143,
      publisherId: "tab-a",
      edits: 3,
    });
  });

  it("still runs an empty publication held by a successful clear", async () => {
    const server = createServer({
      revision: 7,
      publisherId: "tab-a",
      edits: 1,
    });
    const tab = createTab(server, "tab-a");
    let emptyPublished = false;

    await tab.clear(() =>
      enqueueVisualEditPublication({
        queueRef: tab.queueRef,
        clearFenceRef: tab.clearFenceRef,
        carriesEdits: false,
        publish: async () => {
          emptyPublished = true;
        },
        onError: () => {},
      }),
    );
    await tab.queueRef.current;

    expect(emptyPublished).toBe(true);
  });

  it("rejects a second clear while one is running and releases on failure", async () => {
    const server = createServer({
      revision: 1,
      publisherId: "tab-a",
      edits: 1,
    });
    const tab = createTab(server, "tab-a");
    const gate = deferred();
    const first = runFencedVisualEditClear({
      queueRef: tab.queueRef,
      clearFenceRef: tab.clearFenceRef,
      clear: async () => {
        await gate.promise;
        throw new Error("network");
      },
      discardedEdits: () => true,
    });

    await expect(tab.clear()).resolves.toEqual({ status: "busy" });
    gate.resolve();
    await expect(first).rejects.toThrow("network");
    expect(tab.clearFenceRef.current).toBeNull();
    await expect(tab.clear()).resolves.toMatchObject({
      value: { cleared: true },
    });
  });
});

describe("clearEditsDiscardedLocalEdits", () => {
  const base = {
    cleared: false,
    stale: false,
    resetTweakSelections: false,
    handoffCleared: false,
    handoffPending: false,
  };

  it("accepts a full clear and a local-preview clear, never a stale one", () => {
    expect(clearEditsDiscardedLocalEdits({ ...base, cleared: true })).toBe(
      true,
    );
    expect(
      clearEditsDiscardedLocalEdits({ ...base, handoffPending: true }),
    ).toBe(true);
    expect(
      clearEditsDiscardedLocalEdits({
        ...base,
        stale: true,
        handoffPending: true,
      }),
    ).toBe(false);
    expect(clearEditsDiscardedLocalEdits(base)).toBe(false);
  });
});
