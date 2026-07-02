import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// h3 in the source is only used for handler plumbing; stub it so we can drive
// the handlers with plain fake events and inspect the response status.
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

import {
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

    vi.setSystemTime(31_000); // 31s after t=0
    cleanExpired(map);

    expect(map.has(1)).toBe(false); // 31s old > 30s timeout
    expect(map.has(2)).toBe(true); // 11s old
  });

  it("keeps an entry exactly at the boundary (not strictly greater)", () => {
    const map = new Map<number, AwarenessEntry>();
    map.set(1, { clientId: 1, state: "edge", lastSeen: 0 });
    vi.setSystemTime(30_000); // exactly 30s — boundary is not expired
    cleanExpired(map);
    expect(map.has(1)).toBe(true);
  });
});

describe("postAwareness handler", () => {
  afterEach(() => {
    mockReadBody.mockReset();
    // Clear shared maps used by these tests.
    getDocAwareness("post-doc").clear();
  });

  it("returns 400 when docId is missing", async () => {
    const ev = event({});
    const res = await postAwareness(ev);
    expect(ev._status).toBe(400);
    expect(res).toEqual({ error: "docId required" });
  });

  it("returns 400 when clientId or state is missing", async () => {
    mockReadBody.mockResolvedValue({ clientId: 5 }); // no state
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

    // Sender stored.
    expect(map.get(5)?.state).toBe("my-state");
    // Response excludes the sender (5), includes the peer (99).
    expect(res.states).toEqual([{ clientId: 99, state: "other-state" }]);
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
    expect(res.states).toEqual([]); // peer 7 expired, sender 5 excluded
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

    // Client 1 (40s old) pruned; client 2 (15s old) survives.
    expect(res.users).toEqual([{ clientId: 2, lastSeen: 25_000 }]);
  });
});
