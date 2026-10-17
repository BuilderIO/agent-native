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
const storedRows = vi.hoisted(() => ({ unreadable: false }));
vi.mock("./awareness-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./awareness-store.js")>();
  return {
    ...actual,
    loadAwarenessRowsStrict: async (
      ...args: Parameters<typeof actual.loadAwarenessRowsStrict>
    ) => {
      if (storedRows.unreadable) throw new Error("Presence store unavailable");
      return actual.loadAwarenessRowsStrict(...args);
    },
  };
});

import {
  emitAwarenessChange,
  getAwarenessEmitter,
  getDocAwareness,
  cleanExpired,
  postAwareness,
  getActiveUsers,
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

    mockReadBody.mockResolvedValue({ clientId: 5, state: "my-state" });
    const ev = event({ docId: "post-doc" });
    const res = (await postAwareness(ev)) as {
      states: Array<{ clientId: number; state: string }>;
    };

    expect(map.get(5)?.state).toBe("my-state");
    expect(res.states).toEqual([{ clientId: 99, state: "other-state" }]);
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

    afterEach(() => {
      storedRows.unreadable = false;
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
    mockReadBody.mockResolvedValue({ clientId: 5, state: "fresh" });
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
