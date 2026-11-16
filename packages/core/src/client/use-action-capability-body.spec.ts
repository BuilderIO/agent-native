import { afterEach, describe, expect, it, vi } from "vitest";

const analyticsMocks = vi.hoisted(() => ({
  trackEvent: vi.fn(),
}));
vi.mock("./analytics.js", () => analyticsMocks);

const sessionMocks = vi.hoisted(() => ({
  recheckSessionAfterUnauthorized: vi.fn(),
}));
vi.mock("./use-session.js", () => sessionMocks);

import { recordSessionIdentity } from "./session-identity.js";
import {
  callAction,
  callActionBlob,
  forgetUiActionCapability,
} from "./use-action.js";

const MINT = "/_agent-native/ui-capability";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function signIn(identity = "user-1") {
  vi.stubGlobal("window", {});
  recordSessionIdentity(identity);
}

/**
 * A response whose body is a real stream, the shape of a capability answer whose payload the client
 * has no use for but still has to read: cancelling an HTTP-200 body is what the browser reports as an
 * aborted request (net::ERR_ABORTED), so the contract under test is "read it, never cancel it".
 *
 * `chunks: 0` leaves the body pending, which is how a body that never settles is modelled.
 */
function streamedResponse(
  options: {
    status?: number;
    chunks?: number;
    failRead?: boolean;
  } = {},
): {
  response: Response;
  cancelCalls: () => number;
  pullCalls: () => number;
  /** True once the body has been disturbed by a read; the proof that it was read, not just left alone. */
  read: () => boolean;
} {
  let cancelCalls = 0;
  let pullCalls = 0;
  const chunks = options.chunks ?? 1;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pullCalls += 1;
      if (options.failRead) {
        controller.error(new Error("read failed"));
        return;
      }
      if (chunks === 0) return;
      controller.enqueue(new TextEncoder().encode("{}"));
      controller.close();
    },
    cancel() {
      cancelCalls += 1;
    },
  });
  const response = new Response(body, {
    status: options.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
  return {
    response,
    cancelCalls: () => cancelCalls,
    pullCalls: () => pullCalls,
    read: () => response.bodyUsed,
  };
}

function requestUrls(fetchMock: ReturnType<typeof vi.fn>): unknown[] {
  return fetchMock.mock.calls.map(([url]) => url);
}

function mintCalls(fetchMock: ReturnType<typeof vi.fn>): number {
  return requestUrls(fetchMock).filter((url) => url === MINT).length;
}

/** Lets the unawaited body read run to completion. */
async function settleReads() {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
  // a body read needs a macrotask turn; under fake timers that turn is the fake clock's
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(1);
  else await new Promise((resolve) => setTimeout(resolve, 0));
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

afterEach(() => {
  forgetUiActionCapability();
  recordSessionIdentity(undefined);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("the UI capability mint response body is read, never cancelled", () => {
  it("never cancels a successful mint body and resolves from its status alone", async () => {
    // A mint answer is its status; the body must still be read to the end. Cancelling it made Chrome
    // record a successful request as net::ERR_ABORTED, a transport failure the app never caused.
    signIn();
    const mint = streamedResponse();
    const fetchMock = vi.fn(async (url: string) =>
      url === MINT ? mint.response : jsonResponse({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callAction("approve-record", { id: "record-1" }, { uiOnly: true }),
    ).resolves.toEqual({ ok: true });

    expect(mint.cancelCalls()).toBe(0);
    await settleReads();
    expect(mint.read()).toBe(true);
    expect(mintCalls(fetchMock)).toBe(1);
  });

  it("reads an unread mint body once on a binary write", async () => {
    signIn();
    const mint = streamedResponse();
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      url === MINT
        ? mint.response
        : new Response(new Blob(["blob-ok"], { type: "image/png" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const blob = await callActionBlob("export-report", { id: "record-1" });

    await expect(blob.text()).resolves.toBe("blob-ok");
    expect(requestUrls(fetchMock)).toEqual([
      MINT,
      "/_agent-native/actions/export-report",
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
    });
    expect(mint.cancelCalls()).toBe(0);
    await settleReads();
    expect(mint.read()).toBe(true);
  });

  it("reads the rejected mint body and still sends an ordinary write", async () => {
    signIn();
    const mint = streamedResponse({ status: 401 });
    const fetchMock = vi.fn(async (url: string) =>
      url === MINT ? mint.response : jsonResponse({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callAction("rename-record", { id: "record-1" }),
    ).resolves.toEqual({ ok: true });

    expect(requestUrls(fetchMock)).toEqual([
      MINT,
      "/_agent-native/actions/rename-record",
    ]);
    expect(mint.cancelCalls()).toBe(0);
    await settleReads();
    expect(mint.read()).toBe(true);
  });

  it("reads the rejected mint body and denies a strict uiOnly write", async () => {
    signIn();
    const mint = streamedResponse({ status: 401 });
    const fetchMock = vi.fn(async (url: string) =>
      url === MINT ? mint.response : jsonResponse({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callAction("approve-record", { id: "record-1" }, { uiOnly: true }),
    ).rejects.toThrow("Could not establish the browser UI capability.");

    expect(requestUrls(fetchMock)).toEqual([MINT]);
    expect(mint.cancelCalls()).toBe(0);
    await settleReads();
    expect(mint.read()).toBe(true);
  });

  it("has nothing to read when the mint response carries no body", async () => {
    signIn();
    const response = new Response(null);
    expect(response.body).toBeNull();
    const fetchMock = vi.fn(async (url: string) =>
      url === MINT ? response : jsonResponse({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callAction("delete-record", { id: "record-1" }),
    ).resolves.toEqual({ ok: true });

    expect(requestUrls(fetchMock)).toEqual([
      MINT,
      "/_agent-native/actions/delete-record",
    ]);
  });

  it("handles a failing read without an unhandled rejection or an auth change", async () => {
    signIn();
    const mint = streamedResponse({ failRead: true });
    const fetchMock = vi.fn(async (url: string) =>
      url === MINT ? mint.response : jsonResponse({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      await expect(
        callAction("delete-record", { id: "record-1" }),
      ).resolves.toEqual({ ok: true });
      await settleReads();
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }

    expect(unhandled).toEqual([]);
    expect(mint.cancelCalls()).toBe(0);
    // a read that failed still disturbs the body, so the response is released rather than abandoned
    expect(mint.read()).toBe(true);
    // The header-only mint still stands: the next write reuses it.
    await expect(
      callAction("delete-record", { id: "record-2" }),
    ).resolves.toEqual({ ok: true });
    expect(mintCalls(fetchMock)).toBe(1);
    expect(requestUrls(fetchMock)).toEqual([
      MINT,
      "/_agent-native/actions/delete-record",
      "/_agent-native/actions/delete-record",
    ]);
  });

  it("does not wait for a read that never settles, and still reuses one mint", async () => {
    signIn();
    const mint = streamedResponse({ chunks: 0 });
    const fetchMock = vi.fn(async (url: string) =>
      url === MINT ? mint.response : jsonResponse({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callAction("delete-record", { id: "record-1" }),
    ).resolves.toEqual({ ok: true });
    await expect(
      callAction("delete-record", { id: "record-2" }),
    ).resolves.toEqual({ ok: true });

    expect(mintCalls(fetchMock)).toBe(1);
    expect(mint.cancelCalls()).toBe(0);
    expect(mint.read()).toBe(true);
    expect(requestUrls(fetchMock)).toEqual([
      MINT,
      "/_agent-native/actions/delete-record",
      "/_agent-native/actions/delete-record",
    ]);
  });

  it("shares one mint and one body read across concurrent writes", async () => {
    signIn();
    const mint = streamedResponse();
    let settleMint: () => void = () => {};
    const fetchMock = vi.fn((url: string) => {
      if (url === MINT) {
        return new Promise<Response>((resolve) => {
          settleMint = () => resolve(mint.response);
        });
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = callAction("delete-record", { id: "record-1" });
    const second = callAction("rename-record", { id: "record-2" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    settleMint();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true },
      { ok: true },
    ]);
    expect(mintCalls(fetchMock)).toBe(1);
    expect(mint.cancelCalls()).toBe(0);
    await settleReads();
    expect(mint.read()).toBe(true);
    expect(requestUrls(fetchMock)).toEqual([
      MINT,
      "/_agent-native/actions/delete-record",
      "/_agent-native/actions/rename-record",
    ]);
  });

  it("keeps the shared mint alive when one waiting caller aborts, and the other continues", async () => {
    signIn();
    const mint = streamedResponse();
    let settleMint: () => void = () => {};
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (url === MINT) {
        return new Promise<Response>((resolve) => {
          settleMint = () => resolve(mint.response);
        });
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const stopped = callAction(
      "delete-record",
      { id: "record-1" },
      { signal: controller.signal },
    );
    const continued = callAction("rename-record", { id: "record-2" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(stopped).rejects.toMatchObject({ name: "AbortError" });
    const mintInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(mintInit?.signal?.aborted).toBe(false);

    settleMint();
    await expect(continued).resolves.toEqual({ ok: true });

    expect(mintCalls(fetchMock)).toBe(1);
    expect(mint.cancelCalls()).toBe(0);
    await settleReads();
    expect(mint.read()).toBe(true);
    expect(requestUrls(fetchMock)).toEqual([
      MINT,
      "/_agent-native/actions/rename-record",
    ]);
  });

  it("denies a write whose user changed during the mint and reads the body once", async () => {
    signIn("user-1");
    const mint = streamedResponse();
    let settleMint: () => void = () => {};
    const fetchMock = vi.fn((url: string) => {
      if (url === MINT) {
        return new Promise<Response>((resolve) => {
          settleMint = () => resolve(mint.response);
        });
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const write = callAction("delete-record", { id: "record-1" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    recordSessionIdentity("user-2");
    settleMint();

    await expect(write).rejects.toThrow(/signed-in user changed/);
    expect(requestUrls(fetchMock)).toEqual([MINT]);
    expect(mint.cancelCalls()).toBe(0);
    await settleReads();
    expect(mint.read()).toBe(true);
  });
});

describe("the UI capability mint body boundaries", () => {
  it("keeps a successful strict mint when the read cannot start", async () => {
    signIn();
    const mint = streamedResponse();
    const read = vi
      .spyOn(Response.prototype, "arrayBuffer")
      .mockImplementationOnce(() => {
        throw new Error("read failed synchronously");
      });
    const fetchMock = vi.fn(async (url: string) =>
      url === MINT ? mint.response : jsonResponse({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      await expect(
        callAction("approve-record", { id: "record-1" }, { uiOnly: true }),
      ).resolves.toEqual({ ok: true });
      await expect(
        callAction("approve-record", { id: "record-2" }, { uiOnly: true }),
      ).resolves.toEqual({ ok: true });
      await settleReads();
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
      read.mockRestore();
    }

    expect(unhandled).toEqual([]);
    expect(mint.cancelCalls()).toBe(0);
    expect(mintCalls(fetchMock)).toBe(1);
    expect(requestUrls(fetchMock)).toEqual([
      MINT,
      "/_agent-native/actions/approve-record",
      "/_agent-native/actions/approve-record",
    ]);
  });

  it("still aborts the mint request at ten seconds and reads a late answer", async () => {
    signIn();
    vi.useFakeTimers();
    const mint = streamedResponse();
    let deliverMint: (response: Response) => void = () => {};
    let delivered = false;
    const fetchMock = vi.fn((url: string) => {
      if (url === MINT) {
        return new Promise<Response>((resolve) => {
          deliverMint = (response) => {
            delivered = true;
            resolve(response);
          };
        });
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      const request = callAction(
        "approve-record",
        { id: "record-1" },
        { uiOnly: true, timeoutMs: 60_000 },
      );
      const timedOut = expect(request).rejects.toThrow(
        /Timed out establishing the browser UI capability/,
      );
      await vi.advanceTimersByTimeAsync(10_000);
      await timedOut;

      const mintInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(mintInit?.signal?.aborted).toBe(true);
      expect(requestUrls(fetchMock)).toEqual([MINT]);
      expect(mint.cancelCalls()).toBe(0);

      deliverMint(mint.response);
      for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1);

      expect(mint.cancelCalls()).toBe(0);
      await settleReads();
      expect(mint.read()).toBe(true);
      expect(requestUrls(fetchMock)).toEqual([MINT]);
      expect(mintCalls(fetchMock)).toBe(1);
      expect(unhandled).toEqual([]);
    } finally {
      if (!delivered) deliverMint(mint.response);
      process.off("unhandledRejection", onUnhandledRejection);
      vi.useRealTimers();
    }
  });

  it("reads the shared mint body exactly once across concurrent writes", async () => {
    signIn();
    const mint = streamedResponse();
    const read = vi.spyOn(Response.prototype, "arrayBuffer");
    let settleMint: () => void = () => {};
    const fetchMock = vi.fn((url: string) => {
      if (url === MINT) {
        return new Promise<Response>((resolve) => {
          settleMint = () => resolve(mint.response);
        });
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = callAction("delete-record", { id: "record-1" });
    const second = callAction("rename-record", { id: "record-2" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    settleMint();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true },
      { ok: true },
    ]);
    await settleReads();
    expect(read).toHaveBeenCalledTimes(1);
    expect(mint.cancelCalls()).toBe(0);
    expect(mintCalls(fetchMock)).toBe(1);
    expect(requestUrls(fetchMock)).toEqual([
      MINT,
      "/_agent-native/actions/delete-record",
      "/_agent-native/actions/rename-record",
    ]);
    read.mockRestore();
  });
});
