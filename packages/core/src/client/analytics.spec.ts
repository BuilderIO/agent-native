import { afterEach, describe, expect, it, vi } from "vitest";

const sentryMock = vi.hoisted(() => ({
  init: vi.fn(),
  setTag: vi.fn(),
  setUser: vi.fn(),
  withScope: vi.fn((fn: (scope: any) => unknown) =>
    fn({
      setTag: vi.fn(),
      setExtra: vi.fn(),
      setContext: vi.fn(),
    }),
  ),
  captureException: vi.fn(() => "event_id"),
}));

vi.mock("@sentry/browser", () => sentryMock);

const pageviewStateKey = Symbol.for("agent-native.client.pageviewTracking");

function resetPageviewState() {
  delete (globalThis as any)[pageviewStateKey];
}

function setLocation(
  location: {
    href: string;
    origin: string;
    hostname: string;
    pathname: string;
    search: string;
    hash: string;
  },
  next: string,
) {
  const url = new URL(next, location.href);
  location.href = url.href;
  location.origin = url.origin;
  location.hostname = url.hostname;
  location.pathname = url.pathname;
  location.search = url.search;
  location.hash = url.hash;
}

async function tick() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

async function freshAnalytics() {
  vi.resetModules();
  return import("./analytics.js");
}

function installFetch({
  status = {
    configured: true,
    engine: "builder",
    model: "claude-sonnet-4-6",
    source: "app_secrets",
  },
  session = { error: "not authenticated" },
}: {
  status?: Record<string, unknown>;
  session?: Record<string, unknown>;
} = {}) {
  const analyticsCalls: Array<[unknown, RequestInit]> = [];
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url).includes("/_agent-native/agent-engine/status")) {
      return new Response(JSON.stringify(status), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (String(url).includes("/_agent-native/auth/session")) {
      return new Response(JSON.stringify(session), {
        headers: { "Content-Type": "application/json" },
      });
    }
    analyticsCalls.push([url, init ?? {}]);
    return new Response("{}");
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, analyticsCalls };
}

function installBrowser(url = "https://mail.agent-native.com/inbox") {
  const parsed = new URL(url);
  const location = {
    href: parsed.href,
    origin: parsed.origin,
    hostname: parsed.hostname,
    pathname: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
  };
  const listeners: Record<string, Array<() => void>> = {};
  const history = {
    pushState: vi.fn((_state: unknown, _title: string, next?: string | URL) => {
      if (next !== undefined) setLocation(location, String(next));
    }),
    replaceState: vi.fn(
      (_state: unknown, _title: string, next?: string | URL) => {
        if (next !== undefined) setLocation(location, String(next));
      },
    ),
  };
  const windowMock = {
    location,
    history,
    gtag: vi.fn(),
    addEventListener: vi.fn((event: string, listener: () => void) => {
      listeners[event] = [...(listeners[event] ?? []), listener];
    }),
    setTimeout,
  };
  vi.stubGlobal("window", windowMock);
  vi.stubGlobal("document", {
    referrer: "https://builder.io/start?token=secret&utm=ok",
    title: "Inbox",
  });
  vi.stubGlobal("navigator", { sendBeacon: vi.fn(() => false) });

  return {
    fetchMock: vi.fn().mockResolvedValue(new Response("{}")),
    history,
    listeners,
    location,
  };
}

describe("browser analytics pageviews", () => {
  afterEach(() => {
    resetPageviewState();
    sentryMock.init.mockClear();
    sentryMock.setTag.mockClear();
    sentryMock.setUser.mockClear();
    sentryMock.withScope.mockClear();
    sentryMock.captureException.mockClear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("emits a default pageview with useful browser context", async () => {
    installBrowser();
    const { analyticsCalls } = installFetch();
    vi.stubEnv("VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY", "anpk_test");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_ANALYTICS_ENDPOINT",
      "https://analytics.example.test/track",
    );
    const { configureTracking } = await freshAnalytics();

    configureTracking({
      getDefaultProps: (_name, properties) => ({
        ...properties,
        app: "agent-native-mail",
      }),
    });
    await tick();

    expect(analyticsCalls).toHaveLength(1);
    const [url, init] = analyticsCalls[0];
    expect(url).toBe("https://analytics.example.test/track");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      publicKey: "anpk_test",
      event: "pageview",
      properties: {
        app: "agent-native-mail",
        template: "mail",
        url: "https://mail.agent-native.com/inbox",
        path: "/inbox",
        hostname: "mail.agent-native.com",
        referrer: "https://builder.io/start?token=%3Credacted%3E&utm=ok",
        title: "Inbox",
        navigation_type: "load",
        llm_connection: "builder",
        llm_connection_configured: true,
        llm_engine: "builder",
        llm_model: "claude-sonnet-4-6",
        llm_connection_source: "app_secrets",
      },
    });
  });

  it("accepts the first-party public key and endpoint at configure time", async () => {
    installBrowser();
    const { analyticsCalls } = installFetch();
    const { configureTracking } = await freshAnalytics();

    configureTracking({
      key: "anpk_configured",
      endpoint: "https://analytics.example.test/api/analytics/track",
    });
    await tick();

    expect(analyticsCalls).toHaveLength(1);
    const [url, init] = analyticsCalls[0];
    expect(url).toBe("https://analytics.example.test/api/analytics/track");
    expect(JSON.parse(String(init.body))).toMatchObject({
      publicKey: "anpk_configured",
      event: "pageview",
    });
  });

  it("attaches the signed-in session identity to first-party analytics", async () => {
    installBrowser();
    const { analyticsCalls } = installFetch({
      session: {
        email: "dev@example.com",
        userId: "auth-user-1",
        name: "Dev User",
        orgId: "org_123",
      },
    });
    const { configureTracking } = await freshAnalytics();

    configureTracking({
      key: "anpk_configured",
      endpoint: "https://analytics.example.test/api/analytics/track",
      getDefaultProps: (_name, properties) => ({
        ...properties,
        app: "agent-native-clips",
      }),
    });
    await tick();

    expect(analyticsCalls).toHaveLength(1);
    const body = JSON.parse(String(analyticsCalls[0][1].body));
    expect(body.userId).toBe("dev@example.com");
    expect(body.properties).toMatchObject({
      userId: "dev@example.com",
      userEmail: "dev@example.com",
      userName: "Dev User",
      orgId: "org_123",
      app: "agent-native-clips",
      template: "clips",
    });
  });

  it("tracks client-side URL changes once per URL", async () => {
    const { history } = installBrowser();
    const { analyticsCalls } = installFetch();
    vi.stubEnv("VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY", "anpk_test");
    const { configureTracking } = await freshAnalytics();

    configureTracking({});
    await tick();
    history.pushState({}, "", "/sent");
    await tick();
    history.replaceState({}, "", "/sent");
    await tick();

    expect(analyticsCalls).toHaveLength(2);
    const events = analyticsCalls.map(([, init]) =>
      JSON.parse(String(init.body)),
    );
    expect(events.map((event) => event.properties.path)).toEqual([
      "/inbox",
      "/sent",
    ]);
    expect(events[1].properties.navigation_type).toBe("pushState");
  });

  it("normalizes AI SDK engine names into provider connection labels", async () => {
    installBrowser();
    const { analyticsCalls } = installFetch({
      status: {
        configured: true,
        engine: "ai-sdk:openai",
        model: "gpt-5.5",
        source: "env",
        envVar: "OPENAI_API_KEY",
      },
    });
    vi.stubEnv("VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY", "anpk_test");
    const { configureTracking } = await freshAnalytics();

    configureTracking({});
    await tick();

    const body = JSON.parse(String(analyticsCalls[0][1].body));
    expect(body.properties).toMatchObject({
      llm_connection: "openai",
      llm_engine: "ai-sdk:openai",
      llm_model: "gpt-5.5",
      llm_connection_source: "env",
      llm_connection_env_var: "OPENAI_API_KEY",
    });
  });

  it("keeps Agent Native Analytics quiet on localhost", async () => {
    installBrowser("http://localhost:3000/inbox");
    const { analyticsCalls } = installFetch();
    vi.stubEnv("VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY", "anpk_test");
    const { configureTracking } = await freshAnalytics();

    configureTracking({});
    await tick();

    expect(analyticsCalls).toHaveLength(0);
  });

  it("initializes browser Sentry from SSR runtime config", async () => {
    installBrowser();
    (window as any).__AGENT_NATIVE_CONFIG__ = {
      sentryDsn: "https://public@example/4511270423822336",
      sentryEnvironment: "production",
    };
    const { configureTracking } = await freshAnalytics();

    configureTracking({});

    expect(sentryMock.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://public@example/4511270423822336",
        environment: "production",
      }),
    );
    expect(sentryMock.setTag).toHaveBeenCalledWith("runtime", "browser");
  });

  it("initializes browser Sentry from Vite key/project/host env vars", async () => {
    installBrowser();
    vi.stubEnv("VITE_SENTRY_CLIENT_KEY", "public_key");
    vi.stubEnv("VITE_SENTRY_PROJECT_ID", "4511270423822336");
    vi.stubEnv("VITE_SENTRY_INGEST_HOST", "o1.ingest.us.sentry.io");
    const { configureTracking } = await freshAnalytics();

    configureTracking({});

    expect(sentryMock.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://public_key@o1.ingest.us.sentry.io/4511270423822336",
      }),
    );
  });

  it("drops blocked Amplitude fetch noise from browser Sentry", async () => {
    installBrowser();
    (window as any).__AGENT_NATIVE_CONFIG__ = {
      sentryDsn: "https://public@example/4511270423822336",
      sentryEnvironment: "production",
    };
    const { configureTracking } = await freshAnalytics();

    configureTracking({});
    const options = sentryMock.init.mock.calls[0][0];
    const result = options.beforeSend({
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch (api2.amplitude.com)",
          },
        ],
      },
      request: {
        url: "https://www.agent-native.com/templates/calendar",
      },
    });

    expect(result).toBeNull();
  });

  it("drops bare browser auth noise from Sentry", async () => {
    installBrowser();
    (window as any).__AGENT_NATIVE_CONFIG__ = {
      sentryDsn: "https://public@example/4511270423822336",
      sentryEnvironment: "production",
    };
    const { configureTracking } = await freshAnalytics();

    configureTracking({});
    const options = sentryMock.init.mock.calls[0][0];
    const result = options.beforeSend({
      exception: {
        values: [{ type: "Error", value: "Unauthorized" }],
      },
      request: {
        url: "https://mail.agent-native.com/inbox/message-1",
      },
    });

    expect(result).toBeNull();
  });

  it("drops source-less EmptyRanges reference noise from browser Sentry", async () => {
    installBrowser();
    (window as any).__AGENT_NATIVE_CONFIG__ = {
      sentryDsn: "https://public@example/4511270423822336",
      sentryEnvironment: "production",
    };
    const { configureTracking } = await freshAnalytics();

    configureTracking({});
    const options = sentryMock.init.mock.calls[0][0];
    const result = options.beforeSend({
      exception: {
        values: [
          {
            type: "ReferenceError",
            value: "Can't find variable: EmptyRanges",
            stacktrace: {
              frames: [{ filename: "undefined", function: null }],
            },
          },
        ],
      },
      request: {
        url: "https://www.agent-native.com/",
      },
    });

    expect(result).toBeNull();

    const eventWithAppFrame = {
      exception: {
        values: [
          {
            type: "ReferenceError",
            value: "Can't find variable: EmptyRanges",
            stacktrace: {
              frames: [
                {
                  filename: "/assets/app.js",
                  function: "render",
                },
              ],
            },
          },
        ],
      },
      request: {
        url: "https://www.agent-native.com/",
      },
    };
    expect(options.beforeSend(eventWithAppFrame)).toBe(eventWithAppFrame);
  });

  it("drops iOS WebKit scroll bridge noise from docs Sentry", async () => {
    installBrowser();
    (window as any).__AGENT_NATIVE_CONFIG__ = {
      sentryDsn: "https://public@example/4511270423822336",
      sentryEnvironment: "production",
    };
    const { configureTracking } = await freshAnalytics();

    configureTracking({});
    const options = sentryMock.init.mock.calls[0][0];
    const result = options.beforeSend({
      exception: {
        values: [
          {
            type: "TypeError",
            value:
              "undefined is not an object (evaluating 'window.webkit.messageHandlers.scrollEventHandler.postMessage')",
            stacktrace: {
              frames: [{ filename: "/assets/analytics.js", function: "r" }],
            },
          },
        ],
      },
      request: {
        url: "https://www.agent-native.com/ja-JP",
      },
    });

    expect(result).toBeNull();
  });

  it("drops source-less public docs stack overflow noise from browser Sentry", async () => {
    installBrowser();
    (window as any).__AGENT_NATIVE_CONFIG__ = {
      sentryDsn: "https://public@example/4511270423822336",
      sentryEnvironment: "production",
    };
    const { configureTracking } = await freshAnalytics();

    configureTracking({});
    const options = sentryMock.init.mock.calls[0][0];
    const result = options.beforeSend({
      exception: {
        values: [
          {
            type: "RangeError",
            value: "Maximum call stack size exceeded.",
            stacktrace: {
              frames: [{ filename: "undefined", function: null }],
            },
          },
        ],
      },
      request: {
        url: "https://www.agent-native.com/skills",
      },
    });

    expect(result).toBeNull();

    const eventWithAppFrame = {
      exception: {
        values: [
          {
            type: "RangeError",
            value: "Maximum call stack size exceeded.",
            stacktrace: {
              frames: [
                {
                  filename: "/assets/app.js",
                  function: "render",
                },
              ],
            },
          },
        ],
      },
      request: {
        url: "https://www.agent-native.com/skills",
      },
    };
    expect(options.beforeSend(eventWithAppFrame)).toBe(eventWithAppFrame);

    const nonDocsEvent = {
      exception: {
        values: [
          {
            type: "RangeError",
            value: "Maximum call stack size exceeded.",
            stacktrace: {
              frames: [{ filename: "undefined", function: null }],
            },
          },
        ],
      },
      request: {
        url: "https://mail.agent-native.com/inbox",
      },
    };
    expect(options.beforeSend(nonDocsEvent)).toBe(nonDocsEvent);
  });

  it("drops user-aborted browser requests from Sentry", async () => {
    installBrowser();
    (window as any).__AGENT_NATIVE_CONFIG__ = {
      sentryDsn: "https://public@example/4511270423822336",
      sentryEnvironment: "production",
    };
    const { configureTracking } = await freshAnalytics();

    configureTracking({});
    const options = sentryMock.init.mock.calls[0][0];
    const result = options.beforeSend({
      exception: {
        values: [
          {
            type: "Error",
            value: "AbortError: The user aborted a request.",
          },
        ],
      },
      request: {
        url: "https://www.agent-native.com/docs",
      },
    });

    expect(result).toBeNull();
  });

  it("drops reasonless signal abort browser requests from Sentry", async () => {
    installBrowser("https://www.agent-native.com/templates");
    (window as any).__AGENT_NATIVE_CONFIG__ = {
      sentryDsn: "https://public@example/4511270423822336",
      sentryEnvironment: "production",
    };
    const { configureTracking } = await freshAnalytics();

    configureTracking({});
    const options = sentryMock.init.mock.calls[0][0];
    const result = options.beforeSend({
      exception: {
        values: [
          {
            type: "AbortError",
            value: "signal is aborted without reason",
          },
        ],
      },
      request: {
        url: "https://www.agent-native.com/templates",
      },
    });

    expect(result).toBeNull();
  });

  it("captures browser errors through the generic captureError helper", async () => {
    installBrowser();
    vi.stubEnv(
      "VITE_SENTRY_CLIENT_DSN",
      "https://public@example/4511270423822336",
    );
    const { captureError } = await freshAnalytics();

    const err = new Error("boom");
    const result = captureError(err, {
      tags: { source: "agent-chat-client" },
      extra: { runId: "run_123" },
    });

    expect(result).toBe("event_id");
    expect(sentryMock.captureException).toHaveBeenCalledWith(err);
  });
});
