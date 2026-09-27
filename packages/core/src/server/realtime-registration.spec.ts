import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetDatabaseUrl = vi.hoisted(() => vi.fn());
const mockGetSetting = vi.hoisted(() => vi.fn());
const mockPutSetting = vi.hoisted(() => vi.fn());
const mockSelfUrl = vi.hoisted(() => vi.fn());
const mockHostedWorkspace = vi.hoisted(() => vi.fn());
const mockPlatformMarker = vi.hoisted(() => vi.fn());
const mockDeployEnv = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDatabaseUrl: mockGetDatabaseUrl,
  isPgliteUrl: (url: string) => url.startsWith("pglite:"),
}));
vi.mock("../settings/store.js", () => ({
  getSetting: mockGetSetting,
  putSetting: mockPutSetting,
}));
vi.mock("./self-dispatch.js", () => ({
  resolveDeploymentBaseUrl: mockSelfUrl,
}));
vi.mock("./deploy-environment.js", () => ({
  resolveDeployEnvironment: mockDeployEnv,
}));
vi.mock("./credential-provider.js", () => ({
  getBuilderGatewayBaseUrl: () =>
    "https://api.builder.io/agent-native/gateway/v1",
  readDeployCredentialEnv: (key: string) => process.env[key] || undefined,
  isHostedWorkspaceRuntime: mockHostedWorkspace,
  hasPlatformRuntimeMarker: mockPlatformMarker,
}));

import {
  realtimeRegistrationUnavailable,
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
  vi.stubEnv("DEPLOY_PRIME_URL", "https://slides.agent-native.com");
  process.env.AGENT_NATIVE_REALTIME_TRANSPORT = "hosted";
  process.env.BUILDER_PRIVATE_KEY = "bpk-test";
  mockGetDatabaseUrl.mockReturnValue(DB_URL);
  mockSelfUrl.mockReturnValue("https://slides.agent-native.com");
  mockHostedWorkspace.mockReturnValue(false);
  mockPlatformMarker.mockReturnValue(true);
  mockDeployEnv.mockReturnValue("production");
  mockGetSetting.mockResolvedValue(null);
  mockPutSetting.mockResolvedValue(undefined);
  fetchMock.mockResolvedValue(ok({ ...CHANNEL, gatewayUrl: "x" }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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
    expect(value.channelId).toBe(CHANNEL.channelId);
    expect(value.fingerprint).toEqual(expect.any(String));
    expect(value).not.toHaveProperty("hmacSecret");
    expect(value.hmacSecretEncrypted).toMatch(/^v1:/);
    expect(value.hmacSecretEncrypted).not.toContain(CHANNEL.hmacSecret);
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

  describe("how long a failure is remembered", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("retries an unreachable gateway within half a minute", async () => {
      fetchMock.mockRejectedValue(new Error("ETIMEDOUT"));
      await expect(resolveRegisteredRealtimeChannel()).resolves.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(10_000);
      await expect(resolveRegisteredRealtimeChannel()).resolves.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(25_000);
      fetchMock.mockResolvedValue(ok(CHANNEL));
      await expect(resolveRegisteredRealtimeChannel()).resolves.toEqual(
        CHANNEL,
      );
    });

    it("still holds a refusal for the full backoff", async () => {
      fetchMock.mockResolvedValue(ok({ code: "flag_off" }, 403));
      await expect(resolveRegisteredRealtimeChannel()).resolves.toBeNull();

      await vi.advanceTimersByTimeAsync(60_000);
      await expect(resolveRegisteredRealtimeChannel()).resolves.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
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
    [
      "the database host is a rooted localhost",
      () =>
        mockGetDatabaseUrl.mockReturnValue("postgresql://u:p@localhost./app"),
    ],
    [
      "the database host is rooted cloud metadata",
      () =>
        mockGetDatabaseUrl.mockReturnValue(
          "postgresql://u:p@metadata.google.internal./app",
        ),
    ],
  ])("does not register when %s", async (_name, arrange) => {
    arrange();
    await expect(resolveRegisteredRealtimeChannel()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not accept the generic URL variable as deployment evidence", async () => {
    vi.stubEnv("DEPLOY_PRIME_URL", "");
    vi.stubEnv("URL", "https://slides.agent-native.com");
    mockPlatformMarker.mockReturnValue(false);
    await expect(resolveRegisteredRealtimeChannel()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("registers the origin a self-hosted deploy declares for itself", async () => {
    vi.stubEnv("DEPLOY_PRIME_URL", "");
    mockPlatformMarker.mockReturnValue(false);
    vi.stubEnv(
      "AGENT_NATIVE_REALTIME_APP_URL",
      "https://self-hosted.example.com/ignored/path",
    );
    await expect(resolveRegisteredRealtimeChannel()).resolves.toEqual(CHANNEL);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).appUrl).toBe(
      "https://self-hosted.example.com",
    );
  });

  it("does not register the canonical origin from a process that may not be the deploy", async () => {
    vi.stubEnv("DEPLOY_PRIME_URL", "");
    mockPlatformMarker.mockReturnValue(false);
    await expect(resolveRegisteredRealtimeChannel()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("registers on the canonical origin from a real deployed runtime", async () => {
    vi.stubEnv("DEPLOY_PRIME_URL", "");
    await expect(resolveRegisteredRealtimeChannel()).resolves.toEqual(CHANNEL);
  });

  it("does not accept NODE_ENV=production as a substitute for that marker", async () => {
    vi.stubEnv("DEPLOY_PRIME_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    mockPlatformMarker.mockReturnValue(false);
    await expect(resolveRegisteredRealtimeChannel()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-registers when the gateway endpoint changes", async () => {
    // A channel only exists on the gateway it was registered with. Repointing
    // staging to production leaves the database, origin and credential
    // unchanged, so without the endpoint in the fingerprint the app reuses a
    // channel the new gateway has never heard of.
    await resolveRegisteredRealtimeChannel();
    const stored = mockPutSetting.mock.calls[0][1];
    fetchMock.mockClear();
    resetRealtimeRegistrationCache();
    mockGetSetting.mockResolvedValue(stored);
    process.env.AGENT_NATIVE_REALTIME_GATEWAY_URL =
      "https://staging.example/rt";

    try {
      await resolveRegisteredRealtimeChannel();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://staging.example/rt/register",
      );
    } finally {
      delete process.env.AGENT_NATIVE_REALTIME_GATEWAY_URL;
    }
  });

  it("re-registers when the Builder credential moves to another org", async () => {
    // The gateway scopes a channel to the org the key resolves to. Without the
    // credential in the fingerprint the app kept minting against the OLD org's
    // channel forever — the new org's rollout flag, suspension and cap
    // accounting never applying to it.
    await resolveRegisteredRealtimeChannel();
    const stored = mockPutSetting.mock.calls[0][1];
    fetchMock.mockClear();
    resetRealtimeRegistrationCache();
    mockGetSetting.mockResolvedValue(stored);
    process.env.BUILDER_PRIVATE_KEY = "bpk-other-org";

    await resolveRegisteredRealtimeChannel();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("logs a 403 that is not the rollout flag", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      fetchMock.mockResolvedValue(ok({ code: "invalid_credentials" }, 403));
      await expect(resolveRegisteredRealtimeChannel()).resolves.toBeNull();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("invalid_credentials"),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("stays quiet for the rollout flag itself", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      fetchMock.mockResolvedValue(ok({ code: "flag_off" }, 403));
      await expect(resolveRegisteredRealtimeChannel()).resolves.toBeNull();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  describe("separating 'told no' from 'could not ask'", () => {
    it.each([
      [
        "a network failure",
        () => fetchMock.mockRejectedValue(new Error("ETIMEDOUT")),
      ],
      ["a 5xx", () => fetchMock.mockResolvedValue(ok({}, 503))],
    ])("marks %s unavailable", async (_name, arrange) => {
      arrange();
      await expect(resolveRegisteredRealtimeChannel()).resolves.toBeNull();
      expect(realtimeRegistrationUnavailable()).toBe(true);
    });

    it.each([
      [
        "the rollout flag",
        () => fetchMock.mockResolvedValue(ok({ code: "flag_off" }, 403)),
      ],
      [
        "a refused credential",
        () => fetchMock.mockResolvedValue(ok({ code: "no_owner" }, 401)),
      ],
      [
        "an unusable body",
        () => fetchMock.mockResolvedValue(ok({ channelId: "rt_abc" })),
      ],
    ])("does not mark %s unavailable", async (_name, arrange) => {
      arrange();
      await expect(resolveRegisteredRealtimeChannel()).resolves.toBeNull();
      expect(realtimeRegistrationUnavailable()).toBe(false);
    });

    it("clears once a channel resolves", async () => {
      fetchMock.mockRejectedValue(new Error("ETIMEDOUT"));
      await resolveRegisteredRealtimeChannel();
      expect(realtimeRegistrationUnavailable()).toBe(true);

      resetRealtimeRegistrationCache();
      fetchMock.mockResolvedValue(ok(CHANNEL));
      await expect(resolveRegisteredRealtimeChannel()).resolves.toEqual(
        CHANNEL,
      );
      expect(realtimeRegistrationUnavailable()).toBe(false);
    });
  });

  it("does not let a superseded attempt overwrite the current registration", async () => {
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
    await resolveRegisteredRealtimeChannel();
    mockPutSetting.mockClear();

    releaseOriginal(ok(CHANNEL));
    await first;

    expect(mockPutSetting).not.toHaveBeenCalled();
    fetchMock.mockClear();
    await expect(resolveRegisteredRealtimeChannel()).resolves.toMatchObject({
      channelId: "rt_rotated",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing field", { channelId: "rt_abc" }],
    ["a non-string channel id", { channelId: {}, hmacSecret: "s".repeat(64) }],
    ["a non-string secret", { channelId: "rt_abc", hmacSecret: 12345 }],
    ["an empty string", { channelId: "", hmacSecret: "s".repeat(64) }],
  ])("ignores %s rather than minting against it", async (_name, body) => {
    fetchMock.mockResolvedValue(ok(body));
    await expect(resolveRegisteredRealtimeChannel()).resolves.toBeNull();
    expect(mockPutSetting).not.toHaveBeenCalled();
  });

  it("registers this deployment's own address, not the app's canonical URL", async () => {
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
    mockGetSetting.mockResolvedValue({
      ...stored,
      registeredAt: Date.now() - 365 * 24 * 60 * 60 * 1000,
    });
    await expect(resolveRegisteredRealtimeChannel()).resolves.toEqual(CHANNEL);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not serve a concurrent caller whose inputs changed mid-flight", async () => {
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
