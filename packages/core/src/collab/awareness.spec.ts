import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getRouterParam: (event: any, name: string) => event._params?.[name],
  setResponseStatus: (event: any, status: number) => {
    event._status = status;
  },
  setResponseHeader: (event: any, name: string, value: string) => {
    (event._headers ??= {})[name.toLowerCase()] = value;
  },
}));

const mockReadBody = vi.fn();
const mockGetSession = vi.fn();
vi.mock("../server/auth.js", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));
vi.mock("../server/h3-helpers.js", () => ({
  readBody: (...args: unknown[]) => mockReadBody(...args),
}));

import { AGENT_CLIENT_ID } from "./agent-identity.js";
import {
  emitAwarenessChange,
  getAwarenessEmitter,
  getDocAwareness,
  cleanExpired,
  postAwareness,
  getActiveUsers,
  type AwarenessEntry,
} from "./awareness.js";
import { emailToColor, emailToName } from "./types.js";

const testRunId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function scopedDocId(docId: string): string {
  return `${docId}::${testRunId}`;
}

function docAwareness(docId: string): Map<number, AwarenessEntry> {
  return getDocAwareness(scopedDocId(docId));
}

function event(params: Record<string, string> = {}) {
  return {
    _params: {
      ...params,
      ...(params.docId ? { docId: scopedDocId(params.docId) } : {}),
    },
    _status: 200,
  } as any;
}

function postedAwarenessState(value: string): string {
  return JSON.stringify({
    value,
    user: {
      name: "Forged identity",
      email: "peer@example.com",
      color: "forged-color",
      avatarUrl: "https://attacker.example/avatar.png",
    },
  });
}

function authenticatedAwarenessState(
  value: string,
  email = "collaborator@example.com",
  name = emailToName(email),
): string {
  return JSON.stringify({
    value,
    user: { name, email, color: emailToColor(email) },
  });
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
  beforeEach(() => {
    mockGetSession.mockResolvedValue({ email: "collaborator@example.com" });
  });

  afterEach(() => {
    vi.useRealTimers();
    mockReadBody.mockReset();
    mockGetSession.mockReset();
    docAwareness("post-doc").clear();
    docAwareness("post-doc-actor").clear();
    docAwareness("post-doc-agent-id").clear();
    docAwareness("post-doc-identity").clear();
    docAwareness("post-doc-invalid-state").clear();
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

  it("does not let a caller claim the reserved agent client id", async () => {
    mockReadBody.mockResolvedValue({
      clientId: AGENT_CLIENT_ID,
      state: JSON.stringify({ user: { name: "Spoofed agent" } }),
    });
    const ev = event({ docId: "post-doc-agent-id" });

    await expect(postAwareness(ev)).resolves.toEqual({
      error: "invalid clientId",
    });
    expect(ev._status).toBe(400);
    expect(docAwareness("post-doc-agent-id").has(AGENT_CLIENT_ID)).toBe(false);
  });

  it("binds posted awareness to the authenticated collaborator", async () => {
    const docId = "post-doc-actor";
    mockGetSession.mockResolvedValueOnce({ email: "owner@example.com" });
    mockReadBody.mockResolvedValueOnce({
      clientId: 51,
      clientSequence: 1,
      state: postedAwarenessState("owner-state"),
    });
    await postAwareness(event({ docId }));

    mockGetSession.mockResolvedValueOnce({ email: "viewer@example.com" });
    mockReadBody.mockResolvedValueOnce({
      clientId: 51,
      clientSequence: 2,
      state: postedAwarenessState("forged-state"),
    });
    const ev = event({ docId });
    await expect(postAwareness(ev)).resolves.toEqual({
      error: "Awareness client id belongs to another collaborator",
    });

    expect(ev._status).toBe(403);
    expect(docAwareness(docId).get(51)?.state).toBe(
      authenticatedAwarenessState("owner-state", "owner@example.com"),
    );

    mockGetSession.mockResolvedValueOnce({ email: "viewer@example.com" });
    mockReadBody.mockResolvedValueOnce({
      clientId: 51,
      clientSequence: 3,
      state: null,
    });
    const clearEv = event({ docId });
    await expect(postAwareness(clearEv)).resolves.toEqual({
      error: "Awareness client id belongs to another collaborator",
    });

    expect(clearEv._status).toBe(403);
    expect(docAwareness(docId).get(51)?.state).toBe(
      authenticatedAwarenessState("owner-state", "owner@example.com"),
    );
  });

  it("requires an authenticated collaborator to post awareness", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    mockReadBody.mockResolvedValueOnce({ clientId: 5, state: "guest-state" });
    const ev = event({ docId: "post-doc" });

    await expect(postAwareness(ev)).resolves.toEqual({
      error: "Authentication required",
    });
    expect(ev._status).toBe(401);
  });

  it("rejects a client sequence beyond the allowed legacy clock skew", async () => {
    const map = docAwareness("post-doc");
    map.set(99, { clientId: 99, state: "peer-state", lastSeen: Date.now() });
    mockReadBody.mockResolvedValue({
      clientId: 99,
      clientSequence: Number.MAX_SAFE_INTEGER,
      state: "attacker-state",
    });

    const ev = event({ docId: "post-doc" });
    const res = await postAwareness(ev);

    expect(ev._status).toBe(400);
    expect(res).toEqual({ error: "invalid awareness state or clientSequence" });
    expect(map.get(99)?.state).toBe("peer-state");
  });

  it("accepts legacy wall-clock sequences with substantial clock skew", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    mockReadBody.mockResolvedValue({
      clientId: 6,
      clientSequence: 2_000_000_000_000,
      state: postedAwarenessState("client-state"),
    });

    const ev = event({ docId: "post-doc" });
    const res = await postAwareness(ev);

    expect(ev._status).toBe(200);
    expect(docAwareness("post-doc").get(6)?.state).toBe(
      authenticatedAwarenessState("client-state"),
    );
    expect(res).toMatchObject({ states: [] });
    vi.useRealTimers();
  });

  it("asks clients to resynchronize after a bounded sequence gap", async () => {
    const docId = "post-doc-sequence-gap";
    mockReadBody.mockResolvedValue({
      clientId: 15,
      clientSequence: 1,
      state: postedAwarenessState("current-state"),
    });
    await postAwareness(event({ docId }));

    mockReadBody.mockResolvedValue({
      clientId: 15,
      clientSequence: 1 + 257,
      state: postedAwarenessState("out-of-window-state"),
    });
    const ev = event({ docId });
    await postAwareness(ev);

    expect(ev._status).toBe(409);
    expect(ev._headers).toMatchObject({ "x-awareness-client-sequence": "1" });
    expect(docAwareness(docId).get(15)?.state).toBe(
      authenticatedAwarenessState("current-state"),
    );
    docAwareness(docId).clear();
  });

  it("asks clients to resynchronize after any rejected bounded sequence", async () => {
    const docId = "post-doc-stale-sequence";
    mockReadBody.mockResolvedValue({
      clientId: 16,
      clientSequence: 7,
      state: postedAwarenessState("current-state"),
    });
    await postAwareness(event({ docId }));

    mockReadBody.mockResolvedValue({
      clientId: 16,
      clientSequence: 6,
      state: postedAwarenessState("stale-state"),
    });
    const ev = event({ docId });
    await postAwareness(ev);

    expect(ev._status).toBe(409);
    expect(ev._headers).toMatchObject({ "x-awareness-client-sequence": "7" });
    expect(docAwareness(docId).get(16)?.state).toBe(
      authenticatedAwarenessState("current-state"),
    );
    docAwareness(docId).clear();
  });

  it("stores the sender's state and returns only other clients' states", async () => {
    const map = docAwareness("post-doc");
    map.set(99, { clientId: 99, state: "other-state", lastSeen: Date.now() });

    mockReadBody.mockResolvedValue({
      clientId: 5,
      state: postedAwarenessState("my-state"),
    });
    const ev = event({ docId: "post-doc" });
    const res = (await postAwareness(ev)) as {
      states: Array<{ clientId: number; state: string }>;
    };

    expect(map.get(5)?.state).toBe(authenticatedAwarenessState("my-state"));
    expect(res.states).toEqual([{ clientId: 99, state: "other-state" }]);
  });

  it("clears the sender's state when state is null", async () => {
    const map = docAwareness("post-doc");
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
    const map = docAwareness("post-doc");
    map.set(7, { clientId: 7, state: "expired", lastSeen: 0 });

    vi.setSystemTime(40_000);
    mockReadBody.mockResolvedValue({
      clientId: 5,
      state: postedAwarenessState("fresh"),
    });
    const res = (await postAwareness(event({ docId: "post-doc" }))) as {
      states: Array<{ clientId: number }>;
    };
    vi.useRealTimers();

    expect(map.has(7)).toBe(false);
    expect(res.states).toEqual([]);
  });

  it("derives displayed identity from the authenticated session", async () => {
    mockGetSession.mockResolvedValueOnce({
      email: "Alice@Example.com",
      name: "Alice Auth",
      image: "https://profiles.example/alice.png",
    });
    mockReadBody.mockResolvedValueOnce({
      clientId: 63,
      clientSequence: 1,
      state: JSON.stringify({
        user: {
          name: "Bob",
          email: "bob@example.com",
          color: "forged-color",
          avatarUrl: "https://attacker.example/bob.png",
        },
        visible: true,
        pointer: { x: 3, y: 7 },
      }),
    });

    await postAwareness(event({ docId: "post-doc-identity" }));

    const stored = JSON.parse(docAwareness("post-doc-identity").get(63)!.state);
    expect(stored.user).toEqual({
      name: "Alice Auth",
      email: "alice@example.com",
      color: emailToColor("alice@example.com"),
      avatarUrl: "https://profiles.example/alice.png",
    });
    expect(stored).toMatchObject({ visible: true, pointer: { x: 3, y: 7 } });
  });

  it("rejects unreadable serialized awareness state", async () => {
    mockReadBody.mockResolvedValueOnce({
      clientId: 64,
      clientSequence: 1,
      state: "not-json",
    });
    const ev = event({ docId: "post-doc-invalid-state" });

    await expect(postAwareness(ev)).resolves.toEqual({
      error: "invalid awareness state or clientSequence",
    });

    expect(ev._status).toBe(400);
    expect(docAwareness("post-doc-invalid-state").has(64)).toBe(false);
  });
});

describe("getActiveUsers handler", () => {
  afterEach(() => {
    docAwareness("users-doc").clear();
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
    const map = docAwareness("users-doc");
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
