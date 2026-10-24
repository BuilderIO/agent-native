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
        cleared,
        actorEmail: actorEmail ?? null,
      });
      return true;
    },
  ),
}));

import { AGENT_CLIENT_ID } from "./agent-identity.js";
import {
  forgetAwarenessClear,
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
  });

  it("does not resurrect a stored agent row older than the clear", async () => {
    rememberAwarenessClear("tombstone-doc", AGENT_CLIENT_ID, 10_000);
    storedRows.set(rowKey("tombstone-doc", AGENT_CLIENT_ID), {
      clientId: AGENT_CLIENT_ID,
      state: JSON.stringify({ user: { email: "agent@system" } }),
      lastSeen: 9_000,
      clientSequence: 0,
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
});
