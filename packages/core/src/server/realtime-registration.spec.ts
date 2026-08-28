import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockIsPostgres = vi.hoisted(() => vi.fn());
const mockGetDatabaseUrl = vi.hoisted(() => vi.fn());
const mockGetSetting = vi.hoisted(() => vi.fn());
const mockPutSetting = vi.hoisted(() => vi.fn());
const mockSelfUrl = vi.hoisted(() => vi.fn());
const mockHostedWorkspace = vi.hoisted(() => vi.fn());
const mockDeployEnv = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  isPostgres: mockIsPostgres,
  getDatabaseUrl: mockGetDatabaseUrl,
  isPgliteUrl: (url: string) => url.startsWith("pglite:"),
}));
vi.mock("../settings/store.js", () => ({
  getSetting: mockGetSetting,
  putSetting: mockPutSetting,
}));
vi.mock("./self-dispatch.js", () => ({
  resolveSelfDispatchBaseUrl: mockSelfUrl,
}));
vi.mock("./deploy-environment.js", () => ({
  resolveDeployEnvironment: mockDeployEnv,
}));
vi.mock("./credential-provider.js", () => ({
  getBuilderGatewayBaseUrl: () =>
    "https://api.builder.io/agent-native/gateway/v1",
  // Mirrors the real resolver, so the "no deployment key" case still exercises
  // the same absence the module sees in production.
  readDeployCredentialEnv: (key: string) => process.env[key] || undefined,
  isHostedWorkspaceRuntime: mockHostedWorkspace,
}));

import {
  resetRealtimeRegistrationCache,
  resolveRegisteredRealtimeChannel,
} from "./realtime-registration.js";

const DB_URL = "postgresql://u:pw@ep-1-pooler.neon.tech/main?sslmode=require";
const CHANNEL = { channelId: "rt_abc", hmacSecret: "s".repeat(64) };

const fetchMock = vi.fn();

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRealtimeRegistrationCache();
  vi.stubGlobal("fetch", fetchMock);
  process.env.AGENT_NATIVE_REALTIME_TRANSPORT = "hosted";
  process.env.BUILDER_PRIVATE_KEY = "bpk-test";
  mockIsPostgres.mockReturnValue(true);
  mockGetDatabaseUrl.mockReturnValue(DB_URL);
  mockSelfUrl.mockReturnValue("https://slides.agent-native.com");
  mockHostedWorkspace.mockReturnValue(false);
  mockDeployEnv.mockReturnValue("production");
  mockGetSetting.mockResolvedValue(null);
  mockPutSetting.mockResolvedValue(undefined);
  fetchMock.mockResolvedValue(ok({ ...CHANNEL, gatewayUrl: "x" }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AGENT_NATIVE_REALTIME_TRANSPORT;
  delete process.env.BUILDER_PRIVATE_KEY;
});

describe("resolveRegisteredRealtimeChannel", () => {
  it("registers with the deployment's own database URL and origin", async () => {
    await expect(resolveRegisteredRealtimeChannel()).resolves.toEqual(CHANNEL);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://api.builder.io/agent-native/gateway/v1/realtime/register",
    );
    expect(init.headers.authorization).toBe("Bearer bpk-test");
    expect(JSON.parse(init.body)).toEqual({
      appUrl: "https://slides.agent-native.com",
      databaseUrl: DB_URL,
    });
  });

  it("persists the channel so the next cold start does not re-register", async () => {
    await resolveRegisteredRealtimeChannel();
    const [key, value] = mockPutSetting.mock.calls[0];
    expect(key).toBe("agent-native-realtime-registration");
    expect(value).toMatchObject(CHANNEL);
    expect(value.fingerprint).toEqual(expect.any(String));
  });

  it("reuses a stored channel without touching the network", async () => {
    await resolveRegisteredRealtimeChannel();
    const stored = mockPutSetting.mock.calls[0][1];
    fetchMock.mockClear();
    resetRealtimeRegistrationCache();
    mockGetSetting.mockResolvedValue(stored);

    await expect(resolveRegisteredRealtimeChannel()).resolves.toEqual(CHANNEL);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-registers when the database URL rotates", async () => {
    await resolveRegisteredRealtimeChannel();
    const stored = mockPutSetting.mock.calls[0][1];
    fetchMock.mockClear();
    resetRealtimeRegistrationCache();
    mockGetSetting.mockResolvedValue(stored);
    mockGetDatabaseUrl.mockReturnValue(DB_URL.replace("pw@", "rotated@"));

    await resolveRegisteredRealtimeChannel();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("memoizes in-process so repeated requests cost nothing", async () => {
    await resolveRegisteredRealtimeChannel();
    await resolveRegisteredRealtimeChannel();
    await resolveRegisteredRealtimeChannel();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockGetSetting).toHaveBeenCalledTimes(1);
  });

  it("single-flights concurrent callers on a cold isolate", async () => {
    await Promise.all([
      resolveRegisteredRealtimeChannel(),
      resolveRegisteredRealtimeChannel(),
      resolveRegisteredRealtimeChannel(),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("backs off after a 403 instead of re-POSTing on every request", async () => {
    fetchMock.mockResolvedValue(ok({ code: "flag_off" }, 403));
    await expect(resolveRegisteredRealtimeChannel()).resolves.toBeNull();
    await expect(resolveRegisteredRealtimeChannel()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stays local when the gateway is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(resolveRegisteredRealtimeChannel()).resolves.toBeNull();
  });

  it("still serves the channel when the settings write fails", async () => {
    mockPutSetting.mockRejectedValue(new Error("no table yet"));
    await expect(resolveRegisteredRealtimeChannel()).resolves.toEqual(CHANNEL);
  });

  it.each([
    [
      "hosted transport is off",
      () => {
        process.env.AGENT_NATIVE_REALTIME_TRANSPORT = "local";
      },
    ],
    [
      // The gateway binds its runtime with isPostgres: () => true, so a channel
      // here would register fine and then never serve a read.
      "the database is not Postgres",
      () => mockIsPostgres.mockReturnValue(false),
    ],
    [
      "there is no deployment-level Builder key",
      () => {
        delete process.env.BUILDER_PRIVATE_KEY;
      },
    ],
    [
      "the deployment has no parseable self URL",
      () => mockSelfUrl.mockReturnValue("not a url"),
    ],
    [
      // The container's env key belongs to someone else's org.
      "it is running inside a hosted Builder workspace",
      () => mockHostedWorkspace.mockReturnValue(true),
    ],
    [
      // One channel per pull request would burn the per-org cap, and a
      // throwaway preview credential should never leave the machine.
      "it is a deploy preview rather than production",
      () => mockDeployEnv.mockReturnValue("preview"),
    ],
    [
      "the database is PGlite, which the gateway cannot dial",
      () => mockGetDatabaseUrl.mockReturnValue("pglite://./data/pglite"),
    ],
    [
      "the database is on localhost",
      () =>
        mockGetDatabaseUrl.mockReturnValue("postgresql://u:p@localhost/app"),
    ],
    [
      "the database is a bare IP literal",
      () => mockGetDatabaseUrl.mockReturnValue("postgresql://u:p@10.0.0.5/app"),
    ],
  ])("does not register when %s", async (_name, arrange) => {
    arrange();
    await expect(resolveRegisteredRealtimeChannel()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores a malformed gateway response rather than minting against it", async () => {
    fetchMock.mockResolvedValue(ok({ channelId: "rt_abc" }));
    await expect(resolveRegisteredRealtimeChannel()).resolves.toBeNull();
    expect(mockPutSetting).not.toHaveBeenCalled();
  });

  it("registers this deployment's own address, not the app's canonical URL", async () => {
    // A deploy preview sharing prod's origin would repoint prod's channel at
    // the preview database, because the gateway upserts on (org, appUrl).
    mockSelfUrl.mockReturnValue(
      "https://deploy-preview-42--slides.netlify.app",
    );
    await resolveRegisteredRealtimeChannel();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).appUrl).toBe(
      "https://deploy-preview-42--slides.netlify.app",
    );
  });

  it("registers on the same gateway the browser is pointed at", async () => {
    process.env.AGENT_NATIVE_REALTIME_GATEWAY_URL =
      "https://staging.example/rt";
    try {
      await resolveRegisteredRealtimeChannel();
      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://staging.example/rt/register",
      );
    } finally {
      delete process.env.AGENT_NATIVE_REALTIME_GATEWAY_URL;
    }
  });

  it("reuses a stored channel indefinitely while the inputs hold", async () => {
    await resolveRegisteredRealtimeChannel();
    const stored = mockPutSetting.mock.calls[0][1];
    fetchMock.mockClear();
    resetRealtimeRegistrationCache();
    // Deliberately ancient: only the fingerprint gates reuse, so a healthy app
    // never re-registers on a timer.
    mockGetSetting.mockResolvedValue({
      ...stored,
      registeredAt: Date.now() - 365 * 24 * 60 * 60 * 1000,
    });
    await expect(resolveRegisteredRealtimeChannel()).resolves.toEqual(CHANNEL);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not serve a concurrent caller whose inputs changed mid-flight", async () => {
    // Dispatch on the posted body, not call order: the two attempts interleave
    // their settings reads, so which one reaches fetch first is not fixed.
    const rotatedUrl = DB_URL.replace("pw@", "rotated@");
    let releaseOriginal: (v: Response) => void = () => {};
    fetchMock.mockImplementation((_url: string, init: { body: string }) => {
      const { databaseUrl } = JSON.parse(init.body);
      if (databaseUrl === rotatedUrl) {
        return Promise.resolve(
          ok({ channelId: "rt_rotated", hmacSecret: "r".repeat(64) }),
        );
      }
      return new Promise<Response>((r) => (releaseOriginal = r));
    });

    const first = resolveRegisteredRealtimeChannel();
    await Promise.resolve();
    mockGetDatabaseUrl.mockReturnValue(rotatedUrl);
    const second = resolveRegisteredRealtimeChannel();

    expect((await second)?.channelId).toBe("rt_rotated");
    releaseOriginal(ok({ ...CHANNEL, gatewayUrl: "x" }));
    expect((await first)?.channelId).toBe("rt_abc");
  });
});
