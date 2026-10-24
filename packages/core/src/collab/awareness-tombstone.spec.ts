import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadBody = vi.fn();
const storedRows = vi.hoisted(
  () =>
    new Map<
      string,
      {
        clientId: number;
        state: string;
        lastSeen: number;
        clientSequence: number;
        clientSequenceRaw: number;
        cleared: boolean;
        actorEmail?: string | null;
      }
    >(),
);

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

vi.mock("../server/auth.js", () => ({
  getSession: vi.fn(async () => ({ email: "collaborator@example.com" })),
}));

vi.mock("../server/h3-helpers.js", () => ({
  readBody: (...args: unknown[]) => mockReadBody(...args),
}));

vi.mock("./awareness-store.js", () => ({
  loadAwarenessClientSequence: vi.fn(
    async (docId: string, clientId: number) => {
      const row = storedRows.get(rowKey(docId, clientId));
      return row
        ? {
            clientSequence: row.clientSequence,
            cleared: row.cleared,
            actorEmail: row.actorEmail ?? null,
          }
        : undefined;
    },
  ),
  loadAwarenessRows: vi.fn(async (docId: string) =>
    Array.from(storedRows.entries())
      .filter(([key]) => key.startsWith(`${docId}:`))
      .map(([, row]) => row),
  ),
  writeAwarenessRow: vi.fn(
    async (
      docId: string,
      clientId: number,
      state: string,
      lastSeen: number,
      clientSequence: number,
      cleared: boolean,
      actorEmail?: string | null,
    ) => {
      const key = rowKey(docId, clientId);
      const previous = storedRows.get(key);
      if (
        previous &&
        clientSequence <= previous.clientSequence &&
        !(clientSequence === 0 && previous.clientSequence === 0)
      ) {
        return false;
      }
      storedRows.set(key, {
        clientId,
        state,
        lastSeen,
        clientSequence,
        clientSequenceRaw: 0,
        cleared,
        actorEmail: actorEmail ?? null,
      });
      return true;
    },
  ),
}));

import { AGENT_CLIENT_ID } from "./agent-identity.js";
import { loadAwarenessRows, writeAwarenessRow } from "./awareness-store.js";
import {
  forgetAwarenessClear,
  getAwarenessEmitter,
  getDocAwareness,
  postAwareness,
  rememberAwarenessClear,
} from "./awareness.js";

function rowKey(docId: string, clientId: number): string {
  return `${docId}:${clientId}`;
}

function event(docId: string) {
  return { _params: { docId }, _status: 200, _headers: {} } as any;
}

describe("awareness clear tombstones", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    storedRows.clear();
    mockReadBody.mockResolvedValue({
      clientId: 1,
      state: JSON.stringify({ user: { email: "viewer@example.com" } }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    mockReadBody.mockReset();
    getDocAwareness("tombstone-doc").clear();
    forgetAwarenessClear("tombstone-doc", AGENT_CLIENT_ID);
    forgetAwarenessClear("tombstone-doc", 7);
    forgetAwarenessClear("awareness-store-outage-clear", 44);
    forgetAwarenessClear("awareness-read-outage-clear", 45);
  });

  it("does not resurrect a stored agent row older than the clear", async () => {
    rememberAwarenessClear("tombstone-doc", AGENT_CLIENT_ID, 10_000);
    storedRows.set(rowKey("tombstone-doc", AGENT_CLIENT_ID), {
      clientId: AGENT_CLIENT_ID,
      state: JSON.stringify({ user: { email: "agent@system" } }),
      lastSeen: 9_000,
      clientSequence: 0,
      clientSequenceRaw: 0,
      cleared: false,
      actorEmail: null,
    });

    const res = (await postAwareness(event("tombstone-doc"))) as {
      states: Array<{ clientId: number }>;
    };

    expect(res.states).toEqual([]);
    expect(getDocAwareness("tombstone-doc").has(AGENT_CLIENT_ID)).toBe(false);
    expect(
      storedRows.get(rowKey("tombstone-doc", AGENT_CLIENT_ID)),
    ).toMatchObject({
      lastSeen: 9_000,
      cleared: false,
    });
  });

  it("allows a stored agent row newer than the clear", async () => {
    rememberAwarenessClear("tombstone-doc", AGENT_CLIENT_ID, 10_000);
    storedRows.set(rowKey("tombstone-doc", AGENT_CLIENT_ID), {
      clientId: AGENT_CLIENT_ID,
      state: JSON.stringify({ user: { email: "agent@system" } }),
      lastSeen: 10_001,
      clientSequence: 0,
      clientSequenceRaw: 0,
      cleared: false,
      actorEmail: null,
    });

    await postAwareness(event("tombstone-doc"));

    expect(getDocAwareness("tombstone-doc").has(AGENT_CLIENT_ID)).toBe(true);
  });

  it("keeps the final server state when older requests arrive after a clear", async () => {
    const map = getDocAwareness("tombstone-doc");
    map.set(7, {
      clientId: 7,
      state: JSON.stringify({ visible: true }),
      lastSeen: 9_000,
      clientSequence: 10,
    });
    storedRows.set(rowKey("tombstone-doc", 7), {
      clientId: 7,
      state: JSON.stringify({ visible: true }),
      lastSeen: 9_000,
      clientSequence: 10,
      clientSequenceRaw: 0,
      cleared: false,
      actorEmail: "collaborator@example.com",
    });

    mockReadBody.mockResolvedValueOnce({
      clientId: 7,
      clientSequence: 12,
      state: null,
    });
    await postAwareness(event("tombstone-doc"));

    expect(map.has(7)).toBe(false);
    expect(storedRows.get(rowKey("tombstone-doc", 7))).toMatchObject({
      clientSequence: 12,
      cleared: true,
    });

    mockReadBody.mockResolvedValueOnce({
      clientId: 7,
      clientSequence: 11,
      state: JSON.stringify({ visible: true }),
    });
    await postAwareness(event("tombstone-doc"));

    expect(map.has(7)).toBe(false);
    expect(storedRows.get(rowKey("tombstone-doc", 7))).toMatchObject({
      clientSequence: 12,
      cleared: true,
    });
  });

  it("fans out local presence and returns an explicit failure during a store outage", async () => {
    const docId = "awareness-store-outage";
    const map = getDocAwareness(docId);
    map.set(42, {
      clientId: 42,
      state: JSON.stringify({ user: { email: "collaborator@example.com" } }),
      lastSeen: 10_000,
      clientSequence: 1,
      clientSequenceRaw: 0,
      actorEmail: "collaborator@example.com",
    });
    const changes: Array<{
      docId: string;
      states: Array<{ clientId: number; state: string }>;
    }> = [];
    const onChange = (change: (typeof changes)[number]) => changes.push(change);
    getAwarenessEmitter().on("awareness-change", onChange);
    vi.mocked(writeAwarenessRow).mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    mockReadBody.mockResolvedValueOnce({
      clientId: 42,
      clientSequence: 2,
      state: JSON.stringify({
        visible: true,
        user: { email: "forged@example.com" },
      }),
    });

    try {
      const ev = event(docId);
      await expect(postAwareness(ev)).resolves.toEqual({
        error: "Awareness persistence unavailable",
        failureType: "Error",
      });

      const localEntry = getDocAwareness(docId).get(42);
      expect(ev._status).toBe(503);
      expect(localEntry).toMatchObject({
        clientId: 42,
        clientSequence: 2,
        actorEmail: "collaborator@example.com",
      });
      expect(JSON.parse(localEntry!.state)).toMatchObject({
        visible: true,
        user: { email: "collaborator@example.com" },
      });
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        docId,
        states: [{ clientId: 42, state: localEntry!.state }],
      });
      expect(storedRows.has(rowKey(docId, 42))).toBe(false);
    } finally {
      getAwarenessEmitter().off("awareness-change", onChange);
      getDocAwareness(docId).clear();
    }
  });

  it("does not overwrite or clear another collaborator during a store outage", async () => {
    const docId = "awareness-store-outage-peer";
    const map = getDocAwareness(docId);
    map.set(43, {
      clientId: 43,
      state: JSON.stringify({ user: { email: "peer@example.com" } }),
      lastSeen: 10_000,
      clientSequence: 1,
      clientSequenceRaw: 0,
      actorEmail: "peer@example.com",
    });
    vi.mocked(writeAwarenessRow).mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    mockReadBody.mockResolvedValueOnce({
      clientId: 43,
      clientSequence: 2,
      state: null,
    });

    try {
      const ev = event(docId);
      await expect(postAwareness(ev)).resolves.toMatchObject({
        error: "Awareness persistence unavailable",
      });

      expect(ev._status).toBe(503);
      expect(map.get(43)).toMatchObject({
        state: JSON.stringify({ user: { email: "peer@example.com" } }),
        actorEmail: "peer@example.com",
      });
    } finally {
      map.clear();
    }
  });

  it("clears an owned presence and fans it out during a store outage", async () => {
    const docId = "awareness-store-outage-clear";
    const map = getDocAwareness(docId);
    map.set(44, {
      clientId: 44,
      state: JSON.stringify({ user: { email: "collaborator@example.com" } }),
      lastSeen: 10_000,
      clientSequence: 1,
      clientSequenceRaw: 0,
      actorEmail: "collaborator@example.com",
    });
    const changes: Array<{
      docId: string;
      states: Array<{ clientId: number; state: string }>;
    }> = [];
    const onChange = (change: (typeof changes)[number]) => changes.push(change);
    getAwarenessEmitter().on("awareness-change", onChange);
    vi.mocked(writeAwarenessRow).mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    mockReadBody.mockResolvedValueOnce({
      clientId: 44,
      clientSequence: 2,
      state: null,
    });

    try {
      const ev = event(docId);
      await expect(postAwareness(ev)).resolves.toMatchObject({
        error: "Awareness persistence unavailable",
      });

      expect(ev._status).toBe(503);
      expect(map.has(44)).toBe(false);
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({ docId, states: [] });
    } finally {
      getAwarenessEmitter().off("awareness-change", onChange);
      map.clear();
    }
  });

  it("clears local presence before the follow-up store read", async () => {
    const docId = "awareness-read-outage-clear";
    const map = getDocAwareness(docId);
    map.set(45, {
      clientId: 45,
      state: JSON.stringify({ user: { email: "collaborator@example.com" } }),
      lastSeen: 10_000,
      clientSequence: 1,
      clientSequenceRaw: 0,
      actorEmail: "collaborator@example.com",
    });
    const changes: Array<{
      docId: string;
      states: Array<{ clientId: number; state: string }>;
    }> = [];
    const onChange = (change: (typeof changes)[number]) => changes.push(change);
    getAwarenessEmitter().on("awareness-change", onChange);
    mockReadBody.mockResolvedValueOnce({
      clientId: 45,
      clientSequence: 2,
      state: null,
    });
    vi.mocked(loadAwarenessRows).mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    try {
      const ev = event(docId);
      await expect(postAwareness(ev)).resolves.toEqual({
        error: "Awareness read unavailable",
        failureType: "Error",
      });

      expect(ev._status).toBe(503);
      expect(map.has(45)).toBe(false);
      expect(storedRows.get(rowKey(docId, 45))).toMatchObject({
        clientSequence: 2,
        cleared: true,
      });
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({ docId, states: [] });
    } finally {
      getAwarenessEmitter().off("awareness-change", onChange);
      map.clear();
    }
  });
});
