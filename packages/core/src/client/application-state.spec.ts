import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  compareAndSetClientAppState,
  deleteClientAppState,
  isClientAppStateMutationPending,
  readClientAppState,
  readClientAppStateMany,
  setClientAppState,
  writeClientAppState,
} from "./application-state.js";
import { getBrowserTabId } from "./browser-tab-id.js";
import {
  ACTION_KEEPALIVE_BODY_BUDGET_BYTES,
  KEEPALIVE_PAGE_LIMIT_BYTES,
} from "./keepalive-budget.js";

// The write-order headers every value write and delete carries (see
// AppStateWriteOrder in the store).
const orderHeaders = {
  "X-Agent-Native-App-State-Writer": expect.stringMatching(/^page-/),
  "X-Agent-Native-App-State-Seq": expect.stringMatching(/^[1-9][0-9]*$/),
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("client application-state helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads app state from the mounted framework route", async () => {
    vi.stubGlobal("window", {
      location: { pathname: "/plans/_agent-native/auth/session" },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        values: { navigation: { view: "detail" } },
        missing: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(readClientAppState("navigation")).resolves.toEqual({
      view: "detail",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/plans/_agent-native/application-state?keys=navigation",
      {
        method: "GET",
        cache: "no-store",
        headers: { "X-Agent-Native-Browser-Tab": expect.any(String) },
        signal: undefined,
      },
    );
  });

  it.each([
    {
      body: {
        values: { "chat-first-pane": { appId: "mail", path: "/inbox" } },
        missing: [],
      },
      expected: { appId: "mail", path: "/inbox" },
    },
    { body: { values: {}, missing: ["chat-first-pane"] }, expected: null },
  ])(
    "reads pane state when the initial session resolves",
    async ({ body, expected }) => {
      const { recordSessionIdentity } = await import("./session-identity.js");
      recordSessionIdentity(undefined);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body)));
      const read = readClientAppState("chat-first-pane");
      recordSessionIdentity("pane-user", "pane-org");
      await expect(read).resolves.toEqual(expected);
    },
  );

  it("rejects an unreadable pane response after the initial session resolves", async () => {
    const { recordSessionIdentity } = await import("./session-identity.js");
    recordSessionIdentity(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not JSON")));
    const read = readClientAppState("chat-first-pane");
    recordSessionIdentity("pane-user", "pane-org");
    await expect(read).rejects.toThrow("non-JSON");
  });

  it("does not retry across two session changes during startup", async () => {
    const { recordSessionIdentity } = await import("./session-identity.js");
    recordSessionIdentity(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const read = readClientAppState("chat-first-pane");
    recordSessionIdentity("first-user", "first-org");
    recordSessionIdentity("second-user", "second-org");
    await expect(read).rejects.toThrow("scope changed before reading");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a retry if the session changes while its response is pending", async () => {
    const { recordSessionIdentity } = await import("./session-identity.js");
    recordSessionIdentity(undefined);
    let respond!: (response: Response) => void;
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        started();
        return new Promise<Response>((resolve) => {
          respond = resolve;
        });
      }),
    );
    const read = readClientAppState("chat-first-pane");
    recordSessionIdentity("first-user", "first-org");
    await requestStarted;
    recordSessionIdentity("second-user", "second-org");
    respond(
      jsonResponse({
        values: { "chat-first-pane": { appId: "mail" } },
        missing: [],
      }),
    );
    await expect(read).rejects.toThrow("scope changed before reading");
  });

  it("coalesces same-tick reads into one batched request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        values: { navigation: { view: "detail" }, selection: { ids: ["a"] } },
        missing: ["__url__"],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const [navigation, selection, url, duplicate] = await Promise.all([
      readClientAppState("navigation"),
      readClientAppState("selection"),
      readClientAppState("__url__"),
      readClientAppState("navigation"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/_agent-native/application-state?keys=navigation,selection,__url__",
    );
    expect(navigation).toEqual({ view: "detail" });
    expect(selection).toEqual({ ids: ["a"] });
    expect(duplicate).toEqual({ view: "detail" });
    expect(url).toBeNull();
  });

  it("rejects a queued read when its session changes before dispatch", async () => {
    const { recordSessionIdentity } = await import("./session-identity.js");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ values: { selection: "new session" }, missing: [] }),
      );
    vi.stubGlobal("fetch", fetchMock);
    recordSessionIdentity("batch-user", "batch-org-a");
    const oldRead = readClientAppState("selection");
    recordSessionIdentity("batch-user", "batch-org-b");
    const newRead = readClientAppState("selection");
    await expect(oldRead).rejects.toThrow("scope changed before reading");
    await expect(newRead).resolves.toBe("new session");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries reads that overlap a state deletion", async () => {
    let resolveRead!: (response: Response) => void;
    let resolveDelete!: (response: Response) => void;
    let deleteStarted!: () => void;
    const deletionStarted = new Promise<void>((resolve) => {
      deleteStarted = resolve;
    });
    let startRead!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      startRead = resolve;
    });
    let getCount = 0;
    const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        deleteStarted();
        return new Promise<Response>((resolve) => {
          resolveDelete = resolve;
        });
      }
      if (init?.method === "PUT") {
        return Promise.resolve(
          jsonResponse({ text: "new selection", capturedAt: 2 }),
        );
      }
      getCount += 1;
      if (getCount === 1) {
        startRead();
        return new Promise<Response>((resolve) => {
          resolveRead = resolve;
        });
      }
      return Promise.resolve(
        jsonResponse({
          values: {
            "pending-selection-context": {
              text: "new selection",
              capturedAt: 2,
            },
          },
          missing: [],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const read = readClientAppStateMany(["pending-selection-context"]);
    await readStarted;
    const deletion = deleteClientAppState("pending-selection-context");
    await deletionStarted;
    const write = writeClientAppState("pending-selection-context", {
      text: "new selection",
      capturedAt: 2,
    });
    resolveRead(
      jsonResponse({
        values: { "pending-selection-context": { text: "stale" } },
        missing: [],
      }),
    );
    let readSettled = false;
    void read.then(() => {
      readSettled = true;
    });
    await Promise.resolve();
    expect(readSettled).toBe(false);

    resolveDelete(jsonResponse({ ok: true }));
    const [batch] = await Promise.all([read, deletion, write]);
    expect(batch).toEqual({
      values: {
        "pending-selection-context": {
          text: "new selection",
          capturedAt: 2,
        },
      },
      missing: [],
    });
    expect(getCount).toBe(2);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual([
      "GET",
      "DELETE",
      "PUT",
      "GET",
    ]);
  });

  it("waits for an in-flight selection clear before reading", async () => {
    let resolveDelete!: (response: Response) => void;
    let deleteStarted!: () => void;
    const deletionStarted = new Promise<void>((resolve) => {
      deleteStarted = resolve;
    });
    const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        deleteStarted();
        return new Promise<Response>((resolve) => {
          resolveDelete = resolve;
        });
      }
      return Promise.resolve(
        jsonResponse({ values: {}, missing: ["pending-selection-context"] }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const deletion = deleteClientAppState("pending-selection-context");
    await deletionStarted;
    const read = readClientAppStateMany(["pending-selection-context"]);
    await Promise.resolve();

    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual([
      "DELETE",
    ]);

    resolveDelete(jsonResponse({ ok: true }));
    const [, batch] = await Promise.all([deletion, read]);

    expect(batch).toEqual({
      values: {},
      missing: ["pending-selection-context"],
    });
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual([
      "DELETE",
      "GET",
    ]);
  });

  it("reads persisted selection after an in-flight delete fails", async () => {
    let rejectDelete!: (error: Error) => void;
    let deleteStarted!: () => void;
    const deletionStarted = new Promise<void>((resolve) => {
      deleteStarted = resolve;
    });
    const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        deleteStarted();
        return new Promise<Response>((_, reject) => {
          rejectDelete = reject;
        });
      }
      return Promise.resolve(
        jsonResponse({
          values: {
            "pending-selection-context": {
              text: "retry selection",
              capturedAt: 1,
            },
          },
          missing: [],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const deletion = deleteClientAppState("pending-selection-context");
    await deletionStarted;
    const read = readClientAppState("pending-selection-context");
    const deletionFailure = expect(deletion).rejects.toThrow(
      "network unavailable",
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual([
      "DELETE",
    ]);

    rejectDelete(new Error("network unavailable"));
    await deletionFailure;
    await expect(read).resolves.toEqual({
      text: "retry selection",
      capturedAt: 1,
    });
    expect(isClientAppStateMutationPending("pending-selection-context")).toBe(
      false,
    );
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual([
      "DELETE",
      "GET",
    ]);
  });

  it("does not let a failed unrelated mutation block later reads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: "write failed" }, { status: 503 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ values: { navigation: { view: "home" } }, missing: [] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      writeClientAppState("navigation", { view: "next" }),
    ).rejects.toThrow(
      'Write application state "navigation" failed: write failed',
    );
    await expect(readClientAppState("navigation")).resolves.toEqual({
      view: "home",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps absent keys distinguishable from stored null or empty values", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        values: { "stored-null": null, "stored-empty": {} },
        missing: ["never-written"],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const batch = await readClientAppStateMany([
      "stored-null",
      "stored-empty",
      "never-written",
    ]);

    expect(batch.missing).toEqual(["never-written"]);
    expect("never-written" in batch.values).toBe(false);
    expect("stored-null" in batch.values).toBe(true);
    expect(batch.values["stored-null"]).toBeNull();
    expect(batch.values["stored-empty"]).toEqual({});
  });

  it("rejects a queued read when its caller aborts", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ values: { navigation: {} }, missing: [] }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const first = readClientAppState("navigation");
    const queued = readClientAppState("selection", {
      signal: controller.signal,
    });

    controller.abort(new Error("caller cancelled"));
    await expect(queued).rejects.toThrow("caller cancelled");

    await vi.runAllTimersAsync();
    await expect(first).resolves.toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("writes app state with JSON, keepalive, request source, and safe scoped keys", async () => {
    vi.stubGlobal("window", {
      location: { pathname: "/plans/_agent-native/auth/session" },
    });
    const value = { selectedId: "plan:1" };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(value));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      writeClientAppState("selection:primary", value, {
        keepalive: true,
        requestSource: "tab-1",
      }),
    ).resolves.toEqual(value);

    expect(fetchMock).toHaveBeenCalledWith(
      "/plans/_agent-native/application-state/selection:primary",
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Native-Browser-Tab": expect.any(String),
          "X-Request-Source": "tab-1",
          ...orderHeaders,
        },
        body: JSON.stringify(value),
        keepalive: true,
        signal: undefined,
      },
    );
  });

  it("updates a prior mount tab id when writing application state", async () => {
    const stored = new Map<string, string>();
    const fakeWindow = {
      location: { pathname: "/risk/register" },
      __AGENT_NATIVE_CONFIG__: {
        workspaceRuntime: true,
        workspaceAppMountPaths: ["/risk", "/chat"],
      },
    };
    vi.stubGlobal("window", fakeWindow);
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    });

    const priorMountTabId = getBrowserTabId();
    fakeWindow.location.pathname = "/chat/thread-1";
    const currentMountTabId = getBrowserTabId();
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse({ value: true })));
    vi.stubGlobal("fetch", fetchMock);

    await writeClientAppState(
      "selection",
      { value: true },
      {
        requestSource: priorMountTabId,
      },
    );
    await deleteClientAppState("selection", {
      requestSource: priorMountTabId,
    });

    expect(currentMountTabId).not.toBe(priorMountTabId);
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      "Content-Type": "application/json",
      "X-Agent-Native-Browser-Tab": currentMountTabId,
      "X-Request-Source": currentMountTabId,
      ...orderHeaders,
    });
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({
      "X-Agent-Native-CSRF": "1",
      "X-Agent-Native-Browser-Tab": currentMountTabId,
      "X-Request-Source": currentMountTabId,
      ...orderHeaders,
    });
  });

  it("deletes app state directly and via nullish set values", async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await deleteClientAppState("selection", { requestSource: "tab-1" });
    await setClientAppState("selection", null, { keepalive: true });
    await setClientAppState("selection", undefined);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/_agent-native/application-state/selection",
      {
        method: "DELETE",
        headers: {
          "X-Agent-Native-CSRF": "1",
          "X-Request-Source": "tab-1",
          ...orderHeaders,
        },
        keepalive: undefined,
        signal: undefined,
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/_agent-native/application-state/selection",
      {
        method: "DELETE",
        headers: { "X-Agent-Native-CSRF": "1", ...orderHeaders },
        keepalive: true,
        signal: undefined,
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/_agent-native/application-state/selection",
      {
        method: "DELETE",
        headers: { "X-Agent-Native-CSRF": "1", ...orderHeaders },
        keepalive: undefined,
        signal: undefined,
      },
    );
  });

  it("throws with status and server message for failed requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { error: "Unauthenticated" },
            { status: 401, statusText: "Unauthorized" },
          ),
        ),
    );

    await expect(readClientAppState("navigation")).rejects.toMatchObject({
      message: "Read application state [navigation] failed: Unauthenticated",
      status: 401,
    });
  });

  it("compares app state through the atomic server endpoint", async () => {
    const expected = { submissions: [] };
    const next = { submissions: [{ id: "submission-1" }] };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ changed: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      compareAndSetClientAppState("agentkit-deferred", expected, next),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      "/_agent-native/application-state/agentkit-deferred",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ expected, next }),
      }),
    );
  });

  it("rejects direct writes of undefined values", async () => {
    vi.stubGlobal("fetch", vi.fn());

    await expect(writeClientAppState("selection", undefined)).rejects.toThrow(
      "Application state values must be JSON-serializable",
    );
  });

  it("rejects keys the application-state route would sanitize", async () => {
    vi.stubGlobal("fetch", vi.fn());

    await expect(readClientAppState("selection/primary")).rejects.toThrow(
      "Application state keys may only contain",
    );
    await expect(writeClientAppState("selection primary", {})).rejects.toThrow(
      "Application state keys may only contain",
    );
  });

  it("sends writes to one key made in one tick as one request", async () => {
    const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(jsonResponse(JSON.parse(String(init?.body)))),
    );
    vi.stubGlobal("fetch", fetchMock);

    const writes = [1, 2, 3].map((step) =>
      writeClientAppState("navigation", { step }),
    );

    await expect(Promise.all(writes)).resolves.toEqual([
      { step: 3 },
      { step: 3 },
      { step: 3 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/_agent-native/application-state/navigation",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ step: 3 }),
      }),
    ]);
  });

  it("sends a burst behind a write in flight as one more request", async () => {
    const releases: Array<() => void> = [];
    const fetchMock = vi.fn(
      (_: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          releases.push(() =>
            resolve(jsonResponse(JSON.parse(String(init?.body)))),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = writeClientAppState("navigation", { step: 1 });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const burst = [2, 3, 4].map((step) =>
      writeClientAppState("navigation", { step }),
    );
    releases[0]();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    releases[1]();

    await expect(Promise.all([first, ...burst])).resolves.toEqual([
      { step: 1 },
      { step: 4 },
      { step: 4 },
      { step: 4 },
    ]);
    expect(fetchMock.mock.calls[1][1]?.body).toBe(JSON.stringify({ step: 4 }));
  });

  it("sends writes to several keys made in one tick as one batch", async () => {
    vi.stubGlobal("window", {
      sessionStorage: { getItem: () => "tab-1", setItem: () => {} },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          { ok: true, value: { view: "editor" } },
          { ok: false, status: 403, error: "Forbidden" },
          { ok: true, value: { ok: true } },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const navigation = writeClientAppState(
      "navigation",
      { view: "editor" },
      { requestSource: "content-editor" },
    );
    const selection = writeClientAppState("content-selection", { id: "b1" });
    const history = deleteClientAppState("content-history:doc-1");

    await expect(navigation).resolves.toEqual({ view: "editor" });
    await expect(selection).rejects.toMatchObject({
      message: 'Write application state "content-selection" failed: Forbidden',
      status: 403,
    });
    await expect(history).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/_agent-native/application-state");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: {
        "X-Agent-Native-App-State-Writer":
          orderHeaders["X-Agent-Native-App-State-Writer"],
      },
    });
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty(
      "X-Agent-Native-App-State-Seq",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      writes: [
        {
          key: "navigation",
          value: { view: "editor" },
          requestSource: "content-editor",
          seq: expect.any(Number),
        },
        {
          key: "content-selection",
          value: { id: "b1" },
          seq: expect.any(Number),
        },
        { key: "content-history:doc-1", delete: true, seq: expect.any(Number) },
      ],
    });
  });

  it("numbers writes in the order they're made, from one writer per page load", async () => {
    vi.resetModules();
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        jsonResponse(
          String(url) === "/_agent-native/application-state"
            ? {
                results: JSON.parse(String(init?.body)).writes.map(() => ({
                  ok: true,
                  value: null,
                })),
              }
            : init?.method === "PATCH"
              ? { changed: true }
              : JSON.parse(String(init?.body ?? "null")),
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const fresh = await import("./application-state.js");

    await fresh.writeClientAppState("draft", { text: "a" });
    await Promise.all([
      fresh.writeClientAppState("draft", { text: "ab" }),
      fresh.deleteClientAppState("old"),
    ]);
    await fresh.writeClientAppState(
      "draft",
      { text: "abc" },
      {
        signal: new AbortController().signal,
      },
    );
    await fresh.deleteClientAppState("old", {
      signal: new AbortController().signal,
    });
    // Compare-and-set isn't ordered: the server's comparison orders it.
    await fresh.compareAndSetClientAppState("flag", null, { on: true });

    const sent = fetchMock.mock.calls.map(([url, init]) => {
      const headers = init?.headers as Record<string, string>;
      const writer = headers["X-Agent-Native-App-State-Writer"];
      const seqs =
        String(url) === "/_agent-native/application-state"
          ? JSON.parse(String(init?.body)).writes.map(
              (write: { seq: number }) => write.seq,
            )
          : headers["X-Agent-Native-App-State-Seq"] === undefined
            ? []
            : [Number(headers["X-Agent-Native-App-State-Seq"])];
      return { writer, seqs };
    });
    expect(sent.map(({ seqs }) => seqs)).toEqual([[1], [2, 3], [4], [5], []]);
    const writers = new Set(sent.slice(0, 4).map(({ writer }) => writer));
    expect(writers.size).toBe(1);
    expect(sent[4]?.writer).toBeUndefined();

    // A reload starts a new writer, numbering from 1 again.
    vi.resetModules();
    const reloaded = await import("./application-state.js");
    await reloaded.writeClientAppState("draft", { text: "x" });
    const last = fetchMock.mock.lastCall?.[1]?.headers as Record<
      string,
      string
    >;
    expect(last["X-Agent-Native-App-State-Seq"]).toBe("1");
    expect(writers.has(last["X-Agent-Native-App-State-Writer"])).toBe(false);
  });

  it("falls back to a request per key when the server has no batch route", async () => {
    vi.resetModules();
    const fresh = await import("./application-state.js");
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        String(url) === "/_agent-native/application-state"
          ? new Response("Not found", { status: 404 })
          : jsonResponse(init?.body ? JSON.parse(String(init.body)) : {}),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([
      fresh.writeClientAppState("a", 1),
      fresh.writeClientAppState("b", 2),
    ]);
    await Promise.all([
      fresh.writeClientAppState("a", 3),
      fresh.writeClientAppState("b", 4),
    ]);

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/_agent-native/application-state",
      "/_agent-native/application-state/a",
      "/_agent-native/application-state/b",
      "/_agent-native/application-state/a",
      "/_agent-native/application-state/b",
    ]);
  });

  it("falls back to a request per key when a page answers the batch", async () => {
    vi.resetModules();
    const fresh = await import("./application-state.js");
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        String(url) === "/_agent-native/application-state"
          ? new Response("<!doctype html><html></html>", {
              headers: { "Content-Type": "text/html" },
            })
          : jsonResponse(init?.body ? JSON.parse(String(init.body)) : {}),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      Promise.all([
        fresh.writeClientAppState("a", 1),
        fresh.writeClientAppState("b", 2),
      ]),
    ).resolves.toEqual([1, 2]);

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/_agent-native/application-state",
      "/_agent-native/application-state/a",
      "/_agent-native/application-state/b",
    ]);
  });

  it("lets a read issued during a burst see the latest write", async () => {
    let releaseFirst!: () => void;
    const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "GET") {
        return Promise.resolve(
          jsonResponse({ values: { navigation: { step: 3 } }, missing: [] }),
        );
      }
      if (fetchMock.mock.calls.length === 1) {
        return new Promise<Response>((resolve) => {
          releaseFirst = () => resolve(jsonResponse({ step: 1 }));
        });
      }
      return Promise.resolve(jsonResponse(JSON.parse(String(init?.body))));
    });
    vi.stubGlobal("fetch", fetchMock);

    void writeClientAppState("navigation", { step: 1 });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    void writeClientAppState("navigation", { step: 2 });
    const read = readClientAppState("navigation");
    void writeClientAppState("navigation", { step: 3 });
    releaseFirst();

    await expect(read).resolves.toEqual({ step: 3 });
    expect(
      fetchMock.mock.calls.map(([, init]) => [init?.method, init?.body]),
    ).toEqual([
      ["PUT", JSON.stringify({ step: 1 })],
      ["PUT", JSON.stringify({ step: 3 })],
      ["GET", undefined],
    ]);
  });

  it("joins a write identical to the one in flight", async () => {
    let release!: () => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(jsonResponse({ ok: true }));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = deleteClientAppState("content-history:doc-1");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const second = setClientAppState("content-history:doc-1", null);
    release();
    await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("doesn't fold a keepalive write into an identical one sent without keepalive", async () => {
    let release!: () => void;
    const fetchMock = vi.fn(
      (_: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          release = () => resolve(jsonResponse(JSON.parse(String(init?.body))));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = writeClientAppState("draft-join", { text: "a" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const leaving = writeClientAppState(
      "draft-join",
      { text: "a" },
      { keepalive: true },
    );
    release();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    release();
    await Promise.all([first, leaving]);

    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ keepalive: true });
  });

  it("keeps a write made after a compare-and-set behind it", async () => {
    const releases: Array<() => void> = [];
    const fetchMock = vi.fn(
      (_: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          releases.push(() =>
            resolve(
              jsonResponse(
                init?.method === "PATCH"
                  ? { changed: true }
                  : JSON.parse(String(init?.body)),
              ),
            ),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = writeClientAppState("deferred", { step: 1 });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const queued = writeClientAppState("deferred", { step: 2 });
    const compare = compareAndSetClientAppState(
      "deferred",
      { step: 2 },
      { step: 3 },
    );
    const after = writeClientAppState("deferred", { step: 4 });
    for (let sent = 1; sent <= 4; sent += 1) {
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(sent));
      releases[sent - 1]();
    }
    await Promise.all([first, queued, compare, after]);

    expect(
      fetchMock.mock.calls.map(([, init]) => [init?.method, init?.body]),
    ).toEqual([
      ["PUT", JSON.stringify({ step: 1 })],
      ["PUT", JSON.stringify({ step: 2 })],
      ["PATCH", JSON.stringify({ expected: { step: 2 }, next: { step: 3 } })],
      ["PUT", JSON.stringify({ step: 4 })],
    ]);
  });

  it("sends a write with an abort signal on its own", async () => {
    const releases: Array<() => void> = [];
    const fetchMock = vi.fn(
      (_: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          releases.push(() =>
            resolve(jsonResponse(JSON.parse(String(init?.body)))),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = writeClientAppState("selection", { step: 1 });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const queued = writeClientAppState("selection", { step: 2 });
    const signalled = writeClientAppState(
      "selection",
      { step: 3 },
      { signal: new AbortController().signal },
    );
    const after = writeClientAppState("selection", { step: 4 });
    for (let sent = 1; sent <= 4; sent += 1) {
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(sent));
      releases[sent - 1]();
    }
    await Promise.all([first, queued, signalled, after]);

    expect(fetchMock.mock.calls.map(([, init]) => init?.body)).toEqual(
      [1, 2, 3, 4].map((step) => JSON.stringify({ step })),
    );
  });

  it("keeps a write sent as its own request out of a later one", async () => {
    const releases: Array<() => void> = [];
    const fetchMock = vi.fn(
      (_: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          releases.push(() =>
            resolve(jsonResponse(JSON.parse(String(init?.body)))),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = writeClientAppState("selection", { step: 1 });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const own = writeClientAppState(
      "selection",
      { step: 2 },
      { ownRequest: true },
    );
    const later = writeClientAppState("selection", { step: 3 });
    for (let sent = 1; sent <= 3; sent += 1) {
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(sent));
      releases[sent - 1]();
    }
    await Promise.all([first, later]);

    await expect(own).resolves.toEqual({ step: 2 });
    expect(fetchMock.mock.calls.map(([, init]) => init?.body)).toEqual(
      [1, 2, 3].map((step) => JSON.stringify({ step })),
    );
  });

  it("sends keepalive writes with the rest of their tick", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          results: [
            { ok: true, value: 1 },
            { ok: true, value: 2 },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const navigation = writeClientAppState("navigation", 1, {
      keepalive: true,
    });
    const selection = writeClientAppState("selection", 2, { keepalive: true });
    expect(fetchMock).not.toHaveBeenCalled();
    await Promise.all([navigation, selection]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/_agent-native/application-state",
      expect.objectContaining({ method: "POST", keepalive: true }),
    ]);
  });

  describe("writes waiting when the page hides", () => {
    async function hidablePage() {
      vi.resetModules();
      const listeners: Record<string, () => void> = {};
      const listen = (type: string, listener: () => void) => {
        listeners[type] = listener;
      };
      vi.stubGlobal("window", {
        location: { pathname: "/" },
        addEventListener: listen,
      });
      vi.stubGlobal("document", {
        visibilityState: "visible",
        addEventListener: listen,
      });
      const fresh = await import("./application-state.js");
      const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(
          String(url) === "/_agent-native/application-state"
            ? jsonResponse(
                {
                  results: JSON.parse(String(init?.body)).writes.map(
                    (write: { value: unknown }) => ({
                      ok: true,
                      value: write.value,
                    }),
                  ),
                },
                {
                  headers: {
                    "Content-Type": "application/json",
                    "X-Agent-Native-App-State-Batch": "1",
                  },
                },
              )
            : jsonResponse(JSON.parse(String(init?.body))),
        ),
      );
      vi.stubGlobal("fetch", fetchMock);
      return { fresh, fetchMock, hide: () => listeners.pagehide?.() };
    }

    it("go at once, one key at a time until the batch route has answered", async () => {
      const { fresh, fetchMock, hide } = await hidablePage();

      const waiting = fresh.writeClientAppState("selection", 1);
      const leaving = fresh.writeClientAppState("draft", 2, {
        keepalive: true,
      });
      await Promise.resolve();
      expect(fetchMock).not.toHaveBeenCalled();
      hide();

      // Falling back from a server without the batch route would need the
      // page to live on, so each write takes its own route.
      expect(fetchMock.mock.calls).toEqual([
        [
          "/_agent-native/application-state/selection",
          expect.objectContaining({ method: "PUT", keepalive: true }),
        ],
        [
          "/_agent-native/application-state/draft",
          expect.objectContaining({ method: "PUT", keepalive: true }),
        ],
      ]);
      await Promise.all([waiting, leaving]);
    });

    it("go at once as one batch once the batch route has answered", async () => {
      const { fresh, fetchMock, hide } = await hidablePage();
      await Promise.all([
        fresh.writeClientAppState("selection", 0),
        fresh.writeClientAppState("draft", 1),
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const waiting = fresh.writeClientAppState("selection", 1);
      const leaving = fresh.writeClientAppState("draft", 2, {
        keepalive: true,
      });
      await Promise.resolve();
      hide();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1]).toEqual([
        "/_agent-native/application-state",
        expect.objectContaining({ method: "POST", keepalive: true }),
      ]);
      await expect(Promise.all([waiting, leaving])).resolves.toEqual([1, 2]);
    });
  });

  describe("keepalive budget", () => {
    // Browsers refuse a keepalive request once the keepalive bodies in flight
    // pass 64 KiB, counted in encoded bytes. Application state keeps room in
    // that for a document save (see keepalive-budget).
    const KEEPALIVE_BYTES = KEEPALIVE_PAGE_LIMIT_BYTES;
    const APP_STATE_ROOM =
      KEEPALIVE_PAGE_LIMIT_BYTES - ACTION_KEEPALIVE_BODY_BUDGET_BYTES;
    const encodedLength = (body: unknown) =>
      new TextEncoder().encode(String(body ?? "")).length;

    function browserLikeFetch(hold?: (url: string) => Promise<void>) {
      let inFlight = 0;
      let peak = 0;
      const overBudget: number[] = [];
      const fetchMock = vi.fn(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          const bytes = init?.keepalive ? encodedLength(init.body) : 0;
          if (inFlight + bytes > KEEPALIVE_BYTES) {
            overBudget.push(inFlight + bytes);
            throw new TypeError("Failed to fetch");
          }
          inFlight += bytes;
          peak = Math.max(peak, inFlight);
          try {
            await hold?.(String(url));
            const body = JSON.parse(String(init?.body));
            if (init?.method === "PATCH")
              return jsonResponse({ changed: true });
            return jsonResponse(
              String(url) === "/_agent-native/application-state"
                ? {
                    results: body.writes.map((write: { value: unknown }) => ({
                      ok: true,
                      value: write.value,
                    })),
                  }
                : body,
              {
                headers: {
                  "Content-Type": "application/json",
                  "X-Agent-Native-App-State-Batch": "1",
                },
              },
            );
          } finally {
            inFlight -= bytes;
          }
        },
      );
      return { fetchMock, overBudget, peak: () => peak };
    }

    it("splits keepalive writes by encoded bytes so each stays keepalive", async () => {
      vi.resetModules();
      const fresh = await import("./application-state.js");
      const { fetchMock, overBudget } = browserLikeFetch();
      vi.stubGlobal("fetch", fetchMock);
      const big = "a".repeat(8_000);

      await expect(
        Promise.all([
          fresh.writeClientAppState("a", big, { keepalive: true }),
          fresh.writeClientAppState("b", big, { keepalive: true }),
        ]),
      ).resolves.toEqual([big, big]);

      expect(overBudget).toEqual([]);
      const keepaliveBodies = fetchMock.mock.calls
        .filter(([, init]) => init?.keepalive === true)
        .map(([, init]) => String(init?.body))
        .join("");
      expect(keepaliveBodies.split(big).length - 1).toBe(2);
    });

    it("counts multi-byte characters against the budget", async () => {
      vi.resetModules();
      const fresh = await import("./application-state.js");
      const { fetchMock, overBudget, peak } = browserLikeFetch();
      vi.stubGlobal("fetch", fetchMock);
      // 15,000 bytes each: one fits beside room for a document save, but
      // counted as characters both would.
      const wide = "漢".repeat(5_000);

      await expect(
        Promise.all([
          fresh.writeClientAppState("a", wide, { keepalive: true }),
          fresh.writeClientAppState("b", wide, { keepalive: true }),
        ]),
      ).resolves.toEqual([wide, wide]);
      expect(overBudget).toEqual([]);
      expect(peak()).toBeGreaterThan(0);
      expect(peak()).toBeLessThanOrEqual(APP_STATE_ROOM);
    });

    it("leaves room for keepalive writes already in flight", async () => {
      vi.resetModules();
      const fresh = await import("./application-state.js");
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { fetchMock, overBudget } = browserLikeFetch((url) =>
        url.endsWith("/a") ? held : Promise.resolve(),
      );
      vi.stubGlobal("fetch", fetchMock);

      const first = fresh.writeClientAppState("a", "a".repeat(10_000), {
        keepalive: true,
      });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const second = fresh.writeClientAppState("b", "b".repeat(8_000), {
        keepalive: true,
      });
      await expect(second).resolves.toBe("b".repeat(8_000));
      expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ keepalive: false });
      release();
      await first;
      expect(overBudget).toEqual([]);
    });

    function heldFetch(heldUrl: (url: string) => boolean) {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const browser = browserLikeFetch((url) =>
        heldUrl(url) ? held : Promise.resolve(),
      );
      return { ...browser, release };
    }

    it("leaves room for a keepalive compare-and-set in flight", async () => {
      vi.resetModules();
      const fresh = await import("./application-state.js");
      const { fetchMock, overBudget, release } = heldFetch((url) =>
        url.endsWith("/cas"),
      );
      vi.stubGlobal("fetch", fetchMock);

      const swap = fresh.compareAndSetClientAppState(
        "cas",
        null,
        { text: "c".repeat(10_000) },
        { keepalive: true },
      );
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const batch = Promise.all([
        fresh.writeClientAppState("a", "a".repeat(4_000), { keepalive: true }),
        fresh.writeClientAppState("b", "b".repeat(4_000), { keepalive: true }),
      ]);
      await expect(batch).resolves.toEqual([
        "a".repeat(4_000),
        "b".repeat(4_000),
      ]);
      release();
      await expect(swap).resolves.toBe(true);
      expect(overBudget).toEqual([]);
    });

    it("sends a compare-and-set without keepalive when a batch in flight leaves no room", async () => {
      vi.resetModules();
      const fresh = await import("./application-state.js");
      const { fetchMock, overBudget, release } = heldFetch(
        (url) => url === "/_agent-native/application-state",
      );
      vi.stubGlobal("fetch", fetchMock);

      const batch = Promise.all([
        fresh.writeClientAppState("a", "a".repeat(4_000), { keepalive: true }),
        fresh.writeClientAppState("b", "b".repeat(4_000), { keepalive: true }),
      ]);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const swap = fresh.compareAndSetClientAppState(
        "cas",
        null,
        { text: "c".repeat(10_000) },
        { keepalive: true },
      );
      await expect(swap).resolves.toBe(true);
      expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
        method: "PATCH",
        keepalive: false,
      });
      release();
      await batch;
      expect(overBudget).toEqual([]);
    });
  });

  describe("page teardown", () => {
    async function hidingPage(visibilityState = "visible") {
      vi.resetModules();
      const listeners: Record<string, Array<() => void>> = {};
      const listen = (type: string, listener: () => void) => {
        (listeners[type] ??= []).push(listener);
      };
      vi.stubGlobal("window", {
        location: { pathname: "/" },
        addEventListener: listen,
      });
      vi.stubGlobal("document", { visibilityState, addEventListener: listen });
      const fresh = await import("./application-state.js");
      const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "null"));
        return Promise.resolve(
          jsonResponse(
            String(url) === "/_agent-native/application-state"
              ? {
                  results: body.writes.map((write: { value: unknown }) => ({
                    ok: true,
                    value: write.value,
                  })),
                }
              : body,
          ),
        );
      });
      vi.stubGlobal("fetch", fetchMock);
      return { fresh, listeners, listen, fetchMock };
    }

    const sentKeys = (fetchMock: ReturnType<typeof vi.fn>) =>
      fetchMock.mock.calls.flatMap(([url, init]) => {
        const body = JSON.parse(String(init?.body));
        return String(url) === "/_agent-native/application-state"
          ? body.writes.map((write: { key: string }) => [
              write.key,
              init.keepalive,
            ])
          : [[String(url).split("/").pop(), init.keepalive]];
      });

    it("sends writes made by pagehide handlers before or after its own, with keepalive", async () => {
      const { fresh, listeners, listen, fetchMock } = await hidingPage();
      const writes: Promise<unknown>[] = [];
      listen("pagehide", () => {
        writes.push(fresh.writeClientAppState("early", 1));
      });
      writes.push(fresh.writeClientAppState("waiting", 2));
      await Promise.resolve();
      listen("pagehide", () => {
        writes.push(fresh.writeClientAppState("late", 3));
      });

      for (const listener of listeners.pagehide ?? []) listener();

      expect(sentKeys(fetchMock)).toEqual(
        expect.arrayContaining([
          ["early", true],
          ["waiting", true],
          ["late", true],
        ]),
      );
      await Promise.all(writes);
    });

    it("sends a keepalive write waiting behind one in flight when the page hides", async () => {
      const { fresh, listeners, fetchMock } = await hidingPage();
      fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}));

      void fresh.writeClientAppState("draft", { text: "a" });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const last = fresh.writeClientAppState(
        "draft",
        { text: "ab" },
        { keepalive: true },
      );
      await Promise.resolve();
      for (const listener of listeners.pagehide ?? []) listener();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
        body: JSON.stringify({ text: "ab" }),
        keepalive: true,
      });
      void last;
    });

    it("sends a keepalive write sent as its own request when the page hides", async () => {
      const { fresh, listeners, fetchMock } = await hidingPage();
      fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}));

      void fresh.writeClientAppState("draft", { text: "a" });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const own = fresh.writeClientAppState(
        "draft",
        { text: "ab" },
        { keepalive: true, ownRequest: true },
      );
      void fresh.writeClientAppState(
        "draft",
        { text: "abc" },
        { keepalive: true },
      );
      await Promise.resolve();
      for (const listener of listeners.pagehide ?? []) listener();

      // Left waiting, neither would be sent once the page is gone.
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
      expect(
        fetchMock.mock.calls.slice(1).map(([, init]) => ({
          body: init?.body,
          keepalive: init?.keepalive,
        })),
      ).toEqual([
        { body: JSON.stringify({ text: "ab" }), keepalive: true },
        { body: JSON.stringify({ text: "abc" }), keepalive: true },
      ]);
      void own;
    });

    it("doesn't send a write sent as its own request ahead of a compare-and-set when the page hides", async () => {
      const { fresh, listeners, fetchMock } = await hidingPage();
      let commitFirst!: () => void;
      fetchMock.mockImplementationOnce(
        (_url, init) =>
          new Promise<Response>((resolve) => {
            commitFirst = () =>
              resolve(jsonResponse(JSON.parse(String(init?.body))));
          }),
      );
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve(jsonResponse({ changed: true })),
      );

      const first = fresh.writeClientAppState("draft", { text: "a" });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const swap = fresh.compareAndSetClientAppState(
        "draft",
        { text: "a" },
        { text: "b" },
      );
      const own = fresh.writeClientAppState(
        "draft",
        { text: "c" },
        { keepalive: true, ownRequest: true },
      );
      await Promise.resolve();
      for (const listener of listeners.pagehide ?? []) listener();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      commitFirst();
      await Promise.all([first, swap, own]);
      expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual([
        "PUT",
        "PATCH",
        "PUT",
      ]);
    });

    it("sends a write sent as its own request when the page hides, though a compare-and-set made after it waits", async () => {
      const { fresh, listeners, fetchMock } = await hidingPage();
      let commitFirst!: () => void;
      fetchMock.mockImplementationOnce(
        (_url, init) =>
          new Promise<Response>((resolve) => {
            commitFirst = () =>
              resolve(jsonResponse(JSON.parse(String(init?.body))));
          }),
      );

      const first = fresh.writeClientAppState("draft", { text: "a" });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const own = fresh.writeClientAppState(
        "draft",
        { text: "b" },
        { keepalive: true, ownRequest: true },
      );
      const swap = fresh.compareAndSetClientAppState(
        "draft",
        { text: "b" },
        { text: "c" },
      );
      await Promise.resolve();
      for (const listener of listeners.pagehide ?? []) listener();

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
        method: "PUT",
        body: JSON.stringify({ text: "b" }),
        keepalive: true,
      });
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve(jsonResponse({ changed: true })),
      );
      commitFirst();
      await Promise.all([first, own, swap]);
      expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual([
        "PUT",
        "PUT",
        "PATCH",
      ]);
    });

    it("sends a write sent as its own request at once when it's made while the page is hidden", async () => {
      const { fresh, fetchMock } = await hidingPage("hidden");
      fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}));

      void fresh.writeClientAppState("draft", { text: "a" });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      void fresh.writeClientAppState(
        "draft",
        { text: "ab" },
        { keepalive: true, ownRequest: true },
      );

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
        body: JSON.stringify({ text: "ab" }),
        keepalive: true,
      });
    });

    it("sends a waiting write sent as its own request when the tab is hidden", async () => {
      const { fresh, listeners, fetchMock } = await hidingPage();
      fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}));

      void fresh.writeClientAppState("draft", { text: "a" });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      void fresh.writeClientAppState(
        "draft",
        { text: "ab" },
        { keepalive: true, ownRequest: true },
      );
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // A hidden tab may be discarded without a pagehide.
      (document as { visibilityState: string }).visibilityState = "hidden";
      for (const listener of listeners.visibilitychange ?? []) listener();

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
        body: JSON.stringify({ text: "ab" }),
        keepalive: true,
      });
    });

    it("keeps the newer value when it fails on the client and the write it jumped ahead of commits last", async () => {
      const { fresh, listeners, fetchMock } = await hidingPage();
      // A server that applies the write order: it skips a write numbered at
      // or below the last one it applied from the same writer.
      let stored: { value: unknown; writer?: string; seq?: number } = {
        value: null,
      };
      const apply = (init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        const writer = headers["X-Agent-Native-App-State-Writer"];
        const seq = Number(headers["X-Agent-Native-App-State-Seq"]);
        if (stored.writer !== writer || (stored.seq ?? 0) < seq) {
          stored = { value: JSON.parse(String(init?.body)), writer, seq };
        }
      };
      let commitOlder!: () => void;
      fetchMock.mockImplementation((_url, init) => {
        if (fetchMock.mock.calls.length === 1) {
          return new Promise<Response>((resolve) => {
            commitOlder = () => {
              apply(init);
              resolve(jsonResponse(JSON.parse(String(init?.body))));
            };
          });
        }
        // The newer write lands, but its answer never reaches the page.
        apply(init);
        return Promise.reject(new TypeError("Failed to fetch"));
      });

      const older = fresh.writeClientAppState("draft", { text: "a" });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const newer = fresh.writeClientAppState(
        "draft",
        { text: "ab" },
        { keepalive: true },
      );
      await Promise.resolve();
      for (const listener of listeners.pagehide ?? []) listener();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(stored.value).toEqual({ text: "ab" });

      commitOlder();
      await older;
      await expect(newer).rejects.toThrow("Failed to fetch");

      expect(stored.value).toEqual({ text: "ab" });
      // Nothing was sent again: the order alone keeps the newer value.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("keeps the newest value when a signalled delete sits between it and a write in flight", async () => {
      const { fresh, listeners, fetchMock } = await hidingPage();
      // A server that applies the write order: it skips a write or delete
      // numbered at or below the last write it applied from the same writer.
      // A delete leaves no record.
      let stored: { value: unknown; writer?: string; seq?: number } = {
        value: null,
      };
      const seqs: number[] = [];
      const apply = (init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        const writer = headers["X-Agent-Native-App-State-Writer"];
        const seq = Number(headers["X-Agent-Native-App-State-Seq"]);
        seqs.push(seq);
        if (stored.writer === writer && (stored.seq ?? 0) >= seq) return;
        stored =
          init?.method === "DELETE"
            ? { value: null }
            : { value: JSON.parse(String(init?.body)), writer, seq };
      };
      let commitFirst!: () => void;
      fetchMock.mockImplementation((_url, init) => {
        if (fetchMock.mock.calls.length === 1) {
          return new Promise<Response>((resolve) => {
            commitFirst = () => {
              apply(init);
              resolve(jsonResponse(JSON.parse(String(init?.body))));
            };
          });
        }
        apply(init);
        return Promise.resolve(
          jsonResponse(init?.body ? JSON.parse(String(init.body)) : null),
        );
      });

      const first = fresh.writeClientAppState("draft", { text: "a" });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const deletion = fresh.deleteClientAppState("draft", {
        signal: new AbortController().signal,
      });
      const newest = fresh.writeClientAppState(
        "draft",
        { text: "abc" },
        { keepalive: true },
      );
      await Promise.resolve();
      for (const listener of listeners.pagehide ?? []) listener();

      // The newest write doesn't go ahead of the signalled delete.
      expect(fetchMock).toHaveBeenCalledTimes(1);

      commitFirst();
      await Promise.all([first, deletion, newest]);
      expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual([
        "PUT",
        "DELETE",
        "PUT",
      ]);
      // Each carries its number from when it was made.
      expect(seqs).toEqual([1, 2, 3]);
      expect(stored.value).toEqual({ text: "abc" });
    });

    it("keeps a write sent as its own request that goes ahead of a queued delete when the page hides", async () => {
      const { fresh, listeners, fetchMock } = await hidingPage();
      // A server that applies the write order, as above.
      let stored: { value: unknown; writer?: string; seq?: number } = {
        value: null,
      };
      const apply = (init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        const writer = headers["X-Agent-Native-App-State-Writer"];
        const seq = Number(headers["X-Agent-Native-App-State-Seq"]);
        if (stored.writer === writer && (stored.seq ?? 0) >= seq) return;
        stored =
          init?.method === "DELETE"
            ? { value: null }
            : { value: JSON.parse(String(init?.body)), writer, seq };
      };
      let commitFirst!: () => void;
      fetchMock.mockImplementation((_url, init) => {
        if (fetchMock.mock.calls.length === 1) {
          return new Promise<Response>((resolve) => {
            commitFirst = () => {
              apply(init);
              resolve(jsonResponse(JSON.parse(String(init?.body))));
            };
          });
        }
        apply(init);
        return Promise.resolve(
          jsonResponse(init?.body ? JSON.parse(String(init.body)) : null),
        );
      });

      const first = fresh.writeClientAppState("draft", { text: "a" });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const deletion = fresh.deleteClientAppState("draft", { keepalive: true });
      const own = fresh.writeClientAppState(
        "draft",
        { text: "ab" },
        { keepalive: true, ownRequest: true },
      );
      await Promise.resolve();
      for (const listener of listeners.pagehide ?? []) listener();
      await vi.waitFor(() => expect(stored.value).toEqual({ text: "ab" }));

      // The delete was made first, so its lower number has the server skip it
      // when it lands after the newer write.
      commitFirst();
      await Promise.all([first, deletion, own]);
      expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toContain(
        "DELETE",
      );
      expect(stored.value).toEqual({ text: "ab" });
    });

    it("doesn't send a write ahead of a compare-and-set when the page hides", async () => {
      const { fresh, listeners, fetchMock } = await hidingPage();
      let commitFirst!: () => void;
      fetchMock.mockImplementationOnce(
        (_url, init) =>
          new Promise<Response>((resolve) => {
            commitFirst = () =>
              resolve(jsonResponse(JSON.parse(String(init?.body))));
          }),
      );
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve(jsonResponse({ changed: true })),
      );

      const first = fresh.writeClientAppState("draft", { text: "a" });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const swap = fresh.compareAndSetClientAppState(
        "draft",
        { text: "a" },
        { text: "b" },
      );
      const newest = fresh.writeClientAppState(
        "draft",
        { text: "c" },
        { keepalive: true },
      );
      await Promise.resolve();
      for (const listener of listeners.pagehide ?? []) listener();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      commitFirst();
      await Promise.all([first, swap, newest]);
      expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual([
        "PUT",
        "PATCH",
        "PUT",
      ]);
    });

    it("sends a queued keepalive delete when the page hides", async () => {
      const { fresh, listeners, fetchMock } = await hidingPage();
      let commitOlder!: () => void;
      fetchMock.mockImplementationOnce(
        (_url, init) =>
          new Promise<Response>((resolve) => {
            commitOlder = () =>
              resolve(jsonResponse(JSON.parse(String(init?.body))));
          }),
      );

      const older = fresh.writeClientAppState("draft", { text: "a" });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const deletion = fresh.deleteClientAppState("draft", { keepalive: true });
      await Promise.resolve();
      for (const listener of listeners.pagehide ?? []) listener();

      // Left waiting, the delete would never be sent once the page is gone.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
        method: "DELETE",
        keepalive: true,
        headers: expect.objectContaining({
          "X-Agent-Native-App-State-Seq": "2",
        }),
      });

      commitOlder();
      await older;
      await deletion;
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("sends a write made while the page is hidden at once, with keepalive", async () => {
      const { fresh, fetchMock } = await hidingPage("hidden");

      const write = fresh.writeClientAppState("draft", { text: "bye" });

      expect(sentKeys(fetchMock)).toEqual([["draft", true]]);
      await write;
    });
  });

  describe("batch answers", () => {
    const batchHeaders = {
      "Content-Type": "application/json",
      "X-Agent-Native-App-State-Batch": "1",
    };

    async function batching(answer: () => Response) {
      vi.resetModules();
      const fresh = await import("./application-state.js");
      const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(
          String(url) === "/_agent-native/application-state" &&
            init?.method === "POST"
            ? answer()
            : jsonResponse(init?.body ? JSON.parse(String(init.body)) : {}),
        ),
      );
      vi.stubGlobal("fetch", fetchMock);
      return { fresh, fetchMock };
    }

    it("doesn't replay writes when the batch answer can't be read", async () => {
      const { fresh, fetchMock } = await batching(
        () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error("connection reset"));
              },
            }),
            { headers: batchHeaders },
          ),
      );

      const results = await Promise.allSettled([
        fresh.writeClientAppState("a", 1),
        fresh.writeClientAppState("b", 2),
      ]);

      expect(results.map(({ status }) => status)).toEqual([
        "rejected",
        "rejected",
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("doesn't replay writes when the batch route answers malformed JSON", async () => {
      const { fresh, fetchMock } = await batching(
        () => new Response("{not json", { headers: batchHeaders }),
      );

      const results = await Promise.allSettled([
        fresh.writeClientAppState("a", 1),
        fresh.writeClientAppState("b", 2),
      ]);

      expect(results.map(({ status }) => status)).toEqual([
        "rejected",
        "rejected",
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("rejects every write when a result entry is malformed", async () => {
      const { fresh } = await batching(() =>
        jsonResponse(
          { results: [null, { ok: true, value: 2 }] },
          { headers: batchHeaders },
        ),
      );

      const results = await Promise.allSettled([
        fresh.writeClientAppState("a", 1),
        fresh.writeClientAppState("b", 2),
      ]);

      expect(results.map(({ status }) => status)).toEqual([
        "rejected",
        "rejected",
      ]);
      expect(fresh.isClientAppStateMutationPending("a")).toBe(false);
      expect(fresh.isClientAppStateMutationPending("b")).toBe(false);
    });

    it("keeps batching after a server error without replaying", async () => {
      const { fresh, fetchMock } = await batching(() =>
        jsonResponse({ error: "boom" }, { status: 500 }),
      );

      await Promise.allSettled([
        fresh.writeClientAppState("a", 1),
        fresh.writeClientAppState("b", 2),
      ]);
      await Promise.allSettled([
        fresh.writeClientAppState("a", 3),
        fresh.writeClientAppState("b", 4),
      ]);

      expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
        "/_agent-native/application-state",
        "/_agent-native/application-state",
      ]);
    });
  });

  it("makes a read through a tab's explicit key wait for a write through its alias", async () => {
    vi.stubGlobal("window", {
      sessionStorage: { getItem: () => "tab-1", setItem: () => {} },
    });
    const tab = getBrowserTabId();
    const methods: string[] = [];
    const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
      methods.push(String(init?.method));
      return Promise.resolve(
        init?.method === "GET"
          ? jsonResponse({
              values: { [`navigation:${tab}`]: { view: "new" } },
              missing: [],
            })
          : jsonResponse(JSON.parse(String(init?.body))),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    void writeClientAppState("navigation", { view: "new" });
    await readClientAppStateMany([`navigation:${tab}`]);

    expect(methods).toEqual(["PUT", "GET"]);
  });
});

describe("application state before an agent turn", () => {
  let state: typeof import("./application-state.js");
  beforeEach(async () => {
    vi.resetModules();
    state = await import("./application-state.js");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("saves startup state when the initial session resolves before the batch is sent", async () => {
    const { recordSessionIdentity } = await import("./session-identity.js");
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      jsonResponse(JSON.parse(String(init?.body))),
    );
    vi.stubGlobal("fetch", fetcher);
    const save = state.writeClientAppState("navigation", { view: "inbox" });
    recordSessionIdentity("synthetic-user", "synthetic-org");
    await expect(save).resolves.toEqual({ view: "inbox" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not return a multi-key read from before the initial session resolves", async () => {
    const { recordSessionIdentity } = await import("./session-identity.js");
    const response = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        started.resolve();
        return response.promise;
      }),
    );
    const read = state.readClientAppStateMany(["navigation", "selection"]);
    await started.promise;
    recordSessionIdentity("synthetic-user", "synthetic-org");
    response.resolve(
      jsonResponse({ values: { navigation: "old" }, missing: [] }),
    );
    await expect(read).rejects.toThrow("scope changed before reading");
  });

  it("keeps startup writes ordered and waits for them before an agent turn", async () => {
    const { recordSessionIdentity } = await import("./session-identity.js");
    const response = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    const fetcher = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) => {
      started.resolve();
      return response.promise;
    });
    vi.stubGlobal("fetch", fetcher);
    const first = state.writeClientAppState("navigation", { view: "first" });
    recordSessionIdentity("synthetic-user", "synthetic-org");
    const latest = state.writeClientAppState("navigation", { view: "latest" });
    let flushed = false;
    const turn = state.flushClientAppStateBeforeAgentTurn().then(() => {
      flushed = true;
    });
    await started.promise;
    expect(flushed).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      view: "latest",
    });
    response.resolve(jsonResponse({ view: "latest" }));
    await expect(Promise.all([first, latest, turn])).resolves.toEqual([
      { view: "latest" },
      { view: "latest" },
      undefined,
    ]);
  });

  it("does not retarget a write after a known session becomes unknown", async () => {
    const { recordSessionIdentity } = await import("./session-identity.js");
    recordSessionIdentity("first-user", "first-org");
    recordSessionIdentity(undefined);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const save = state.writeClientAppState("navigation", { view: "private" });
    recordSessionIdentity("second-user", "second-org");
    await expect(save).rejects.toThrow("scope changed before saving");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not retarget startup state after a session invalidation", async () => {
    const { announceSessionInvalidated, recordSessionIdentity } =
      await import("./session-identity.js");
    const fetcher = vi.fn(async () => jsonResponse({ view: "private" }));
    vi.stubGlobal("fetch", fetcher);
    const save = state.writeClientAppState("navigation", { view: "private" });
    announceSessionInvalidated();
    recordSessionIdentity("second-user", "second-org");
    await expect(save).rejects.toThrow("scope changed before saving");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fences queued state as soon as a known session is invalidated", async () => {
    const { announceSessionInvalidated, recordSessionIdentity } =
      await import("./session-identity.js");
    recordSessionIdentity("first-user", "first-org");
    const fetcher = vi.fn(async () => jsonResponse({ view: "private" }));
    vi.stubGlobal("fetch", fetcher);
    const save = state.writeClientAppState("navigation", { view: "private" });
    announceSessionInvalidated();
    recordSessionIdentity("first-user", "first-org");
    await expect(save).rejects.toThrow("scope changed before saving");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["write", "delete", "compare"])(
    "does not send a %s while the invalidated session is being verified",
    async (operation) => {
      const { announceSessionInvalidated, recordSessionIdentity } =
        await import("./session-identity.js");
      recordSessionIdentity("first-user", "first-org");
      const fetcher = vi.fn(async () => jsonResponse({ view: "private" }));
      vi.stubGlobal("fetch", fetcher);
      announceSessionInvalidated();
      const save =
        operation === "write"
          ? state.writeClientAppState("navigation", { view: "private" })
          : operation === "delete"
            ? state.deleteClientAppState("navigation")
            : state.compareAndSetClientAppState("navigation", null, {
                view: "private",
              });
      await expect(save).rejects.toThrow(
        "Application state session is being verified",
      );
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each(["single", "many"])(
    "does not send a %s read while the invalidated session is being verified",
    async (operation) => {
      const { announceSessionInvalidated, recordSessionIdentity } =
        await import("./session-identity.js");
      recordSessionIdentity("first-user", "first-org");
      const fetcher = vi.fn(async () =>
        jsonResponse({ values: { navigation: "private" }, missing: [] }),
      );
      vi.stubGlobal("fetch", fetcher);
      announceSessionInvalidated();
      const read =
        operation === "single"
          ? state.readClientAppState("navigation")
          : state.readClientAppStateMany(["navigation"]);
      await expect(read).rejects.toThrow(
        "Application state session is being verified",
      );
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("keeps state fenced if a scope update still leaves the identity unknown", async () => {
    const {
      announceSessionInvalidated,
      notifySessionIdentityPublished,
      recordSessionIdentity,
    } = await import("./session-identity.js");
    recordSessionIdentity("first-user", "first-org");
    const fetcher = vi.fn(async () => jsonResponse({ view: "private" }));
    vi.stubGlobal("fetch", fetcher);
    announceSessionInvalidated();
    recordSessionIdentity(undefined, "pending-org");
    notifySessionIdentityPublished(null);
    await expect(
      state.writeClientAppState("navigation", { view: "private" }),
    ).rejects.toThrow("Application state session is being verified");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("waits for session confirmation and preserves flushers when the session is unchanged", async () => {
    const {
      announceSessionInvalidated,
      notifySessionIdentityPublished,
      recordSessionIdentity,
    } = await import("./session-identity.js");
    recordSessionIdentity("first-user", "first-org");
    const flush = vi.fn();
    const unregister = state.registerBeforeAgentTurnFlush(flush);
    try {
      announceSessionInvalidated();
      await expect(state.flushClientAppStateBeforeAgentTurn()).rejects.toThrow(
        "Application state session is being verified",
      );
      expect(flush).not.toHaveBeenCalled();
      notifySessionIdentityPublished("first-user\nfirst-org");
      await expect(
        state.flushClientAppStateBeforeAgentTurn(),
      ).resolves.toBeUndefined();
      expect(flush).toHaveBeenCalledTimes(1);
    } finally {
      unregister();
    }
  });

  it("keeps a queued save when the same session is confirmed before dispatch", async () => {
    const {
      announceSessionInvalidated,
      notifySessionIdentityPublished,
      recordSessionIdentity,
    } = await import("./session-identity.js");
    recordSessionIdentity("first-user", "first-org");
    const fetcher = vi.fn(async () => jsonResponse({ view: "inbox" }));
    vi.stubGlobal("fetch", fetcher);
    const save = state.writeClientAppState("navigation", { view: "inbox" });
    announceSessionInvalidated();
    notifySessionIdentityPublished("first-user\nfirst-org");
    await expect(save).resolves.toEqual({ view: "inbox" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not restore prior-session flushers when verification finds another session", async () => {
    const {
      announceSessionInvalidated,
      notifySessionIdentityPublished,
      recordSessionIdentity,
    } = await import("./session-identity.js");
    recordSessionIdentity("first-user", "first-org");
    const flush = vi.fn();
    const unregister = state.registerBeforeAgentTurnFlush(flush);
    try {
      announceSessionInvalidated();
      recordSessionIdentity("second-user", "second-org");
      notifySessionIdentityPublished("second-user\nsecond-org");
      await expect(
        state.flushClientAppStateBeforeAgentTurn(),
      ).resolves.toBeUndefined();
      expect(flush).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  it("fences startup state when an invalidation was missed before listeners installed", async () => {
    vi.resetModules();
    vi.stubGlobal("window", {
      location: { pathname: "/" },
      addEventListener: vi.fn(),
      __agentNativeSessionBootstrapInvalidation: "before",
      localStorage: { getItem: () => "after" },
    });
    const fresh = await import("./application-state.js");
    const { recordSessionIdentity } = await import("./session-identity.js");
    const fetcher = vi.fn(async () => jsonResponse({ view: "private" }));
    vi.stubGlobal("fetch", fetcher);
    const save = fresh.writeClientAppState("navigation", { view: "private" });
    recordSessionIdentity("second-user", "second-org");
    await expect(save).rejects.toThrow("scope changed before saving");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("flushes deferred selection and waits for its actual write response", async () => {
    const { promise, resolve } = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    const fetcher = vi.fn(() => {
      started.resolve();
      return promise;
    });
    vi.stubGlobal("fetch", fetcher);
    const unregister = state.registerBeforeAgentTurnFlush(() =>
      state.setClientAppState("selection", { id: "selected-now" }),
    );
    try {
      let ready = false;
      const flushed = state.flushClientAppStateBeforeAgentTurn().then(() => {
        ready = true;
      });
      await started.promise;
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(ready).toBe(false);
      resolve(jsonResponse({ ok: true }));
      await flushed;
      expect(ready).toBe(true);
    } finally {
      unregister();
    }
  });

  it.each(["selection", "unregistered-context"])(
    "refuses a turn when an in-flight %s save fails",
    async (key) => {
      const { promise, resolve } = Promise.withResolvers<Response>();
      vi.stubGlobal("fetch", () => promise);
      const write = state.setClientAppState(key, { id: "selected-now" });
      const written = (async () => {
        await expect(write).rejects.toThrow();
      })();
      const flushed = (async () => {
        await expect(
          state.flushClientAppStateBeforeAgentTurn(),
        ).rejects.toThrow();
      })();
      resolve(new Response("Unavailable", { status: 503 }));
      await Promise.all([written, flushed]);
    },
  );

  it.each(["write", "delete", "compare"] as const)(
    "retains a settled %s failure until the same state row is saved",
    async (method) => {
      const fetcher = vi.fn(async (url: string) =>
        url.endsWith("/unrelated")
          ? jsonResponse({ ok: true })
          : jsonResponse({ error: "Save unavailable" }, { status: 503 }),
      );
      vi.stubGlobal("fetch", fetcher);
      const save =
        method === "write"
          ? state.writeClientAppState("selection", { id: "chosen" })
          : method === "delete"
            ? state.deleteClientAppState("selection")
            : state.compareAndSetClientAppState("selection", null, {
                id: "chosen",
              });
      await expect(save).rejects.toThrow("Save unavailable");
      await expect(state.flushClientAppStateBeforeAgentTurn()).rejects.toThrow(
        "Save unavailable",
      );
      await state.writeClientAppState("unrelated", { id: "other" });
      await expect(state.flushClientAppStateBeforeAgentTurn()).rejects.toThrow(
        "Save unavailable",
      );
      fetcher.mockImplementation(async () => jsonResponse({ ok: true }));
      const unregister = state.registerBeforeAgentTurnFlush(() =>
        state.writeClientAppState("selection", { id: "chosen" }),
      );
      try {
        await expect(
          state.flushClientAppStateBeforeAgentTurn(),
        ).resolves.toBeUndefined();
      } finally {
        unregister();
      }
    },
  );

  it("keeps a failed state row blocked when a compare-and-set does not apply", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: "Save unavailable" }, { status: 503 }),
      )
      .mockResolvedValueOnce(jsonResponse({ changed: false }));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      state.writeClientAppState("selection", { id: "chosen" }),
    ).rejects.toThrow("Save unavailable");
    await expect(
      state.compareAndSetClientAppState("selection", null, { id: "chosen" }),
    ).resolves.toBe(false);
    await expect(state.flushClientAppStateBeforeAgentTurn()).rejects.toThrow(
      "Save unavailable",
    );
  });

  it("isolates settled save failures to the mounted app and browser tab", async () => {
    const fakeWindow = {
      location: { pathname: "/risk/register" },
      __AGENT_NATIVE_CONFIG__: {
        workspaceRuntime: true,
        workspaceAppMountPaths: ["/risk", "/chat"],
      },
    };
    vi.stubGlobal("window", fakeWindow);
    const stored = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    });
    const fetcher = vi.fn(async (url: string) =>
      url.startsWith("/risk/")
        ? jsonResponse({ error: "Risk save unavailable" }, { status: 503 })
        : jsonResponse({ ok: true }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      state.writeClientAppState("selection", { id: "risk" }),
    ).rejects.toThrow("Risk save unavailable");
    fakeWindow.location.pathname = "/chat/thread-1";
    await expect(
      state.flushClientAppStateBeforeAgentTurn(),
    ).resolves.toBeUndefined();
    await state.writeClientAppState("selection", { id: "chat" });
    fakeWindow.location.pathname = "/risk/register";
    await expect(state.flushClientAppStateBeforeAgentTurn()).rejects.toThrow(
      "Risk save unavailable",
    );
  });

  it("does not let an unregistered unrelated failure poison later turns", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: "Temporarily unavailable" }, { status: 503 }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      state.writeClientAppState("unregistered-context", { id: "original" }),
    ).rejects.toThrow("Temporarily unavailable");
    await expect(
      state.flushClientAppStateBeforeAgentTurn(),
    ).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps registered custom failures required until every owner unmounts or the row saves", async () => {
    const first = state.registerBeforeAgentTurnStateKeys(["editor-context"]);
    const second = state.registerBeforeAgentTurnStateKeys([
      "editor-context",
      "editor-context",
    ]);
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: "Editor unavailable" }, { status: 503 }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      state.writeClientAppState("editor-context", { id: "draft" }),
    ).rejects.toThrow("Editor unavailable");
    await expect(state.flushClientAppStateBeforeAgentTurn()).rejects.toThrow(
      "Editor unavailable",
    );
    first();
    first();
    await expect(state.flushClientAppStateBeforeAgentTurn()).rejects.toThrow(
      "Editor unavailable",
    );
    second();
    await expect(
      state.flushClientAppStateBeforeAgentTurn(),
    ).resolves.toBeUndefined();
    const third = state.registerBeforeAgentTurnStateKeys(["editor-context"]);
    try {
      await expect(state.flushClientAppStateBeforeAgentTurn()).rejects.toThrow(
        "Editor unavailable",
      );
      fetcher.mockImplementation(async () => jsonResponse({ ok: true }));
      await state.writeClientAppState("editor-context", { id: "saved" });
      await expect(
        state.flushClientAppStateBeforeAgentTurn(),
      ).resolves.toBeUndefined();
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      third();
    }
  });

  it.each([true, false])(
    "requires only the exact current-tab core alias (current=%s)",
    async (current) => {
      vi.stubGlobal("window", { location: { pathname: "/" } });
      const { getBrowserTabId } = await import("./browser-tab-id.js");
      const key = `navigation:${current ? getBrowserTabId() : "another-browser-tab"}`;
      const fetcher = vi.fn(async () =>
        jsonResponse({ error: "Alias unavailable" }, { status: 503 }),
      );
      vi.stubGlobal("fetch", fetcher);
      await expect(
        state.writeClientAppState(key, { id: "route" }),
      ).rejects.toThrow("Alias unavailable");
      const failure = await state.flushClientAppStateBeforeAgentTurn().then(
        () => null,
        (error: unknown) =>
          error instanceof Error ? error.message : String(error),
      );
      const expectedFailure = current
        ? `Write application state "${key}" failed: Alias unavailable`
        : null;
      expect(failure).toBe(expectedFailure);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("scopes custom requirements and their cleanup to the app, tab and authenticated epoch", async () => {
    const fakeWindow = {
      location: { pathname: "/risk/register" },
      __AGENT_NATIVE_CONFIG__: {
        workspaceRuntime: true,
        workspaceAppMountPaths: ["/risk", "/chat"],
      },
    };
    vi.stubGlobal("window", fakeWindow);
    const stored = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    });
    const { recordSessionIdentity } = await import("./session-identity.js");
    recordSessionIdentity("synthetic-user", "org-a");
    const oldOwner = state.registerBeforeAgentTurnStateKeys(["editor-context"]);
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: "Scoped editor unavailable" }, { status: 503 }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      state.writeClientAppState("editor-context", { id: "risk" }),
    ).rejects.toThrow("Scoped editor unavailable");
    fakeWindow.location.pathname = "/chat/thread-1";
    await expect(
      state.writeClientAppState("editor-context", { id: "chat" }),
    ).rejects.toThrow("Scoped editor unavailable");
    await expect(
      state.flushClientAppStateBeforeAgentTurn(),
    ).resolves.toBeUndefined();
    fakeWindow.location.pathname = "/risk/register";
    await expect(state.flushClientAppStateBeforeAgentTurn()).rejects.toThrow(
      "Scoped editor unavailable",
    );
    recordSessionIdentity("synthetic-user", "org-b");
    await expect(
      state.flushClientAppStateBeforeAgentTurn(),
    ).resolves.toBeUndefined();
    const newOwner = state.registerBeforeAgentTurnStateKeys(["editor-context"]);
    try {
      await expect(
        state.writeClientAppState("editor-context", { id: "new-org" }),
      ).rejects.toThrow("Scoped editor unavailable");
      oldOwner();
      await expect(state.flushClientAppStateBeforeAgentTurn()).rejects.toThrow(
        "Scoped editor unavailable",
      );
    } finally {
      newOwner();
      oldOwner();
    }
    await expect(
      state.flushClientAppStateBeforeAgentTurn(),
    ).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not execute a prior authenticated epoch's flusher", async () => {
    const { recordSessionIdentity } = await import("./session-identity.js");
    recordSessionIdentity("synthetic-user", "org-a");
    const fetcher = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetcher);
    const save = vi.fn(() =>
      state.writeClientAppState("editor-context", { id: "old-org" }),
    );
    const unregister = state.registerBeforeAgentTurnFlush(save);
    try {
      recordSessionIdentity("synthetic-user", "org-b");
      await state.flushClientAppStateBeforeAgentTurn();
      expect(save).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  it("does not execute another mounted app's flusher", async () => {
    const fakeWindow = {
      location: { pathname: "/risk/register" },
      __AGENT_NATIVE_CONFIG__: {
        workspaceRuntime: true,
        workspaceAppMountPaths: ["/risk", "/chat"],
      },
    };
    vi.stubGlobal("window", fakeWindow);
    const fetcher = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetcher);
    const save = vi.fn(() =>
      state.writeClientAppState("editor-context", { id: "risk-view" }),
    );
    const unregister = state.registerBeforeAgentTurnFlush(save);
    try {
      fakeWindow.location.pathname = "/chat/thread-1";
      await state.flushClientAppStateBeforeAgentTurn();
      expect(save).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  it("rechecks the captured context before each scheduled flusher can write", async () => {
    const { recordSessionIdentity } = await import("./session-identity.js");
    recordSessionIdentity("synthetic-user", "org-a");
    const fetcher = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetcher);
    const changeScope = state.registerBeforeAgentTurnFlush(() =>
      recordSessionIdentity("synthetic-user", "org-b"),
    );
    const save = vi.fn(() =>
      state.writeClientAppState("editor-context", { id: "old-org" }),
    );
    const unregister = state.registerBeforeAgentTurnFlush(save);
    try {
      await expect(state.flushClientAppStateBeforeAgentTurn()).rejects.toThrow(
        "Application state scope changed",
      );
      expect(save).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      changeScope();
      unregister();
    }
  });

  it.each(["settings-view", "navigate", "__set_url__"])(
    "does not make best-effort or inbound-command %s a turn prerequisite",
    async (key) => {
      const fetcher = vi.fn(async () =>
        jsonResponse({ error: "Best effort unavailable" }, { status: 503 }),
      );
      vi.stubGlobal("fetch", fetcher);
      await expect(
        state.writeClientAppState(key, { pageId: "appearance" }),
      ).rejects.toThrow("Best effort unavailable");
      await expect(
        state.flushClientAppStateBeforeAgentTurn(),
      ).resolves.toBeUndefined();
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each([false, true])(
    "rejects queued prior-session payloads before transport (newer=%s)",
    async (newer) => {
      vi.useFakeTimers();
      try {
        const { recordSessionIdentity } = await import("./session-identity.js");
        recordSessionIdentity("synthetic-user", "org-a");
        const fetcher = vi.fn(
          async (_url: RequestInfo | URL, _init?: RequestInit) =>
            jsonResponse({ ok: true }),
        );
        vi.stubGlobal("fetch", fetcher);
        const previous = state.writeClientAppState("navigation", {
          id: "private-old-context",
        });
        recordSessionIdentity("synthetic-user", "org-b");
        const current = newer
          ? state.writeClientAppState("navigation", { id: "current-context" })
          : undefined;
        const settled = Promise.allSettled(
          current ? [previous, current] : [previous],
        );
        await vi.runAllTimersAsync();
        const results = await settled;
        expect(results[0]).toMatchObject({
          status: "rejected",
          reason: {
            message: expect.stringContaining("Application state scope changed"),
          },
        });
        expect(
          fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body))),
        ).toEqual(newer ? [{ id: "current-context" }] : []);
        await expect(
          state.flushClientAppStateBeforeAgentTurn(),
        ).resolves.toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(["ownRequest", "signal", "compare", "pagehide"])(
    "fences a queued %s operation before it can use a different session",
    async (kind) => {
      const listeners = new Map<string, () => void>();
      const listen = (event: string, callback: () => void) =>
        listeners.set(event, callback);
      vi.stubGlobal("window", {
        location: { pathname: "/" },
        addEventListener: listen,
      });
      vi.stubGlobal("document", {
        visibilityState: "visible",
        addEventListener: listen,
      });
      const { recordSessionIdentity, currentSessionIdentity } =
        await import("./session-identity.js");
      recordSessionIdentity("synthetic-old-user", "org-a");
      const blocked = Promise.withResolvers<Response>();
      const entered = Promise.withResolvers<void>();
      const sessions: Array<string | null | undefined> = [];
      const fetcher = vi.fn(
        async (_url: RequestInfo | URL, init?: RequestInit) => {
          sessions.push(currentSessionIdentity());
          if (sessions.length === 1) {
            entered.resolve();
            return blocked.promise;
          }
          return jsonResponse(
            init?.method === "PATCH" ? { changed: true } : { ok: true },
          );
        },
      );
      vi.stubGlobal("fetch", fetcher);
      const previous = state.writeClientAppState("selection", {
        id: "blocking-old",
      });
      await entered.promise;
      const queued =
        kind === "compare"
          ? state.compareAndSetClientAppState("selection", null, {
              id: "queued-old",
            })
          : state.writeClientAppState(
              "selection",
              { id: "queued-old" },
              kind === "signal"
                ? { signal: new AbortController().signal }
                : { ownRequest: true, keepalive: kind === "pagehide" },
            );
      const outcomes = Promise.allSettled([previous, queued]);
      recordSessionIdentity("synthetic-new-user", "org-b");
      if (kind === "pagehide") listeners.get("pagehide")?.();
      blocked.resolve(jsonResponse({ ok: true }));
      const results = await outcomes;
      expect(results[1]).toMatchObject({
        status: "rejected",
        reason: { message: "Application state scope changed before saving" },
      });
      expect(sessions).toEqual(["synthetic-old-user"]);
      await expect(
        state.flushClientAppStateBeforeAgentTurn(),
      ).resolves.toBeUndefined();
    },
  );

  it("keeps an own request already started by pagehide attached to its original result", async () => {
    const listeners = new Map<string, () => void>();
    const listen = (event: string, callback: () => void) =>
      listeners.set(event, callback);
    vi.stubGlobal("window", {
      location: { pathname: "/" },
      addEventListener: listen,
    });
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: listen,
    });
    const { recordSessionIdentity, currentSessionIdentity } =
      await import("./session-identity.js");
    recordSessionIdentity("synthetic-old-user", "org-a");
    const blocked = Promise.withResolvers<Response>();
    const entered = Promise.withResolvers<void>();
    const sessions: Array<string | null | undefined> = [];
    vi.stubGlobal("fetch", async () => {
      sessions.push(currentSessionIdentity());
      if (sessions.length === 1) {
        entered.resolve();
        return blocked.promise;
      }
      return jsonResponse({ id: "own-original-result" });
    });
    const previous = state.writeClientAppState("selection", {
      id: "blocking-old",
    });
    await entered.promise;
    const queued = state.writeClientAppState(
      "selection",
      { id: "own-original-result" },
      { ownRequest: true, keepalive: true },
    );
    const outcomes = Promise.allSettled([previous, queued]);
    listeners.get("pagehide")?.();
    recordSessionIdentity("synthetic-new-user", "org-b");
    blocked.resolve(jsonResponse({ ok: true }));
    const results = await outcomes;
    expect(results[1]).toEqual({
      status: "fulfilled",
      value: { id: "own-original-result" },
    });
    expect(sessions).toEqual(["synthetic-old-user", "synthetic-old-user"]);
  });

  it.each(["auth", "mount", "api-mount"])(
    "saves a new %s context without waiting for an old in-flight row",
    async (transition) => {
      vi.useFakeTimers();
      const config = {
        workspaceRuntime: transition === "mount",
        workspaceAppMountPaths: ["/risk", "/chat"],
        apiBaseUrl:
          transition === "api-mount"
            ? "https://example.invalid/mount-a"
            : undefined,
      };
      const fakeWindow = {
        location: { pathname: transition === "mount" ? "/risk/register" : "/" },
        __AGENT_NATIVE_CONFIG__: config,
      };
      vi.stubGlobal("window", fakeWindow);
      const { recordSessionIdentity } = await import("./session-identity.js");
      recordSessionIdentity("synthetic-old-user", "org-a");
      const blocked = Promise.withResolvers<Response>();
      const fetcher = vi.fn(
        async (_url: RequestInfo | URL, init?: RequestInit) => {
          if (String(init?.body).includes("blocking-old"))
            return blocked.promise;
          return jsonResponse({ id: "current-context" });
        },
      );
      vi.stubGlobal("fetch", fetcher);
      const previous = state.writeClientAppState("selection", {
        id: "blocking-old",
      });
      let current: Promise<unknown> | undefined;
      let completed = false;
      try {
        await vi.advanceTimersByTimeAsync(1);
        if (transition === "auth")
          recordSessionIdentity("synthetic-new-user", "org-b");
        if (transition === "mount")
          fakeWindow.location.pathname = "/chat/thread-1";
        if (transition === "api-mount")
          config.apiBaseUrl = "https://example.invalid/mount-b";
        current = state.writeClientAppState("selection", {
          id: "current-context",
        });
        const observed = current.then(
          () => {
            completed = true;
          },
          () => {
            completed = false;
          },
        );
        await vi.advanceTimersByTimeAsync(1);
        expect(completed).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(2);
        await observed;
        await expect(
          state.flushClientAppStateBeforeAgentTurn(),
        ).resolves.toBeUndefined();
      } finally {
        blocked.resolve(jsonResponse({ ok: true }));
        const settled = Promise.allSettled(
          current ? [previous, current] : [previous],
        );
        await vi.runAllTimersAsync();
        await settled;
        vi.useRealTimers();
      }
    },
  );

  it("fails a turn within the save budget when an editor never settles", async () => {
    vi.useFakeTimers();
    const unregister = state.registerBeforeAgentTurnFlush(
      () => new Promise<void>(() => {}),
    );
    try {
      const failure = (async () => {
        await expect(
          state.flushClientAppStateBeforeAgentTurn(),
        ).rejects.toThrow("Application state save timed out");
      })();
      await vi.advanceTimersByTimeAsync(25_000);
      await failure;
    } finally {
      unregister();
      vi.useRealTimers();
    }
  });

  it("unregisters an editor flush when its editor unmounts", async () => {
    const save = vi.fn();
    const unregister = state.registerBeforeAgentTurnFlush(save);
    unregister();
    await state.flushClientAppStateBeforeAgentTurn();
    expect(save).not.toHaveBeenCalled();
  });
});
