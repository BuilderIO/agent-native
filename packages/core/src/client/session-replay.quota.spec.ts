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

function installBrowser(url = "https://design.agent-native.com/editor") {
  const parsed = new URL(url);
  const sessionStorageMap = new Map<string, string>();
  const localStorageMap = new Map<string, string>();
  const location = {
    href: parsed.href,
    origin: parsed.origin,
    hostname: parsed.hostname,
    pathname: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
  };
  const storageStub = (map: Map<string, string>) => ({
    getItem: vi.fn((key: string) => map.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      map.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      map.delete(key);
    }),
  });
  const windowStub: Record<string, unknown> = {
    location,
    history: { pushState: vi.fn(), replaceState: vi.fn() },
    localStorage: storageStub(localStorageMap),
    sessionStorage: storageStub(sessionStorageMap),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  };
  windowStub.parent = windowStub;
  vi.stubGlobal("window", windowStub);
  vi.stubGlobal("document", {
    referrer: "",
    title: "Design",
    visibilityState: "visible",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    cookie: "",
  });
  vi.stubGlobal("navigator", { sendBeacon: vi.fn(() => false) });
  let idCounter = 0;
  vi.stubGlobal("crypto", {
    randomUUID: vi.fn(() => `00000000-0000-4000-8000-${++idCounter}`),
  });
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("CompressionStream", undefined);

  const uploads: RequestInit[] = [];
  let respond: (call: number) => Response = () => new Response("{}");
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    if (String(input).includes("/_agent-native/auth/session")) {
      return new Response(JSON.stringify({ error: "not authenticated" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    uploads.push(init ?? {});
    return respond(uploads.length);
  });
  vi.stubGlobal("fetch", fetchMock);

  return {
    uploads,
    setResponder(next: (call: number) => Response) {
      respond = next;
    },
  };
}

async function parseReplayUpload(init: RequestInit): Promise<any> {
  const body = init.body;
  const text =
    typeof body === "string" ? body : Buffer.from(body as any).toString("utf8");
  return JSON.parse(text);
}

function quotaExceeded(retryAfterSeconds?: number): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (retryAfterSeconds !== undefined) {
    headers["Retry-After"] = String(retryAfterSeconds);
  }
  return new Response(
    JSON.stringify({
      error: "Replay ingest byte quota exceeded for this public key",
    }),
    { status: 429, headers },
  );
}

async function freshSessionReplay() {
  vi.resetModules();
  return import("./session-replay.js");
}

describe("session replay ingest quota (HTTP 429)", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (globalThis as any)[replayStateKey];
    delete (globalThis as any)[pageviewStateKey];
  });

  it("stops re-sending the rejected batch instead of retry-storming", async () => {
    const browser = installBrowser();
    browser.setResponder(() => quotaExceeded(60));
    const onUploadRejected = vi.fn();
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
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
      onUploadRejected,
    });

    recordOptions.emit({ type: 2, data: { node: { type: 0 } } });
    await waitForAssertion(() => expect(browser.uploads).toHaveLength(1));
    expect(onUploadRejected).toHaveBeenCalledWith({
      status: 429,
      restartAttempted: false,
      restartSucceeded: false,
      failureReason: "quota_pause",
      retryAfterSeconds: 60,
    });

    // A Design canvas session keeps emitting while the key is over quota.
    for (let index = 0; index < 20; index += 1) {
      recordOptions.emit({ type: 3, data: { source: 1, index } });
      await flushSessionReplay("interval");
    }

    expect(browser.uploads).toHaveLength(1);
  });

  it("does not resume uploading for the rest of the over-quota session", async () => {
    const browser = installBrowser();
    browser.setResponder(() => quotaExceeded());
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
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
    });
    recordOptions.emit({ type: 2, data: { node: { type: 0 } } });
    await waitForAssertion(() => expect(browser.uploads).toHaveLength(1));

    // Even a high-priority unload flush must not reopen the firehose.
    recordOptions.emit({ type: 3, data: { source: 1 } });
    await flushSessionReplay("pagehide");
    await flushSessionReplay("beforeunload");

    expect(browser.uploads).toHaveLength(1);
  });

  it("stops the recorder when the server names no retry window", async () => {
    const browser = installBrowser();
    browser.setResponder(() => quotaExceeded());
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
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
    });
    recordOptions.emit({ type: 2, data: { node: { type: 0 } } });
    await waitForAssertion(() => expect(isSessionReplayActive()).toBe(false));
    expect(browser.uploads).toHaveLength(1);
  });

  it("stops the recorder when the retry window outlasts the session", async () => {
    const browser = installBrowser();
    browser.setResponder(() => quotaExceeded(24 * 60 * 60));
    const onUploadRejected = vi.fn();
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
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
      onUploadRejected,
    });
    recordOptions.emit({ type: 2, data: { node: { type: 0 } } });
    await waitForAssertion(() => expect(isSessionReplayActive()).toBe(false));
    expect(browser.uploads).toHaveLength(1);
    expect(onUploadRejected).toHaveBeenCalledWith({
      status: 429,
      restartAttempted: false,
      restartSucceeded: false,
      failureReason: "quota_stop",
      retryAfterSeconds: 24 * 60 * 60,
    });
  });

  it("pauses but keeps recording for a short rate-limit window", async () => {
    const browser = installBrowser();
    browser.setResponder(() => quotaExceeded(60));
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const { flushSessionReplay, isSessionReplayActive, startSessionReplay } =
      await freshSessionReplay();

    await startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "/api/analytics/replay",
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
    });
    recordOptions.emit({ type: 2, data: { node: { type: 0 } } });
    await waitForAssertion(() => expect(browser.uploads).toHaveLength(1));

    for (let index = 0; index < 20; index += 1) {
      recordOptions.emit({ type: 3, data: { source: 1, index } });
      await flushSessionReplay("interval");
    }

    expect(browser.uploads).toHaveLength(1);
    expect(isSessionReplayActive()).toBe(true);
  });

  it("keeps the key parked when the recorder restarts mid-session", async () => {
    const browser = installBrowser();
    browser.setResponder(() => quotaExceeded());
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const { isSessionReplayActive, startSessionReplay } =
      await freshSessionReplay();

    const options = {
      publicKey: "anpk_test",
      endpoint: "/api/analytics/replay",
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
    };
    await startSessionReplay(options);
    recordOptions.emit({ type: 2, data: { node: { type: 0 } } });
    await waitForAssertion(() => expect(isSessionReplayActive()).toBe(false));
    expect(browser.uploads).toHaveLength(1);

    // Agent chat events re-invoke replay startup on every phase change. The
    // key's daily budget did not come back just because we restarted.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await startSessionReplay(options);
      recordOptions.emit({ type: 2, data: { node: { type: 0 } } });
    }

    expect(browser.uploads).toHaveLength(1);
  });

  it("unparks when the recorder restarts against a different ingest key", async () => {
    const browser = installBrowser();
    browser.setResponder((call) =>
      call === 1 ? quotaExceeded() : new Response("{}"),
    );
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const { isSessionReplayActive, startSessionReplay } =
      await freshSessionReplay();

    await startSessionReplay({
      publicKey: "anpk_exhausted",
      endpoint: "/api/analytics/replay",
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
    });
    recordOptions.emit({ type: 2, data: { node: { type: 0 } } });
    await waitForAssertion(() => expect(isSessionReplayActive()).toBe(false));

    await startSessionReplay({
      publicKey: "anpk_fresh",
      endpoint: "/api/analytics/replay",
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
    });
    recordOptions.emit({ type: 2, data: { node: { type: 0 } } });

    await waitForAssertion(() => expect(browser.uploads).toHaveLength(2));
  });

  it("keeps Meta with the re-anchor snapshot so playback stays valid", async () => {
    const browser = installBrowser();
    browser.setResponder((call) =>
      call === 1 ? quotaExceeded(60) : new Response("{}"),
    );
    let recordOptions: any;
    (recordMock as any).takeFullSnapshot = vi.fn(() => {
      // rrweb emits Meta immediately before the FullSnapshot; the resumed
      // upload is useless to the player without the viewport dimensions.
      recordOptions.emit({
        type: 4,
        data: { href: "/editor", width: 1440, height: 900 },
      });
      recordOptions.emit({ type: 2, data: { node: { type: 0 } } });
    });
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const { flushSessionReplay, startSessionReplay } =
      await freshSessionReplay();

    const nowSpy = vi.spyOn(Date, "now");
    const base = Date.now();
    nowSpy.mockReturnValue(base);

    await startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "/api/analytics/replay",
      maxEventsPerBatch: 50,
      flushIntervalMs: 100_000,
    });
    recordOptions.emit({
      type: 4,
      data: { href: "/editor", width: 1440, height: 900 },
    });
    recordOptions.emit({ type: 2, data: { node: { type: 0 } } });
    await waitForAssertion(() => expect(browser.uploads).toHaveLength(1));

    nowSpy.mockReturnValue(base + 61_000);
    await flushSessionReplay("interval");
    await waitForAssertion(() =>
      expect(browser.uploads.length).toBeGreaterThan(2),
    );

    // FullSnapshots are deliberately isolated into their own batch, so Meta
    // and the snapshot arrive as consecutive chunks rather than one upload.
    // What matters is that the resumed stream still opens with Meta.
    const resumed = await Promise.all(
      browser.uploads.slice(1).map(parseReplayUpload),
    );
    const resumedTypes = resumed.flatMap((body: any) =>
      body.events.map((event: any) => event.type),
    );
    expect(resumedTypes.slice(0, 2)).toEqual([4, 2]);
    nowSpy.mockRestore();
  });

  it("does not park a new key when an old key's upload 429s late", async () => {
    const browser = installBrowser();
    let release!: (r: Response) => void;
    const hanging = new Promise<Response>((r) => {
      release = r;
    });
    browser.setResponder((call) =>
      call === 1 ? (hanging as any) : new Response("{}"),
    );
    let recordOptions: any;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const { flushSessionReplay, startSessionReplay, stopSessionReplay } =
      await freshSessionReplay();

    await startSessionReplay({
      publicKey: "anpk_old",
      endpoint: "/api/analytics/replay",
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
    });
    recordOptions.emit({ type: 2, data: { node: { type: 0 } } });
    await waitForAssertion(() => expect(browser.uploads).toHaveLength(1));

    // Teardown does not await the in-flight upload before a concurrent start
    // swaps state.options to a different ingest key.
    void stopSessionReplay("manual");
    await startSessionReplay({
      publicKey: "anpk_new",
      endpoint: "/api/analytics/replay",
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
    });

    release(
      new Response(JSON.stringify({ error: "quota" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await new Promise((r) => setTimeout(r, 20));

    recordOptions.emit({ type: 2, data: { node: { type: 0 } } });
    await flushSessionReplay("interval");

    await waitForAssertion(() =>
      expect(browser.uploads.length).toBeGreaterThan(1),
    );
    const latest = await parseReplayUpload(
      browser.uploads[browser.uploads.length - 1],
    );
    expect(latest.publicKey).toBe("anpk_new");
  });

  it("resumes with a fresh snapshot once the pause elapses", async () => {
    const browser = installBrowser();
    browser.setResponder((call) =>
      call === 1 ? quotaExceeded(60) : new Response("{}"),
    );
    let recordOptions: any;
    const takeFullSnapshot = vi.fn(() => {
      recordOptions.emit({ type: 2, data: { node: { type: 0 } } });
    });
    (recordMock as any).takeFullSnapshot = takeFullSnapshot;
    recordMock.mockImplementation((options) => {
      recordOptions = options;
      return vi.fn();
    });
    const { flushSessionReplay, startSessionReplay } =
      await freshSessionReplay();

    const nowSpy = vi.spyOn(Date, "now");
    const base = Date.now();
    nowSpy.mockReturnValue(base);

    await startSessionReplay({
      publicKey: "anpk_test",
      endpoint: "/api/analytics/replay",
      maxEventsPerBatch: 1,
      flushIntervalMs: 100_000,
    });
    recordOptions.emit({ type: 2, data: { node: { type: 0 } } });
    await waitForAssertion(() => expect(browser.uploads).toHaveLength(1));

    // Events emitted during the pause are dropped, not queued.
    recordOptions.emit({ type: 3, data: { source: 1 } });
    await flushSessionReplay("interval");
    expect(browser.uploads).toHaveLength(1);

    nowSpy.mockReturnValue(base + 61_000);
    await flushSessionReplay("interval");

    expect(takeFullSnapshot).toHaveBeenCalled();
    await waitForAssertion(() => expect(browser.uploads).toHaveLength(2));
    nowSpy.mockRestore();
  });
});
