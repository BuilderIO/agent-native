import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadDevActionDiscoveryFile = vi.hoisted(() => vi.fn());
const mockIsProcessAlive = vi.hoisted(() => vi.fn());
const mockGetDatabaseUrl = vi.hoisted(() =>
  vi.fn(() => "pglite:./data/pglite"),
);
const mockHashDatabaseKey = vi.hoisted(() =>
  vi.fn((url: string) => `hash:${url}`),
);
const mockIsValidDevActionHandoffUrl = vi.hoisted(() =>
  vi.fn(
    (value: unknown) =>
      typeof value === "string" &&
      value.startsWith("/_agent-native/embed/start?"),
  ),
);

vi.mock("../db/client.js", () => ({
  closeDbExec: vi.fn(async () => {}),
  getRuntimeDatabaseUrl: (...args: unknown[]) => mockGetDatabaseUrl(...args),
  isProcessAlive: (...args: unknown[]) => mockIsProcessAlive(...args),
}));
vi.mock("../server/dev-action-bridge.js", () => ({
  DEV_ACTION_ORG_HEADER: "x-agent-native-dev-org",
  DEV_ACTION_ROUTE: "/_agent-native/dev/action",
  DEV_ACTION_TOKEN_HEADER: "x-agent-native-dev-token",
  DEV_ACTION_USER_HEADER: "x-agent-native-dev-user",
  devActionHandoffUrl: (result: Record<string, unknown>) =>
    typeof result?.embedStartUrl === "string"
      ? result.embedStartUrl
      : typeof result?.startUrl === "string"
        ? result.startUrl
        : undefined,
  isValidDevActionHandoffUrl: (...args: unknown[]) =>
    mockIsValidDevActionHandoffUrl(...args),
  hashDatabaseKey: (...args: unknown[]) => mockHashDatabaseKey(...args),
  readDevActionDiscoveryFile: (...args: unknown[]) =>
    mockReadDevActionDiscoveryFile(...args),
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
}));

import { tryForwardToDevServer } from "./runner.js";

const MATCHING_DATABASE_KEY = "hash:pglite:./data/pglite";

function liveDiscovery(overrides: Record<string, unknown> = {}) {
  return {
    origin: "http://127.0.0.1:1",
    pid: process.pid,
    token: "t",
    databaseKey: MATCHING_DATABASE_KEY,
    ...overrides,
  };
}

function mockExit() {
  return vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code ?? 0})`);
  }) as any;
}

describe("tryForwardToDevServer", () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    mockReadDevActionDiscoveryFile.mockReset();
    mockIsProcessAlive.mockReset();
    mockGetDatabaseUrl.mockReset().mockReturnValue("pglite:./data/pglite");
    mockHashDatabaseKey
      .mockReset()
      .mockImplementation((url: string) => `hash:${url}`);
    mockIsValidDevActionHandoffUrl.mockClear();
    delete process.env.AGENT_USER_EMAIL;
    delete process.env.AGENT_ORG_ID;
    delete process.env.APP_URL;
    delete process.env.WORKSPACE_GATEWAY_URL;
    delete process.env.VITE_WORKSPACE_GATEWAY_URL;
    delete process.env.BETTER_AUTH_URL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("runs in-process when there is no discovery file", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(undefined);
    await tryForwardToDevServer("do-thing", []);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs in-process when the discovery file's pid is dead", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery());
    mockIsProcessAlive.mockReturnValue(false);
    await tryForwardToDevServer("do-thing", []);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs in-process when the discovery file's databaseKey doesn't match", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(
      liveDiscovery({ databaseKey: "hash:some-other-db" }),
    );
    mockIsProcessAlive.mockReturnValue(true);
    await tryForwardToDevServer("do-thing", []);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs in-process, sending nothing, when the discovery origin is not the loopback dev server", async () => {
    for (const origin of [
      "http://evil.example",
      "https://evil.example",
      "http://127.0.0.1:1/path",
      "not a url",
    ]) {
      mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery({ origin }));
      mockIsProcessAlive.mockReturnValue(true);
      process.env.AGENT_USER_EMAIL = "dev@example.com";
      await tryForwardToDevServer("do-thing", []);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("exits 1 with the normal failure message when the forwarded arguments don't parse", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery());
    mockIsProcessAlive.mockReturnValue(true);
    const exit = mockExit();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      tryForwardToDevServer("do-thing", ["{not json"]),
    ).rejects.toThrow("process.exit(1)");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      'Action "do-thing" failed:',
      expect.any(String),
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("runs in-process when the dev server isn't actually reachable", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery());
    mockIsProcessAlive.mockReturnValue(true);
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    await tryForwardToDevServer("do-thing", []);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("runs in-process when the server doesn't have this action registered", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery());
    mockIsProcessAlive.mockReturnValue(true);
    fetchMock.mockResolvedValue({ status: 404, json: async () => ({}) });
    await tryForwardToDevServer("db-query", []);
  });

  it("exits 1 without falling back when the server rejects the request (401)", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery());
    mockIsProcessAlive.mockReturnValue(true);
    fetchMock.mockResolvedValue({
      status: 401,
      json: async () => ({ error: "Invalid or missing dev token." }),
    });
    const exit = mockExit();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(tryForwardToDevServer("do-thing", [])).rejects.toThrow(
      "process.exit(1)",
    );
    expect(errorSpy).toHaveBeenCalledWith(
      'Action "do-thing" failed:',
      "Invalid or missing dev token.",
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("forwards when the discovery origin is the printed localhost dev server", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(
      liveDiscovery({ origin: "http://localhost:8082", token: "secret-token" }),
    );
    mockIsProcessAlive.mockReturnValue(true);
    process.env.AGENT_USER_EMAIL = "owner@example.test";
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({ ok: true, result: "forwarded-ok" }),
    });
    const exit = mockExit();

    await expect(tryForwardToDevServer("do-thing", [])).rejects.toThrow(
      "process.exit(0)",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8082/_agent-native/dev/action",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-agent-native-dev-token": "secret-token",
          "x-agent-native-dev-user": "owner@example.test",
        }),
      }),
    );
    expect(exit).toHaveBeenCalledWith(0);
  });

  it.each(["https://localhost:8083", "http://[::1]:8084"])(
    "forwards to the printed loopback origin %s",
    async (origin) => {
      mockReadDevActionDiscoveryFile.mockReturnValue(
        liveDiscovery({ origin, token: "secret-token" }),
      );
      mockIsProcessAlive.mockReturnValue(true);
      fetchMock.mockResolvedValue({
        status: 200,
        json: async () => ({ ok: true, result: "forwarded-ok" }),
      });
      const exit = mockExit();

      await expect(tryForwardToDevServer("do-thing", [])).rejects.toThrow(
        "process.exit(0)",
      );
      expect(fetchMock).toHaveBeenCalledWith(
        `${origin}/_agent-native/dev/action`,
        expect.objectContaining({
          method: "POST",
          ...(origin.startsWith("https:")
            ? { dispatcher: expect.anything() }
            : {}),
        }),
      );
      expect(exit).toHaveBeenCalledWith(0);
    },
  );

  it("forwards the CLI's identity env as headers and prints the result on success", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(
      liveDiscovery({ token: "secret-token" }),
    );
    mockIsProcessAlive.mockReturnValue(true);
    process.env.AGENT_USER_EMAIL = "owner@example.test";
    process.env.AGENT_ORG_ID = "org_1";
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({ ok: true, result: "forwarded-ok" }),
    });
    const exit = mockExit();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(tryForwardToDevServer("do-thing", [])).rejects.toThrow(
      "process.exit(0)",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:1/_agent-native/dev/action",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-agent-native-dev-token": "secret-token",
          "x-agent-native-dev-user": "owner@example.test",
          "x-agent-native-dev-org": "org_1",
        }),
      }),
    );
    expect(logSpy).toHaveBeenCalledWith("forwarded-ok");
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("opens a private handoff returned beside the forwarded result", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery());
    mockIsProcessAlive.mockReturnValue(true);
    process.env.AGENT_NATIVE_NO_OPEN = "1";
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({
        ok: true,
        result: "forwarded-ok",
        devHandoffUrl: "/_agent-native/embed/start?ticket=private",
      }),
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(tryForwardToDevServer("open-visual-edit", [])).rejects.toThrow(
      "Secure browser handoff is disabled",
    );
    expect(logSpy).toHaveBeenCalledWith("forwarded-ok");
  });

  it("ignores an untrusted handoff returned beside the forwarded result", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery());
    mockIsProcessAlive.mockReturnValue(true);
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({
        ok: true,
        result: "forwarded-ok",
        devHandoffUrl:
          "https://evil.example/_agent-native/embed/start?ticket=secret",
      }),
    });
    const exit = mockExit();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(tryForwardToDevServer("open-visual-edit", [])).rejects.toThrow(
      "process.exit(0)",
    );

    expect(mockIsValidDevActionHandoffUrl).toHaveBeenCalledWith(
      "https://evil.example/_agent-native/embed/start?ticket=secret",
      "http://127.0.0.1:1",
    );
    expect(logSpy).toHaveBeenCalledWith("forwarded-ok");
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("exits 1 when the forwarded action itself failed", async () => {
    mockReadDevActionDiscoveryFile.mockReturnValue(liveDiscovery());
    mockIsProcessAlive.mockReturnValue(true);
    fetchMock.mockResolvedValue({
      status: 500,
      json: async () => ({ ok: false, error: "action blew up" }),
    });
    const exit = mockExit();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(tryForwardToDevServer("do-thing", [])).rejects.toThrow(
      "process.exit(1)",
    );
    expect(errorSpy).toHaveBeenCalledWith(
      'Action "do-thing" failed:',
      "action blew up",
    );
    expect(exit).toHaveBeenCalledWith(1);
  });
});
