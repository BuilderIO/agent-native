import { gunzipSync } from "node:zlib";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_REPLAY_IFRAME_ATTRIBUTE,
  SESSION_REPLAY_IFRAME_PROBE,
  SESSION_REPLAY_IFRAME_START,
  SESSION_REPLAY_IFRAME_STOP,
} from "../session-replay-iframe-protocol.js";

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

// The channel name the duplicated-tab claim guard uses internally
// (SESSION_REPLAY_BROADCAST_CHANNEL_NAME in session-replay.ts). Not
// exported -- kept in sync here rather than widening the module's public
// surface just for a test.
const REPLAY_BROADCAST_CHANNEL_NAME = "agent-native-session-replay";

/**
 * A minimal same-process BroadcastChannel stand-in: instances constructed
 * with the same name and returned by the same factory call can message each
 * other (never themselves), same as the real API. Each test gets its own
 * isolated "network" by calling the factory fresh.
 */
function createFakeBroadcastChannelClass() {
  const registry = new Map<string, Set<InstanceType<typeof FakeChannel>>>();
  class FakeChannel {
    name: string;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    closed = false;
    constructor(name: string) {
      this.name = name;
      const peers = registry.get(name) ?? new Set();
      peers.add(this);
      registry.set(name, peers);
    }
    postMessage(data: unknown) {
      if (this.closed) return;
      for (const peer of registry.get(this.name) ?? []) {
        if (peer === this || peer.closed) continue;
        queueMicrotask(() => peer.onmessage?.({ data }));
      }
    }
    close() {
      this.closed = true;
      registry.get(this.name)?.delete(this);
    }
  }
  return FakeChannel;
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
  const localStorageMap = new Map<string, string>();
  const sessionStorageMap = new Map<string, string>();
  const location = {
    href: parsed.href,
    origin: parsed.origin,
    hostname: parsed.hostname,
    pathname: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
  };
  const windowListeners = new Map<string, Set<(event?: unknown) => void>>();
  const documentListeners = new Map<string, Set<() => void>>();
  const addWindowListener = (
    event: string,
    listener: (event?: unknown) => void,
  ) => {
    const set = windowListeners.get(event) ?? new Set();
    set.add(listener);
    windowListeners.set(event, set);
  };
  const removeWindowListener = (
    event: string,
    listener: (event?: unknown) => void,
  ) => {
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
    getItem: vi.fn((key: string) => localStorageMap.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      localStorageMap.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      localStorageMap.delete(key);
    }),
  };
  const sessionStorage = {
    getItem: vi.fn((key: string) => sessionStorageMap.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      sessionStorageMap.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      sessionStorageMap.delete(key);
    }),
  };
  const windowStub: Record<string, unknown> = {
    location,
    history,
    localStorage,
    sessionStorage,
    gtag: vi.fn(),
    addEventListener: vi.fn(addWindowListener),
    removeEventListener: vi.fn(removeWindowListener),
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  };
  // A real top-level browsing context exposes itself as window.parent.
  windowStub.parent = windowStub;
  vi.stubGlobal("window", windowStub);
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
  // Node exposes a real global BroadcastChannel, which would otherwise make
  // every resumed-session start wait out the duplicated-tab claim timeout
  // for no reason in tests that don't care about it. Tests exercising that
  // guard stub their own BroadcastChannel back in.
  vi.stubGlobal("BroadcastChannel", undefined);
  const fetchMock = vi.fn(async (input: unknown) => {
    if (String(input).includes("/_agent-native/auth/session")) {
      return new Response(JSON.stringify(session), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}");
  });
  vi.stubGlobal("fetch", fetchMock);
  // `storage` is the sessionStorage-backed map -- the replay session record
  // (replayId + sequence) is per-tab and lives there. `localStorage` is
  // exposed separately for tests asserting the legacy key gets cleared.
  return {
    fetchMock,
    history,
    location,
    storage: sessionStorageMap,
    localStorage: localStorageMap,
    windowStub,
    fireWindowEvent(event: string, payload?: unknown) {
      for (const listener of windowListeners.get(event) ?? []) {
        listener(payload);
      }
    },
  };
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

  it("cancels deferred replay startup when navigation enters a private route", async () => {
    const { history } = installBrowser("https://plan.agent-native.com/plans", {
      error: "not authenticated",
    });
    const authResponse = deferred<Response>();
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes("/_agent-native/auth/session")) {
        return authResponse.promise;
      }
      return new Response("{}");
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { configureTracking } = await import("./analytics.js");

    configureTracking({
      key: "anpk_configured",
      endpoint: "https://analytics.example.test/api/analytics/track",
      contentCaptureForPath: (pathname) =>
        !pathname.startsWith("/local-plans/"),
      sessionReplay: { enabled: true, requireSignedInUser: true },
    });
    history.pushState({}, "", "/local-plans/local#bridge=private-token");
    authResponse.resolve(
      new Response(
        JSON.stringify({ email: "dev@example.com", userId: "user-1" }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    await tick();
    await tick();

    expect(recordMock).not.toHaveBeenCalled();
  });

  it("does not retry auth-required replay while content capture is disabled", async () => {
    const { history } = installBrowser("https://plan.agent-native.com/plans", {
      error: "not authenticated",
    });
    vi.resetModules();
    const { configureTracking, setSentryUser } = await import("./analytics.js");

    configureTracking({
      key: "anpk_configured",
      endpoint: "https://analytics.example.test/api/analytics/track",
      contentCaptureForPath: (pathname) =>
        !pathname.startsWith("/local-plans/"),
      sessionReplay: { enabled: true, requireSignedInUser: true },
    });
    await tick();
    history.pushState({}, "", "/local-plans/local#bridge=private-token");
    setSentryUser({ email: "dev@example.com", id: "user-1" });
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
      recordCrossOriginIframes: true,
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

  it("keeps local emission enabled when the app is embedded by a nonparticipating host", async () => {
    const { windowStub } = installBrowser();
    windowStub.parent = {};
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const { startSessionReplay, stopSessionReplay } =
      await freshSessionReplay();

    await startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "https://analytics.example.test/session-replay",
    });

    expect(recordOptions.recordCrossOriginIframes).toBe(false);
    await stopSessionReplay();
  });

  it("honors explicit cross-origin iframe overrides in top-level and embedded apps", async () => {
    const { windowStub } = installBrowser();
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const replay = await freshSessionReplay();

    await replay.startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "https://analytics.example.test/session-replay",
      recordCrossOriginIframes: false,
      blockSelector: ".custom-private-zone",
    });
    expect(recordOptions.recordCrossOriginIframes).toBe(false);
    expect(recordOptions.blockSelector).toContain(".custom-private-zone");
    expect(recordOptions.blockSelector).toContain(
      `iframe[${SESSION_REPLAY_IFRAME_ATTRIBUTE}]`,
    );
    await replay.stopSessionReplay();

    windowStub.parent = {};
    await replay.startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "https://analytics.example.test/session-replay",
      recordCrossOriginIframes: true,
    });
    expect(recordOptions.recordCrossOriginIframes).toBe(true);
    await replay.stopSessionReplay();
  });

  it("starts and stops only marked direct cooperative iframe recorders", async () => {
    const { fireWindowEvent } = installBrowser();
    const childWindow = { postMessage: vi.fn() };
    const unmarkedWindow = { postMessage: vi.fn() };
    const markedIframe = {
      contentWindow: childWindow,
      hasAttribute: (name: string) => name === SESSION_REPLAY_IFRAME_ATTRIBUTE,
    } as unknown as HTMLIFrameElement;
    (
      document as unknown as { querySelectorAll: ReturnType<typeof vi.fn> }
    ).querySelectorAll = vi.fn(() => [markedIframe]);
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const replay = await freshSessionReplay();

    await replay.startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "https://analytics.example.test/session-replay",
    });

    expect(recordOptions.recordCrossOriginIframes).toBe(true);
    expect(childWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: SESSION_REPLAY_IFRAME_START,
        options: expect.objectContaining({
          blockSelector: expect.stringContaining("[data-an-private]"),
          maskAllInputs: true,
          maskInputOptions: expect.objectContaining({
            email: true,
            password: true,
          }),
          sampling: expect.objectContaining({ scroll: 100 }),
        }),
      }),
      "*",
    );

    childWindow.postMessage.mockClear();
    fireWindowEvent("message", {
      data: { type: SESSION_REPLAY_IFRAME_PROBE },
      source: unmarkedWindow,
    });
    expect(unmarkedWindow.postMessage).not.toHaveBeenCalled();
    expect(childWindow.postMessage).not.toHaveBeenCalled();

    fireWindowEvent("message", {
      data: { type: SESSION_REPLAY_IFRAME_PROBE },
      source: childWindow,
    });
    expect(childWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: SESSION_REPLAY_IFRAME_START }),
      "*",
    );

    await replay.stopSessionReplay();
    expect(childWindow.postMessage).toHaveBeenLastCalledWith(
      { type: SESSION_REPLAY_IFRAME_STOP },
      "*",
    );
    childWindow.postMessage.mockClear();
    fireWindowEvent("message", {
      data: { type: SESSION_REPLAY_IFRAME_PROBE },
      source: childWindow,
    });
    expect(childWindow.postMessage).not.toHaveBeenCalled();
  });

  it("preserves signed DOM resources without leaking navigation secrets", async () => {
    const { fetchMock } = installBrowser();
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const { flushSessionReplay, startSessionReplay } =
      await freshSessionReplay();
    await startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "https://analytics.example.test/session-replay",
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
    });

    recordOptions.emit({
      type: 2,
      timestamp: Date.now(),
      data: {
        node: {
          type: 0,
          childNodes: [
            {
              type: 2,
              id: 12,
              tagName: "link",
              attributes: {
                rel: "stylesheet",
                href: "https://cdn.example.test/app.css?token=signed-style",
                _cssText:
                  '@import "https://fonts.example.test/css?family=Inter&token=signed-font";',
              },
            },
            {
              type: 2,
              id: 14,
              tagName: "img",
              attributes: {
                src: "https://cdn.example.test/hero.png?token=signed-image",
                srcset:
                  "https://cdn.example.test/hero-2x.png?token=signed-image-2x 2x",
              },
            },
            {
              type: 2,
              id: 13,
              tagName: "a",
              attributes: {
                href: "/oauth/callback?p=private&token=secret&keep=1",
              },
            },
            {
              type: 2,
              id: 15,
              tagName: "script",
              attributes: {
                src: "https://app.example.test/runtime.js?token=script-secret",
              },
            },
            {
              type: 2,
              id: 16,
              tagName: "iframe",
              attributes: {
                src: "https://app.example.test/embed?token=frame-secret",
              },
            },
            {
              type: 2,
              id: 17,
              tagName: "object",
              attributes: {
                data: "https://app.example.test/file?token=object-secret",
              },
            },
            {
              type: 2,
              id: 18,
              tagName: "video",
              attributes: {
                src: "https://cdn.example.test/demo.mp4?token=signed-video",
                poster:
                  "https://cdn.example.test/poster.png?token=signed-poster",
              },
            },
            {
              type: 2,
              id: 19,
              tagName: "link",
              attributes: {
                rel: "preload",
                as: "font",
                href: "https://cdn.example.test/inter.woff2?token=signed-font",
              },
            },
            {
              type: 2,
              id: 20,
              tagName: "link",
              attributes: {
                rel: "modulepreload",
                href: "https://app.example.test/chunk.js?token=module-secret",
              },
            },
          ],
        },
      },
    });
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [
      stylesheet,
      image,
      anchor,
      script,
      iframe,
      object,
      video,
      fontPreload,
      modulePreload,
    ] = (await parseReplayUpload(init)).events[0].data.node.childNodes;
    expect(stylesheet.attributes).toEqual({
      rel: "stylesheet",
      href: "https://cdn.example.test/app.css?token=signed-style",
      _cssText:
        '@import "https://fonts.example.test/css?family=Inter&token=signed-font";',
    });
    expect(image.attributes).toEqual({
      src: "https://cdn.example.test/hero.png?token=signed-image",
      srcset: "https://cdn.example.test/hero-2x.png?token=signed-image-2x 2x",
    });
    expect(anchor.attributes.href).toBe(
      "/oauth/callback?p=%3Credacted%3E&token=%3Credacted%3E&keep=1",
    );
    expect(script.attributes.src).toBe(
      "https://app.example.test/runtime.js?token=%3Credacted%3E",
    );
    expect(iframe.attributes.src).toBe(
      "https://app.example.test/embed?token=%3Credacted%3E",
    );
    expect(object.attributes.data).toBe(
      "https://app.example.test/file?token=%3Credacted%3E",
    );
    expect(video.attributes).toMatchObject({
      src: "https://cdn.example.test/demo.mp4?token=signed-video",
      poster: "https://cdn.example.test/poster.png?token=signed-poster",
    });
    expect(fontPreload.attributes.href).toBe(
      "https://cdn.example.test/inter.woff2?token=signed-font",
    );
    expect(modulePreload.attributes.href).toBe(
      "https://app.example.test/chunk.js?token=%3Credacted%3E",
    );

    recordOptions.emit({
      type: 3,
      timestamp: Date.now() + 1,
      data: {
        source: 0,
        attributes: [
          {
            id: 12,
            attributes: {
              href: "https://cdn.example.test/app.css?token=rotated-signature",
            },
          },
          {
            id: 13,
            attributes: { href: "/next?p=private&token=secret" },
          },
          {
            id: 14,
            attributes: {
              src: "https://cdn.example.test/next.png?token=rotated-image",
            },
          },
          {
            id: 15,
            attributes: {
              src: "https://app.example.test/next.js?token=rotated-script",
            },
          },
          {
            id: 16,
            attributes: {
              src: "https://app.example.test/next?token=rotated-frame",
            },
          },
          {
            id: 17,
            attributes: {
              data: "https://app.example.test/next-file?token=rotated-object",
            },
          },
          {
            id: 18,
            attributes: {
              poster:
                "https://cdn.example.test/next-poster.png?token=rotated-poster",
            },
          },
          {
            id: 19,
            attributes: {
              href: "https://cdn.example.test/inter.woff2?token=rotated-font",
            },
          },
          {
            id: 12,
            attributes: {
              rel: "modulepreload",
              href: "https://app.example.test/next.js?token=changed-to-script",
            },
          },
        ],
      },
    });
    await flushSessionReplay("test");
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const [, mutationInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const [
      stylesheetMutation,
      anchorMutation,
      imageMutation,
      scriptMutation,
      iframeMutation,
      objectMutation,
      videoMutation,
      fontMutation,
      changedLinkMutation,
    ] = (await parseReplayUpload(mutationInit)).events[0].data.attributes;
    expect(stylesheetMutation.attributes.href).toBe(
      "https://cdn.example.test/app.css?token=rotated-signature",
    );
    expect(anchorMutation.attributes.href).toBe(
      "/next?p=%3Credacted%3E&token=%3Credacted%3E",
    );
    expect(imageMutation.attributes.src).toBe(
      "https://cdn.example.test/next.png?token=rotated-image",
    );
    expect(scriptMutation.attributes.src).toBe(
      "https://app.example.test/next.js?token=%3Credacted%3E",
    );
    expect(iframeMutation.attributes.src).toBe(
      "https://app.example.test/next?token=%3Credacted%3E",
    );
    expect(objectMutation.attributes.data).toBe(
      "https://app.example.test/next-file?token=%3Credacted%3E",
    );
    expect(videoMutation.attributes.poster).toBe(
      "https://cdn.example.test/next-poster.png?token=rotated-poster",
    );
    expect(fontMutation.attributes.href).toBe(
      "https://cdn.example.test/inter.woff2?token=rotated-font",
    );
    expect(changedLinkMutation.attributes.href).toBe(
      "https://app.example.test/next.js?token=%3Credacted%3E",
    );
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

  it("keeps an in-flight backlog within the UTF-8 byte cap and in FIFO order", async () => {
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
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const { flushSessionReplay, startSessionReplay } =
      await freshSessionReplay();

    await startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "/api/analytics/replay",
      maxBatchBytes: 1024,
      maxEventsPerBatch: 50,
      flushIntervalMs: 100_000,
    });
    recordOptions.emit({ type: 2, data: { node: { type: 0 } } });
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    for (let index = 1; index <= 4; index += 1) {
      // Each serialized event is below 1 KiB in UTF-16 code units but above
      // half the cap in UTF-8, so no two may share a bounded upload.
      recordOptions.emit({
        type: 3,
        data: { href: `/event-${index}`, text: "é".repeat(350) },
      });
    }
    firstUpload.resolve(new Response("{}"));
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await flushSessionReplay("manual");
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(5));

    const bodies = await Promise.all(
      fetchMock.mock.calls.map(([, init]) =>
        parseReplayUpload(init as RequestInit),
      ),
    );
    expect(bodies.map((body) => body.sequence)).toEqual([0, 1, 2, 3, 4]);
    expect(bodies.slice(1).map((body) => body.events.length)).toEqual([
      1, 1, 1, 1,
    ]);
    for (const body of bodies.slice(1)) {
      expect(
        Buffer.byteLength(JSON.stringify(body.events[0]), "utf8"),
      ).toBeLessThanOrEqual(1024);
    }
    expect(bodies.slice(1).map((body) => body.events[0].data.href)).toEqual([
      "/event-1",
      "/event-2",
      "/event-3",
      "/event-4",
    ]);
  });

  it("bisects a 413 batch and retries both halves without duplicates", async () => {
    const { fetchMock, storage } = installBrowser(
      "https://app.agent-native.com/inbox",
    );
    vi.stubGlobal("CompressionStream", undefined);
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
      return Promise.resolve(
        uploadCalls === 1
          ? new Response("too large", { status: 413 })
          : new Response("{}"),
      );
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const { isSessionReplayActive, startSessionReplay } =
      await freshSessionReplay();

    await startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "/api/analytics/replay",
      maxEventsPerBatch: 4,
      flushIntervalMs: 100_000,
    });
    for (let index = 1; index <= 4; index += 1) {
      recordOptions.emit({ type: 3, data: { href: `/event-${index}` } });
    }
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const bodies = await Promise.all(
      fetchMock.mock.calls.map(([, init]) =>
        parseReplayUpload(init as RequestInit),
      ),
    );
    expect(bodies.map((body) => body.sequence)).toEqual([0, 0, 1]);
    expect(
      bodies.map((body) => body.events.map((event: any) => event.data.href)),
    ).toEqual([
      ["/event-1", "/event-2", "/event-3", "/event-4"],
      ["/event-1", "/event-2"],
      ["/event-3", "/event-4"],
    ]);
    expect(
      JSON.parse(storage.get("agent-native.session_replay_id") ?? "{}")
        .sequence,
    ).toBe(2);
    expect(isSessionReplayActive()).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      "[session-replay] splitting oversized upload (HTTP 413)",
      expect.any(Error),
    );
  });

  it("drops only an unsplittable 413 event and continues later retry halves", async () => {
    const { fetchMock, storage } = installBrowser(
      "https://app.agent-native.com/inbox",
    );
    vi.stubGlobal("CompressionStream", undefined);
    let uploadCalls = 0;
    fetchMock.mockImplementation(() => {
      uploadCalls += 1;
      return Promise.resolve(
        uploadCalls <= 3
          ? new Response("too large", { status: 413 })
          : new Response("{}"),
      );
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onUploadRejected = vi.fn();
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const replay = await freshSessionReplay();

    const started = await replay.startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "/api/analytics/replay",
      maxEventsPerBatch: 4,
      flushIntervalMs: 100_000,
      onUploadRejected,
    });
    for (let index = 1; index <= 4; index += 1) {
      recordOptions.emit({ type: 3, data: { href: `/event-${index}` } });
    }
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(5));

    const bodies = await Promise.all(
      fetchMock.mock.calls.map(([, init]) =>
        parseReplayUpload(init as RequestInit),
      ),
    );
    expect(bodies.map((body) => body.sequence)).toEqual([0, 0, 0, 0, 1]);
    expect(
      bodies.map((body) => body.events.map((event: any) => event.data.href)),
    ).toEqual([
      ["/event-1", "/event-2", "/event-3", "/event-4"],
      ["/event-1", "/event-2"],
      ["/event-1"],
      ["/event-2"],
      ["/event-3", "/event-4"],
    ]);
    expect(
      JSON.parse(storage.get("agent-native.session_replay_id") ?? "{}")
        .sequence,
    ).toBe(2);
    expect(replay.isSessionReplayActive()).toBe(true);
    expect(replay.getSessionReplayId()).toBe(started.replayId);
    expect(onUploadRejected).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "[session-replay] dropping oversized replay event (HTTP 413)",
      expect.any(Error),
    );
  });

  it("quarantines DOM-dependent events after an oversized snapshot until the next snapshot", async () => {
    const { fetchMock } = installBrowser("https://app.agent-native.com/inbox");
    vi.stubGlobal("CompressionStream", undefined);
    fetchMock
      .mockResolvedValueOnce(new Response("too large", { status: 413 }))
      .mockResolvedValue(new Response("{}"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const replay = await freshSessionReplay();

    await replay.startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "/api/analytics/replay",
      flushIntervalMs: 100_000,
    });
    recordOptions.emit({
      type: 2,
      data: { node: { type: 0, id: "oversized-root" } },
    });
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await tick();

    recordOptions.emit({
      type: 3,
      data: { source: 0, adds: [{ parentId: 1, node: { id: 2 } }] },
    });
    recordOptions.emit({ type: 5, data: { tag: "unsafe-tail" } });
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    recordOptions.emit({
      type: 2,
      data: { node: { type: 0, id: "replacement-root" } },
    });
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const recovered = await parseReplayUpload(
      fetchMock.mock.calls[1][1] as RequestInit,
    );
    expect(recovered.sequence).toBe(0);
    expect(recovered.events).toEqual([
      { type: 2, data: { node: { type: 0, id: "replacement-root" } } },
    ]);
    expect(replay.isSessionReplayActive()).toBe(true);
  });

  it.each(["pagehide", "manual", "max-duration"] as const)(
    "preserves the final %s reason and unload reservation through a 413 split",
    async (reason) => {
      const { fetchMock, storage } = installBrowser(
        "https://app.agent-native.com/inbox",
      );
      vi.stubGlobal("CompressionStream", undefined);
      let uploadCalls = 0;
      const sequenceAtRequest: number[] = [];
      fetchMock.mockImplementation((input: unknown) => {
        if (String(input).includes("/_agent-native/auth/session")) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: "not authenticated" }), {
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        sequenceAtRequest.push(
          JSON.parse(storage.get("agent-native.session_replay_id") ?? "{}")
            .sequence ?? 0,
        );
        uploadCalls += 1;
        return Promise.resolve(
          uploadCalls === 1
            ? new Response("too large", { status: 413 })
            : new Response("{}"),
        );
      });
      vi.spyOn(console, "warn").mockImplementation(() => {});
      let recordOptions: any;
      recordMock.mockImplementation((options) => {
        recordOptions = options;
        return vi.fn();
      });
      const replay = await freshSessionReplay();

      await replay.startSessionReplay({
        publicKey: "anpk_test",
        endpoint: "/api/analytics/replay",
        maxEventsPerBatch: 10,
        flushIntervalMs: 100_000,
      });
      for (let index = 1; index <= 4; index += 1) {
        recordOptions.emit({ type: 3, data: { href: `/event-${index}` } });
      }

      if (reason === "pagehide") {
        await replay.flushSessionReplay(reason);
      } else {
        await replay.stopSessionReplay(reason);
      }
      expect(fetchMock).toHaveBeenCalledTimes(3);

      const bodies = await Promise.all(
        fetchMock.mock.calls.map(([, init]) =>
          parseReplayUpload(init as RequestInit),
        ),
      );
      expect(bodies.map((body) => body.sequence)).toEqual([0, 0, 1]);
      expect(bodies.map((body) => body.reason)).toEqual([
        reason,
        reason,
        reason,
      ]);
      expect(bodies.map((body) => body.status)).toEqual([
        "completed",
        "completed",
        "completed",
      ]);
      expect(fetchMock.mock.calls.map(([, init]) => init?.keepalive)).toEqual([
        true,
        true,
        true,
      ]);
      if (reason === "pagehide") {
        // The rejected reservation rolls back to zero; each accepted half then
        // reserves the sequence again before its keepalive request begins.
        expect(sequenceAtRequest).toEqual([1, 1, 2]);
      }
      expect(
        JSON.parse(storage.get("agent-native.session_replay_id") ?? "{}")
          .sequence,
      ).toBe(2);
    },
  );

  it.each([
    { reason: "manual", stop: true },
    { reason: "pagehide", stop: false },
  ] as const)(
    "drains a small $reason tail requested during an active upload",
    async ({ reason, stop }) => {
      const { fetchMock } = installBrowser(
        "https://app.agent-native.com/inbox",
      );
      vi.stubGlobal("CompressionStream", undefined);
      const firstUpload = deferred<Response>();
      fetchMock
        .mockImplementationOnce(() => firstUpload.promise)
        .mockResolvedValue(new Response("{}"));
      let recordOptions: any;
      recordMock.mockImplementation((options) => {
        recordOptions = options;
        return vi.fn();
      });
      const replay = await freshSessionReplay();

      await replay.startSessionReplay({
        publicKey: "anpk_test",
        endpoint: "/api/analytics/replay",
        maxEventsPerBatch: 1,
        flushIntervalMs: 100_000,
      });
      recordOptions.emit({ type: 3, data: { href: "/in-flight" } });
      await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      recordOptions.emit({ type: 3, data: { href: "/final-tail" } });

      let settled = false;
      const finalFlush = (
        stop
          ? replay.stopSessionReplay(reason)
          : replay.flushSessionReplay(reason)
      ).then(() => {
        settled = true;
      });
      await tick();
      expect(settled).toBe(false);

      firstUpload.resolve(new Response("{}"));
      await finalFlush;
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const bodies = await Promise.all(
        fetchMock.mock.calls.map(([, init]) =>
          parseReplayUpload(init as RequestInit),
        ),
      );
      expect(bodies.map((body) => body.reason)).toEqual(["max-events", reason]);
      expect(bodies.map((body) => body.status)).toEqual([
        "active",
        "completed",
      ]);
      expect(bodies[1].events[0].data.href).toBe("/final-tail");

      if (!stop) await replay.stopSessionReplay();
    },
  );

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
      maxEventsPerBatch: 10,
      flushIntervalMs: 100_000,
    });
    recordOptions.emit({ type: 3, data: { href: "/first" } });
    const firstFlush = flushSessionReplay("max-events");
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    recordOptions.emit({ type: 3, data: { href: "/second" } });

    firstUpload.resolve(new Response("nope", { status: 500 }));
    await firstFlush;
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

  it("keeps replay identity per tab and clears the legacy shared record", async () => {
    const { localStorage, storage } = installBrowser();
    localStorage.set(
      "agent-native.session_replay_id",
      JSON.stringify({
        sessionId: "legacy-session",
        replayId: "legacy-shared-replay",
        startedAtMs: 1,
        sequence: 12,
      }),
    );
    recordMock.mockReturnValue(vi.fn());
    const { startSessionReplay } = await freshSessionReplay();

    const result = await startSessionReplay({ publicKey: "anpk_test" });

    expect(result.replayId).not.toBe("legacy-shared-replay");
    expect(localStorage.has("agent-native.session_replay_id")).toBe(false);
    expect(
      JSON.parse(storage.get("agent-native.session_replay_id") ?? "{}")
        .replayId,
    ).toBe(result.replayId);
  });

  it("restarts once with a fresh replay identity after a definitive 409 conflict", async () => {
    const { fetchMock, storage, localStorage } = installBrowser();
    localStorage.set("agent-native.session_id", "sample-in");
    localStorage.set("agent-native.session_last_activity", String(Date.now()));
    vi.stubGlobal("CompressionStream", undefined);
    const conflictResponse = deferred<Response>();
    fetchMock
      .mockImplementationOnce(() => conflictResponse.promise)
      .mockResolvedValue(new Response("{}"));
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const recordOptions: any[] = [];
    recordMock.mockImplementation((options) => {
      recordOptions.push(options);
      const stop = vi.fn();
      stops.push(stop);
      return stop;
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onUploadRejected = vi.fn();
    const replay = await freshSessionReplay();
    const first = await replay.startSessionReplay({
      publicKey: "anpk_test",
      sampleRate: 0.5,
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
      console: { maxEvents: 7 },
      network: {
        maxEvents: 9,
        captureErrorBodies: false,
        maxErrorBodyLength: 123,
      },
      onUploadRejected,
    });
    const initialNormalizedOptions = (globalThis as any)[replayStateKey]
      .options;

    recordOptions[0].emit({ type: 3, data: { href: "/conflicting" } });
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const rejectedUpload = await parseReplayUpload(
      fetchMock.mock.calls[0][1] as RequestInit,
    );
    expect(rejectedUpload.sessionId).toBe("sample-in");

    // Simulate the analytics session rotating while the rejected upload is in
    // flight. This id scores above 0.5, but conflict recovery must preserve the
    // original recording's accepted sampling decision and session id.
    localStorage.set("agent-native.session_id", "a");
    localStorage.set("agent-native.session_last_activity", String(Date.now()));
    conflictResponse.resolve(new Response("conflict", { status: 409 }));

    await waitForAssertion(() => expect(recordOptions).toHaveLength(2));
    await waitForAssertion(() => expect(onUploadRejected).toHaveBeenCalled());

    expect(replay.isSessionReplayActive()).toBe(true);
    expect(stops[0]).toHaveBeenCalledTimes(1);
    const recoveredState = (globalThis as any)[replayStateKey];
    expect(recoveredState.options).toBe(initialNormalizedOptions);
    expect(recoveredState.options.console).toMatchObject({ maxEvents: 7 });
    expect(recoveredState.options.network).toMatchObject({
      maxEvents: 9,
      captureErrorBodies: false,
      maxErrorBodyLength: 123,
    });
    const restarted = JSON.parse(
      storage.get("agent-native.session_replay_id") ?? "{}",
    );
    expect(restarted.replayId).not.toBe(first.replayId);
    expect(onUploadRejected).toHaveBeenCalledWith({
      status: 409,
      restartAttempted: true,
      restartSucceeded: true,
    });

    recordOptions[1].emit({ type: 3, data: { href: "/recovered" } });
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const recoveredUpload = await parseReplayUpload(
      fetchMock.mock.calls[1][1] as RequestInit,
    );
    expect(recoveredUpload.sessionId).toBe("a");
  });

  it("does not loop automatic restarts when every fresh identity receives 409", async () => {
    const { fetchMock, storage } = installBrowser();
    vi.stubGlobal("CompressionStream", undefined);
    fetchMock.mockResolvedValue(new Response("conflict", { status: 409 }));
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const recordOptions: any[] = [];
    recordMock.mockImplementation((options) => {
      recordOptions.push(options);
      const stop = vi.fn();
      stops.push(stop);
      return stop;
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const replay = await freshSessionReplay();
    await replay.startSessionReplay({
      publicKey: "anpk_test",
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
    });

    recordOptions[0].emit({ type: 3, data: { href: "/first-conflict" } });
    await waitForAssertion(() => expect(recordOptions).toHaveLength(2));
    recordOptions[1].emit({ type: 3, data: { href: "/second-conflict" } });
    await waitForAssertion(() =>
      expect(replay.isSessionReplayActive()).toBe(false),
    );

    expect(recordOptions).toHaveLength(2);
    expect(stops).toHaveLength(2);
    expect(stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
    expect(storage.has("agent-native.session_replay_id")).toBe(false);
  });

  it("allows a later caller-initiated recording episode to recover from one conflict", async () => {
    const { fetchMock } = installBrowser();
    vi.stubGlobal("CompressionStream", undefined);
    fetchMock.mockResolvedValue(new Response("conflict", { status: 409 }));
    const recordOptions: any[] = [];
    recordMock.mockImplementation((options) => {
      recordOptions.push(options);
      return vi.fn();
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const replay = await freshSessionReplay();
    await replay.startSessionReplay({
      publicKey: "anpk_test",
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
    });

    recordOptions[0].emit({ type: 3, data: { href: "/episode-one" } });
    await waitForAssertion(() => expect(recordOptions).toHaveLength(2));
    recordOptions[1].emit({ type: 3, data: { href: "/episode-one-retry" } });
    await waitForAssertion(() =>
      expect(replay.isSessionReplayActive()).toBe(false),
    );

    await replay.startSessionReplay({
      publicKey: "anpk_test",
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
    });
    recordOptions[2].emit({ type: 3, data: { href: "/episode-two" } });

    await waitForAssertion(() => expect(recordOptions).toHaveLength(4));
    expect(replay.isSessionReplayActive()).toBe(true);
    await replay.stopSessionReplay();
  });

  it.each([
    { label: "an explicit stop", action: "stop" as const },
    { label: "a pagehide final flush", action: "pagehide" as const },
  ])("does not restart after a 409 during $label", async ({ action }) => {
    const { fetchMock, storage } = installBrowser();
    vi.stubGlobal("CompressionStream", undefined);
    fetchMock.mockResolvedValue(new Response("conflict", { status: 409 }));
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const recordOptions: any[] = [];
    recordMock.mockImplementation((options) => {
      recordOptions.push(options);
      const stop = vi.fn();
      stops.push(stop);
      return stop;
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onUploadRejected = vi.fn();
    const replay = await freshSessionReplay();
    await replay.startSessionReplay({
      publicKey: "anpk_test",
      flushIntervalMs: 100_000,
      onUploadRejected,
    });

    recordOptions[0].emit({ type: 3, data: { href: "/final" } });
    if (action === "stop") {
      await replay.stopSessionReplay();
    } else {
      await replay.flushSessionReplay("pagehide");
    }

    expect(recordOptions).toHaveLength(1);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveBeenCalledTimes(1);
    expect(replay.isSessionReplayActive()).toBe(false);
    expect(storage.has("agent-native.session_replay_id")).toBe(false);
    expect(onUploadRejected).toHaveBeenCalledWith({
      status: 409,
      restartAttempted: false,
      restartSucceeded: false,
    });
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

  it("gives two tabs on the same analytics session different replayIds", async () => {
    const tab1 = installBrowser("https://app.agent-native.com/inbox");
    recordMock.mockImplementation(() => vi.fn());
    const first = await freshSessionReplay();
    const firstResult = await first.startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "https://analytics.example.test/session-replay",
      flushIntervalMs: 100_000,
    });
    expect(firstResult.started).toBe(true);
    await first.stopSessionReplay();

    // Simulate a second tab of the same browser session: same origin, same
    // localStorage-backed analytics sessionId (localStorage is shared by
    // every tab), but its own empty sessionStorage (never shared across
    // tabs) -- so it must mint its own replayId rather than resume tab1's.
    const sharedSessionId = tab1.localStorage.get("agent-native.session_id");
    const sharedLastActivity = tab1.localStorage.get(
      "agent-native.session_last_activity",
    );
    expect(sharedSessionId).toBeTruthy();

    delete (globalThis as any)[replayStateKey];
    const tab2 = installBrowser("https://app.agent-native.com/inbox");
    tab2.localStorage.set("agent-native.session_id", sharedSessionId!);
    tab2.localStorage.set(
      "agent-native.session_last_activity",
      sharedLastActivity!,
    );
    recordMock.mockImplementation(() => vi.fn());
    const second = await freshSessionReplay();
    const secondResult = await second.startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "https://analytics.example.test/session-replay",
      flushIntervalMs: 100_000,
    });

    expect(secondResult.started).toBe(true);
    expect(secondResult.sessionId).toBe(firstResult.sessionId);
    expect(secondResult.replayId).toBeTruthy();
    expect(secondResult.replayId).not.toBe(firstResult.replayId);
    await second.stopSessionReplay();
  });

  it("resumes the same replayId from sessionStorage after a simulated reload in the same tab", async () => {
    const { storage } = installBrowser("https://app.agent-native.com/inbox");
    recordMock.mockImplementation(() => vi.fn());
    const first = await freshSessionReplay();
    const firstResult = await first.startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "https://analytics.example.test/session-replay",
      flushIntervalMs: 100_000,
    });
    expect(firstResult.started).toBe(true);
    await first.stopSessionReplay();

    expect(
      JSON.parse(storage.get("agent-native.session_replay_id") ?? "{}")
        .replayId,
    ).toBe(firstResult.replayId);

    // Simulate a reload within the same tab: the module's in-memory state
    // resets, but window.sessionStorage (this test's installBrowser() mock,
    // never reset mid-test) persists exactly like a real tab's
    // sessionStorage does across a reload/navigation.
    delete (globalThis as any)[replayStateKey];
    const second = await freshSessionReplay();
    const secondResult = await second.startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "https://analytics.example.test/session-replay",
      flushIntervalMs: 100_000,
    });

    expect(secondResult.started).toBe(true);
    expect(secondResult.replayId).toBe(firstResult.replayId);
    await second.stopSessionReplay();
  });

  it("retries a transient 503 response", async () => {
    const { fetchMock } = installBrowser("https://app.agent-native.com/inbox");
    fetchMock
      .mockResolvedValueOnce(
        new Response("service unavailable", { status: 503 }),
      )
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
    recordOptions.emit({ type: 3, data: { href: "/transient" } });
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await tick();

    expect(warn).toHaveBeenCalledWith(
      "[session-replay] upload failed",
      expect.any(Error),
    );
    await flushSessionReplay("retry");
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, lastInit] = fetchMock.mock.calls[
      fetchMock.mock.calls.length - 1
    ] as [string, RequestInit];
    const lastBody = await parseReplayUpload(lastInit);
    expect(lastBody.events[0].data.href).toBe("/transient");
  });

  it.each([401, 403, 404])(
    "keeps recording and retries a transient HTTP %s response",
    async (status) => {
      const { fetchMock } = installBrowser(
        "https://app.agent-native.com/inbox",
      );
      fetchMock
        .mockResolvedValueOnce(
          new Response("temporarily unavailable", { status }),
        )
        .mockResolvedValue(new Response("{}"));
      vi.spyOn(console, "warn").mockImplementation(() => {});
      let recordOptions: any;
      recordMock.mockImplementation((options) => {
        recordOptions = options;
        return vi.fn();
      });
      const replay = await freshSessionReplay();
      await replay.startSessionReplay({
        publicKey: "anpk_test",
        endpoint: "https://analytics.example.test/session-replay",
        maxEventsPerBatch: 1,
        flushIntervalMs: 100_000,
      });

      recordOptions.emit({ type: 3, data: { href: `/transient-${status}` } });
      await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(replay.isSessionReplayActive()).toBe(true);

      await replay.flushSessionReplay("retry");
      await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const lastBody = await parseReplayUpload(
        fetchMock.mock.calls[1][1] as RequestInit,
      );
      expect(lastBody.events[0].data.href).toBe(`/transient-${status}`);
      await replay.stopSessionReplay();
    },
  );

  it.each([401, 403, 404])(
    "bounds persistent HTTP %s retries and stops the rejected episode",
    async (status) => {
      const { fetchMock } = installBrowser(
        "https://app.agent-native.com/inbox",
      );
      fetchMock.mockResolvedValue(
        new Response("still unavailable", { status }),
      );
      vi.spyOn(console, "warn").mockImplementation(() => {});
      let recordOptions: any;
      recordMock.mockImplementation((options) => {
        recordOptions = options;
        return vi.fn();
      });
      const replay = await freshSessionReplay();
      await replay.startSessionReplay({
        publicKey: "anpk_test",
        endpoint: "https://analytics.example.test/session-replay",
        maxEventsPerBatch: 1,
        flushIntervalMs: 100_000,
      });

      recordOptions.emit({ type: 3, data: { href: `/persistent-${status}` } });
      await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await replay.flushSessionReplay("retry");
      await replay.flushSessionReplay("retry");

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(replay.isSessionReplayActive()).toBe(false);
    },
  );

  it("mints a fresh replayId when a peer tab claims the resumed id over BroadcastChannel", async () => {
    const FakeBroadcastChannel = createFakeBroadcastChannelClass();
    const { storage } = installBrowser("https://app.agent-native.com/inbox");
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel as any);
    recordMock.mockImplementation(() => vi.fn());

    const first = await freshSessionReplay();
    const firstResult = await first.startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "https://analytics.example.test/session-replay",
      flushIntervalMs: 100_000,
    });
    expect(firstResult.started).toBe(true);
    await first.stopSessionReplay();
    const resumedReplayId = firstResult.replayId!;

    // A peer that still owns (and replies "taken" for) the resumed id --
    // e.g. the browser duplicated this tab, so both copies briefly share the
    // exact same sessionStorage snapshot and would otherwise both try to
    // resume the same replayId.
    const peer = new FakeBroadcastChannel(REPLAY_BROADCAST_CHANNEL_NAME);
    peer.onmessage = (event: { data: any }) => {
      if (
        event.data?.type === "an-replay-claim" &&
        event.data.replayId === resumedReplayId
      ) {
        peer.postMessage({
          type: "an-replay-claim-taken",
          replayId: event.data.replayId,
        });
      }
    };

    delete (globalThis as any)[replayStateKey];
    const second = await freshSessionReplay();
    const secondResult = await second.startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "https://analytics.example.test/session-replay",
      flushIntervalMs: 100_000,
    });

    expect(secondResult.started).toBe(true);
    expect(secondResult.replayId).toBeTruthy();
    expect(secondResult.replayId).not.toBe(resumedReplayId);
    expect(
      JSON.parse(storage.get("agent-native.session_replay_id") ?? "{}")
        .replayId,
    ).toBe(secondResult.replayId);
    await second.stopSessionReplay();
    peer.close();
  });

  it("arbitrates simultaneous duplicated-tab claims instead of letting both resume", async () => {
    const FakeBroadcastChannel = createFakeBroadcastChannelClass();
    installBrowser("https://app.agent-native.com/inbox");
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel as any);
    recordMock.mockImplementation(() => vi.fn());

    const first = await freshSessionReplay();
    const firstResult = await first.startSessionReplay({
      publicKey: "anpk_test",
      flushIntervalMs: 100_000,
    });
    await first.stopSessionReplay();

    const peer = new FakeBroadcastChannel(REPLAY_BROADCAST_CHANNEL_NAME);
    peer.onmessage = (event: { data: any }) => {
      if (event.data?.type !== "an-replay-claim") return;
      // Simulate another copied tab probing at the same time. Its lower nonce
      // wins deterministically, so this tab must abandon the shared id.
      peer.postMessage({
        type: "an-replay-claim",
        replayId: event.data.replayId,
        instanceNonce: "00000000-0000-4000-8000-0",
      });
    };

    delete (globalThis as any)[replayStateKey];
    const duplicate = await freshSessionReplay();
    const result = await duplicate.startSessionReplay({
      publicKey: "anpk_test",
      flushIntervalMs: 100_000,
    });

    expect(result.replayId).not.toBe(firstResult.replayId);
    await duplicate.stopSessionReplay();
    peer.close();
  });

  it("keeps the resumed replayId when no peer claims it within the claim timeout", async () => {
    vi.useFakeTimers();
    try {
      const FakeBroadcastChannel = createFakeBroadcastChannelClass();
      installBrowser("https://app.agent-native.com/inbox");
      vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel as any);
      recordMock.mockImplementation(() => vi.fn());

      const first = await freshSessionReplay();
      const firstResult = await first.startSessionReplay({
        publicKey: "anpk_test",
        endpoint: "https://analytics.example.test/session-replay",
        flushIntervalMs: 100_000,
      });
      expect(firstResult.started).toBe(true);
      await first.stopSessionReplay();

      // No peer is registered on the channel this time, so the claim goes
      // unanswered -- advance fake time past the ~150ms claim timeout.
      delete (globalThis as any)[replayStateKey];
      const second = await freshSessionReplay();
      const startPromise = second.startSessionReplay({
        publicKey: "anpk_test",
        endpoint: "https://analytics.example.test/session-replay",
        flushIntervalMs: 100_000,
      });
      await vi.advanceTimersByTimeAsync(500);
      const secondResult = await startPromise;

      expect(secondResult.started).toBe(true);
      expect(secondResult.replayId).toBe(firstResult.replayId);
      await second.stopSessionReplay();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a resumed recorder when stopped during the duplicate-tab probe", async () => {
    vi.useFakeTimers();
    try {
      const FakeBroadcastChannel = createFakeBroadcastChannelClass();
      installBrowser("https://app.agent-native.com/inbox");
      vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel as any);
      recordMock.mockImplementation(() => vi.fn());

      const first = await freshSessionReplay();
      await first.startSessionReplay({
        publicKey: "anpk_test",
        flushIntervalMs: 100_000,
      });
      await first.stopSessionReplay();
      recordMock.mockClear();

      delete (globalThis as any)[replayStateKey];
      const second = await freshSessionReplay();
      const startPromise = second.startSessionReplay({
        publicKey: "anpk_test",
        flushIntervalMs: 100_000,
      });
      await vi.advanceTimersByTimeAsync(1);
      await second.stopSessionReplay();
      await vi.advanceTimersByTimeAsync(500);

      await expect(startPromise).resolves.toMatchObject({
        started: false,
        reason: "disabled",
      });
      expect(recordMock).not.toHaveBeenCalled();
      expect(second.isSessionReplayActive()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
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
