import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  awaitBootstrap: vi.fn(async () => {}),
  emitter: { on: vi.fn() },
  execute: vi.fn(),
  getH3App: vi.fn(),
  getSession: vi.fn(async () => ({ email: "owner@example.com" })),
  getOrgContext: vi.fn(async () => null),
  hasCollabState: vi.fn(),
  resolveAccess: vi.fn(),
  assertAccess: vi.fn(),
  postAwareness: vi.fn(async () => ({ ok: true })),
  getActiveUsers: vi.fn(async () => ({ users: [] })),
  getCollabState: vi.fn(async () => ({ state: "" })),
  postCollabUpdate: vi.fn(async () => ({ ok: true })),
  postCollabText: vi.fn(async () => ({ ok: true })),
  postCollabSearchReplace: vi.fn(async () => ({ ok: true })),
  postCollabJson: vi.fn(async () => ({ ok: true })),
  getCollabJson: vi.fn(async () => ({ data: {} })),
  postCollabPatch: vi.fn(async () => ({ ok: true })),
  seedFromText: vi.fn(),
  seedFromJson: vi.fn(),
  recordChange: vi.fn(),
  runWithRequestContext: vi.fn(
    async (_context: unknown, callback: () => unknown) => callback(),
  ),
  transaction: null as
    | null
    | ((
        run: (tx: { execute: typeof mocks.execute }) => Promise<unknown>,
      ) => Promise<unknown>),
  use: vi.fn(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getMethod: (event: { method: string }) => event.method,
  setResponseStatus: (event: { status?: number }, status: number) => {
    event.status = status;
  },
}));

vi.mock("../collab/awareness.js", () => ({
  postAwareness: mocks.postAwareness,
  getActiveUsers: mocks.getActiveUsers,
}));
vi.mock("../collab/emitter.js", () => ({
  getCollabEmitter: () => mocks.emitter,
}));
vi.mock("../collab/routes.js", () => ({
  getCollabState: mocks.getCollabState,
  postCollabUpdate: mocks.postCollabUpdate,
  postCollabText: mocks.postCollabText,
  postCollabSearchReplace: mocks.postCollabSearchReplace,
}));
vi.mock("../collab/storage.js", () => ({
  hasCollabState: mocks.hasCollabState,
}));
vi.mock("../collab/struct-routes.js", () => ({
  postCollabJson: mocks.postCollabJson,
  getCollabJson: mocks.getCollabJson,
  postCollabPatch: mocks.postCollabPatch,
}));
vi.mock("../collab/ydoc-manager.js", () => ({
  seedFromText: mocks.seedFromText,
  seedFromJson: mocks.seedFromJson,
}));
vi.mock("../db/client.js", () => ({
  getDbExec: () => ({
    execute: mocks.execute,
    ...(mocks.transaction ? { transaction: mocks.transaction } : {}),
  }),
  withDbExec: (_exec: unknown, run: () => unknown) => run(),
}));
vi.mock("../org/context.js", () => ({
  getOrgContext: mocks.getOrgContext,
}));
vi.mock("../sharing/access.js", () => ({
  resolveAccess: mocks.resolveAccess,
  assertAccess: mocks.assertAccess,
}));
vi.mock("./auth.js", () => ({
  getSession: mocks.getSession,
}));
vi.mock("./core-routes-plugin.js", () => ({
  FRAMEWORK_ROUTE_PREFIX: "/_agent-native",
}));
vi.mock("./framework-request-handler.js", () => ({
  awaitBootstrap: mocks.awaitBootstrap,
  getH3App: mocks.getH3App,
}));
vi.mock("./poll.js", () => ({
  recordChange: mocks.recordChange,
}));
vi.mock("./request-context.js", () => ({
  runWithRequestContext: mocks.runWithRequestContext,
}));

import {
  createCollabPlugin,
  type CollabPluginOptions,
} from "./collab-plugin.js";

function makeEvent(docId = "design-file-1") {
  return {
    method: "GET",
    url: new URL(`http://localhost/${docId}/state`),
    headers: new Headers(),
    context: {},
  };
}

async function mountCollabHandler(
  options: Partial<CollabPluginOptions> = {},
): Promise<(event: unknown) => Promise<unknown>> {
  const app = { use: mocks.use };
  mocks.getH3App.mockReturnValue(app);
  await createCollabPlugin({
    table: "design_files",
    contentColumn: "content",
    idColumn: "id",
    access: { mode: "all-authenticated" },
    ...options,
  })({});
  return mocks.use.mock.calls.at(-1)?.[1] as (
    event: unknown,
  ) => Promise<unknown>;
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.use.mockReset();
  mocks.getH3App.mockReset();
  mocks.execute.mockReset().mockResolvedValue({
    rows: [{ content: "legacy design" }],
    rowsAffected: 0,
  });
  mocks.transaction = null;
  mocks.hasCollabState.mockReset().mockResolvedValue(false);
  mocks.seedFromText.mockReset().mockResolvedValue(undefined);
  mocks.seedFromJson.mockReset().mockResolvedValue(undefined);
  mocks.getSession.mockResolvedValue({ email: "owner@example.com" });
  mocks.getOrgContext.mockResolvedValue(null);
  mocks.resolveAccess.mockReset();
  mocks.assertAccess.mockReset();
  mocks.runWithRequestContext.mockImplementation(
    async (_context: unknown, callback: () => unknown) => callback(),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("collab lazy source seeding", () => {
  it("does not scan source rows during plugin startup", async () => {
    await mountCollabHandler();
    await vi.advanceTimersByTimeAsync(1000);

    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.seedFromText).not.toHaveBeenCalled();
  });

  it("coalesces twelve simultaneous first requests into one indexed source read", async () => {
    let releaseSeed!: () => void;
    const seedReady = new Promise<void>((resolve) => {
      releaseSeed = resolve;
    });
    mocks.seedFromText.mockImplementation(async () => seedReady);
    const handler = await mountCollabHandler();

    const requests = Array.from({ length: 12 }, () => handler(makeEvent()));
    await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());

    expect(mocks.execute).toHaveBeenCalledWith({
      sql: "SELECT content FROM design_files WHERE id = ?",
      args: ["design-file-1"],
    });
    expect(mocks.seedFromText).toHaveBeenCalledOnce();

    releaseSeed();
    await Promise.all(requests);
    expect(mocks.getCollabState).toHaveBeenCalledTimes(12);
  });

  it("does not open a seed transaction for an already-seeded document", async () => {
    mocks.hasCollabState.mockResolvedValue(true);
    mocks.transaction = vi.fn(async () => {
      throw new Error("seed lock should not be requested");
    });
    const handler = await mountCollabHandler();

    await expect(handler(makeEvent())).resolves.toEqual({ state: "" });

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.seedFromText).not.toHaveBeenCalled();
  });

  it("supports a legacy forward-only mapping with a request-lazy scan", async () => {
    mocks.execute.mockResolvedValue({
      rows: [{ id: "design-file-1", content: "legacy design" }],
      rowsAffected: 0,
    });
    const handler = await mountCollabHandler({
      resolveCollabDocumentId: (sourceId) => `dash-${sourceId}`,
    });

    await handler(makeEvent("dash-design-file-1"));

    expect(mocks.execute).toHaveBeenCalledWith({
      sql: "SELECT id, content FROM design_files",
    });
    expect(mocks.seedFromText).toHaveBeenCalledWith(
      "dash-design-file-1",
      "legacy design",
    );
  });

  it("normalizes numeric source IDs in a legacy forward-only mapping", async () => {
    mocks.execute.mockResolvedValue({
      rows: [{ id: 0, content: "legacy design" }],
      rowsAffected: 0,
    });
    const handler = await mountCollabHandler({
      resolveCollabDocumentId: (sourceId) => `dash-${sourceId}`,
    });

    await handler(makeEvent("dash-0"));

    expect(mocks.seedFromText).toHaveBeenCalledWith("dash-0", "legacy design");
  });

  it("coalesces first seeds across independent plugin instances", async () => {
    let seeded = false;
    let releaseSeed!: () => void;
    const seedReady = new Promise<void>((resolve) => {
      releaseSeed = resolve;
    });
    let transactionTail = Promise.resolve();

    mocks.hasCollabState.mockImplementation(async () => seeded);
    mocks.seedFromText.mockImplementation(async () => {
      await seedReady;
      seeded = true;
    });
    mocks.execute.mockImplementation(async (query) => {
      if (
        typeof query === "object" &&
        query?.sql ===
          "SELECT pg_try_advisory_xact_lock(hashtextextended(?, 0)) AS acquired"
      ) {
        return { rows: [{ acquired: true }], rowsAffected: 0 };
      }
      return { rows: [{ content: "legacy design" }], rowsAffected: 0 };
    });
    mocks.transaction = vi.fn(async (run) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await run({ execute: mocks.execute });
      } finally {
        release();
      }
    });

    const handlers: Array<(event: unknown) => Promise<unknown>> = [];
    for (let index = 0; index < 12; index += 1) {
      handlers.push(await mountCollabHandler());
    }
    const requests = handlers.map((handler) => handler(makeEvent()));
    await vi.waitFor(() => expect(mocks.transaction).toHaveBeenCalledTimes(12));
    await vi.waitFor(() => expect(mocks.seedFromText).toHaveBeenCalledOnce());

    expect(
      mocks.execute.mock.calls.filter(
        ([query]) =>
          typeof query === "object" &&
          query?.sql === "SELECT content FROM design_files WHERE id = ?",
      ),
    ).toHaveLength(1);
    releaseSeed();
    await Promise.all(requests);
    expect(
      mocks.execute.mock.calls.filter(
        ([query]) =>
          typeof query === "object" &&
          query?.sql ===
            "SELECT pg_try_advisory_xact_lock(hashtextextended(?, 0)) AS acquired",
      ),
    ).toHaveLength(12);
    expect(mocks.getCollabState).toHaveBeenCalledTimes(12);
  });

  it("backs off when another instance owns the seed lock", async () => {
    let lockAttempts = 0;
    mocks.execute.mockImplementation(async (query) => {
      if (
        typeof query === "object" &&
        query?.sql ===
          "SELECT pg_try_advisory_xact_lock(hashtextextended(?, 0)) AS acquired"
      ) {
        lockAttempts += 1;
        return {
          rows: [{ acquired: lockAttempts > 1 ? "t" : "f" }],
          rowsAffected: 0,
        };
      }
      return { rows: [{ content: "legacy design" }], rowsAffected: 0 };
    });
    mocks.transaction = vi.fn(async (run) => run({ execute: mocks.execute }));

    const handler = await mountCollabHandler();
    const request = handler(makeEvent());
    await vi.waitFor(() => expect(lockAttempts).toBe(1));
    expect(
      mocks.execute.mock.calls.filter(
        ([query]) =>
          typeof query === "object" &&
          query?.sql === "SELECT content FROM design_files WHERE id = ?",
      ),
    ).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(25);
    await request;

    expect(lockAttempts).toBe(2);
    expect(
      mocks.execute.mock.calls.filter(
        ([query]) =>
          typeof query === "object" &&
          query?.sql === "SELECT content FROM design_files WHERE id = ?",
      ),
    ).toHaveLength(1);
    expect(mocks.seedFromText).toHaveBeenCalledOnce();
  });

  it("authorizes a resource before reading its source content", async () => {
    mocks.resolveAccess.mockResolvedValue(null);
    const handler = await mountCollabHandler({
      access: {
        mode: "resource",
        resourceType: "design",
        resolveResourceId: () => "design-1",
      },
    });

    await expect(handler(makeEvent())).resolves.toEqual({ error: "Not found" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("maps a JSON collab id back to its source row", async () => {
    mocks.execute.mockResolvedValue({
      rows: [{ config: '{"title":"Legacy dashboard"}' }],
      rowsAffected: 0,
    });
    const handler = await mountCollabHandler({
      table: "dashboards",
      contentColumn: "config",
      contentType: "json",
      resolveSourceIdFromCollabDocumentId: (docId: string) =>
        docId.startsWith("dash-") ? docId.slice("dash-".length) : docId,
    });

    await handler(makeEvent("dash-dashboard-1"));

    expect(mocks.execute).toHaveBeenCalledWith({
      sql: "SELECT config FROM dashboards WHERE id = ?",
      args: ["dashboard-1"],
    });
    expect(mocks.seedFromJson).toHaveBeenCalledWith(
      "dash-dashboard-1",
      { title: "Legacy dashboard" },
      "data",
      "map",
    );
  });

  it("fails loudly when a JSON source row is unreadable", async () => {
    mocks.execute.mockResolvedValue({
      rows: [{ config: "" }],
      rowsAffected: 0,
    });
    const handler = await mountCollabHandler({
      table: "dashboards",
      contentColumn: "config",
      contentType: "json",
    });

    await expect(handler(makeEvent("dashboard-1"))).rejects.toThrow(
      /contains invalid JSON/,
    );
    expect(mocks.seedFromJson).not.toHaveBeenCalled();
  });
});
