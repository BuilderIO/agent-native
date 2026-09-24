import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

vi.mock("../db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/client.js")>();
  return {
    ...actual,
    getDbExec: () => sharedClient,
    isProductionServerlessFunctionRuntime: () => false,
    retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
  };
});

interface FrameworkClient {
  execute(arg: string | { sql: string; args?: any[] }): Promise<{
    rows: any[];
    rowsAffected: number;
  }>;
}

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let sharedClient: FrameworkClient = {
  async execute() {
    return { rows: [], rowsAffected: 0 };
  },
};

beforeAll(async () => {
  pglite = await createTestPglite();
  sharedClient = {
    async execute(arg) {
      const sql = typeof arg === "string" ? arg : arg.sql;
      const args = typeof arg === "string" ? [] : (arg.args ?? []);
      const stmt = await pglite.prepare(sql);
      if (/^\s*select/i.test(sql)) {
        const rows = (await stmt.all(...args)) as any[];
        return { rows, rowsAffected: 0 };
      }
      const result = await stmt.run(...args);
      return { rows: [], rowsAffected: Number(result.changes ?? 0) };
    },
  };
});

beforeEach(async () => {
  for (const table of [
    "agent_native_browser_session_requests",
    "agent_native_browser_sessions",
  ]) {
    try {
      await pglite.prepare(`DELETE FROM ${table}`).run();
    } catch {
      // First test creates the tables through the store initializer.
    }
  }
});

afterAll(async () => {
  await pglite.close();
});

describe("browser session store", () => {
  it("registers sessions and scopes them to the owner", async () => {
    const { listBrowserSessions, registerBrowserSession } =
      await import("./store.js");

    await registerBrowserSession("alice@example.com", {
      session: { id: "tab-1", label: "Customer tab" },
      context: {
        route: { name: "customer-detail" },
        resource: { type: "customer", id: "acme" },
      },
      actions: [
        {
          name: "select-row",
          description: "Select a visible row",
          schema: { type: "object" },
        },
      ],
    });

    const aliceSessions = await listBrowserSessions("alice@example.com");
    expect(aliceSessions).toHaveLength(1);
    expect(aliceSessions[0]).toMatchObject({
      sessionId: "tab-1",
      label: "Customer tab",
      active: true,
      context: { route: { name: "customer-detail" } },
    });
    expect(aliceSessions[0].actions[0]).toMatchObject({
      name: "select-row",
    });

    await expect(listBrowserSessions("bob@example.com")).resolves.toEqual([]);
  });

  it("claims and completes pending requests once", async () => {
    const {
      claimBrowserSessionRequest,
      completeBrowserSessionRequest,
      createBrowserSessionRequest,
      getBrowserSessionRequest,
      registerBrowserSession,
    } = await import("./store.js");

    await registerBrowserSession("alice@example.com", {
      session: { id: "tab-1" },
    });
    const request = await createBrowserSessionRequest(
      "alice@example.com",
      "tab-1",
      {
        type: "run-action",
        name: "select-row",
        args: { rowId: "row-1" },
      },
    );

    const claimed = await claimBrowserSessionRequest(
      "alice@example.com",
      "tab-1",
    );
    expect(claimed).toMatchObject({
      id: request.id,
      status: "claimed",
      type: "run-action",
      name: "select-row",
      args: { rowId: "row-1" },
    });
    await expect(
      claimBrowserSessionRequest("alice@example.com", "tab-1"),
    ).resolves.toBeNull();

    const completed = await completeBrowserSessionRequest(
      "alice@example.com",
      "tab-1",
      request.id,
      { ok: true, result: { selected: "row-1" } },
    );
    expect(completed).toMatchObject({
      status: "completed",
      result: { selected: "row-1" },
    });

    await expect(
      getBrowserSessionRequest("alice@example.com", request.id),
    ).resolves.toMatchObject({ status: "completed" });
  });

  it("keeps WebMCP descriptors separate from client actions", async () => {
    const {
      claimBrowserSessionRequest,
      createBrowserSessionRequest,
      registerBrowserSession,
    } = await import("./store.js");

    await registerBrowserSession("alice@example.com", {
      session: { id: "tab-webmcp" },
      actions: [{ name: "select-row", description: "Select a row" }],
      webmcpTools: [
        {
          name: "get-order",
          description: "Read an order",
          origin: "https://shop.example",
          annotations: { readOnlyHint: true },
        },
      ],
    });

    const { getBrowserSession } = await import("./store.js");
    await expect(
      getBrowserSession("alice@example.com", "tab-webmcp"),
    ).resolves.toMatchObject({
      actions: [expect.objectContaining({ name: "select-row" })],
      webmcpTools: [
        expect.objectContaining({
          name: "get-order",
          origin: "https://shop.example",
        }),
      ],
    });

    const request = await createBrowserSessionRequest(
      "alice@example.com",
      "tab-webmcp",
      {
        type: "run-webmcp-tool",
        name: "get-order",
        origin: "https://shop.example",
        args: { id: "order-1" },
      },
    );
    await expect(
      claimBrowserSessionRequest("alice@example.com", "tab-webmcp"),
    ).resolves.toMatchObject({
      id: request.id,
      type: "run-webmcp-tool",
      name: "get-order",
      origin: "https://shop.example",
      args: { id: "order-1" },
    });

    await expect(
      registerBrowserSession("alice@example.com", {
        session: { id: "tab-too-many-webmcp" },
        webmcpTools: Array.from({ length: 101 }, (_, index) => ({
          name: `tool-${index}`,
          description: "A tool",
        })),
      }),
    ).rejects.toThrow("100-tool limit");
  });

  it("preserves empty WebMCP arguments when an origin is present", async () => {
    const {
      claimBrowserSessionRequest,
      createBrowserSessionRequest,
      registerBrowserSession,
    } = await import("./store.js");

    await registerBrowserSession("alice@example.com", {
      session: { id: "tab-empty-webmcp" },
    });
    await createBrowserSessionRequest("alice@example.com", "tab-empty-webmcp", {
      type: "run-webmcp-tool",
      name: "get-order",
      origin: "https://shop.example",
    });

    await expect(
      claimBrowserSessionRequest("alice@example.com", "tab-empty-webmcp"),
    ).resolves.toMatchObject({
      type: "run-webmcp-tool",
      name: "get-order",
      origin: "https://shop.example",
      args: {},
    });
  });

  it("waits for a live browser result", async () => {
    const {
      callBrowserSession,
      claimBrowserSessionRequest,
      completeBrowserSessionRequest,
      registerBrowserSession,
    } = await import("./store.js");

    await registerBrowserSession("alice@example.com", {
      session: { id: "tab-1" },
    });

    const resultPromise = callBrowserSession(
      "alice@example.com",
      "tab-1",
      { type: "command", command: "refreshData", payload: { scope: "rows" } },
      { timeoutMs: 1000, pollMs: 10 },
    );

    const claimed = await vi.waitFor(async () => {
      const request = await claimBrowserSessionRequest(
        "alice@example.com",
        "tab-1",
      );
      expect(request).toBeTruthy();
      return request;
    });

    expect(claimed).toMatchObject({
      type: "command",
      command: "refreshData",
      payload: { scope: "rows" },
    });

    await completeBrowserSessionRequest(
      "alice@example.com",
      "tab-1",
      claimed!.id,
      { ok: true, result: { refreshed: true } },
    );

    await expect(resultPromise).resolves.toEqual({ refreshed: true });
  });
});
