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
    track(
      "qa.event",
      { app: "qa", signed_in: true },
      {
        userId: "u1",
        anonymousId: "anon_1",
      },
    );
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
      anonymousId: "anon_1",
    });
  });

  it("maps the browser session onto each provider's own session field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("POSTHOG_API_KEY", "ph_test");
    vi.stubEnv("POSTHOG_HOST", "https://us.i.posthog.com");
    vi.stubEnv("MIXPANEL_TOKEN", "mp_test");
    vi.stubEnv("AMPLITUDE_API_KEY", "amp_test");
    const { flushTracking, registerBuiltinProviders, track } =
      await freshTrackingModules();

    registerBuiltinProviders();
    track(
      "project_created",
      { template: "blank" },
      { userId: "u1", sessionId: "session-1" },
    );
    await flushTracking();

    const byUrl = new Map<string, any>(
      fetchMock.mock.calls.map(([url, init]: [string, any]) => [
        url,
        JSON.parse(init.body),
      ]),
    );
    expect(
      byUrl.get("https://us.i.posthog.com/capture/").properties,
    ).toMatchObject({ $session_id: "session-1" });
    expect(
      byUrl.get("https://api.mixpanel.com/track")[0].properties,
    ).toMatchObject({ session_id: "session-1" });
    expect(
      byUrl.get("https://api2.amplitude.com/2/httpapi").events[0]
        .event_properties,
    ).toMatchObject({ session_id: "session-1" });
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

  it("flushes PostHog, Mixpanel, Amplitude, and webhook events immediately in serverless runtimes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("POSTHOG_API_KEY", "ph_test");
    vi.stubEnv("MIXPANEL_TOKEN", "mp_test");
    vi.stubEnv("AMPLITUDE_API_KEY", "amp_test");
    vi.stubEnv("TRACKING_WEBHOOK_URL", "https://hooks.example.test/track");
    vi.stubEnv("NETLIFY", "true");
    const { registerBuiltinProviders, track } = await freshTrackingModules();

    registerBuiltinProviders();
    track("http.response", { status_code: 500 });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
    const calledUrls = fetchMock.mock.calls.map((call) => call[0]).sort();
    expect(calledUrls).toEqual(
      [
        "https://api.mixpanel.com/track",
        "https://api2.amplitude.com/2/httpapi",
        "https://hooks.example.test/track",
        "https://us.i.posthog.com/capture/",
      ].sort(),
    );
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

  it("reshapes tracked exceptions into PostHog's $exception_list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("POSTHOG_API_KEY", "ph_test");
    vi.stubEnv("POSTHOG_HOST", "https://us.i.posthog.com");
    const { flushTracking, registerBuiltinProviders, track } =
      await freshTrackingModules();

    registerBuiltinProviders();
    track(
      "$exception",
      {
        exceptionType: "TypeError",
        exceptionMessage: "boom",
        exceptionStack: "TypeError: boom\n    at run (/app/src/a.ts:3:5)",
        handled: false,
        level: "error",
        app: "content",
      },
      { userId: "u1", sessionId: "session-1" },
    );
    await flushTracking();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://us.i.posthog.com/i/v0/e/");
    const body = JSON.parse(init.body);
    expect(body.event).toBe("$exception");
    expect(body.properties.distinct_id).toBe("u1");
    expect(body.properties.app).toBe("content");
    expect(body.properties.$exception_level).toBe("error");
    // The reshaped exception path is a separate branch from /capture/ — a
    // server error still has to join the visit that triggered it.
    expect(body.properties.$session_id).toBe("session-1");
    expect(body.properties.$exception_list[0]).toMatchObject({
      type: "TypeError",
      value: "boom",
      mechanism: { handled: false },
      stacktrace: {
        type: "raw",
        frames: [
          {
            platform: "custom",
            lang: "javascript",
            function: "run",
            filename: "/app/src/a.ts",
            lineno: 3,
            colno: 5,
          },
        ],
      },
    });
    expect(body.properties).not.toHaveProperty("exceptionType");
  });

  it("keeps non-exception-shaped $exception events on /capture/", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("POSTHOG_API_KEY", "ph_test");
    vi.stubEnv("POSTHOG_HOST", "https://us.i.posthog.com");
    const { flushTracking, registerBuiltinProviders, track } =
      await freshTrackingModules();

    registerBuiltinProviders();
    track("$exception", { unrelated: true }, { userId: "u1" });
    await flushTracking();

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://us.i.posthog.com/capture/",
    );
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
