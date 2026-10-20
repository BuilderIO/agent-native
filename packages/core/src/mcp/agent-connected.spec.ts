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

let database: Awaited<ReturnType<typeof createTestPglite>>;
let storageUnavailable = false;
const trackMock = vi.hoisted(() => vi.fn());
const providersMock = vi.hoisted(() => vi.fn(() => ["first-party"]));
vi.mock("../tracking/registry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tracking/registry.js")>()),
  track: trackMock,
  listTrackingProviders: providersMock,
}));
vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => ({
    execute: async (input: string | { sql: string; args?: unknown[] }) => {
      if (storageUnavailable) throw new Error("storage unavailable");
      const sql = typeof input === "string" ? input : input.sql;
      const result = await database.query(
        sql,
        typeof input === "string" ? [] : input.args,
      );
      return { rows: result.rows, rowsAffected: result.affectedRows };
    },
  }),
}));

const { trackAgentConnected, connectionApp, deviceFlowClients } =
  await import("./agent-connected.js");
const { defineAppConfig, resetAppConfigForTests } =
  await import("../app-config/index.js");

beforeAll(async () => {
  database = await createTestPglite();
  await database.exec(
    "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at BIGINT NOT NULL)",
  );
});
afterAll(async () => database.close());
beforeEach(async () => {
  await database.exec("DELETE FROM settings");
  storageUnavailable = false;
  trackMock.mockClear();
  providersMock.mockReturnValue(["first-party"]);
  resetAppConfigForTests();
});

describe("agent connection attribution", () => {
  const connection = {
    email: "Person@Example.com",
    origin: "https://plan.agent-native.com",
    client: "Claude",
    method: "mcp" as const,
  };

  it("claims one event across concurrent MCP and OAuth connects and later reconnects", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        trackAgentConnected({
          ...connection,
          method: index % 2 ? "oauth" : "mcp",
        }),
      ),
    );
    expect(results.filter((result) => result === "emitted")).toHaveLength(1);
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith(
      "agent_connected",
      {
        email: "person@example.com",
        app: "plan",
        client: "claude",
        connection_method: expect.any(String),
      },
      { userId: "person@example.com" },
    );
    vi.resetModules();
    const restarted = await import("./agent-connected.js");
    expect(
      await restarted.trackAgentConnected({
        ...connection,
        email: "person@example.com",
        client: "Anthropic Claude",
        method: "oauth",
      }),
    ).toBe("duplicate");
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(
      (await database.query("SELECT key, value FROM settings")).rows,
    ).toHaveLength(1);
  });

  it("counts different people, apps and clients independently and preserves multi-client choices", async () => {
    await trackAgentConnected(connection);
    await trackAgentConnected({ ...connection, email: "second@example.com" });
    await trackAgentConnected({
      ...connection,
      origin: "https://clips.agent-native.com",
    });
    await trackAgentConnected({
      ...connection,
      client: ["claude", "cursor", "cursor"],
    });
    expect(trackMock).toHaveBeenCalledTimes(4);
    expect(trackMock.mock.calls.map((call) => call[1].client)).toEqual([
      "claude",
      "claude",
      "claude",
      "cursor",
    ]);
  });

  it.each(["Example, Inc.", "example,inc", "codex,cursor"])(
    "keeps a comma in an OAuth client's name %s as one client",
    async (name) => {
      await trackAgentConnected({
        ...connection,
        client: name,
        method: "oauth",
      });
      expect(trackMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["codex,opencode", ["codex", "opencode"]],
    ["claude-code,github-copilot", ["claude-code", "github-copilot"]],
    ["codex", ["codex"]],
    ["example,inc", "example,inc"],
    ["Example, Inc.", "Example, Inc."],
    ["codex, cursor", "codex, cursor"],
    ["codex,", "codex,"],
    ["all", "all"],
    ["", ""],
    [null, null],
  ])("splits device client %j only into CLI client ids", (client, expected) => {
    expect(deviceFlowClients(client)).toEqual(expected);
  });

  it.each([
    ["claude", "Claude Desktop", "claude"],
    ["cowork", "Claude Cowork", "cowork"],
    ["chatgpt", "OpenAI", "chatgpt"],
    ["codex", "OpenAI Codex", "codex"],
    ["claude-code-cli", "Claude Code", "claude-code"],
  ])(
    "deduplicates client id %s against OAuth name %s",
    async (id, name, canonical) => {
      await trackAgentConnected({ ...connection, client: id });
      expect(
        await trackAgentConnected({
          ...connection,
          client: name,
          method: "oauth",
        }),
      ).toBe("duplicate");
      expect(trackMock).toHaveBeenCalledTimes(1);
      expect(trackMock.mock.calls[0][1].client).toBe(canonical);
    },
  );

  it("leaves synthetic and configured test identities unclaimed", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    expect(
      await runWithRequestContext(
        { userEmail: connection.email, isSyntheticTraffic: true },
        () => trackAgentConnected(connection),
      ),
    ).toBe("disabled");
    defineAppConfig({ testIdentity: { emails: [connection.email] } });
    expect(await trackAgentConnected(connection)).toBe("disabled");
    expect(trackMock).not.toHaveBeenCalled();
    expect(
      (await database.query("SELECT key FROM settings")).rows,
    ).toHaveLength(0);
  });

  it("does not consume the real owner's claim when the ambient identity suppresses tracking", async () => {
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    expect(
      await runWithRequestContext({ userEmail: "poller@example.test" }, () =>
        trackAgentConnected(connection),
      ),
    ).toBe("disabled");
    expect(trackMock).not.toHaveBeenCalled();
    expect(await trackAgentConnected(connection)).toBe("emitted");
  });

  it("does not claim while tracking is disabled and reports unreadable storage distinctly", async () => {
    providersMock.mockReturnValue([]);
    expect(await trackAgentConnected(connection)).toBe("disabled");
    providersMock.mockReturnValue(["first-party"]);
    storageUnavailable = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await trackAgentConnected(connection)).toBe("failed");
    expect(error).toHaveBeenCalled();
    storageUnavailable = false;
    expect(await trackAgentConnected(connection)).toBe("emitted");
    error.mockRestore();
  });

  it("prefers explicit and configured app identity over beta hostnames", () => {
    defineAppConfig({ app: { id: "agent-native-clips" } });
    expect(connectionApp("https://beta.clips.agent-native.com")).toBe("clips");
    expect(connectionApp("https://beta.clips.agent-native.com", "plan")).toBe(
      "plan",
    );
  });

  it("names a beta lane after its app, like the connect identity", () => {
    resetAppConfigForTests();
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "beta");
    expect(connectionApp("https://beta.clips.agent-native.com")).toBe("clips");
    vi.unstubAllEnvs();
    expect(connectionApp("https://clips.agent-native.com")).toBe("clips");
  });

  it("reports a failing tracking registry as failed instead of throwing", async () => {
    providersMock.mockImplementation(() => {
      throw new Error("registry unavailable");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await trackAgentConnected(connection)).toBe("failed");
    expect(trackMock).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("reports an unresolvable app as failed instead of throwing", async () => {
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "staging");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await trackAgentConnected(connection)).toBe("failed");
    expect(trackMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    error.mockRestore();
  });
});
