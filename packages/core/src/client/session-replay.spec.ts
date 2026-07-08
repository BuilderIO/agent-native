import { gunzipSync } from "node:zlib";

import { afterEach, describe, expect, it, vi } from "vitest";

const recordMock = vi.hoisted(() => vi.fn());
const sentryMock = vi.hoisted(() => ({
  init: vi.fn(),
  setTag: vi.fn(),
  setUser: vi.fn(),
}));
const amplitudeMock = vi.hoisted(() => ({
  init: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@rrweb/record", () => ({ record: recordMock }));
vi.mock("@sentry/browser", () => sentryMock);
vi.mock("@amplitude/analytics-browser", () => amplitudeMock);

const replayStateKey = Symbol.for("agent-native.client.sessionReplay");
const pageviewStateKey = Symbol.for("agent-native.client.pageviewTracking");

async function tick() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitForAssertion(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

function headerValue(
  headers: RequestInit["headers"],
  name: string,
): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (Array.isArray(headers)) {
    const match = headers.find(([key]) => key.toLowerCase() === name);
    return match?.[1];
  }
  const lowerName = name.toLowerCase();
  return Object.entries(headers ?? {}).find(
    ([key]) => key.toLowerCase() === lowerName,
  )?.[1] as string | undefined;
}

async function requestBodyBuffer(body: RequestInit["body"]): Promise<Buffer> {
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  return Buffer.from(String(body ?? ""), "utf8");
}

async function parseReplayUpload(init: RequestInit): Promise<any> {
  let bytes = await requestBodyBuffer(init.body);
  if (headerValue(init.headers, "content-encoding") === "gzip") {
    bytes = gunzipSync(bytes);
  }
  return JSON.parse(bytes.toString("utf8"));
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

function installBrowser(
  url = "https://app.agent-native.com/inbox",
  session: Record<string, unknown> = { error: "not authenticated" },
) {
  const parsed = new URL(url);
  const storage = new Map<string, string>();
  const location = {
    href: parsed.href,
    origin: parsed.origin,
    hostname: parsed.hostname,
    pathname: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
  };
  const windowListeners = new Map<string, Set<() => void>>();
  const documentListeners = new Map<string, Set<() => void>>();
  const addWindowListener = (event: string, listener: () => void) => {
    const set = windowListeners.get(event) ?? new Set();
    set.add(listener);
    windowListeners.set(event, set);
  };
  const removeWindowListener = (event: string, listener: () => void) => {
    windowListeners.get(event)?.delete(listener);
  };
  const addDocumentListener = (event: string, listener: () => void) => {
    const set = documentListeners.get(event) ?? new Set();
    set.add(listener);
    documentListeners.set(event, set);
  };
  const removeDocumentListener = (event: string, listener: () => void) => {
    documentListeners.get(event)?.delete(listener);
  };
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
  const localStorage = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
  };
  vi.stubGlobal("window", {
    location,
    history,
    localStorage,
    gtag: vi.fn(),
    addEventListener: vi.fn(addWindowListener),
    removeEventListener: vi.fn(removeWindowListener),
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  });
  vi.stubGlobal("document", {
    referrer: "",
    title: "Inbox",
    visibilityState: "visible",
    addEventListener: vi.fn(addDocumentListener),
    removeEventListener: vi.fn(removeDocumentListener),
    cookie: "",
  });
  vi.stubGlobal("navigator", { sendBeacon: vi.fn(() => false) });
  let idCounter = 0;
  vi.stubGlobal("crypto", {
    randomUUID: vi.fn(() => `00000000-0000-4000-8000-${++idCounter}`),
  });
  const fetchMock = vi.fn(async (input: unknown) => {
    if (String(input).includes("/_agent-native/auth/session")) {
      return new Response(JSON.stringify(session), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}");
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, history, location, storage };
}

async function freshSessionReplay() {
  vi.resetModules();
  return import("./session-replay.js");
}

describe("session replay", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (globalThis as any)[replayStateKey];
    delete (globalThis as any)[pageviewStateKey];
    recordMock.mockReset();
    sentryMock.init.mockReset();
    sentryMock.setTag.mockReset();
    sentryMock.setUser.mockReset();
    amplitudeMock.init.mockReset();
    amplitudeMock.track.mockReset();
  });

  it("does not import or start rrweb from configureTracking without replay config or an analytics key", async () => {
    installBrowser();
    const { configureTracking } = await import("./analytics.js");

    configureTracking({});
    await tick();

    expect(recordMock).not.toHaveBeenCalled();
  });

  it("starts signed-in replay by default when first-party analytics is configured", async () => {
    const { fetchMock } = installBrowser("https://app.agent-native.com/inbox", {
      email: "dev@example.com",
      userId: "auth-user-1",
      name: "Dev User",
      orgId: "org_123",
    });
    vi.stubEnv("VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY", "anpk_test");
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    vi.resetModules();
    const { configureTracking, stopSessionReplay } =
      await import("./analytics.js");

    configureTracking({});
    await waitForAssertion(() => expect(recordOptions).toBeDefined());

    recordOptions.emit({ type: 3, data: { href: "/inbox" } });
    await stopSessionReplay();
    await waitForAssertion(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes("/api/analytics/replay"),
        ),
      ).toBe(true),
    );

    const replayCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/api/analytics/replay"),
    );
    expect(replayCalls).toHaveLength(1);
    expect(replayCalls[0][0]).toBe(
      "https://analytics.agent-native.com/api/analytics/replay",
    );
    const body = await parseReplayUpload(replayCalls[0][1] as RequestInit);
    expect(body).toMatchObject({
      publicKey: "anpk_test",
      userId: "dev@example.com",
      userEmail: "dev@example.com",
      properties: {
        userId: "dev@example.com",
        userEmail: "dev@example.com",
        userName: "Dev User",
        orgId: "org_123",
      },
    });
  });

  it("lets explicit sessionReplay false override replay env vars", async () => {
    installBrowser();
    vi.stubEnv("VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY", "anpk_test");
    vi.stubEnv("VITE_AGENT_NATIVE_SESSION_REPLAY_ENABLED", "true");
    const { configureTracking } = await import("./analytics.js");

    configureTracking({ sessionReplay: false });
    await tick();

    expect(recordMock).not.toHaveBeenCalled();
  });

  it("does not start auth-required replay for anonymous sessions", async () => {
    const { fetchMock } = installBrowser("https://app.agent-native.com/inbox", {
      error: "not authenticated",
    });
    vi.resetModules();
    const { configureTracking } = await import("./analytics.js");

    configureTracking({
      key: "anpk_configured",
      endpoint: "https://analytics.example.test/api/analytics/track",
      sessionReplay: { enabled: true, requireSignedInUser: true },
    });
    await tick();

    expect(recordMock).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("/api/analytics/replay"),
      ),
    ).toBe(false);
  });

  it("does not start auth-required replay without a session email", async () => {
    installBrowser("https://app.agent-native.com/inbox", {
      userId: "auth-user-1",
      name: "Dev User",
      orgId: "org_123",
    });
    vi.resetModules();
    const { configureTracking } = await import("./analytics.js");

    configureTracking({
      key: "anpk_configured",
      endpoint: "https://analytics.example.test/api/analytics/track",
      sessionReplay: { enabled: true, sampleRate: 1 },
    });
    await tick();

    expect(recordMock).not.toHaveBeenCalled();
  });

  it("starts auth-required replay after browser identity is provided", async () => {
    const { fetchMock } = installBrowser("https://app.agent-native.com/inbox", {
      error: "not authenticated",
    });
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    vi.resetModules();
    const { configureTracking, setSentryUser, stopSessionReplay } =
      await import("./analytics.js");

    configureTracking({
      key: "anpk_configured",
      endpoint: "https://analytics.example.test/api/analytics/track",
      sessionReplay: { enabled: true, requireSignedInUser: true },
    });
    await tick();

    expect(recordOptions).toBeUndefined();
    setSentryUser(
      {
        email: "dev@example.com",
        id: "auth-user-1",
        username: "Dev User",
      },
      "org_123",
    );
    await waitForAssertion(() => expect(recordOptions).toBeDefined());

    recordOptions.emit({ type: 3, data: { href: "/inbox" } });
    await stopSessionReplay();
    await waitForAssertion(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          String(url).includes("/api/analytics/replay"),
        ),
      ).toHaveLength(1),
    );

    const replayCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/api/analytics/replay"),
    );
    const [, init] = replayCalls[0] as [string, RequestInit];
    const body = await parseReplayUpload(init);
    expect(body).toMatchObject({
      userId: "dev@example.com",
      userEmail: "dev@example.com",
      properties: {
        userId: "dev@example.com",
        userEmail: "dev@example.com",
        userName: "Dev User",
        orgId: "org_123",
      },
    });
  });

  it("starts rrweb with privacy defaults and uploads scrubbed replay batches", async () => {
    const { fetchMock } = installBrowser(
      "https://app.agent-native.com/inbox?code=secret&keep=1",
    );
    let recordOptions: any;
    const stop = vi.fn();
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return stop;
    });
    const { startSessionReplay, stopSessionReplay } =
      await freshSessionReplay();

    const result = await startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "https://analytics.example.test/session-replay",
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
      extraProperties: { route: "/inbox?token=private" },
    });

    expect(result).toMatchObject({ started: true, sampled: true });
    expect(recordOptions).toMatchObject({
      blockSelector: expect.stringContaining("[data-an-private]"),
      maskTextClass: "an-mask",
      maskTextSelector: "[data-an-mask]",
      maskAllInputs: true,
      recordCanvas: false,
      recordCrossOriginIframes: false,
      collectFonts: false,
      inlineImages: false,
      inlineStylesheet: true,
      sampling: {
        mousemove: 50,
        mouseInteraction: true,
        scroll: 100,
        media: 800,
        input: "last",
      },
    });

    const eventTimestamp = Date.now() + 2_500;
    recordOptions.emit({
      type: 3,
      timestamp: eventTimestamp,
      data: {
        href: "https://app.agent-native.com/path?token=secret&ok=1",
        source: "/oauth/callback?code=private",
      },
    });
    await tick();

    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://analytics.example.test/session-replay");
    expect(url).not.toContain("anpk_test");
    expect(headerValue(init.headers, "content-type")).toBe(
      "text/plain;charset=UTF-8",
    );
    expect(init.keepalive).toBe(true);
    expect(headerValue(init.headers, "content-encoding")).toBeUndefined();
    expect(
      headerValue(init.headers, "x-agent-native-analytics-key"),
    ).toBeUndefined();
    const body = await parseReplayUpload(init);
    expect(body).toMatchObject({
      publicKey: "anpk_test",
      type: "session_replay",
      reason: "max-events",
      sequence: 0,
      eventCount: 1,
      startedAt: expect.any(String),
      endedAt: new Date(eventTimestamp).toISOString(),
      durationMs: expect.any(Number),
      url: "https://app.agent-native.com/inbox?code=%3Credacted%3E&keep=1",
      properties: { route: "/inbox?token=%3Credacted%3E" },
    });
    expect(Date.parse(body.startedAt)).toBeLessThanOrEqual(
      Date.parse(body.endedAt),
    );
    expect(body.events[0].data.href).toBe(
      "https://app.agent-native.com/path?token=%3Credacted%3E&ok=1",
    );
    expect(body.events[0].data.source).toBe(
      "/oauth/callback?code=%3Credacted%3E",
    );

    stopSessionReplay();
    expect(stop).toHaveBeenCalled();
  });

  it("does not force keepalive for oversized cross-origin replay batches", async () => {
    const { fetchMock } = installBrowser("https://app.agent-native.com/inbox");
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const { startSessionReplay } = await freshSessionReplay();

    await startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "https://analytics.example.test/session-replay",
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
    });
    recordOptions.emit({
      type: 3,
      data: { href: "/inbox", text: "x".repeat(70_000) },
    });
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(headerValue(init.headers, "content-type")).toBe(
      "text/plain;charset=UTF-8",
    );
    expect(init.keepalive).toBe(false);
    expect(headerValue(init.headers, "content-encoding")).toBeUndefined();
    expect(
      headerValue(init.headers, "x-agent-native-analytics-key"),
    ).toBeUndefined();
  });

  it("keeps gzip uploads for same-origin replay collectors", async () => {
    const { fetchMock } = installBrowser("https://app.agent-native.com/inbox");
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const { startSessionReplay } = await freshSessionReplay();

    await startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "/api/analytics/replay",
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
    });
    recordOptions.emit({ type: 3, data: { href: "/inbox" } });
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/analytics/replay");
    expect(headerValue(init.headers, "content-type")).toBe(
      "application/octet-stream",
    );
    expect(headerValue(init.headers, "content-encoding")).toBe("gzip");
    expect(headerValue(init.headers, "x-agent-native-analytics-key")).toBe(
      "anpk_test",
    );
    const body = await parseReplayUpload(init);
    expect(body).toMatchObject({
      publicKey: "anpk_test",
      type: "session_replay",
      eventCount: 1,
    });
    expect(body.events[0].data.href).toBe("/inbox");
  });

  it("deduplicates concurrent replay startup attempts", async () => {
    installBrowser("https://app.agent-native.com/inbox");
    const stop = vi.fn();
    const recordOptions: any[] = [];
    recordMock.mockImplementation((options) => {
      recordOptions.push(options);
      return stop;
    });
    const { startSessionReplay, stopSessionReplay } =
      await freshSessionReplay();
    const options = {
      publicKey: "anpk_test",
      endpoint: "https://analytics.example.test/session-replay",
      flushIntervalMs: 100_000,
    };

    const [first, second] = await Promise.all([
      startSessionReplay(options),
      startSessionReplay(options),
    ]);

    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordOptions).toHaveLength(1);
    expect(first).toMatchObject({ started: true, sampled: true });
    expect(second).toMatchObject({
      started: true,
      sampled: true,
      replayId: first.replayId,
      sessionId: first.sessionId,
    });

    stopSessionReplay();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("falls back to raw fetch uploads when gzip is unavailable", async () => {
    const { fetchMock } = installBrowser("https://app.agent-native.com/inbox");
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { sendBeacon });
    vi.stubGlobal("CompressionStream", undefined);
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const { startSessionReplay } = await freshSessionReplay();

    await startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "https://analytics.example.test/session-replay",
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
    });
    recordOptions.emit({ type: 3, data: { href: "/inbox" } });
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(sendBeacon).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://analytics.example.test/session-replay");
    expect(headerValue(init.headers, "content-type")).toBe(
      "text/plain;charset=UTF-8",
    );
    expect(init.keepalive).toBe(true);
    expect(headerValue(init.headers, "content-encoding")).toBeUndefined();
    const body = await parseReplayUpload(init);
    expect(body.events[0].data.href).toBe("/inbox");
  });

  it("does not use keepalive for large replay uploads", async () => {
    const { fetchMock } = installBrowser("https://app.agent-native.com/inbox");
    const sendBeacon = vi.fn(() => false);
    vi.stubGlobal("navigator", { sendBeacon });
    vi.stubGlobal("CompressionStream", undefined);
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const { startSessionReplay } = await freshSessionReplay();

    await startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "https://analytics.example.test/session-replay",
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
    });
    recordOptions.emit({
      type: 2,
      data: {
        node: {
          type: 2,
          tagName: "html",
          childNodes: [{ type: 3, textContent: "x".repeat(70 * 1024) }],
        },
      },
    });
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(init.keepalive).toBe(false);
    const body = await parseReplayUpload(init);
    expect(body.events[0].type).toBe(2);
  });

  it("flushes full snapshots immediately even below the normal batch byte cap", async () => {
    const { fetchMock } = installBrowser("https://app.agent-native.com/inbox");
    vi.stubGlobal("CompressionStream", undefined);
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const { startSessionReplay } = await freshSessionReplay();

    await startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "https://analytics.example.test/session-replay",
      maxBatchBytes: 256 * 1024,
      maxEventsPerBatch: 50,
      flushIntervalMs: 100_000,
    });
    recordOptions.emit({
      type: 2,
      data: {
        node: {
          type: 2,
          tagName: "html",
          childNodes: [{ type: 3, textContent: "x".repeat(70 * 1024) }],
        },
      },
    });
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const body = await parseReplayUpload(
      fetchMock.mock.calls[0][1] as RequestInit,
    );
    expect(body.reason).toBe("full-snapshot");
    expect(body.events.map((event: any) => event.type)).toEqual([2]);
  });

  it("flushes oversized snapshots queued behind an active upload", async () => {
    const { fetchMock } = installBrowser("https://app.agent-native.com/inbox");
    vi.stubGlobal("CompressionStream", undefined);
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const { startSessionReplay } = await freshSessionReplay();

    await startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "/api/analytics/replay",
      maxBatchBytes: 1024,
      maxEventsPerBatch: 50,
      flushIntervalMs: 100_000,
    });
    recordOptions.emit({ type: 4, data: { href: "/inbox" } });
    recordOptions.emit({
      type: 2,
      data: {
        node: {
          type: 2,
          tagName: "html",
          childNodes: [{ type: 3, textContent: "x".repeat(70 * 1024) }],
        },
      },
    });
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const bodies = await Promise.all(
      fetchMock.mock.calls.map(([, init]) =>
        parseReplayUpload(init as RequestInit),
      ),
    );
    expect(bodies.map((body) => body.sequence)).toEqual([0, 1]);
    expect(bodies[0].events.map((event: any) => event.type)).toEqual([4]);
    expect(bodies[1].events.map((event: any) => event.type)).toEqual([2]);
  });

  it("retries failed batches without merging newly queued events", async () => {
    const { fetchMock } = installBrowser("https://app.agent-native.com/inbox");
    vi.stubGlobal("CompressionStream", undefined);
    const firstUpload = deferred<Response>();
    let uploadCalls = 0;
    fetchMock.mockImplementation((input: unknown) => {
      if (String(input).includes("/_agent-native/auth/session")) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "not authenticated" }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      uploadCalls += 1;
      return uploadCalls === 1
        ? firstUpload.promise
        : Promise.resolve(new Response("{}"));
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const { startSessionReplay, flushSessionReplay } =
      await freshSessionReplay();

    await startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "/api/analytics/replay",
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
    });
    recordOptions.emit({ type: 3, data: { href: "/first" } });
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    recordOptions.emit({ type: 3, data: { href: "/second" } });

    firstUpload.resolve(new Response("nope", { status: 500 }));
    await tick();
    await flushSessionReplay("retry");
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await flushSessionReplay("manual");
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const bodies = await Promise.all(
      fetchMock.mock.calls.map(([, init]) =>
        parseReplayUpload(init as RequestInit),
      ),
    );
    expect(bodies.map((body) => body.sequence)).toEqual([0, 0, 1]);
    expect(bodies[1].events.map((event: any) => event.data.href)).toEqual([
      "/first",
    ]);
    expect(bodies[2].events.map((event: any) => event.data.href)).toEqual([
      "/second",
    ]);
    expect(warn).toHaveBeenCalledWith(
      "[session-replay] upload failed",
      expect.any(Error),
    );
  });

  it("does not retry failed batches on every newly queued event", async () => {
    const { fetchMock } = installBrowser("https://app.agent-native.com/inbox");
    vi.stubGlobal("CompressionStream", undefined);
    fetchMock
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockResolvedValue(new Response("{}"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const { startSessionReplay, flushSessionReplay } =
      await freshSessionReplay();

    await startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "https://analytics.example.test/session-replay",
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
    });
    recordOptions.emit({ type: 3, data: { href: "/first" } });
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await tick();

    recordOptions.emit({ type: 3, data: { href: "/second" } });
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await flushSessionReplay("interval");
    await waitForAssertion(() =>
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    const bodies = await Promise.all(
      fetchMock.mock.calls.map(([, init]) =>
        parseReplayUpload(init as RequestInit),
      ),
    );
    expect(bodies.map((body) => body.sequence)).toEqual([0, 0, 1]);
    expect(bodies[1].events.map((event: any) => event.data.href)).toEqual([
      "/first",
    ]);
    expect(bodies[2].events.map((event: any) => event.data.href)).toEqual([
      "/second",
    ]);
    expect(warn).toHaveBeenCalledWith(
      "[session-replay] upload failed",
      expect.any(Error),
    );
  });

  it("reserves the next sequence before unload keepalive uploads", async () => {
    const { fetchMock, storage } = installBrowser(
      "https://app.agent-native.com/inbox",
    );
    vi.stubGlobal("CompressionStream", undefined);
    const upload = deferred<Response>();
    fetchMock.mockImplementation((input: unknown) => {
      if (String(input).includes("/_agent-native/auth/session")) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "not authenticated" }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return upload.promise;
    });
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const { startSessionReplay, flushSessionReplay } =
      await freshSessionReplay();

    await startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "https://analytics.example.test/session-replay",
      maxEventsPerBatch: 50,
      flushIntervalMs: 100_000,
    });
    recordOptions.emit({ type: 3, data: { href: "/leaving" } });
    const flush = flushSessionReplay("pagehide");
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.keepalive).toBe(true);
    expect(
      JSON.parse(storage.get("agent-native.session_replay_id") ?? "{}")
        .sequence,
    ).toBe(1);

    upload.resolve(new Response("{}"));
    await flush;
  });

  it("reserves the next sequence before visibility-hidden keepalive uploads", async () => {
    const { fetchMock, storage } = installBrowser(
      "https://app.agent-native.com/inbox",
    );
    vi.stubGlobal("CompressionStream", undefined);
    const upload = deferred<Response>();
    fetchMock.mockImplementation((input: unknown) => {
      if (String(input).includes("/_agent-native/auth/session")) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "not authenticated" }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return upload.promise;
    });
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const { startSessionReplay, flushSessionReplay } =
      await freshSessionReplay();

    await startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "https://analytics.example.test/session-replay",
      maxEventsPerBatch: 50,
      flushIntervalMs: 100_000,
    });
    recordOptions.emit({ type: 3, data: { href: "/hidden" } });
    const flush = flushSessionReplay("visibility-hidden");
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.keepalive).toBe(true);
    expect(
      JSON.parse(storage.get("agent-native.session_replay_id") ?? "{}")
        .sequence,
    ).toBe(1);

    upload.resolve(new Response("{}"));
    await flush;
  });

  it("rolls back and retries failed unload keepalive reservations", async () => {
    const { fetchMock, storage } = installBrowser(
      "https://app.agent-native.com/inbox",
    );
    vi.stubGlobal("CompressionStream", undefined);
    fetchMock
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockResolvedValue(new Response("{}"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const { startSessionReplay, flushSessionReplay } =
      await freshSessionReplay();

    await startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "https://analytics.example.test/session-replay",
      maxEventsPerBatch: 50,
      flushIntervalMs: 100_000,
    });
    recordOptions.emit({ type: 3, data: { href: "/bfcache" } });
    await flushSessionReplay("pagehide");
    expect(
      JSON.parse(storage.get("agent-native.session_replay_id") ?? "{}")
        .sequence,
    ).toBe(0);

    await flushSessionReplay("retry");
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const bodies = await Promise.all(
      fetchMock.mock.calls.map(([, init]) =>
        parseReplayUpload(init as RequestInit),
      ),
    );
    expect(bodies.map((body) => body.sequence)).toEqual([0, 0]);
    expect(bodies[1].events.map((event: any) => event.data.href)).toEqual([
      "/bfcache",
    ]);
    expect(
      JSON.parse(storage.get("agent-native.session_replay_id") ?? "{}")
        .sequence,
    ).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      "[session-replay] upload failed",
      expect.any(Error),
    );
  });

  it("passes custom rrweb event sampling through to the recorder", async () => {
    installBrowser("https://app.agent-native.com/inbox");
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const { startSessionReplay, stopSessionReplay } =
      await freshSessionReplay();

    const sampling = { mousemove: false, scroll: 250, input: "last" };
    await startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "https://analytics.example.test/session-replay",
      eventSampling: sampling,
    });

    expect(recordOptions.sampling).toBe(sampling);
    stopSessionReplay();
  });

  it("continues replay sequence across reloads for the same replay id", async () => {
    const { fetchMock } = installBrowser("https://app.agent-native.com/inbox", {
      email: "dev@example.com",
      userId: "auth-user-1",
      name: "Dev User",
      orgId: "org_123",
    });
    const recordOptions: any[] = [];
    recordMock.mockImplementation((options) => {
      recordOptions.push(options);
      return vi.fn();
    });
    const endpoint = "https://analytics.example.test/session-replay";
    const first = await freshSessionReplay();

    await first.startSessionReplay({
      publicKey: "anpk_test",
      endpoint,
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
    });
    recordOptions[0].emit({ type: 3, data: { href: "/first" } });
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    first.stopSessionReplay();
    await tick();

    delete (globalThis as any)[replayStateKey];
    const second = await freshSessionReplay();
    await second.startSessionReplay({
      publicKey: "anpk_test",
      endpoint,
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
    });
    recordOptions[1].emit({ type: 3, data: { href: "/second" } });
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    second.stopSessionReplay();

    const bodies = await Promise.all(
      fetchMock.mock.calls.map(([, init]) =>
        parseReplayUpload(init as RequestInit),
      ),
    );
    expect(bodies.map((body) => body.sequence)).toEqual([0, 1]);
    expect(new Set(bodies.map((body) => body.replayId)).size).toBe(1);
  });

  it("retries failed replay uploads without advancing the sequence", async () => {
    const { fetchMock, storage } = installBrowser(
      "https://app.agent-native.com/inbox",
    );
    fetchMock
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockResolvedValue(new Response("{}"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const { startSessionReplay, flushSessionReplay } =
      await freshSessionReplay();

    await startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "/api/analytics/replay",
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
    });
    recordOptions.emit({ type: 3, data: { href: "/first" } });
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await flushSessionReplay("retry");
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    recordOptions.emit({ type: 3, data: { href: "/second" } });
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const bodies = await Promise.all(
      fetchMock.mock.calls.map(([, init]) =>
        parseReplayUpload(init as RequestInit),
      ),
    );
    expect(bodies.map((body) => body.sequence)).toEqual([0, 0, 1]);
    expect(bodies[1].events[0].data.href).toBe("/first");
    expect(bodies[2].events[0].data.href).toBe("/second");
    expect(
      JSON.parse(storage.get("agent-native.session_replay_id") ?? "{}")
        .sequence,
    ).toBe(2);
    expect(warn).toHaveBeenCalledWith(
      "[session-replay] upload failed",
      expect.any(Error),
    );
  });

  it("blocks disallowed URLs before importing the recorder", async () => {
    installBrowser("https://app.agent-native.com/settings/billing");
    const { startSessionReplay } = await freshSessionReplay();

    const result = await startSessionReplay({
      publicKey: "anpk_test",
      blockUrls: ["/settings/billing"],
    });

    expect(result).toMatchObject({ started: false, reason: "url-blocked" });
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("derives the replay endpoint from the first-party analytics endpoint env", async () => {
    const { fetchMock } = installBrowser("https://app.agent-native.com/inbox");
    vi.stubEnv("VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY", "anpk_test");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_ANALYTICS_ENDPOINT",
      "https://analytics.example.test/api/analytics/track",
    );
    vi.stubEnv("VITE_AGENT_NATIVE_SESSION_REPLAY_SAMPLE_RATE", "1");
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const { startSessionReplay, stopSessionReplay } =
      await freshSessionReplay();

    await startSessionReplay();
    recordOptions.emit({ type: 3, data: { href: "/inbox" } });
    stopSessionReplay();
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://analytics.example.test/api/analytics/replay",
    );
  });

  it("derives replay defaults from configureTracking key and endpoint", async () => {
    const { fetchMock } = installBrowser("https://app.agent-native.com/inbox", {
      email: "dev@example.com",
      userId: "auth-user-1",
      name: "Dev User",
      orgId: "org_123",
    });
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    vi.resetModules();
    const { configureTracking, stopSessionReplay } =
      await import("./analytics.js");

    configureTracking({
      key: "anpk_configured",
      endpoint: "https://analytics.example.test/api/analytics/track",
      sessionReplay: { enabled: true, sampleRate: 1 },
    });
    await waitForAssertion(() => expect(recordOptions).toBeDefined());

    recordOptions.emit({ type: 3, data: { href: "/inbox" } });
    await stopSessionReplay();
    await waitForAssertion(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          String(url).includes("/api/analytics/replay"),
        ),
      ).toHaveLength(1),
    );

    const replayCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/api/analytics/replay"),
    );
    expect(replayCalls).toHaveLength(1);
    const [url, init] = replayCalls[0] as [string, RequestInit];
    expect(url).toBe("https://analytics.example.test/api/analytics/replay");
    expect(headerValue(init.headers, "content-type")).toBe(
      "text/plain;charset=UTF-8",
    );
    expect(
      headerValue(init.headers, "x-agent-native-analytics-key"),
    ).toBeUndefined();
  });

  it("applies configureTracking default props to replay metadata", async () => {
    const { fetchMock } = installBrowser("https://app.agent-native.com/inbox", {
      email: "dev@example.com",
      userId: "auth-user-1",
      name: "Dev User",
      orgId: "org_123",
    });
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    vi.resetModules();
    const { configureTracking, stopSessionReplay } =
      await import("./analytics.js");

    configureTracking({
      key: "anpk_configured",
      endpoint: "https://analytics.example.test/api/analytics/track",
      getDefaultProps: (_name, properties) => ({
        ...properties,
        app: "agent-native-test",
        userId: "user_123",
      }),
      sessionReplay: { enabled: true, sampleRate: 1 },
    });
    await waitForAssertion(() => expect(recordOptions).toBeDefined());

    recordOptions.emit({ type: 3, data: { href: "/inbox" } });
    await stopSessionReplay();
    await waitForAssertion(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          String(url).includes("/api/analytics/replay"),
        ),
      ).toHaveLength(1),
    );

    const replayCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/api/analytics/replay"),
    );
    expect(replayCalls).toHaveLength(1);
    const [, init] = replayCalls[0] as [string, RequestInit];
    const body = await parseReplayUpload(init);
    expect(body.userId).toBe("dev@example.com");
    expect(body.properties).toMatchObject({
      app: "agent-native-test",
      userId: "user_123",
      userEmail: "dev@example.com",
    });
  });

  it("attaches signed-in session identity to replay metadata", async () => {
    const { fetchMock } = installBrowser("https://app.agent-native.com/inbox", {
      email: "dev@example.com",
      userId: "auth-user-1",
      name: "Dev User",
      orgId: "org_123",
    });
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    vi.resetModules();
    const { configureTracking, stopSessionReplay } =
      await import("./analytics.js");

    configureTracking({
      key: "anpk_configured",
      endpoint: "https://analytics.example.test/api/analytics/track",
      getDefaultProps: (_name, properties) => ({
        ...properties,
        app: "agent-native-clips",
      }),
      sessionReplay: {
        enabled: true,
        requireSignedInUser: true,
        sampleRate: 1,
      },
    });
    await waitForAssertion(() => expect(recordOptions).toBeDefined());

    recordOptions.emit({ type: 3, data: { href: "/inbox" } });
    await stopSessionReplay();
    await waitForAssertion(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          String(url).includes("/api/analytics/replay"),
        ),
      ).toHaveLength(1),
    );

    const replayCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/api/analytics/replay"),
    );
    expect(replayCalls).toHaveLength(1);
    const [, init] = replayCalls[0] as [string, RequestInit];
    const body = await parseReplayUpload(init);
    expect(body.userId).toBe("dev@example.com");
    expect(body.properties).toMatchObject({
      app: "agent-native-clips",
      userId: "dev@example.com",
      userEmail: "dev@example.com",
      userName: "Dev User",
      orgId: "org_123",
    });
  });

  it("flushes queued auth-required replay events when auth is cleared", async () => {
    const { fetchMock } = installBrowser("https://app.agent-native.com/inbox", {
      email: "dev@example.com",
      userId: "auth-user-1",
      name: "Dev User",
      orgId: "org_123",
    });
    let recordOptions: any;
    const stop = vi.fn();
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return stop;
    });
    vi.resetModules();
    const { configureTracking, setSentryUser } = await import("./analytics.js");

    configureTracking({
      key: "anpk_configured",
      endpoint: "https://analytics.example.test/api/analytics/track",
      sessionReplay: {
        enabled: true,
        requireSignedInUser: true,
        sampleRate: 1,
        flushIntervalMs: 100_000,
      },
    });
    await waitForAssertion(() => expect(recordOptions).toBeDefined());

    recordOptions.emit({ type: 3, data: { href: "/inbox" } });
    setSentryUser(null);

    await waitForAssertion(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          String(url).includes("/api/analytics/replay"),
        ),
      ).toHaveLength(1),
    );

    expect(stop).toHaveBeenCalledTimes(1);
    const replayCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/api/analytics/replay"),
    );
    const [, init] = replayCalls[0] as [string, RequestInit];
    const body = await parseReplayUpload(init);
    expect(body).toMatchObject({
      userId: "dev@example.com",
      userEmail: "dev@example.com",
      reason: "auth-cleared",
      status: "completed",
      eventCount: 1,
      properties: {
        userId: "dev@example.com",
        userEmail: "dev@example.com",
        userName: "Dev User",
        orgId: "org_123",
      },
    });
    expect(body.events[0].data.href).toBe("/inbox");
  });

  it("uses deterministic per-session sampling", async () => {
    const { shouldSampleSessionReplay, getSessionReplaySamplingScore } =
      await freshSessionReplay();

    const score = getSessionReplaySamplingScore("session-1", "salt-a");
    expect(getSessionReplaySamplingScore("session-1", "salt-a")).toBe(score);
    expect(shouldSampleSessionReplay("session-1", 0, "salt-a")).toBe(false);
    expect(shouldSampleSessionReplay("session-1", 1, "salt-a")).toBe(true);
    expect(
      shouldSampleSessionReplay("session-1", score + 0.001, "salt-a"),
    ).toBe(true);
    expect(
      shouldSampleSessionReplay("session-1", score - 0.001, "salt-a"),
    ).toBe(false);
  });
});
