import { createServer } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  calendarDeleteEvent,
  calendarGetEvent,
  calendarBatchListEvents,
  createOAuth2Client,
  calendarListEvents,
  calendarPatchEvent,
  calendarUpdateEvent,
  GoogleApiError,
  googleFetch,
  isGoogleRequestRejectedError,
} from "./google-api.js";

describe("isGoogleRequestRejectedError", () => {
  it("counts a 4xx answer as a refused write, but not a timeout or a server error", () => {
    expect(isGoogleRequestRejectedError(new GoogleApiError(400, "Bad"))).toBe(
      true,
    );
    expect(
      isGoogleRequestRejectedError(new Error("Google API error (404): Gone")),
    ).toBe(true);
    expect(
      isGoogleRequestRejectedError(new GoogleApiError(408, "Timeout")),
    ).toBe(false);
    expect(
      isGoogleRequestRejectedError(new GoogleApiError(503, "Unavailable")),
    ).toBe(false);
    expect(isGoogleRequestRejectedError(new Error("socket hang up"))).toBe(
      false,
    );
  });
});

describe("googleFetch", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("bounds Google requests while preserving caller cancellation", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const caller = new AbortController().signal;

    await googleFetch(
      "https://www.googleapis.com/calendar/v3/events",
      "token",
      {
        signal: caller,
      },
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal).not.toBe(caller);
  });

  it("preserves throttling from a token refresh", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "temporarily_unavailable" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(
      createOAuth2Client("fixture", "fixture", "http://localhost").refreshToken(
        "fixture",
      ),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("forwards cancellation to event list, read, and RSVP requests", async () => {
    fetchMock.mockClear();
    const controller = new AbortController();

    await calendarListEvents("token", "primary", {}, controller.signal);
    await calendarGetEvent("token", "primary", "event-1", controller.signal);
    await calendarPatchEvent(
      "token",
      "primary",
      "event-1",
      { attendees: [] },
      undefined,
      controller.signal,
    );

    const signals = fetchMock.mock.calls.map(
      ([, init]) => (init as RequestInit).signal as AbortSignal,
    );
    controller.abort();
    expect(signals).toHaveLength(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("sends the revision an event write starts from as If-Match, not in the query", async () => {
    fetchMock.mockClear();

    await calendarPatchEvent(
      "token",
      "primary",
      "event-1",
      { summary: "Mine" },
      { sendUpdates: "none", ifMatch: '"etag-1"' },
    );
    await calendarUpdateEvent(
      "token",
      "primary",
      "event-1",
      { summary: "Mine" },
      { ifMatch: '"etag-2"' },
    );
    await calendarPatchEvent("token", "primary", "event-1", {});
    await calendarDeleteEvent(
      "token",
      "primary",
      "event-1",
      undefined,
      '"etag-3"',
    );

    const requests = fetchMock.mock.calls.map(([url, init]) => ({
      url: String(url),
      ifMatch: new Headers((init as RequestInit).headers).get("If-Match"),
    }));
    expect(requests).toEqual([
      {
        url: expect.stringMatching(/\/events\/event-1\?sendUpdates=none$/),
        ifMatch: '"etag-1"',
      },
      { url: expect.stringMatching(/\/events\/event-1$/), ifMatch: '"etag-2"' },
      { url: expect.stringMatching(/\/events\/event-1$/), ifMatch: null },
      { url: expect.stringMatching(/\/events\/event-1$/), ifMatch: '"etag-3"' },
    ]);
  });
});

it("preserves HTTP status and quota reason from a local provider response", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/quota") {
      response.writeHead(403, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          error: {
            message: "Quota exceeded",
            errors: [{ reason: "rateLimitExceeded" }],
          },
        }),
      );
    } else {
      response.writeHead(429, { "Content-Type": "text/plain" });
      response.end("Too many requests");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Local server failed to listen");
    const base = `http://127.0.0.1:${address.port}`;
    await expect(googleFetch(`${base}/quota`, "fixture")).rejects.toMatchObject(
      { status: 403, reason: "rateLimitExceeded" },
    );
    await expect(
      googleFetch(`${base}/throttle`, "fixture"),
    ).rejects.toMatchObject({ status: 429 });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("batches calendar reads and preserves individual provider failures", async () => {
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      if ((body.match(/GET \/calendar\/v3\/calendars\//g) ?? []).length !== 2) {
        response.writeHead(400).end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": "multipart/mixed; boundary=fixture_response",
      });
      response.end(
        [
          '--fixture_response\r\nContent-Type: application/http\r\nContent-ID: <response-0>\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"items":[]}\r\n',
          '--fixture_response\r\nContent-Type: application/http\r\nContent-ID: <response-1>\r\n\r\nHTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\n\r\n{"error":{"message":"Quota exceeded","errors":[{"reason":"rateLimitExceeded"}]}}\r\n',
          "--fixture_response--\r\n",
        ].join(""),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const originalFetch = globalThis.fetch;
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Local server failed to listen");
    vi.stubGlobal("fetch", (_url: RequestInfo | URL, init?: RequestInit) =>
      originalFetch(`http://127.0.0.1:${address.port}/batch`, init),
    );
    const results = await calendarBatchListEvents("fixture", [
      { calendarId: "one@example.test", params: {} },
      { calendarId: "two@example.test", params: {} },
    ]);
    expect(requests).toBe(1);
    expect(results[0]).toMatchObject({
      status: "fulfilled",
      value: { items: [] },
    });
    expect(results[1]).toMatchObject({
      status: "rejected",
      reason: { status: 403, reason: "rateLimitExceeded" },
    });
  } finally {
    vi.unstubAllGlobals();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
