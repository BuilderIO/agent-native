import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadDevActionDiscoveryFile = vi.hoisted(() => vi.fn());
const mockIsProcessAlive = vi.hoisted(() => vi.fn());
const mockGetRuntimeDatabaseUrl = vi.hoisted(() =>
  vi.fn(() => "pglite:./data/pglite"),
);
const mockHashDatabaseKey = vi.hoisted(() =>
  vi.fn((url: string) => `hash:${url}`),
);

vi.mock("../../db/client.js", () => ({
  getRuntimeDatabaseUrl: (...args: unknown[]) =>
    mockGetRuntimeDatabaseUrl(...args),
  isPgliteUrl: (url: string) => url.toLowerCase().startsWith("pglite:"),
  isProcessAlive: (...args: unknown[]) => mockIsProcessAlive(...args),
}));
vi.mock("../../server/dev-action-bridge.js", () => ({
  DEV_ACTION_ORG_HEADER: "x-agent-native-dev-org",
  DEV_ACTION_TOKEN_HEADER: "x-agent-native-dev-token",
  DEV_ACTION_USER_HEADER: "x-agent-native-dev-user",
  DEV_DB_QUERY_ROUTE: "/_agent-native/dev/db-query",
  hashDatabaseKey: (...args: unknown[]) => mockHashDatabaseKey(...args),
  isLoopbackDevActionOrigin: (origin: string) => {
    try {
      const url = new URL(origin);
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        (url.hostname === "127.0.0.1" ||
          url.hostname === "localhost" ||
          url.hostname === "[::1]") &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  },
  readDevActionDiscoveryFile: (...args: unknown[]) =>
    mockReadDevActionDiscoveryFile(...args),
}));

import { tryForwardDbQueryToDevServer } from "./dev-query-proxy.js";

const MATCHING_DATABASE_KEY = "hash:pglite:./data/pglite";

function liveDiscovery(overrides: Record<string, unknown> = {}) {
  return {
    origin: "http://127.0.0.1:5173",
    pid: process.pid,
    token: "dev-token",
    databaseKey: MATCHING_DATABASE_KEY,
    ...overrides,
  };
}

describe("tryForwardDbQueryToDevServer", () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;
  const print = vi.fn();

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    mockReadDevActionDiscoveryFile.mockReset();
    mockIsProcessAlive.mockReset();
    mockGetRuntimeDatabaseUrl
      .mockReset()
      .mockReturnValue("pglite:./data/pglite");
    mockHashDatabaseKey
      .mockReset()
      .mockImplementation((url: string) => `hash:${url}`);
    print.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("runs in-process when there is no discovery file", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(undefined);
    const forwarded = await tryForwardDbQueryToDevServer({
      sql: "SELECT 1",
      params: [],
      print,
    });
    expect(forwarded).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs in-process when the discovery pid is no longer alive", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery());
    mockIsProcessAlive.mockReturnValue(false);
    const forwarded = await tryForwardDbQueryToDevServer({
      sql: "SELECT 1",
      params: [],
      print,
    });
    expect(forwarded).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs in-process when the discovery origin is not the loopback dev server", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(
      liveDiscovery({ origin: "http://evil.example" }),
    );
    mockIsProcessAlive.mockReturnValue(true);
    const forwarded = await tryForwardDbQueryToDevServer({
      sql: "SELECT 1",
      params: [],
      print,
    });
    expect(forwarded).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs in-process when the discovery databaseKey doesn't match", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(
      liveDiscovery({ databaseKey: "hash:some-other-db" }),
    );
    mockIsProcessAlive.mockReturnValue(true);
    const forwarded = await tryForwardDbQueryToDevServer({
      sql: "SELECT 1",
      params: [],
      print,
    });
    expect(forwarded).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips forwarding when the resolved database is hosted PostgreSQL", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery());
    mockIsProcessAlive.mockReturnValue(true);
    mockGetRuntimeDatabaseUrl.mockReturnValue("postgres://localhost/db");
    const forwarded = await tryForwardDbQueryToDevServer({
      sql: "SELECT 1",
      params: [],
      print,
    });
    expect(forwarded).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["https://localhost:5173", "http://[::1]:5174"])(
    "forwards to the printed loopback origin %s, with a TLS dispatcher only for https",
    async (origin) => {
      mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery({ origin }));
      mockIsProcessAlive.mockReturnValue(true);
      fetchMock.mockResolvedValue({
        status: 200,
        json: async () => ({ ok: true, rows: [{ id: 1 }], sql: "SELECT 1" }),
      });

      const forwarded = await tryForwardDbQueryToDevServer({
        sql: "SELECT 1",
        params: [],
        print,
      });

      expect(forwarded).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        `${origin}/_agent-native/dev/db-query`,
        expect.objectContaining({
          method: "POST",
          ...(origin.startsWith("https:")
            ? { dispatcher: expect.anything() }
            : {}),
        }),
      );
    },
  );

  it("forwards the caller's resolved user/org identity as headers", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery());
    mockIsProcessAlive.mockReturnValue(true);
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({ ok: true, rows: [], sql: "SELECT 1" }),
    });

    await tryForwardDbQueryToDevServer({
      sql: "SELECT 1",
      params: [],
      userEmail: "owner@example.test",
      orgId: "org_1",
      print,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:5173/_agent-native/dev/db-query",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-agent-native-dev-user": "owner@example.test",
          "x-agent-native-dev-org": "org_1",
        }),
      }),
    );
  });

  it("forwards matching PGlite queries to the dev server", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery());
    mockIsProcessAlive.mockReturnValue(true);
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({
        ok: true,
        rows: [{ id: 1 }],
        sql: "SELECT id FROM items LIMIT 100",
      }),
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const forwarded = await tryForwardDbQueryToDevServer({
      sql: "SELECT id FROM items",
      params: [],
      limit: 100,
      format: "json",
      print,
    });

    expect(forwarded).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:5173/_agent-native/dev/db-query",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-agent-native-dev-token": "dev-token",
        }),
        body: JSON.stringify({
          sql: "SELECT id FROM items",
          limit: 100,
        }),
      }),
    );
    expect(print).toHaveBeenCalledWith(
      [{ id: 1 }],
      "SELECT id FROM items LIMIT 100",
      "json",
    );
    expect(logSpy).toHaveBeenCalledWith(
      "[dev-db] proxied query through http://127.0.0.1:5173",
    );
    logSpy.mockRestore();
  });

  it("runs in-process when the dev server isn't actually listening", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery());
    mockIsProcessAlive.mockReturnValue(true);
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const forwarded = await tryForwardDbQueryToDevServer({
      sql: "SELECT 1",
      params: [],
      print,
    });
    expect(forwarded).toBe(false);
  });

  it("runs in-process when the server doesn't have the route mounted (404)", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery());
    mockIsProcessAlive.mockReturnValue(true);
    fetchMock.mockResolvedValue({ status: 404, json: async () => ({}) });
    const forwarded = await tryForwardDbQueryToDevServer({
      sql: "SELECT 1",
      params: [],
      print,
    });
    expect(forwarded).toBe(false);
  });

  it("throws without falling back when the dev server rejects the token", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery());
    mockIsProcessAlive.mockReturnValue(true);
    fetchMock.mockResolvedValue({
      status: 401,
      json: async () => ({ error: "Invalid or missing dev token." }),
    });

    await expect(
      tryForwardDbQueryToDevServer({
        sql: "SELECT 1",
        params: [],
        print,
      }),
    ).rejects.toThrow("Invalid or missing dev token.");
  });

  it("throws when the forwarded query fails validation on the server", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery());
    mockIsProcessAlive.mockReturnValue(true);
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({ ok: false, error: "Table not allowed" }),
    });

    await expect(
      tryForwardDbQueryToDevServer({
        sql: "SELECT * FROM secrets",
        params: [],
        print,
      }),
    ).rejects.toThrow("Table not allowed");
  });
});
