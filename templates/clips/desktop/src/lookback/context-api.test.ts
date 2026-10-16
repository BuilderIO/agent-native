import { afterEach, describe, expect, it, vi } from "vitest";

import { ClipsActionError, ClipsActionTimeoutError } from "../lib/clips-action";
import {
  getRecordingContextItem,
  isTerminalRecordingContextRequestFailure,
  listPendingRecordingContext,
  LOOKBACK_ACTION_TIMEOUT_MS,
  removeRecordingContext,
  requestRecordingContext,
  settleRecordingContextRequest,
  visitPendingRecordingContextPage,
  type PendingRecordingContextPage,
  type RecordingContextItem,
} from "./context-api";

const target = { serverUrl: "https://clips.example.test", authToken: "" };

function stubFetch(
  body: unknown = { items: [], nextCursor: null },
  status = 200,
) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("requestRecordingContext", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the capturing device and audio details with the request", async () => {
    const fetchMock = stubFetch({ id: "ctx1" });

    await requestRecordingContext(target, {
      recordingId: "rec1",
      seconds: 30,
      endedAt: "2026-10-09T10:00:00.000Z",
      deviceId: "device-1",
      includeMicrophone: true,
      includeSystemAudio: false,
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(new URL(String(url)).pathname).toBe(
      "/_agent-native/actions/request-recording-context",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      recordingId: "rec1",
      seconds: 30,
      endedAt: "2026-10-09T10:00:00.000Z",
      deviceId: "device-1",
      includeMicrophone: true,
      includeSystemAudio: false,
    });
  });
});

describe("settleRecordingContextRequest", () => {
  it("keeps the origin while the request is pending and after it succeeds", async () => {
    let resolve!: (value: {
      includeMicrophone: boolean;
      includeSystemAudio: boolean;
    }) => void;
    const request = new Promise<{
      includeMicrophone: boolean;
      includeSystemAudio: boolean;
    }>((res) => {
      resolve = res;
    });
    const forgetOrigin = vi.fn();
    const onError = vi.fn();
    const settled = settleRecordingContextRequest(
      request,
      "rec1",
      forgetOrigin,
      onError,
    );

    expect(forgetOrigin).not.toHaveBeenCalled();
    resolve({ includeMicrophone: true, includeSystemAudio: false });

    await expect(settled).resolves.toEqual({
      includeMicrophone: true,
      includeSystemAudio: false,
    });
    expect(forgetOrigin).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it.each([
    ["recording_context_invalid_window", 400],
    ["recording_unavailable", 404],
  ])(
    "forgets the origin after terminal request failure %s",
    async (code, status) => {
      const forgetOrigin = vi.fn();
      const onError = vi.fn();
      const error = new ClipsActionError(
        "terminal request failure",
        status,
        code,
      );

      await expect(
        settleRecordingContextRequest(
          Promise.reject(error),
          "rec1",
          forgetOrigin,
          onError,
        ),
      ).resolves.toBeNull();

      expect(forgetOrigin).toHaveBeenCalledExactlyOnceWith("rec1");
      expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    },
  );

  it("retains the origin after a retryable request failure", async () => {
    const forgetOrigin = vi.fn();
    const onError = vi.fn();
    const error = new ClipsActionError("temporary server failure", 503);

    await expect(
      settleRecordingContextRequest(
        Promise.reject(error),
        "rec1",
        forgetOrigin,
        onError,
      ),
    ).resolves.toBeNull();

    expect(forgetOrigin).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
  });
});

describe("isTerminalRecordingContextRequestFailure", () => {
  it("requires the matching typed status and error code", () => {
    expect(
      isTerminalRecordingContextRequestFailure(
        new ClipsActionError(
          "invalid window",
          400,
          "recording_context_invalid_window",
        ),
      ),
    ).toBe(true);
    expect(
      isTerminalRecordingContextRequestFailure(
        new ClipsActionError("gone", 404, "recording_unavailable"),
      ),
    ).toBe(true);
    expect(
      isTerminalRecordingContextRequestFailure(
        new ClipsActionError("forbidden", 403, "recording_forbidden"),
      ),
    ).toBe(false);
    expect(isTerminalRecordingContextRequestFailure(new Error("offline"))).toBe(
      false,
    );
  });
});

describe("removeRecordingContext", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the context item id to the removal action", async () => {
    const fetchMock = stubFetch({ id: "ctx1" });

    await removeRecordingContext(target, "ctx1");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(new URL(String(url)).pathname).toBe(
      "/_agent-native/actions/remove-recording-context",
    );
    expect(JSON.parse(String(init?.body))).toEqual({ id: "ctx1" });
  });

  it("treats only the typed missing-context response as already removed", async () => {
    stubFetch(
      {
        error: "This screen history context was not found.",
        errorCode: "recording_context_not_found",
      },
      404,
    );

    await expect(removeRecordingContext(target, "ctx1")).resolves.toBeNull();
  });

  it("keeps untyped 404 failures distinguishable from an absent context", async () => {
    stubFetch({ error: "Not found." }, 404);

    await expect(removeRecordingContext(target, "ctx1")).rejects.toMatchObject({
      status: 404,
      code: undefined,
    });
  });
});

describe("listPendingRecordingContext", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends the skipped ids so the server leaves them out of the batch", async () => {
    const fetchMock = stubFetch();

    await expect(
      listPendingRecordingContext(target, {
        deviceId: "device-1",
        excludeIds: ["ctx1", "ctx2"],
      }),
    ).resolves.toEqual({ items: [], nextCursor: null });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe(
      "/_agent-native/actions/list-pending-recording-context",
    );
    expect(url.searchParams.getAll("excludeIds[]")).toEqual(["ctx1", "ctx2"]);
    expect(url.searchParams.has("excludeIds")).toBe(false);
  });

  it("sends the device id as a plain query parameter, not an array", async () => {
    const fetchMock = stubFetch();

    await listPendingRecordingContext(target, { deviceId: "device-1" });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("deviceId")).toBe("device-1");
    expect(url.searchParams.has("deviceId[]")).toBe(false);
  });

  it("sends no excludeIds parameter when nothing has been skipped", async () => {
    const fetchMock = stubFetch();

    await listPendingRecordingContext(target, { deviceId: "device-1" });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.has("excludeIds")).toBe(false);
  });

  it("continues after a stable item cursor", async () => {
    const fetchMock = stubFetch({
      items: [],
      nextCursor: {
        afterCreatedAt: "2026-10-15T12:00:00.000Z",
        afterId: "ctx25",
      },
    });

    await expect(
      listPendingRecordingContext(target, {
        deviceId: "device-1",
        cursor: {
          afterCreatedAt: "2026-10-15T11:59:00.000Z",
          afterId: "ctx10",
        },
      }),
    ).resolves.toEqual({
      items: [],
      nextCursor: {
        afterCreatedAt: "2026-10-15T12:00:00.000Z",
        afterId: "ctx25",
      },
    });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("afterCreatedAt")).toBe(
      "2026-10-15T11:59:00.000Z",
    );
    expect(url.searchParams.get("afterId")).toBe("ctx10");
  });

  it("times out a stalled pending-context action so polling can retry", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const request = listPendingRecordingContext(target, {
      deviceId: "device-1",
    });
    const rejected = expect(request).rejects.toBeInstanceOf(
      ClipsActionTimeoutError,
    );

    await vi.advanceTimersByTimeAsync(LOOKBACK_ACTION_TIMEOUT_MS);

    await rejected;
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});

describe("visitPendingRecordingContextPage", () => {
  it("returns the next cursor only after every item is inspected", () => {
    const previousCursor = {
      afterCreatedAt: "2026-10-15T11:59:00.000Z",
      afterId: "ctx10",
    };
    const page: PendingRecordingContextPage = {
      items: [{ id: "ctx1" }, { id: "ctx2" }] as RecordingContextItem[],
      nextCursor: {
        afterCreatedAt: "2026-10-15T12:00:00.000Z",
        afterId: "ctx25",
      },
    };
    let cursor = previousCursor;

    expect(() => {
      cursor = visitPendingRecordingContextPage(page, (item) => {
        if (item.id === "ctx2") throw new Error("local storage unreadable");
      })!;
    }).toThrow("local storage unreadable");

    expect(cursor).toBe(previousCursor);
  });

  it("returns the page cursor after every item is inspected", () => {
    const page = {
      items: [{ id: "ctx1" }] as RecordingContextItem[],
      nextCursor: {
        afterCreatedAt: "2026-10-15T12:00:00.000Z",
        afterId: "ctx25",
      },
    } satisfies PendingRecordingContextPage;

    expect(visitPendingRecordingContextPage(page, () => {})).toEqual(
      page.nextCursor,
    );
  });
});

describe("getRecordingContextItem", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the listed item with the given id", async () => {
    stubFetch({ items: [{ id: "ctx1" }, { id: "ctx2" }] });

    await expect(
      getRecordingContextItem(target, "rec1", "ctx2"),
    ).resolves.toMatchObject({ id: "ctx2" });
  });

  it("returns null when the server no longer lists the item", async () => {
    stubFetch({ items: [] });

    await expect(
      getRecordingContextItem(target, "rec1", "ctx1"),
    ).resolves.toBeNull();
  });

  it("throws when the read fails instead of reporting the item absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );

    await expect(
      getRecordingContextItem(target, "rec1", "ctx1"),
    ).rejects.toThrow();
  });

  it("returns null when the server answers recording_not_found because the Clip is gone", async () => {
    stubFetch(
      { error: "Recording not found.", errorCode: "recording_not_found" },
      404,
    );

    await expect(
      getRecordingContextItem(target, "rec1", "ctx1"),
    ).resolves.toBeNull();
  });

  it("throws on a 404 without the action's error code, such as a proxy or missing route", async () => {
    stubFetch({ error: "Not found" }, 404);

    await expect(
      getRecordingContextItem(target, "rec1", "ctx1"),
    ).rejects.toThrow("Not found");
  });

  it("throws on a 404 carrying a different error code", async () => {
    stubFetch({ error: "Other", errorCode: "something_else" }, 404);

    await expect(
      getRecordingContextItem(target, "rec1", "ctx1"),
    ).rejects.toThrow("Other");
  });

  it("throws on a 403, since lost access does not prove the item is absent", async () => {
    stubFetch({ error: "No access to recording rec1" }, 403);

    await expect(
      getRecordingContextItem(target, "rec1", "ctx1"),
    ).rejects.toThrow("No access to recording rec1");
  });
});
