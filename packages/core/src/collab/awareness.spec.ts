import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getRouterParam: (event: any, name: string) => event._params?.[name],
  setResponseStatus: (event: any, status: number) => {
    event._status = status;
  },
}));

const mockReadBody = vi.fn();
vi.mock("../server/h3-helpers.js", () => ({
  readBody: (...args: unknown[]) => mockReadBody(...args),
}));
const storedRows = vi.hoisted(() => ({
  unreadable: false,
  unwritable: false,
  /** Runs once a read finishes, as another server's write landing after it. */
  afterRead: null as null | (() => Promise<void>),
  /** Runs once a reader's write lands, before its request resumes. */
  afterWrite: null as null | (() => Promise<void>),
}));
vi.mock("./awareness-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./awareness-store.js")>();
  return {
    ...actual,
    loadAwarenessRowsStrict: async (
      ...args: Parameters<typeof actual.loadAwarenessRowsStrict>
    ) => {
      if (storedRows.unreadable) throw new Error("Presence store unavailable");
      const rows = await actual.loadAwarenessRowsStrict(...args);
      const afterRead = storedRows.afterRead;
      storedRows.afterRead = null;
      await afterRead?.();
      return rows;
    },
    replaceReaderAwarenessRow: async (
      ...args: Parameters<typeof actual.replaceReaderAwarenessRow>
    ) => {
      if (storedRows.unwritable) throw new Error("Presence store unavailable");
      const replaced = await actual.replaceReaderAwarenessRow(...args);
      const afterWrite = storedRows.afterWrite;
      storedRows.afterWrite = null;
      if (replaced) await afterWrite?.();
      return replaced;
    },
  };
});

import {
  loadAwarenessRowsStrict,
  upsertAwarenessRow,
} from "./awareness-store.js";
import {
  emitAwarenessChange,
  getAwarenessEmitter,
  getDocAwareness,
  cleanExpired,
  postAwareness,
  getActiveUsers,
  rememberAwarenessClear,
  type AwarenessEntry,
} from "./awareness.js";

function event(params: Record<string, string> = {}) {
  return { _params: params, _status: 200 } as any;
}

describe("getDocAwareness", () => {
  it("returns the same Map instance for a docId on repeated calls", () => {
    const a = getDocAwareness("doc-shared");
    const b = getDocAwareness("doc-shared");
    expect(a).toBe(b);
  });

  it("isolates state between documents", () => {
    const a = getDocAwareness("doc-iso-a");
    const b = getDocAwareness("doc-iso-b");
    a.set(1, { clientId: 1, state: "s", lastSeen: Date.now() });
    expect(b.has(1)).toBe(false);
  });
});

describe("cleanExpired", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("drops entries older than the 30s timeout, keeps fresh ones", () => {
    const map = new Map<number, AwarenessEntry>();
    map.set(1, { clientId: 1, state: "stale", lastSeen: 0 });
    map.set(2, { clientId: 2, state: "fresh", lastSeen: 20_000 });

    vi.setSystemTime(31_000);
    cleanExpired(map);

    expect(map.has(1)).toBe(false);
    expect(map.has(2)).toBe(true);
  });

  it("keeps an entry exactly at the boundary (not strictly greater)", () => {
    const map = new Map<number, AwarenessEntry>();
    map.set(1, { clientId: 1, state: "edge", lastSeen: 0 });
    vi.setSystemTime(30_000);
    cleanExpired(map);
    expect(map.has(1)).toBe(true);
  });
});

describe("awareness scope retention", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires scopes that stop receiving awareness activity", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const docId = "scope-expiry";
    const received: Array<{ owner?: string }> = [];
    const onChange = (event: { owner?: string }) =>
      received.push({ owner: event.owner });
    getAwarenessEmitter().on("awareness-change", onChange);

    try {
      emitAwarenessChange(docId, [], { owner: "owner@example.com" });
      vi.setSystemTime(35_001);
      emitAwarenessChange(docId, []);
    } finally {
      getAwarenessEmitter().off("awareness-change", onChange);
    }

    expect(received).toEqual([{ owner: "owner@example.com" }, {}]);
  });

  it("keeps a scope alive for scope-less presence heartbeats", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const docId = "scope-heartbeat";
    const received: Array<{ owner?: string }> = [];
    const onChange = (event: { owner?: string }) =>
      received.push({ owner: event.owner });
    getAwarenessEmitter().on("awareness-change", onChange);

    try {
      emitAwarenessChange(docId, [], { owner: "owner@example.com" });
      vi.setSystemTime(10_000);
      emitAwarenessChange(docId, []);
      vi.setSystemTime(35_001);
      emitAwarenessChange(docId, []);
    } finally {
      getAwarenessEmitter().off("awareness-change", onChange);
    }

    expect(received).toEqual([
      { owner: "owner@example.com" },
      { owner: "owner@example.com" },
      { owner: "owner@example.com" },
    ]);
  });
});

describe("postAwareness handler", () => {
  afterEach(() => {
    mockReadBody.mockReset();
    getDocAwareness("post-doc").clear();
  });

  it("returns 400 when docId is missing", async () => {
    const ev = event({});
    const res = await postAwareness(ev);
    expect(ev._status).toBe(400);
    expect(res).toEqual({ error: "docId required" });
  });

  it("returns 400 when clientId or state is missing", async () => {
    mockReadBody.mockResolvedValue({ clientId: 5 });
    const ev = event({ docId: "post-doc" });
    const res = await postAwareness(ev);
    expect(ev._status).toBe(400);
    expect(res).toEqual({ error: "clientId and state required" });
  });

  it("stores the sender's state and returns only other clients' states", async () => {
    const map = getDocAwareness("post-doc");
    map.set(99, { clientId: 99, state: "other-state", lastSeen: Date.now() });

    const mine = JSON.stringify({ user: { name: "Me" } });
    mockReadBody.mockResolvedValue({ clientId: 5, state: mine });
    const ev = event({ docId: "post-doc" });
    const res = (await postAwareness(ev)) as {
      states: Array<{ clientId: number; state: string }>;
    };

    expect(map.get(5)?.state).toBe(mine);
    expect(res.states).toEqual([{ clientId: 99, state: "other-state" }]);
  });

  it("refuses an editor's state that is not a JSON object", async () => {
    const map = getDocAwareness("writer-unreadable-doc");
    for (const state of ["{broken", "null", "[]", "7"]) {
      mockReadBody.mockResolvedValue({ clientId: 5, state });
      const ev = event({ docId: "writer-unreadable-doc" });

      expect(await postAwareness(ev)).toEqual({
        error: "state must be a JSON object",
      });
      expect(ev._status).toBe(400);
    }
    expect(map.has(5)).toBe(false);
  });

  it("answers an editor with 503, keeping its entry, while stored presence cannot be read", async () => {
    const map = getDocAwareness("writer-unread-doc");
    const mine = JSON.stringify({ user: { name: "Me" } });
    storedRows.unreadable = true;
    mockReadBody.mockResolvedValue({ clientId: 5, state: mine });
    const ev = event({ docId: "writer-unread-doc" });
    try {
      expect(await postAwareness(ev)).toEqual({
        error: "Presence could not be read",
      });
    } finally {
      storedRows.unreadable = false;
    }

    expect(ev._status).toBe(503);
    expect(map.get(5)?.state).toBe(mine);
  });

  it("stores a reader's state as one that cannot flush the doc", async () => {
    const map = getDocAwareness("reader-marked-doc");
    const claim = {
      user: { name: "Reader" },
      canFlushDocument: true,
      reconciledRevision: "body:9:z",
    };
    mockReadBody.mockResolvedValue({
      clientId: 5,
      state: JSON.stringify(claim),
    });
    const ev = {
      ...event({ docId: "reader-marked-doc" }),
      context: { _collabAwarenessReadOnly: true },
    };
    await postAwareness(ev);

    expect(JSON.parse(map.get(5)!.state)).toEqual({
      ...claim,
      canFlushDocument: false,
    });
  });

  it("refuses a reader's state that is not a JSON object", async () => {
    const map = getDocAwareness("post-doc");
    mockReadBody.mockResolvedValue({ clientId: 5, state: "{broken" });
    const ev = {
      ...event({ docId: "post-doc" }),
      context: { _collabAwarenessReadOnly: true },
    };
    const res = await postAwareness(ev);

    expect(ev._status).toBe(400);
    expect(res).toEqual({ error: "state must be a JSON object" });
    expect(map.has(5)).toBe(false);
  });

  describe("from a reader", () => {
    const writer = JSON.stringify({
      user: { name: "Editor" },
      canFlushDocument: true,
      reconciledRevision: "body:3:a",
    });
    const reader = JSON.stringify({ user: { name: "Reader" } });
    const post = (docId: string, clientId: number, state: string | null) => {
      mockReadBody.mockResolvedValue({ clientId, state });
      const ev = {
        ...event({ docId }),
        context: { _collabAwarenessReadOnly: true },
      };
      return postAwareness(ev).then((res) => ({ status: ev._status, res }));
    };

    const storedState = async (docId: string, clientId: number) =>
      (await loadAwarenessRowsStrict(docId)).find(
        (row) => row.clientId === clientId,
      )?.state;
    const writerStoresAfterRead = (docId: string, clientId: number) => {
      storedRows.afterRead = () =>
        upsertAwarenessRow(docId, clientId, writer, Date.now() + 1);
    };

    afterEach(() => {
      storedRows.unreadable = false;
      storedRows.unwritable = false;
      storedRows.afterRead = null;
      storedRows.afterWrite = null;
    });

    it("cannot replace or clear a writer's entry", async () => {
      const map = getDocAwareness("reader-writer-doc");
      map.set(7, { clientId: 7, state: writer, lastSeen: Date.now() });

      expect(await post("reader-writer-doc", 7, reader)).toEqual({
        status: 403,
        res: { error: "clientId belongs to another collaborator" },
      });
      expect((await post("reader-writer-doc", 7, null)).status).toBe(403);
      expect(map.get(7)?.state).toBe(writer);
    });

    it("replaces and clears its own entry, or one that expired", async () => {
      const map = getDocAwareness("reader-own-doc");
      map.set(9, { clientId: 9, state: writer, lastSeen: Date.now() - 60_000 });

      expect((await post("reader-own-doc", 8, reader)).status).toBe(200);
      expect((await post("reader-own-doc", 8, reader)).status).toBe(200);
      expect((await post("reader-own-doc", 9, reader)).status).toBe(200);
      expect((await post("reader-own-doc", 8, null)).status).toBe(200);

      expect(map.has(8)).toBe(false);
      expect(JSON.parse(map.get(9)!.state).canFlushDocument).toBe(false);
    });

    it("cannot replace a writer's entry another server stores after its read", async () => {
      writerStoresAfterRead("reader-raced-doc", 7);

      expect(await post("reader-raced-doc", 7, reader)).toEqual({
        status: 403,
        res: { error: "clientId belongs to another collaborator" },
      });
      // It reads the store again on missing the row it judged, so it knows
      // the writer's entry now.
      expect(getDocAwareness("reader-raced-doc").get(7)?.state).toBe(writer);
      expect(await storedState("reader-raced-doc", 7)).toBe(writer);
    });

    it.each([
      { action: "replace", state: reader, offset: 0, when: "at the same time" },
      { action: "clear", state: null, offset: 0, when: "at the same time" },
      {
        action: "replace",
        state: reader,
        offset: -1000,
        when: "earlier by a slower clock",
      },
      {
        action: "clear",
        state: null,
        offset: -1000,
        when: "earlier by a slower clock",
      },
    ])(
      "cannot $action a writer's stored entry this server knows as its own, stamped $when",
      async ({ action, state, offset }) => {
        const docId = `reader-cached-${action}-${offset}`;
        expect((await post(docId, 7, reader)).status).toBe(200);
        // A writer on another server stores an entry under this id.
        await upsertAwarenessRow(
          docId,
          7,
          writer,
          getDocAwareness(docId).get(7)!.lastSeen + offset,
        );

        expect(await post(docId, 7, state)).toEqual({
          status: 403,
          res: { error: "clientId belongs to another collaborator" },
        });
        expect(await storedState(docId, 7)).toBe(writer);
        expect(getDocAwareness(docId).get(7)?.state).toBe(writer);
      },
    );

    it.each([
      { action: "renews", state: reader },
      { action: "clears", state: null },
    ])(
      "$action its own entry while a clear here outdates the stored one",
      async ({ state }) => {
        const docId = `reader-outdated-${state === null ? "clear" : "renew"}`;
        const now = Date.now();
        await upsertAwarenessRow(docId, 7, reader, now - 1000);
        rememberAwarenessClear(docId, 7, now - 500);

        expect((await post(docId, 7, state)).status).toBe(200);
        const stored = await storedState(docId, 7);
        expect(stored && JSON.parse(stored).user).toEqual(
          state === null ? undefined : { name: "Reader" },
        );
      },
    );

    it("cannot replace its own entry once a writer on another server stores one there", async () => {
      expect((await post("reader-taken-doc", 9, reader)).status).toBe(200);
      writerStoresAfterRead("reader-taken-doc", 9);

      expect((await post("reader-taken-doc", 9, reader)).status).toBe(403);
      expect(await storedState("reader-taken-doc", 9)).toBe(writer);
    });

    it("leaves a writer's entry another server stores after its read when it clears", async () => {
      writerStoresAfterRead("reader-raced-clear-doc", 7);

      expect((await post("reader-raced-clear-doc", 7, null)).status).toBe(200);
      expect(await storedState("reader-raced-clear-doc", 7)).toBe(writer);
      // Nor does this server hide it the next time it reads the store.
      mockReadBody.mockResolvedValue({
        clientId: 8,
        state: JSON.stringify({ user: { name: "Other" } }),
      });
      const res = (await postAwareness(
        event({ docId: "reader-raced-clear-doc" }),
      )) as { states: Array<{ clientId: number; state: string }> };
      expect(res.states).toContainEqual({ clientId: 7, state: writer });
    });

    it.each([
      { action: "replace", state: reader },
      { action: "clear", state: null },
    ])(
      "keeps a writer that posts here while its $action is on its way",
      async ({ action, state }) => {
        const docId = `reader-overtaken-${action}`;
        storedRows.afterWrite = async () => {
          mockReadBody.mockResolvedValue({ clientId: 7, state: writer });
          await postAwareness(event({ docId }));
        };
        const broadcasts: Array<Array<{ clientId: number; state: string }>> =
          [];
        const listener = (change: {
          docId: string;
          states: Array<{ clientId: number; state: string }>;
        }) => {
          if (change.docId === docId) broadcasts.push(change.states);
        };
        getAwarenessEmitter().on("awareness-change", listener);
        try {
          expect((await post(docId, 7, state)).status).toBe(200);
        } finally {
          getAwarenessEmitter().off("awareness-change", listener);
        }

        expect(getDocAwareness(docId).get(7)?.state).toBe(writer);
        expect(broadcasts.at(-1)).toContainEqual({
          clientId: 7,
          state: writer,
        });
      },
    );

    it("is refused, changing nothing, while its presence cannot be saved", async () => {
      storedRows.unwritable = true;

      expect(await post("reader-unsaved-doc", 8, reader)).toEqual({
        status: 503,
        res: { error: "Presence could not be saved" },
      });
      expect(getDocAwareness("reader-unsaved-doc").has(8)).toBe(false);
    });

    it("is refused, changing nothing, while stored presence cannot be read", async () => {
      const map = getDocAwareness("reader-unread-doc");
      storedRows.unreadable = true;

      expect(await post("reader-unread-doc", 8, reader)).toEqual({
        status: 503,
        res: { error: "Presence could not be read" },
      });
      expect(map.has(8)).toBe(false);
    });
  });

  it("clears the sender's state when state is null", async () => {
    const map = getDocAwareness("post-doc");
    map.set(5, { clientId: 5, state: "old-state", lastSeen: Date.now() });
    map.set(99, { clientId: 99, state: "other-state", lastSeen: Date.now() });

    mockReadBody.mockResolvedValue({ clientId: 5, state: null });
    const ev = event({ docId: "post-doc" });
    const res = (await postAwareness(ev)) as {
      states: Array<{ clientId: number; state: string }>;
    };

    expect(map.has(5)).toBe(false);
    expect(res.states).toEqual([{ clientId: 99, state: "other-state" }]);
  });

  it("evicts expired peers before responding", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const map = getDocAwareness("post-doc");
    map.set(7, { clientId: 7, state: "expired", lastSeen: 0 });

    vi.setSystemTime(40_000);
    mockReadBody.mockResolvedValue({
      clientId: 5,
      state: JSON.stringify({ user: { name: "Fresh" } }),
    });
    const res = (await postAwareness(event({ docId: "post-doc" }))) as {
      states: Array<{ clientId: number }>;
    };
    vi.useRealTimers();

    expect(map.has(7)).toBe(false);
    expect(res.states).toEqual([]);
  });
});

describe("getActiveUsers handler", () => {
  afterEach(() => {
    getDocAwareness("users-doc").clear();
  });

  it("returns 400 when docId is missing", async () => {
    const ev = event({});
    const res = await getActiveUsers(ev);
    expect(ev._status).toBe(400);
    expect(res).toEqual({ error: "docId required" });
  });

  it("lists active client ids and prunes expired ones", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const map = getDocAwareness("users-doc");
    map.set(1, { clientId: 1, state: "a", lastSeen: 0 });
    map.set(2, { clientId: 2, state: "b", lastSeen: 25_000 });

    vi.setSystemTime(40_000);
    const res = (await getActiveUsers(event({ docId: "users-doc" }))) as {
      users: Array<{ clientId: number; lastSeen: number }>;
    };
    vi.useRealTimers();

    expect(res.users).toEqual([{ clientId: 2, lastSeen: 25_000 }]);
  });
});
