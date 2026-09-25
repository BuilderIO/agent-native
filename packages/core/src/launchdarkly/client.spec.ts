import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAppConfigMock = vi.fn();
vi.mock("../app-config/index.js", () => ({
  getAppConfig: () => getAppConfigMock(),
}));

const initMock = vi.fn();
vi.mock("@launchdarkly/node-server-sdk", () => ({
  init: (...args: unknown[]) => initMock(...args),
}));

const { getLaunchDarklyClient, closeLaunchDarklyClient } =
  await import("./client.js");

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  await closeLaunchDarklyClient();
});

describe("getLaunchDarklyClient", () => {
  it("resolves null without calling init when no SDK key is configured", async () => {
    getAppConfigMock.mockReturnValue({ launchDarkly: {} });

    await expect(getLaunchDarklyClient()).resolves.toBeNull();
    expect(initMock).not.toHaveBeenCalled();
  });

  it("initializes once and caches the client across calls", async () => {
    getAppConfigMock.mockReturnValue({ launchDarkly: { sdkKey: "sdk-key" } });
    const client = {
      waitForInitialization: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    };
    initMock.mockReturnValue(client);

    const first = await getLaunchDarklyClient();
    const second = await getLaunchDarklyClient();

    expect(first).toBe(client);
    expect(second).toBe(client);
    expect(initMock).toHaveBeenCalledTimes(1);
  });

  it("returns the client immediately without waiting for initialization to settle", async () => {
    // A request-path flag read must never pay for LaunchDarkly's connection
    // handshake — variation() already answers with the caller's default
    // before the client is ready, so this resolves without waiting on
    // waitForInitialization() at all.
    getAppConfigMock.mockReturnValue({ launchDarkly: { sdkKey: "sdk-key" } });
    const client = {
      waitForInitialization: vi.fn(() => new Promise(() => {})),
      close: vi.fn(),
    };
    initMock.mockReturnValue(client);

    await expect(getLaunchDarklyClient()).resolves.toBe(client);
  });

  it("logs a warning when the background connection never settles, without affecting resolution", async () => {
    vi.useFakeTimers();
    getAppConfigMock.mockReturnValue({ launchDarkly: { sdkKey: "sdk-key" } });
    const client = {
      waitForInitialization: vi.fn(() => new Promise(() => {})),
      close: vi.fn(),
    };
    initMock.mockReturnValue(client);

    await getLaunchDarklyClient();
    await vi.advanceTimersByTimeAsync(6_000);

    expect(console.warn).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("closeLaunchDarklyClient", () => {
  it("closes the cached client and clears it so the next call reinitializes", async () => {
    getAppConfigMock.mockReturnValue({ launchDarkly: { sdkKey: "sdk-key" } });
    const client = {
      waitForInitialization: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    initMock.mockReturnValue(client);

    await getLaunchDarklyClient();
    await closeLaunchDarklyClient();

    expect(client.close).toHaveBeenCalledOnce();

    initMock.mockReturnValue({
      waitForInitialization: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    });
    await getLaunchDarklyClient();
    expect(initMock).toHaveBeenCalledTimes(2);
  });
});
