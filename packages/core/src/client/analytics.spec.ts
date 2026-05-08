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
}

async function freshAnalytics() {
  vi.resetModules();
  return import("./analytics.js");
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
    const { fetchMock } = installBrowser();
    vi.stubGlobal("fetch", fetchMock);
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://analytics.example.test/track");
    const body = JSON.parse(init.body);
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
      },
    });
  });

  it("tracks client-side URL changes once per URL", async () => {
    const { fetchMock, history } = installBrowser();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY", "anpk_test");
    const { configureTracking } = await freshAnalytics();

    configureTracking({});
    await tick();
    history.pushState({}, "", "/sent");
    await tick();
    history.replaceState({}, "", "/sent");
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const events = fetchMock.mock.calls.map(([, init]) =>
      JSON.parse(init.body),
    );
    expect(events.map((event) => event.properties.path)).toEqual([
      "/inbox",
      "/sent",
    ]);
    expect(events[1].properties.navigation_type).toBe("pushState");
  });

  it("keeps Agent Native Analytics quiet on localhost", async () => {
    const { fetchMock } = installBrowser("http://localhost:3000/inbox");
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY", "anpk_test");
    const { configureTracking } = await freshAnalytics();

    configureTracking({});
    await tick();

    expect(fetchMock).not.toHaveBeenCalled();
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
