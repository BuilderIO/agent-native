import { afterEach, describe, expect, it, vi } from "vitest";

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

  it("sends the waiting writes at once when the page hides", async () => {
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

    const waiting = fresh.writeClientAppState("selection", 1);
    const leaving = fresh.writeClientAppState("draft", 2, { keepalive: true });
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    listeners.pagehide?.();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/_agent-native/application-state",
      expect.objectContaining({ method: "POST", keepalive: true }),
    ]);
    await Promise.all([waiting, leaving]);
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

    it("leaves a queued delete waiting when the page hides", async () => {
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

      // Sent now, the delete could land first and the older write would bring
      // the row back, since the server keeps no record of a delete.
      expect(fetchMock).toHaveBeenCalledTimes(1);

      commitOlder();
      await older;
      await deletion;
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE" });
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
