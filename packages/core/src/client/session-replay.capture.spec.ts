import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_REPLAY_CONSOLE_EVENT_TAG,
  SESSION_REPLAY_NETWORK_EVENT_TAG,
} from "./session-replay.js";

const recordMock = vi.hoisted(() => {
  const record = vi.fn() as ReturnType<typeof vi.fn> & {
    addCustomEvent: ReturnType<typeof vi.fn>;
  };
  record.addCustomEvent = vi.fn();
  return record;
});
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

type WindowListener = (event: unknown) => void;

interface FakeXhr {
  status: number;
  responseType: string;
  responseText: string;
  response: unknown;
  addEventListener(event: string, listener: WindowListener): void;
  dispatch(event: string): void;
  open(method: string, url: string): void;
  send(body?: unknown): void;
}

/**
 * Fresh class per test so a leaked prototype patch (e.g. from a failed
 * assertion before stopSessionReplay ran) can never bleed across tests.
 */
function createFakeXhrClass(): new () => FakeXhr {
  return class FakeXMLHttpRequest implements FakeXhr {
    status = 0;
    responseType = "";
    responseText = "";
    response: unknown = undefined;
    private listeners = new Map<string, WindowListener[]>();

    addEventListener(event: string, listener: WindowListener): void {
      const list = this.listeners.get(event) ?? [];
      list.push(listener);
      this.listeners.set(event, list);
    }

    dispatch(event: string): void {
      for (const listener of this.listeners.get(event) ?? []) {
        listener({ type: event });
      }
    }

    open(_method: string, _url: string): void {}

    send(_body?: unknown): void {}
  };
}

function installBrowser(url = "https://app.agent-native.com/inbox") {
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
  const windowListeners = new Map<string, Set<WindowListener>>();
  const fetchMock = vi.fn(async (input: unknown) => {
    if (String(input).includes("/_agent-native/auth/session")) {
      return new Response(JSON.stringify({ error: "not authenticated" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}");
  });
  const windowStub: Record<string, unknown> = {
    location,
    history: { pushState: vi.fn(), replaceState: vi.fn() },
    localStorage: {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
    },
    addEventListener: vi.fn((event: string, listener: WindowListener) => {
      const set = windowListeners.get(event) ?? new Set();
      set.add(listener);
      windowListeners.set(event, set);
    }),
    removeEventListener: vi.fn((event: string, listener: WindowListener) => {
      windowListeners.get(event)?.delete(listener);
    }),
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    fetch: fetchMock,
  };
  vi.stubGlobal("window", windowStub);
  vi.stubGlobal("document", {
    referrer: "",
    title: "Inbox",
    visibilityState: "visible",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    cookie: "",
  });
  vi.stubGlobal("navigator", { sendBeacon: vi.fn(() => false) });
  const XhrCtor = createFakeXhrClass();
  vi.stubGlobal("XMLHttpRequest", XhrCtor);
  let idCounter = 0;
  vi.stubGlobal("crypto", {
    randomUUID: vi.fn(() => `00000000-0000-4000-8000-${++idCounter}`),
  });
  vi.stubGlobal("fetch", fetchMock);
  const fireWindowEvent = (event: string, payload: unknown) => {
    for (const listener of windowListeners.get(event) ?? new Set()) {
      listener(payload);
    }
  };
  return { fetchMock, windowStub, windowListeners, fireWindowEvent, XhrCtor };
}

let activeModule: Awaited<ReturnType<typeof freshSessionReplay>> | null = null;

async function freshSessionReplay() {
  vi.resetModules();
  return import("./session-replay.js");
}

function customEvents(tag: string): Record<string, unknown>[] {
  return recordMock.addCustomEvent.mock.calls
    .filter(([eventTag]) => eventTag === tag)
    .map(([, payload]) => payload as Record<string, unknown>);
}

const consoleEvents = () => customEvents(SESSION_REPLAY_CONSOLE_EVENT_TAG);
const networkEvents = () => customEvents(SESSION_REPLAY_NETWORK_EVENT_TAG);

const START_OPTIONS = {
  publicKey: "anpk_test",
  endpoint: "https://analytics.example.test/api/analytics/replay",
  flushIntervalMs: 100_000,
} as const;

async function startCapture(
  overrides: Record<string, unknown> = {},
): Promise<Awaited<ReturnType<typeof freshSessionReplay>>> {
  const mod = await freshSessionReplay();
  activeModule = mod;
  const result = await mod.startSessionReplay({
    ...START_OPTIONS,
    ...overrides,
  });
  expect(result.started).toBe(true);
  return mod;
}

describe("session replay console/network capture", () => {
  afterEach(async () => {
    // Restore interceptors even when a failed assertion skipped the in-test
    // stop, so wrappers never leak into the next test.
    try {
      await activeModule?.stopSessionReplay();
    } catch {
      // best-effort cleanup
    }
    activeModule = null;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (globalThis as Record<symbol, unknown>)[replayStateKey];
    delete (globalThis as Record<symbol, unknown>)[pageviewStateKey];
    recordMock.mockReset();
    recordMock.addCustomEvent.mockReset();
  });

  it("captures console methods with level mapping, source, and scrubbed url", async () => {
    installBrowser("https://app.agent-native.com/inbox?token=secret");
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    recordMock.mockReturnValue(vi.fn());
    await startCapture();

    console.info("info message");
    console.warn("warn message");
    console.error("error message");
    console.debug("debug message");

    const events = consoleEvents();
    expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({
      level: "info",
      source: "console",
      message: "info message",
      url: "https://app.agent-native.com/inbox?token=%3Credacted%3E",
    });
    expect(events[1]).toMatchObject({ level: "warn" });
    expect(events[2]).toMatchObject({ level: "error" });
    expect(events[3]).toMatchObject({ level: "debug" });
  });

  it("still invokes the original console method first", async () => {
    installBrowser();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    recordMock.mockReturnValue(vi.fn());
    await startCapture();

    console.log("hello", { a: 1 });

    expect(logSpy).toHaveBeenCalledWith("hello", { a: 1 });
    expect(consoleEvents()[0]).toMatchObject({
      message: "hello",
      args: ['{"a":1}'],
    });
  });

  it("serializes and truncates console args per the contract caps", async () => {
    installBrowser();
    vi.spyOn(console, "log").mockImplementation(() => {});
    recordMock.mockReturnValue(vi.fn());
    await startCapture();

    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    const error = new Error("kaboom");
    error.stack = `Error: kaboom\n${"at somewhere\n".repeat(400)}`;
    console.log(
      "x".repeat(600),
      "y".repeat(600),
      circular,
      error,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      "arg-eleven-dropped",
    );

    const [event] = consoleEvents();
    expect((event.message as string).length).toBe(500);
    const args = event.args as string[];
    expect(args).toHaveLength(10);
    expect(args[0].length).toBe(500);
    expect(args[1]).toContain('"self":"[circular]"');
    expect(args[2]).toBe("Error: kaboom");
    // args holds only the 10 values after the message; "8" and the final
    // string were dropped by the max-args cap.
    expect(args[9]).toBe("7");
    expect((event.stack as string).length).toBeLessThanOrEqual(2000);
  });

  it("redacts credential-looking tokens in console text", async () => {
    installBrowser();
    vi.spyOn(console, "log").mockImplementation(() => {});
    recordMock.mockReturnValue(vi.fn());
    await startCapture();

    console.log("request failed with apiKey=abc123 and Bearer aaa.bbb.ccc");

    expect(consoleEvents()[0].message).toBe(
      "request failed with apiKey=<redacted> and Bearer <redacted>",
    );
  });

  it("collapses consecutive duplicate messages into one repeat event", async () => {
    installBrowser();
    vi.spyOn(console, "log").mockImplementation(() => {});
    recordMock.mockReturnValue(vi.fn());
    await startCapture();

    console.log("same thing");
    console.log("same thing");
    console.log("same thing");
    console.log("different thing");

    const events = consoleEvents();
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ message: "same thing" });
    expect(events[0].repeat).toBeUndefined();
    expect(events[1]).toMatchObject({ message: "same thing", repeat: 2 });
    expect(events[2]).toMatchObject({ message: "different thing" });
  });

  it("flushes a pending duplicate when replay stops", async () => {
    installBrowser();
    vi.spyOn(console, "log").mockImplementation(() => {});
    recordMock.mockReturnValue(vi.fn());
    const mod = await startCapture();

    console.log("repeat me");
    console.log("repeat me");
    await mod.stopSessionReplay();

    const events = consoleEvents();
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ message: "repeat me", repeat: 1 });
  });

  it("stops console capture at the budget and emits one truncation notice", async () => {
    installBrowser();
    vi.spyOn(console, "log").mockImplementation(() => {});
    recordMock.mockReturnValue(vi.fn());
    await startCapture({ console: { maxEvents: 2 } });

    console.log("one");
    console.log("two");
    console.log("three");
    console.log("four");

    const events = consoleEvents();
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ message: "one" });
    expect(events[1]).toMatchObject({ message: "two" });
    expect(events[2]).toMatchObject({
      level: "warn",
      source: "console",
      message: "session replay console capture truncated",
      truncated: true,
    });
  });

  it("captures window error and unhandledrejection events", async () => {
    const { fireWindowEvent } = installBrowser();
    recordMock.mockReturnValue(vi.fn());
    await startCapture();

    const boom = new Error("boom");
    fireWindowEvent("error", { error: boom, message: "boom" });
    fireWindowEvent("unhandledrejection", { reason: new Error("nope") });
    fireWindowEvent("unhandledrejection", { reason: "plain reason" });

    const events = consoleEvents();
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      level: "error",
      source: "window-error",
      message: "Error: boom",
    });
    expect(typeof events[0].stack).toBe("string");
    expect(events[1]).toMatchObject({
      level: "error",
      source: "unhandledrejection",
      message: "Error: nope",
    });
    expect(events[2]).toMatchObject({
      level: "error",
      source: "unhandledrejection",
      message: "plain reason",
    });
  });

  it("captures successful fetch requests without touching the response", async () => {
    const { fetchMock, windowStub } = installBrowser();
    recordMock.mockReturnValue(vi.fn());
    const response = new Response("streamed body", { status: 201 });
    fetchMock.mockResolvedValueOnce(response);
    await startCapture();

    const wrappedFetch = windowStub.fetch as typeof fetch;
    expect(wrappedFetch).not.toBe(fetchMock);
    const result = await wrappedFetch("/api/things?token=zzz", {
      method: "post",
    });

    expect(result).toBe(response);
    expect(await result.text()).toBe("streamed body");
    const events = networkEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      api: "fetch",
      method: "POST",
      url: "https://app.agent-native.com/api/things?token=%3Credacted%3E",
      status: 201,
      ok: true,
    });
    expect(typeof events[0].durationMs).toBe("number");
  });

  it("captures network-level fetch failures and rethrows to the caller", async () => {
    const { fetchMock, windowStub } = installBrowser();
    recordMock.mockReturnValue(vi.fn());
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await startCapture();

    const wrappedFetch = windowStub.fetch as typeof fetch;
    await expect(wrappedFetch("https://api.example.test/data")).rejects.toThrow(
      "Failed to fetch",
    );

    expect(networkEvents()[0]).toMatchObject({
      api: "fetch",
      method: "GET",
      url: "https://api.example.test/data",
      status: 0,
      ok: false,
      error: "Failed to fetch",
    });
  });

  it("captures XHR requests including failures", async () => {
    const { XhrCtor } = installBrowser();
    recordMock.mockReturnValue(vi.fn());
    await startCapture();

    const ok = new XhrCtor();
    ok.open("post", "https://api.example.test/things");
    ok.send();
    ok.status = 204;
    ok.dispatch("loadend");

    const failed = new XhrCtor();
    failed.open("get", "/relative/path");
    failed.send();
    failed.dispatch("error");
    failed.dispatch("loadend");

    const events = networkEvents();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      api: "xhr",
      method: "POST",
      url: "https://api.example.test/things",
      status: 204,
      ok: true,
    });
    expect(events[1]).toMatchObject({
      api: "xhr",
      method: "GET",
      url: "https://app.agent-native.com/relative/path",
      status: 0,
      ok: false,
      error: "XMLHttpRequest failed",
    });
  });

  it("captures a redacted, truncated response body for 5xx fetch responses", async () => {
    const { fetchMock, windowStub } = installBrowser();
    recordMock.mockReturnValue(vi.fn());
    const response = new Response(
      JSON.stringify({ error: "boom", apiKey: "abc123" }),
      { status: 502 },
    );
    fetchMock.mockResolvedValueOnce(response);
    await startCapture();

    const wrappedFetch = windowStub.fetch as typeof fetch;
    const result = await wrappedFetch("https://api.example.test/broken");

    // The caller's response body must still be fully readable -- the
    // response-body capture reads a clone, never the original stream.
    expect(await result.json()).toEqual({ error: "boom", apiKey: "abc123" });

    await vi.waitFor(() => {
      expect(networkEvents()).toHaveLength(1);
      expect(networkEvents()[0].responseBody).toBeDefined();
    });
    expect(networkEvents()[0]).toMatchObject({
      api: "fetch",
      status: 502,
      responseBody: '{"error":"boom","apiKey":"<redacted>"}',
    });
  });

  it("truncates a captured error body to the configured cap", async () => {
    const { fetchMock, windowStub } = installBrowser();
    recordMock.mockReturnValue(vi.fn());
    const longBody = "x".repeat(5000);
    fetchMock.mockResolvedValueOnce(new Response(longBody, { status: 500 }));
    await startCapture({ network: { maxErrorBodyLength: 100 } });

    const wrappedFetch = windowStub.fetch as typeof fetch;
    await wrappedFetch("https://api.example.test/broken");

    await vi.waitFor(() => {
      expect(networkEvents()[0]?.responseBody).toBeDefined();
    });
    expect((networkEvents()[0].responseBody as string).length).toBe(100);
  });

  it("does not capture a response body for non-5xx or network-failure statuses", async () => {
    const { fetchMock, windowStub } = installBrowser();
    recordMock.mockReturnValue(vi.fn());
    fetchMock
      .mockResolvedValueOnce(new Response("client error body", { status: 404 }))
      .mockResolvedValueOnce(new Response("ok body", { status: 200 }));
    await startCapture();

    const wrappedFetch = windowStub.fetch as typeof fetch;
    await wrappedFetch("https://api.example.test/missing");
    await wrappedFetch("https://api.example.test/ok");
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(
      wrappedFetch("https://api.example.test/down"),
    ).rejects.toThrow();

    // Give any (incorrectly-scheduled) body read a chance to resolve before
    // asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const events = networkEvents();
    expect(events).toHaveLength(3);
    for (const event of events) {
      expect(event.responseBody).toBeUndefined();
    }
  });

  it("disables error-body capture when captureErrorBodies is false", async () => {
    const { fetchMock, windowStub } = installBrowser();
    recordMock.mockReturnValue(vi.fn());
    fetchMock.mockResolvedValueOnce(
      new Response("server exploded", { status: 500 }),
    );
    await startCapture({ network: { captureErrorBodies: false } });

    const wrappedFetch = windowStub.fetch as typeof fetch;
    await wrappedFetch("https://api.example.test/broken");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(networkEvents()).toHaveLength(1);
    expect(networkEvents()[0].responseBody).toBeUndefined();
    expect(networkEvents()[0]).toMatchObject({ status: 500 });
  });

  it("emits without a body when the body read exceeds the timeout", async () => {
    vi.useFakeTimers();
    try {
      const { fetchMock, windowStub } = installBrowser();
      recordMock.mockReturnValue(vi.fn());
      // A response whose clone().text()/reader never resolves, simulating a
      // stalled/slow body read.
      const hangingBody = new ReadableStream<Uint8Array>({
        start: () => {
          // never enqueue or close -- the reader hangs forever.
        },
      });
      const response = new Response(hangingBody, { status: 503 });
      fetchMock.mockResolvedValueOnce(response);
      await startCapture();

      const wrappedFetch = windowStub.fetch as typeof fetch;
      await wrappedFetch("https://api.example.test/stalled");

      // Advance past the 1500ms hard timeout so the race resolves without a
      // body, then let the microtask queue drain.
      await vi.advanceTimersByTimeAsync(2000);

      expect(networkEvents()).toHaveLength(1);
      expect(networkEvents()[0]).toMatchObject({ status: 503 });
      expect(networkEvents()[0].responseBody).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("captures XHR response bodies for 5xx statuses via responseText", async () => {
    const { XhrCtor } = installBrowser();
    recordMock.mockReturnValue(vi.fn());
    await startCapture();

    const failed = new XhrCtor();
    failed.open("post", "https://api.example.test/things");
    failed.send();
    failed.status = 500;
    failed.responseType = "";
    failed.responseText = "Bearer aaa.bbb.ccc failed to authorize";
    failed.dispatch("loadend");

    expect(networkEvents()[0]).toMatchObject({
      api: "xhr",
      status: 500,
      responseBody: "Bearer <redacted> failed to authorize",
    });
  });

  it("captures XHR json responseType error bodies via JSON.stringify", async () => {
    const { XhrCtor } = installBrowser();
    recordMock.mockReturnValue(vi.fn());
    await startCapture();

    const failed = new XhrCtor();
    failed.open("post", "https://api.example.test/things");
    failed.send();
    failed.status = 500;
    failed.responseType = "json";
    failed.response = { error: "internal" };
    failed.dispatch("loadend");

    expect(networkEvents()[0]).toMatchObject({
      api: "xhr",
      status: 500,
      responseBody: '{"error":"internal"}',
    });
  });

  it("does not read XHR response bodies for non-5xx statuses", async () => {
    const { XhrCtor } = installBrowser();
    recordMock.mockReturnValue(vi.fn());
    await startCapture();

    const ok = new XhrCtor();
    ok.open("get", "https://api.example.test/things");
    ok.send();
    ok.status = 200;
    ok.responseText = "fine";
    ok.dispatch("loadend");

    expect(networkEvents()[0]).toMatchObject({ status: 200 });
    expect(networkEvents()[0].responseBody).toBeUndefined();
  });

  it("never records replay-ingest, analytics-track, or non-network URLs", async () => {
    const { windowStub, XhrCtor } = installBrowser();
    recordMock.mockReturnValue(vi.fn());
    await startCapture();

    const wrappedFetch = windowStub.fetch as typeof fetch;
    await wrappedFetch("https://analytics.example.test/api/analytics/replay", {
      method: "POST",
    });
    await wrappedFetch("/api/analytics/replay", { method: "POST" });
    await wrappedFetch("/api/analytics/track", { method: "POST" });
    await wrappedFetch("data:text/plain,hello");
    await wrappedFetch("blob:https://app.agent-native.com/some-blob");
    await wrappedFetch("about:blank");

    expect(networkEvents()).toHaveLength(0);

    const xhr = new XhrCtor();
    xhr.open("POST", "/api/analytics/replay");
    xhr.send();
    xhr.status = 200;
    xhr.dispatch("loadend");
    expect(networkEvents()).toHaveLength(0);
  });

  it("stops network capture at the budget and emits one truncation notice", async () => {
    const { windowStub } = installBrowser();
    recordMock.mockReturnValue(vi.fn());
    await startCapture({ network: { maxEvents: 1 } });

    const wrappedFetch = windowStub.fetch as typeof fetch;
    await wrappedFetch("https://api.example.test/one");
    await wrappedFetch("https://api.example.test/two");
    await wrappedFetch("https://api.example.test/three");

    const events = networkEvents();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ url: "https://api.example.test/one" });
    expect(events[1]).toMatchObject({
      message: "session replay network capture truncated",
      truncated: true,
    });
  });

  it("restores console, fetch, and XHR originals on stop and supports restart", async () => {
    const { fetchMock, windowStub, XhrCtor } = installBrowser();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    recordMock.mockReturnValue(vi.fn());
    const originalOpen = XhrCtor.prototype.open;
    const mod = await startCapture();

    expect(XhrCtor.prototype.open).not.toBe(originalOpen);
    expect(windowStub.fetch).not.toBe(fetchMock);
    expect(console.log).not.toBe(logSpy);

    await mod.stopSessionReplay();

    expect(windowStub.fetch).toBe(fetchMock);
    expect(console.log).toBe(logSpy);
    expect(XhrCtor.prototype.open).toBe(originalOpen);
    recordMock.addCustomEvent.mockClear();

    // A fresh start/stop cycle installs and restores cleanly again.
    delete (globalThis as Record<symbol, unknown>)[replayStateKey];
    const restarted = await mod.startSessionReplay({ ...START_OPTIONS });
    expect(restarted.started).toBe(true);
    console.log("second cycle");
    expect(consoleEvents()).toHaveLength(1);
    await mod.stopSessionReplay();
    expect(windowStub.fetch).toBe(fetchMock);
    expect(console.log).toBe(logSpy);
  });

  it("leaves foreign monkey-patches in place when restoring", async () => {
    const { windowStub } = installBrowser();
    recordMock.mockReturnValue(vi.fn());
    const mod = await startCapture();

    const foreignFetch = vi.fn();
    windowStub.fetch = foreignFetch;
    await mod.stopSessionReplay();

    expect(windowStub.fetch).toBe(foreignFetch);
  });

  it("never throws from wrappers when serialization or emit fails", async () => {
    installBrowser();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    recordMock.mockReturnValue(vi.fn());
    await startCapture();

    const hostile = {
      get boom(): never {
        throw new Error("getter exploded");
      },
    };
    recordMock.addCustomEvent.mockImplementation(() => {
      throw new Error("recorder stopped");
    });

    expect(() => console.log(hostile)).not.toThrow();
    expect(() => console.log("plain message")).not.toThrow();
    expect(logSpy).toHaveBeenCalledTimes(2);
  });

  it("does not capture the recorder's own custom-event emission work", async () => {
    installBrowser();
    vi.spyOn(console, "log").mockImplementation(() => {});
    recordMock.mockReturnValue(vi.fn());
    recordMock.addCustomEvent.mockImplementation(() => {
      // rrweb work triggered by the emit must not be re-captured.
      console.log("internal recorder log");
    });
    await startCapture();

    console.log("user log");

    const messages = consoleEvents().map((event) => event.message);
    expect(messages).toEqual(["user log"]);
  });

  it("supports disabling each capture category independently", async () => {
    const { windowStub } = installBrowser();
    vi.spyOn(console, "log").mockImplementation(() => {});
    recordMock.mockReturnValue(vi.fn());
    await startCapture({ console: false });

    console.log("not captured");
    const wrappedFetch = windowStub.fetch as typeof fetch;
    await wrappedFetch("https://api.example.test/captured");

    expect(consoleEvents()).toHaveLength(0);
    expect(networkEvents()).toHaveLength(1);
  });

  it("skips capture entirely when rrweb has no addCustomEvent", async () => {
    const { windowStub, fetchMock } = installBrowser();
    const logBefore = console.log;
    recordMock.mockReturnValue(vi.fn());
    const addCustomEvent = recordMock.addCustomEvent;
    // Simulate an rrweb build without the static helper.
    (recordMock as { addCustomEvent?: unknown }).addCustomEvent = undefined;
    try {
      const mod = await freshSessionReplay();
      activeModule = mod;
      const result = await mod.startSessionReplay({ ...START_OPTIONS });
      expect(result.started).toBe(true);
      expect(console.log).toBe(logBefore);
      expect(windowStub.fetch).toBe(fetchMock);
      await mod.stopSessionReplay();
    } finally {
      recordMock.addCustomEvent = addCustomEvent;
    }
  });
});
