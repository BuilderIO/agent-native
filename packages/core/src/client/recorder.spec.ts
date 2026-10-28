// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./analytics.js", () => ({ trackEvent: vi.fn() }));
vi.mock("./use-session.js", () => ({
  recheckSessionAfterUnauthorized: vi.fn(),
}));

import { resetActionGetBatchForTests } from "./action-get-batch.js";
import {
  deleteClientAppState,
  writeClientAppState,
} from "./application-state.js";
import {
  clearRecorder,
  configureRecorder,
  recorder,
  resetRecorderForTests,
  startRecorder,
  type RecorderEvent,
} from "./recorder.js";
import { installRouteChunkRecovery } from "./route-chunk-recovery.js";
import { callAction, useActionQuery } from "./use-action.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function eventsOf(type: RecorderEvent["type"]) {
  return recorder
    .report()
    .events.filter((event) => event.type === type)
    .map(({ t: _t, at: _at, ms: _ms, ...event }) => event);
}

function abortableFetch() {
  return vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError")),
        );
      }),
  );
}

beforeAll(() => installRouteChunkRecovery());

afterEach(() => {
  window.history.replaceState({}, "", "/");
  resetRecorderForTests();
  resetActionGetBatchForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (window as { __AGENT_NATIVE_CONFIG__?: unknown })
    .__AGENT_NATIVE_CONFIG__;
  document.body.innerHTML = "";
});

describe("recorder buffer", () => {
  it("keeps the newest 2,000 events and counts the ones it dropped", () => {
    for (let i = 0; i < 2_005; i += 1) recorder.log("tick", { i });

    const report = recorder.report();

    expect(report.events).toHaveLength(2_000);
    expect(report.events[0]).toMatchObject({ data: { i: 5 } });
    expect(report.events.at(-1)).toMatchObject({ data: { i: 2_004 } });
    expect(report.dropped).toBe(5);
  });

  it("forgets events older than the configured window without counting them as dropped", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    configureRecorder({ windowSeconds: 30 });
    vi.setSystemTime(new Date("2026-10-14T16:00:00.000Z"));
    clearRecorder();
    recorder.log("old");
    vi.setSystemTime(new Date("2026-10-14T16:00:20.000Z"));
    recorder.log("recent");
    vi.setSystemTime(new Date("2026-10-14T16:00:40.000Z"));

    const report = recorder.report();

    expect(report.events.map((event) => event.name)).toEqual(["recent"]);
    expect(report.windowSeconds).toBe(30);
    expect(report.dropped).toBe(0);
  });

  it("reports only the seconds it has been recording since a clear", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T16:00:00.000Z"));
    clearRecorder();
    vi.setSystemTime(new Date("2026-10-14T16:00:04.200Z"));

    expect(recorder.report().windowSeconds).toBe(5);
    expect(recorder.report({ seconds: 2 }).windowSeconds).toBe(2);
  });

  it("applies a lower event cap to what it already holds", () => {
    for (let i = 0; i < 10; i += 1) recorder.log("tick", { i });

    configureRecorder({ maxEvents: 3 });

    expect(recorder.report().events.map((event) => event.data)).toEqual([
      { i: 7 },
      { i: 8 },
      { i: 9 },
    ]);
    expect(recorder.report().dropped).toBe(7);
  });

  it("rejects a window or cap it cannot honor instead of guessing", () => {
    expect(() => configureRecorder({ windowSeconds: 0 })).toThrow(RangeError);
    expect(() => configureRecorder({ windowSeconds: Number.NaN })).toThrow(
      RangeError,
    );
    expect(() => configureRecorder({ maxEvents: 2.5 })).toThrow(RangeError);
    expect(() => recorder.report({ seconds: -1 })).toThrow(RangeError);
  });
});

describe("recorder redaction", () => {
  it("redacts secret-looking keys and token-looking values", () => {
    recorder.log("sign-in", {
      email: "person@example.com",
      password: "hunter2",
      apiKey: "abc",
      cardNumber: "4242",
      cvv: "123",
      nested: { session_id: "s1", Authorization: "Bearer abc.def" },
      note: "header was Bearer abcdefghijklmnop and key sk-ABCDEFGHIJKLMNOPQRST",
      jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl", // ggignore: fake test JWT
      query: "token=abc123",
    });

    const [event] = recorder.report().events;

    expect(event!.data).toEqual({
      email: "person@example.com",
      password: "[redacted]",
      apiKey: "[redacted]",
      cardNumber: "[redacted]",
      cvv: "[redacted]",
      nested: { session_id: "[redacted]", Authorization: "[redacted]" },
      note: "header was Bearer [redacted] and key [redacted]",
      jwt: "[redacted]",
      query: "token=[redacted]",
    });
  });

  it("redacts a token that the 200-character cut leaves half", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl"; // ggignore: fake test JWT
    recorder.log("cut", { value: `${"x".repeat(180)} ${jwt}` });

    const [event] = recorder.report().events;

    expect(event!.data).toEqual({ value: `${"x".repeat(180)} [redacted]…` });
  });

  it("redacts signed URLs, URL credentials, quoted credentials, and private keys", () => {
    recorder.log("leaks", {
      signed:
        "https://bucket.s3.amazonaws.com/f.png?X-Amz-Credential=AKIA1&X-Amz-Signature=abcd1234",
      // guard:allow-secret-literal — fake credentials verify redaction
      database: "postgres://admin:hunter2@db.internal:5432/app",
      json: '{"apiKey":"abc123"}',
      // guard:allow-secret-literal — fake key header verifies redaction
      pem: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC",
    });

    const text = JSON.stringify(recorder.report().events[0]!.data);

    for (const secret of ["abcd1234", "hunter2", "abc123", "MIIEvQIB"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("cuts strings at 200 characters and an event at about 2 KB, saying what it cut", () => {
    const wide = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`field${i}`, "x".repeat(150)]),
    );
    recorder.log("big", {
      long: "y".repeat(500),
      list: Array.from({ length: 50 }, (_, i) => `item-${i}-${"z".repeat(40)}`),
      ...wide,
    });

    const [event] = recorder.report().events;
    const data = event!.data as Record<string, unknown>;

    expect(data.long).toBe(`${"y".repeat(200)}…`);
    expect((data.list as string[]).at(-1)).toMatch(/^\[\+\d+ more\]$/);
    expect(data["…"]).toMatch(/^\+\d+ more keys$/);
    expect(JSON.stringify(event).length).toBeLessThan(2_300);
  });

  it("hides extra fields by name, or by dotted path from the event name", () => {
    recorder.redact("email", "compose.body", "payment.*");
    recorder.log("compose", { body: "hi", subject: "s", to: { email: "a@b" } });
    recorder.log("payment", { amount: 3, method: { kind: "visa" } });

    const [compose, payment] = recorder.report().events;

    expect(compose!.data).toEqual({
      body: "[redacted]",
      subject: "s",
      to: { email: "[redacted]" },
    });
    expect(payment!.data).toEqual({
      amount: "[redacted]",
      method: "[redacted]",
    });
  });

  it("keeps the route path and redacts every query value in the report url", () => {
    window.history.replaceState(
      {},
      "",
      "/designs/d1?file=f2&_session=eyJhbGciOiJIUzI1NiJ9.e30.c2ln#token=abc",
    );

    expect(recorder.report().url).toBe(
      "/designs/d1?file=[redacted]&_session=[redacted]",
    );
  });

  it("never records request or response bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ html: "<p>response body</p>" })),
    );

    await callAction("update-file", { content: "<p>request body</p>" });

    expect(eventsOf("action")).toEqual([
      {
        type: "action",
        name: "update-file",
        ok: true,
        status: 200,
        data: { method: "POST" },
      },
    ]);
    expect(JSON.stringify(recorder.report())).not.toMatch(/body/);
  });
});

describe("recorder action events", () => {
  it("records each action inside a batched 200 on its own", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("/_agent-native/actions/get-actions-batch");
      return jsonResponse({
        results: [
          { status: 200, body: [{ id: "l1" }] },
          {
            status: 403,
            error: { error: "Missing scope", errorCode: "forbidden_scope" },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const names = ["list-labels", "list-folders"];
    const queryKey = (name: string) => ["action", name, { accountId: "a1" }];
    // Only a refetch of data a query already holds joins a batch.
    const queryClient = new QueryClient();
    for (const name of names) {
      queryClient.setQueryData(queryKey(name), [], {
        updatedAt: Date.now() - 60_000,
      });
    }
    function Reader({ name }: { name: string }) {
      useActionQuery(name, { accountId: "a1" }, { retry: false });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          names.map((name) => createElement(Reader, { key: name, name })),
        ),
      ),
    );
    await act(() => vi.waitFor(() => expect(queryClient.isFetching()).toBe(0)));
    act(() => root.unmount());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      names.map((name) => queryClient.getQueryState(queryKey(name))?.status),
    ).toEqual(["success", "error"]);
    expect(eventsOf("action")).toEqual([
      {
        type: "action",
        name: "list-labels",
        ok: true,
        status: 200,
        data: { method: "GET" },
      },
      {
        type: "action",
        name: "list-folders",
        ok: false,
        status: 403,
        errorCode: "forbidden_scope",
        data: {
          method: "GET",
          error: "Action list-folders failed: Missing scope",
        },
      },
    ]);
  });

  it("keeps the server's request id so the event joins its log line", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: "Conflict", errorCode: "stale_revision" },
          {
            status: 409,
            headers: {
              "Content-Type": "application/json",
              "x-agent-native-request-id": "req_123",
            },
          },
        ),
      ),
    );

    await expect(callAction("update-file", { id: "f1" })).rejects.toThrow();

    expect(eventsOf("action")).toEqual([
      expect.objectContaining({
        ok: false,
        status: 409,
        errorCode: "stale_revision",
        requestId: "req_123",
      }),
    ]);
  });

  it("records a cancelled call as one compact cancelled failure", async () => {
    vi.stubGlobal("fetch", abortableFetch());
    const controller = new AbortController();

    const call = callAction(
      "update-file",
      { id: "f1" },
      {
        signal: controller.signal,
      },
    );
    controller.abort();
    await expect(call).rejects.toThrow();

    expect(eventsOf("action")).toEqual([
      {
        type: "action",
        name: "update-file",
        ok: false,
        errorCode: "cancelled",
        data: { method: "POST" },
      },
    ]);
  });
});

describe("recorder state events", () => {
  it("records the first value, then only what changed, then the delete", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: true })),
    );

    await writeClientAppState("design-selection", {
      nodeId: "n12",
      state: "hover",
      styles: { opacity: "0.91", width: "160px" },
    });
    await writeClientAppState("design-selection", {
      nodeId: "n12",
      state: "focus",
      styles: { opacity: "0.97", width: "160px" },
    });
    await writeClientAppState("design-selection", {
      nodeId: "n12",
      state: "focus",
      styles: { opacity: "0.97", width: "160px" },
    });
    await deleteClientAppState("design-selection");

    expect(eventsOf("state")).toEqual([
      {
        type: "state",
        name: "design-selection",
        ok: true,
        data: {
          value: {
            nodeId: "n12",
            state: "hover",
            styles: { opacity: "0.91", width: "160px" },
          },
        },
      },
      {
        type: "state",
        name: "design-selection",
        ok: true,
        data: { changed: { state: "focus", styles: { opacity: "0.97" } } },
      },
      {
        type: "state",
        name: "design-selection",
        ok: true,
        data: { unchanged: true },
      },
      {
        type: "state",
        name: "design-selection",
        ok: true,
        data: { deleted: true },
      },
    ]);
  });

  it("records a rejected write as failed and diffs the next write against the last saved value", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ ok: true }))
        .mockResolvedValueOnce(
          jsonResponse({ error: "Forbidden" }, { status: 403 }),
        )
        .mockResolvedValueOnce(jsonResponse({ ok: true })),
    );

    await writeClientAppState("navigation", { view: "list" });
    await expect(
      writeClientAppState("navigation", { view: "detail" }),
    ).rejects.toThrow();
    await writeClientAppState("navigation", { view: "detail" });

    expect(eventsOf("state")).toEqual([
      {
        type: "state",
        name: "navigation",
        ok: true,
        data: { value: { view: "list" } },
      },
      {
        type: "state",
        name: "navigation",
        ok: false,
        status: 403,
        data: {
          changed: { view: "detail" },
          error: 'Write application state "navigation" failed: Forbidden',
        },
      },
      {
        type: "state",
        name: "navigation",
        ok: true,
        data: { changed: { view: "detail" } },
      },
    ]);
  });

  it("never records a cancelled write as saved", async () => {
    vi.stubGlobal("fetch", abortableFetch());
    const controller = new AbortController();

    const write = writeClientAppState(
      "navigation",
      { view: "detail" },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(write).rejects.toThrow();

    expect(eventsOf("state")).toEqual([
      {
        type: "state",
        name: "navigation",
        ok: false,
        errorCode: "cancelled",
        data: { value: { view: "detail" } },
      },
    ]);
  });
});

describe("recorder pending()", () => {
  it("lists in-flight actions and state writes until they settle", async () => {
    let answerAction!: (response: Response) => void;
    let answerState!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        String(url).includes("application-state")
          ? new Promise<Response>((resolve) => (answerState = resolve))
          : new Promise<Response>((resolve) => (answerAction = resolve)),
      ),
    );

    const action = callAction("update-file", { id: "f2" });
    const write = writeClientAppState("design-selection", { nodeId: "n1" });

    expect(recorder.pending()).toEqual([
      { type: "action", name: "update-file", ageMs: expect.any(Number) },
      { type: "state", name: "design-selection", ageMs: expect.any(Number) },
    ]);
    await vi.waitFor(() => {
      expect(answerAction).toBeDefined();
      expect(answerState).toBeDefined();
    });
    answerAction(jsonResponse({ ok: true }));
    answerState(jsonResponse({ nodeId: "n1" }));
    await Promise.all([action, write]);

    expect(recorder.pending()).toEqual([]);
    expect(recorder.report().pending).toEqual([]);
  });
});

describe("recorder report", () => {
  it("has the pinned shape, oldest event first on a clock relative to the report", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    (
      window as { __AGENT_NATIVE_CONFIG__?: { appId: string } }
    ).__AGENT_NATIVE_CONFIG__ = { appId: "Design" };
    vi.setSystemTime(new Date("2026-10-14T16:18:00.000Z"));
    clearRecorder();
    vi.setSystemTime(new Date("2026-10-14T16:20:00.000Z"));
    window.history.pushState({}, "", "/designs/d1?file=f2");
    recorder.log("first");
    vi.setSystemTime(new Date("2026-10-14T16:20:03.500Z"));
    recorder.log("second", ["a", "b"]);
    vi.setSystemTime(new Date("2026-10-14T16:20:05.120Z"));
    recorder.watch("inspector", () => ({ Opacity: { shown: "91%" } }));

    const report = recorder.report({ reason: "test" });

    expect(report).toEqual({
      app: "design",
      build: "unknown",
      url: "/designs/d1?file=[redacted]",
      at: "2026-10-14T16:20:05.120Z",
      reason: "test",
      windowSeconds: 120,
      events: [
        {
          t: -5.12,
          at: Date.parse("2026-10-14T16:20:00.000Z"),
          type: "nav",
          name: "/designs/d1",
        },
        {
          t: -5.12,
          at: Date.parse("2026-10-14T16:20:00.000Z"),
          type: "log",
          name: "first",
        },
        {
          t: -1.62,
          at: Date.parse("2026-10-14T16:20:03.500Z"),
          type: "log",
          name: "second",
          data: { value: ["a", "b"] },
        },
      ],
      watched: { inspector: { Opacity: { shown: "91%" } } },
      pending: [],
      dropped: 0,
    });
    expect(recorder.report({ seconds: 2 })).toMatchObject({
      windowSeconds: 2,
      events: [{ name: "second" }],
    });
  });

  it("names the app by its host when no app id was injected, never null", () => {
    expect(recorder.report().app).toBe(window.location.host);
    expect(recorder.report().app).not.toBe("");
  });

  it("reports a watcher that throws as unreadable, and stops reading one that was unwatched", () => {
    recorder.watch("inspector", () => {
      throw new Error("panel unmounted");
    });
    const unwatch = recorder.watch("canvas", () => ({ zoom: 1 }));
    unwatch();

    expect(recorder.report().watched).toEqual({
      inspector: { unreadable: "panel unmounted" },
    });
  });

  it("sends user, error and test reports to onReport listeners, but not a manual one", () => {
    const listener = vi.fn();
    const stop = recorder.onReport(listener);

    recorder.report();
    recorder.report({ reason: "manual" });
    recorder.report({ reason: "user" });
    recorder.report({ reason: "error" });
    recorder.report({ reason: "test" });
    stop();
    recorder.report({ reason: "user" });

    expect(listener.mock.calls.map(([report]) => report.reason)).toEqual([
      "user",
      "error",
      "test",
    ]);
  });

  it("keeps reporting when one listener throws", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const second = vi.fn();
    recorder.onReport(() => {
      throw new Error("destination down");
    });
    recorder.onReport(second);

    recorder.report({ reason: "user" });

    expect(second).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
  });
});

describe("recorder off switch", () => {
  it("records nothing, reports nothing and leaves the page global once disabled", () => {
    startRecorder();
    const listener = vi.fn();
    recorder.onReport(listener);
    recorder.log("before");
    recorder.watch("inspector", () => 1);

    recorder.disable();
    recorder.log("after");

    expect(recorder.report({ reason: "user" })).toMatchObject({
      events: [],
      watched: {},
      dropped: 0,
    });
    expect(listener).not.toHaveBeenCalled();
    expect(window.__agentNativeRecorder).toBeUndefined();

    configureRecorder({ enabled: true });
    recorder.log("again");

    expect(recorder.report().events.map((event) => event.name)).toEqual([
      "/",
      "again",
    ]);
    expect(window.__agentNativeRecorder?.report).toBe(recorder.report);
  });

  it("forgets what it recorded when cleared, as on sign-out", () => {
    recorder.log("before");

    clearRecorder();

    expect(recorder.report()).toMatchObject({ events: [], dropped: 0 });
  });

  it("records nothing from work that was in flight when it was cleared", async () => {
    let answerAction!: (response: Response) => void;
    let answerState!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        String(url).includes("application-state")
          ? new Promise<Response>((resolve) => (answerState = resolve))
          : new Promise<Response>((resolve) => (answerAction = resolve)),
      ),
    );
    const action = callAction("list-mail", {});
    const write = writeClientAppState("compose", { to: "a@example.com" });

    clearRecorder();
    await vi.waitFor(() => {
      expect(answerAction).toBeDefined();
      expect(answerState).toBeDefined();
    });
    answerAction(jsonResponse({ ok: true }));
    answerState(jsonResponse({ to: "a@example.com" }));
    await Promise.all([action, write]);

    expect(recorder.report()).toMatchObject({ events: [], pending: [] });
  });
});

describe("recorder browser capture", () => {
  it("records error and warning toasts, not other toasts", async () => {
    startRecorder();
    const toaster = document.createElement("ol");
    toaster.setAttribute("data-sonner-toaster", "");
    const toast = (type: string, text: string) => {
      const item = document.createElement("li");
      item.setAttribute("data-sonner-toast", "");
      item.setAttribute("data-type", type);
      item.textContent = text;
      toaster.append(item);
      return item;
    };
    toast("error", "Couldn't reach the server");
    document.body.append(toaster);
    toast("success", "Saved");
    const loading = toast("loading", "Saving…");
    toast("error", "Couldn't load comments");
    await vi.waitFor(() => expect(eventsOf("toast")).toHaveLength(2));
    loading.setAttribute("data-type", "warning");
    loading.textContent = "Saved locally only";

    await vi.waitFor(() =>
      expect(eventsOf("toast")).toEqual([
        {
          type: "toast",
          name: "error",
          data: { text: "Couldn't reach the server" },
        },
        {
          type: "toast",
          name: "error",
          data: { text: "Couldn't load comments" },
        },
        {
          type: "toast",
          name: "warning",
          data: { text: "Saved locally only" },
        },
      ]),
    );
  });

  it("records uncaught errors with their first frame and sends one error report per burst", () => {
    startRecorder();
    const listener = vi.fn();
    recorder.onReport(listener);
    const error = new TypeError(
      "Cannot read properties of undefined (reading 'id')",
    );
    error.stack = `TypeError: Cannot read properties of undefined (reading 'id')
    at restore (http://localhost:8080/app/pages/design-editor/commands/undo.ts?t=1:1715:20)`;

    window.dispatchEvent(
      new ErrorEvent("error", { error, message: error.message }),
    );
    window.dispatchEvent(
      new ErrorEvent("error", { error, message: error.message }),
    );

    expect(eventsOf("error").at(-1)).toEqual({
      type: "error",
      name: "TypeError",
      data: {
        kind: "error",
        message: "Cannot read properties of undefined (reading 'id')",
        source: "/app/pages/design-editor/commands/undo.ts:1715",
      },
    });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]![0]).toMatchObject({ reason: "error" });
  });

  it("records a route change once per path and exposes report() to the page", () => {
    startRecorder();
    window.history.pushState({}, "", "/design/d1");
    window.history.pushState({}, "", "/design/d1?selection=n2");
    window.history.replaceState({}, "", "/design/d2");

    expect(eventsOf("nav").map((event) => event.name)).toEqual([
      "/",
      "/design/d1",
      "/design/d2",
    ]);
    expect(window.__agentNativeRecorder?.report({ seconds: 0 })).toMatchObject({
      reason: "manual",
    });
  });
});
