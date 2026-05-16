import Database from "better-sqlite3";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("../db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/client.js")>();
  return {
    ...actual,
    getDbExec: () => sharedClient,
    isPostgres: () => false,
    intType: () => "INTEGER",
    retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
  };
});

interface FrameworkClient {
  execute(arg: string | { sql: string; args?: any[] }): Promise<{
    rows: any[];
    rowsAffected: number;
  }>;
}

let sqlite: Database.Database;
let sharedClient: FrameworkClient = {
  async execute() {
    return { rows: [], rowsAffected: 0 };
  },
};

beforeAll(() => {
  sqlite = new Database(":memory:");
  sharedClient = {
    async execute(arg) {
      const sql = typeof arg === "string" ? arg : arg.sql;
      const args = typeof arg === "string" ? [] : (arg.args ?? []);
      const stmt = sqlite.prepare(sql);
      if (/^\s*select/i.test(sql)) {
        const rows = stmt.all(...args) as any[];
        return { rows, rowsAffected: 0 };
      }
      const result = stmt.run(...args);
      return { rows: [], rowsAffected: Number(result.changes ?? 0) };
    },
  };
});

beforeEach(() => {
  for (const table of [
    "agent_native_browser_session_requests",
    "agent_native_browser_sessions",
  ]) {
    try {
      sqlite.prepare(`DELETE FROM ${table}`).run();
    } catch {
      // First test creates the tables through the store initializer.
    }
  }
});

afterAll(() => {
  sqlite.close();
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
