import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadDevActionDiscoveryFile = vi.hoisted(() => vi.fn());
const mockIsProcessAlive = vi.hoisted(() => vi.fn());
const mockGetRuntimeDatabaseUrl = vi.hoisted(() =>
  vi.fn(() => "pglite:./data/pglite"),
);

vi.mock("../../db/client.js", () => ({
  getRuntimeDatabaseUrl: (...args: unknown[]) =>
    mockGetRuntimeDatabaseUrl(...args),
  isPgliteUrl: (url: string) => url.toLowerCase().startsWith("pglite:"),
  isProcessAlive: (...args: unknown[]) => mockIsProcessAlive(...args),
}));
vi.mock("../../server/dev-action-bridge.js", () => ({
  DEV_ACTION_TOKEN_HEADER: "x-agent-native-dev-token",
  DEV_DB_MIGRATE_ROUTE: "/_agent-native/dev/db-migrate",
  hashDatabaseKey: (url: string) => `hash:${url}`,
  isLoopbackDevActionOrigin: (origin: string) =>
    /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/.test(origin),
  readDevActionDiscoveryFile: (...args: unknown[]) =>
    mockReadDevActionDiscoveryFile(...args),
}));

import { tryForwardDbMigrateToDevServer } from "./dev-migrate-proxy.js";

function liveDiscovery(overrides: Record<string, unknown> = {}) {
  return {
    origin: "http://127.0.0.1:5173",
    pid: process.pid,
    token: "dev-token",
    databaseKey: "hash:pglite:./data/pglite",
    ...overrides,
  };
}

describe("tryForwardDbMigrateToDevServer", () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;
  const options = { migrationsFolder: "./drizzle/migrations" };

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    mockReadDevActionDiscoveryFile.mockReset();
    mockIsProcessAlive.mockReset().mockReturnValue(true);
    mockGetRuntimeDatabaseUrl
      .mockReset()
      .mockReturnValue("pglite:./data/pglite");
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("does not forward when there is no discovery file", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(undefined);
    await expect(tryForwardDbMigrateToDevServer(options)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not forward when the discovery pid is dead", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery());
    mockIsProcessAlive.mockReturnValue(false);
    await expect(tryForwardDbMigrateToDevServer(options)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not forward to a non-loopback origin", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(
      liveDiscovery({ origin: "http://evil.example" }),
    );
    await expect(tryForwardDbMigrateToDevServer(options)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not forward when the databaseKey doesn't match", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(
      liveDiscovery({ databaseKey: "hash:other" }),
    );
    await expect(tryForwardDbMigrateToDevServer(options)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not forward for a hosted PostgreSQL database", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery());
    mockGetRuntimeDatabaseUrl.mockReturnValue("postgres://localhost/db");
    await expect(tryForwardDbMigrateToDevServer(options)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["https://localhost:5173", "http://[::1]:5174"])(
    "posts to the loopback origin %s, with a TLS dispatcher only for https",
    async (origin) => {
      mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery({ origin }));
      fetchMock.mockResolvedValue({
        status: 200,
        json: async () => ({ ok: true }),
      });
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await expect(tryForwardDbMigrateToDevServer(options)).resolves.toBe(true);

      expect(fetchMock).toHaveBeenCalledWith(
        `${origin}/_agent-native/dev/db-migrate`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "x-agent-native-dev-token": "dev-token",
          }),
          body: JSON.stringify(options),
          ...(origin.startsWith("https:")
            ? { dispatcher: expect.anything() }
            : {}),
        }),
      );
      expect(logSpy).toHaveBeenCalledWith(
        `[dev-db] applied migrations through ${origin}`,
      );
    },
  );

  it("does not forward when the dev server isn't listening", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery());
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    await expect(tryForwardDbMigrateToDevServer(options)).resolves.toBe(false);
  });

  it("does not forward when the route isn't mounted (404)", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery());
    fetchMock.mockResolvedValue({ status: 404, json: async () => ({}) });
    await expect(tryForwardDbMigrateToDevServer(options)).resolves.toBe(false);
  });

  it("throws the server's error when migrations fail", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery());
    fetchMock.mockResolvedValue({
      status: 500,
      json: async () => ({ ok: false, error: "relation already exists" }),
    });
    await expect(tryForwardDbMigrateToDevServer(options)).rejects.toThrow(
      "relation already exists",
    );
  });

  it("throws when the dev server rejects the token", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery());
    fetchMock.mockResolvedValue({
      status: 401,
      json: async () => ({ ok: false, error: "Invalid or missing dev token." }),
    });
    await expect(tryForwardDbMigrateToDevServer(options)).rejects.toThrow(
      "Invalid or missing dev token.",
    );
  });
});
