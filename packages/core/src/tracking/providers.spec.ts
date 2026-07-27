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

  it("falls back to the public Vite key for server-side Agent Native Analytics", async () => {
    vi.stubEnv("VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY", "anpk_vite_test");
    const { listTrackingProviders, registerBuiltinProviders } =
      await freshTrackingModules();

    registerBuiltinProviders();

    expect(listTrackingProviders()).toContain("agent-native-analytics");
  });

  it("flushes Agent Native Analytics events immediately in serverless runtimes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("AGENT_NATIVE_ANALYTICS_PUBLIC_KEY", "anpk_test");
    vi.stubEnv(
      "AGENT_NATIVE_ANALYTICS_ENDPOINT",
      "https://analytics.example.test/track",
    );
    vi.stubEnv("NETLIFY", "true");
    const { registerBuiltinProviders, track } = await freshTrackingModules();

    registerBuiltinProviders();
    track("http.response", { status_code: 200 });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("sends PostHog AI observability events to the AI event endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("POSTHOG_API_KEY", "ph_test");
    vi.stubEnv("POSTHOG_HOST", "https://us.i.posthog.com");
    const { flushTracking, registerBuiltinProviders, track } =
      await freshTrackingModules();

    registerBuiltinProviders();
    track(
      "$ai_generation",
      {
        $ai_trace_id: "run-1",
        $ai_model: "gpt-5",
        $ai_input_tokens: 10,
        $ai_output_tokens: 20,
      },
      { userId: "u1" },
    );
    await flushTracking();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://us.i.posthog.com/i/v0/e/");
    expect(JSON.parse(init.body)).toMatchObject({
      api_key: "ph_test",
      event: "$ai_generation",
      properties: {
        distinct_id: "u1",
        $ai_trace_id: "run-1",
        $ai_model: "gpt-5",
        $ai_input_tokens: 10,
        $ai_output_tokens: 20,
      },
    });
  });

  it("waits for queued provider sends when flushing", async () => {
    let resolveFetch: (() => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = () => resolve(new Response("{}"));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("AGENT_NATIVE_ANALYTICS_PUBLIC_KEY", "anpk_test");
    vi.stubEnv(
      "AGENT_NATIVE_ANALYTICS_ENDPOINT",
      "https://analytics.example.test/track",
    );
    const { flushTracking, registerBuiltinProviders, track } =
      await freshTrackingModules();

    registerBuiltinProviders();
    track("qa.event", { app: "qa" }, { userId: "u1" });
    let flushed = false;
    const flushPromise = flushTracking().then(() => {
      flushed = true;
    });
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(flushed).toBe(false);

    resolveFetch?.();
    await flushPromise;

    expect(flushed).toBe(true);
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
