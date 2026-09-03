import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteClientAppState,
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
    // Absent keys still read as `null` through the single-key helper, matching
    // the pre-batching contract.
    expect(url).toBeNull();
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
