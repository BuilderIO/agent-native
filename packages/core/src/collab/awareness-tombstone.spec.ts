import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadBody = vi.fn();
const storedRows = vi.hoisted(
  () =>
    new Map<string, { clientId: number; state: string; lastSeen: number }>(),
);
const deletedRows = vi.hoisted(
  () => [] as Array<{ docId: string; clientId: number; maxLastSeen?: number }>,
);

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getRouterParam: (event: any, name: string) => event._params?.[name],
  setResponseStatus: (event: any, status: number) => {
    event._status = status;
  },
}));

vi.mock("../server/h3-helpers.js", () => ({
  readBody: (...args: unknown[]) => mockReadBody(...args),
}));

vi.mock("./awareness-store.js", () => ({
  deleteAwarenessRow: vi.fn(
    async (docId: string, clientId: number, maxLastSeen?: number) => {
      deletedRows.push({ docId, clientId, maxLastSeen });
    },
  ),
  loadAwarenessRows: vi.fn(async (docId: string) =>
    Array.from(storedRows.entries())
      .filter(([key]) => key.startsWith(`${docId}:`))
      .map(([, row]) => row),
  ),
  upsertAwarenessRow: vi.fn(),
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
  return { _params: { docId }, _status: 200 } as any;
}

describe("awareness clear tombstones", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    storedRows.clear();
    deletedRows.length = 0;
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
  });

  it("does not resurrect a stored agent row older than the clear", async () => {
    rememberAwarenessClear("tombstone-doc", AGENT_CLIENT_ID, 10_000);
    storedRows.set(rowKey("tombstone-doc", AGENT_CLIENT_ID), {
      clientId: AGENT_CLIENT_ID,
      state: JSON.stringify({ user: { email: "agent@system" } }),
      lastSeen: 9_000,
    });

    const res = (await postAwareness(event("tombstone-doc"))) as {
      states: Array<{ clientId: number }>;
    };

    expect(res.states).toEqual([]);
    expect(getDocAwareness("tombstone-doc").has(AGENT_CLIENT_ID)).toBe(false);
    expect(deletedRows).toContainEqual({
      docId: "tombstone-doc",
      clientId: AGENT_CLIENT_ID,
      maxLastSeen: 9_000,
    });
  });

  it("allows a stored agent row newer than the clear", async () => {
    rememberAwarenessClear("tombstone-doc", AGENT_CLIENT_ID, 10_000);
    storedRows.set(rowKey("tombstone-doc", AGENT_CLIENT_ID), {
      clientId: AGENT_CLIENT_ID,
      state: JSON.stringify({ user: { email: "agent@system" } }),
      lastSeen: 10_001,
    });

    await postAwareness(event("tombstone-doc"));

    expect(getDocAwareness("tombstone-doc").has(AGENT_CLIENT_ID)).toBe(true);
    expect(deletedRows).toEqual([]);
  });
});
