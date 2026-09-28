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
        },
        body: JSON.stringify(value),
        keepalive: true,
        signal: undefined,
      },
    );
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
        headers: { "X-Agent-Native-CSRF": "1" },
        keepalive: true,
        signal: undefined,
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/_agent-native/application-state/selection",
      {
        method: "DELETE",
        headers: { "X-Agent-Native-CSRF": "1" },
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
});
