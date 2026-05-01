import { afterEach, describe, expect, it, vi } from "vitest";

async function freshTrackingModules() {
  vi.resetModules();
  const registry = await import("./registry.js");
  registry.unregisterTrackingProvider("agent-native-analytics");
  registry.unregisterTrackingProvider("posthog");
  registry.unregisterTrackingProvider("mixpanel");
  registry.unregisterTrackingProvider("amplitude");
  registry.unregisterTrackingProvider("webhook");
  const providers = await import("./providers.js");
  return { ...registry, ...providers };
}

describe("tracking providers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not register Agent Native Analytics without a public key", async () => {
    vi.stubEnv("AGENT_NATIVE_ANALYTICS_PUBLIC_KEY", "");
    const { listTrackingProviders, registerBuiltinProviders } =
      await freshTrackingModules();

    registerBuiltinProviders();

    expect(listTrackingProviders()).not.toContain("agent-native-analytics");
  });

  it("sends track events to Agent Native Analytics when configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("AGENT_NATIVE_ANALYTICS_PUBLIC_KEY", "anpk_test");
    vi.stubEnv(
      "AGENT_NATIVE_ANALYTICS_ENDPOINT",
      "https://analytics.example.test/track",
    );
    const { flushTracking, registerBuiltinProviders, track } =
      await freshTrackingModules();

    registerBuiltinProviders();
    track("qa.event", { app: "qa", signed_in: true }, { userId: "u1" });
    await flushTracking();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://analytics.example.test/track");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({
      publicKey: "anpk_test",
      event: "qa.event",
      properties: { app: "qa", signed_in: true },
      userId: "u1",
    });
  });

  it("does not register Agent Native Analytics for localhost app URLs", async () => {
    vi.stubEnv("AGENT_NATIVE_ANALYTICS_PUBLIC_KEY", "anpk_test");
    vi.stubEnv("APP_URL", "http://localhost:3000");
    const { listTrackingProviders, registerBuiltinProviders } =
      await freshTrackingModules();

    registerBuiltinProviders();

    expect(listTrackingProviders()).not.toContain("agent-native-analytics");
  });

  it("allows an explicit localhost override for Agent Native Analytics", async () => {
    vi.stubEnv("AGENT_NATIVE_ANALYTICS_PUBLIC_KEY", "anpk_test");
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.stubEnv("AGENT_NATIVE_ANALYTICS_ALLOW_LOCALHOST", "true");
    const { listTrackingProviders, registerBuiltinProviders } =
      await freshTrackingModules();

    registerBuiltinProviders();

    expect(listTrackingProviders()).toContain("agent-native-analytics");
  });
});
