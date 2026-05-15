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
  try {
    sqlite.prepare("DELETE FROM workspace_connections").run();
  } catch {
    // The first test creates the table through the store initializer.
  }
});

afterAll(() => {
  sqlite.close();
});

describe("workspace connection store", () => {
  it("scopes personal list, upsert, and delete to the request user", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const {
      deleteWorkspaceConnection,
      listWorkspaceConnections,
      upsertWorkspaceConnection,
    } = await import("./store.js");

    await runWithRequestContext({ userEmail: "alice@example.com" }, () =>
      upsertWorkspaceConnection({
        id: "conn-personal",
        provider: "google",
        label: "Alice Google",
      }),
    );

    const aliceList = await runWithRequestContext(
      { userEmail: "alice@example.com" },
      () => listWorkspaceConnections(),
    );
    expect(aliceList).toHaveLength(1);
    expect(aliceList[0]).toMatchObject({
      id: "conn-personal",
      ownerEmail: "alice@example.com",
      orgId: null,
    });

    await expect(
      runWithRequestContext({ userEmail: "bob@example.com" }, () =>
        upsertWorkspaceConnection({
          id: "conn-personal",
          provider: "google",
          label: "Bob Google",
        }),
      ),
    ).rejects.toThrow(/outside the current request scope/i);

    const bobList = await runWithRequestContext(
      { userEmail: "bob@example.com" },
      () => listWorkspaceConnections(),
    );
    expect(bobList).toEqual([]);

    const bobDeleted = await runWithRequestContext(
      { userEmail: "bob@example.com" },
      () => deleteWorkspaceConnection("conn-personal"),
    );
    expect(bobDeleted).toBe(false);
  });

  it("uses active org scope when present", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const {
      getWorkspaceConnection,
      listWorkspaceConnections,
      upsertWorkspaceConnection,
    } = await import("./store.js");

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      () =>
        upsertWorkspaceConnection({
          id: "conn-org",
          provider: "slack",
          label: "Team Slack",
          allowedApps: ["dispatch"],
        }),
    );

    const bobList = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () => listWorkspaceConnections({ appId: "dispatch" }),
    );
    expect(bobList).toHaveLength(1);
    expect(bobList[0]).toMatchObject({
      id: "conn-org",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
    });

    const updated = await runWithRequestContext(
      { userEmail: "bob@example.com", orgId: "org-1" },
      () =>
        upsertWorkspaceConnection({
          id: "conn-org",
          provider: "slack",
          label: "Updated Team Slack",
        }),
    );
    expect(updated.label).toBe("Updated Team Slack");

    const otherOrg = await runWithRequestContext(
      { userEmail: "carol@example.com", orgId: "org-2" },
      () => getWorkspaceConnection("conn-org"),
    );
    expect(otherOrg).toBeNull();
  });

  it("redacts secret-shaped fields during serialization", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { serializeWorkspaceConnection, upsertWorkspaceConnection } =
      await import("./store.js");

    const saved = await runWithRequestContext(
      { userEmail: "alice@example.com" },
      () =>
        upsertWorkspaceConnection({
          id: "conn-safe",
          provider: "openai",
          label: "OpenAI",
          config: {
            region: "us",
            apiKey: "sk-should-not-leak",
            nested: { accessToken: "token-should-not-leak" },
          },
          credentialRefs: [
            {
              key: "OPENAI_API_KEY",
              scope: "user",
              value: "raw-secret-should-not-leak",
            },
          ],
        }),
    );

    expect(JSON.stringify(saved)).not.toContain("sk-should-not-leak");
    expect(JSON.stringify(saved)).not.toContain("token-should-not-leak");
    expect(JSON.stringify(saved)).not.toContain("raw-secret-should-not-leak");
    expect(saved.config).toMatchObject({
      region: "us",
      apiKey: "[redacted]",
      nested: { accessToken: "[redacted]" },
    });
    expect(saved.credentialRefs[0]).toMatchObject({
      key: "OPENAI_API_KEY",
      scope: "user",
      value: "[redacted]",
    });

    const serialized = serializeWorkspaceConnection(saved);
    expect(JSON.stringify(serialized)).not.toContain("sk-should-not-leak");
    expect(JSON.stringify(serialized)).not.toContain("token-should-not-leak");
  });
});
