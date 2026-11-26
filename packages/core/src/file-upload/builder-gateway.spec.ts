import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BuilderGatewayError,
  builderGatewayRequest,
  describeErrorBody,
  type BuilderGatewayStep,
} from "./builder-gateway.js";

const URL = "https://builder.example/api/v1/upload/signed-url";
const INIT = {
  method: "POST",
  headers: {
    Authorization: "Bearer secret-token",
    "Content-Type": "application/json",
  },
  body: "{}",
};
const STEPS: BuilderGatewayStep[] = ["signed_url", "session_start", "complete"];
const LABELS: Record<BuilderGatewayStep, string> = {
  signed_url: "Builder.io signed-URL request failed",
  session_start: "GCS resumable session initiation failed",
  complete: "Builder.io upload complete failed",
};
const ATTEMPTS: Record<BuilderGatewayStep, number> = {
  signed_url: 3,
  session_start: 3,
  complete: 4,
};
// Wait before each retry: 500 ms, tripled every time.
const WAITS: Record<BuilderGatewayStep, number[]> = {
  signed_url: [500, 1_500],
  session_start: [500, 1_500],
  complete: [500, 1_500, 4_500],
};
const RETRIED: Record<BuilderGatewayStep, number[]> = {
  signed_url: [502, 503, 504],
  session_start: [408, 429, 500, 502, 503, 504],
  complete: [409, 502, 503, 504],
};
const NOT_RETRIED: Record<BuilderGatewayStep, number[]> = {
  signed_url: [400, 401, 403, 404, 409, 429, 500],
  session_start: [400, 401, 403, 404, 409],
  complete: [400, 401, 403, 404, 429, 500],
};
const GOOGLE_PAGE =
  "<!DOCTYPE html><html lang=en><title>Error 502 (Server Error)!!1</title><p>That's an error.</p></html>";
const TRACE_HEADER = /^[0-9a-f]{32}\/1;o=1$/;

function reply(
  status: number,
  options: {
    body?: string;
    headers?: Record<string, string>;
    statusText?: string;
  } = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: options.statusText ?? `status ${status}`,
    headers: new Headers(options.headers ?? {}),
    text: async () => options.body ?? "",
  } as unknown as Response;
}

const googlePage = (headers: Record<string, string> = {}) =>
  reply(502, {
    body: GOOGLE_PAGE,
    headers: { "content-type": "text/html; charset=UTF-8", ...headers },
  });

type Failure = BuilderGatewayError & Record<string, unknown>;

describe("builderGatewayRequest", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let warn: ReturnType<typeof vi.spyOn>;
  let log: ReturnType<typeof vi.spyOn>;

  const start = (step: BuilderGatewayStep, init = INIT) =>
    builderGatewayRequest(step, URL, init).then(
      (response) => ({ response }) as { response: Response; error?: never },
      (error: unknown) => ({ error: error as Failure }),
    );
  const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
  const sentTraceIds = () =>
    fetchMock.mock.calls.map(
      (call) =>
        (call[1].headers["X-Cloud-Trace-Context"] as string).split("/")[0],
    );
  /** A request that never answers; it rejects when the caller aborts it. */
  const hang =
    (signals: AbortSignal[] = []) =>
    (_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        signals.push(init.signal);
        init.signal.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });

  beforeEach(() => {
    vi.useFakeTimers();
    // 0.5 makes the retry jitter exactly the nominal wait.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("a request that works", () => {
    it("resolves with the first OK response and logs nothing", async () => {
      const ok = reply(200);
      fetchMock.mockResolvedValue(ok);

      const outcome = await start("signed_url");

      expect(outcome.response).toBe(ok);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        URL,
        expect.objectContaining({
          method: "POST",
          body: "{}",
          signal: expect.any(AbortSignal),
        }),
      );
      expect(warn).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    });

    it.each(["signed_url", "complete"] as const)(
      "sends a trace id on %s and keeps the caller's headers",
      async (step) => {
        fetchMock.mockResolvedValue(reply(200));

        await start(step);

        const headers = fetchMock.mock.calls[0][1].headers;
        expect(headers["X-Cloud-Trace-Context"]).toMatch(TRACE_HEADER);
        expect(headers.Authorization).toBe("Bearer secret-token");
        expect(headers["Content-Type"]).toBe("application/json");
      },
    );

    it("sends the storage session start untouched, with no trace id", async () => {
      fetchMock.mockResolvedValue(reply(200));

      await start("session_start");

      expect(fetchMock.mock.calls[0][1].headers).toEqual(INIT.headers);
    });

    it("says so when a retry recovered the request", async () => {
      fetchMock
        .mockResolvedValueOnce(googlePage())
        .mockResolvedValueOnce(reply(200));

      const outcome = start("signed_url");
      await advance(500);
      await outcome;

      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        "[builder-upload] signed_url recovered on attempt 2/3",
        { elapsedMs: 0, traceId: sentTraceIds()[1] },
      );
    });
  });

  describe("which failures are retried", () => {
    for (const step of STEPS) {
      it.each(RETRIED[step])(
        `retries a ${step} ${"%i"}, then takes the OK answer`,
        async (status) => {
          fetchMock
            .mockResolvedValueOnce(reply(status))
            .mockResolvedValueOnce(reply(200));

          const outcome = start(step);
          await advance(500);

          expect(await outcome).toHaveProperty("response");
          expect(fetchMock).toHaveBeenCalledTimes(2);
        },
      );

      it.each(NOT_RETRIED[step])(
        `does not retry a ${step} ${"%i"}`,
        async (status) => {
          fetchMock.mockResolvedValue(reply(status));

          const { error } = await start(step);

          expect(error).toMatchObject({ status, attempts: 1 });
          expect(fetchMock).toHaveBeenCalledTimes(1);
        },
      );

      it(`gives up on ${step} after ${ATTEMPTS[step]} attempts`, async () => {
        fetchMock.mockResolvedValue(googlePage());

        const outcome = start(step);
        for (const wait of WAITS[step]) await advance(wait);
        const { error } = await outcome;

        expect(fetchMock).toHaveBeenCalledTimes(ATTEMPTS[step]);
        expect(error).toMatchObject({
          step,
          status: 502,
          attempts: ATTEMPTS[step],
        });
      });

      it(`retries a dropped ${step} connection, then reports it with no status`, async () => {
        const dropped = new TypeError("fetch failed");
        fetchMock.mockRejectedValue(dropped);

        const outcome = start(step);
        for (const wait of WAITS[step]) await advance(wait);
        const { error } = await outcome;

        expect(fetchMock).toHaveBeenCalledTimes(ATTEMPTS[step]);
        expect(error?.message).toBe(
          `${LABELS[step]} (no response): fetch failed`,
        );
        expect(error).toMatchObject({
          status: 0,
          attempts: ATTEMPTS[step],
          isHtml: false,
          headers: {},
        });
        expect(error?.cause).toBe(dropped);
      });
    }

    it("reports a rejection that is not an Error by its text", async () => {
      fetchMock.mockRejectedValue("socket hang up");

      const outcome = start("complete");
      for (const wait of WAITS.complete) await advance(wait);
      const { error } = await outcome;

      expect(error?.message).toBe(
        "Builder.io upload complete failed (no response): socket hang up",
      );
    });
  });

  describe("backoff", () => {
    it("waits 500 ms, then 1.5 s, then 4.5 s between upload-complete attempts", async () => {
      fetchMock.mockResolvedValue(googlePage());

      const outcome = start("complete");
      await advance(499);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await advance(1_499);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await advance(1);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      await advance(4_499);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      await advance(1);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      await outcome;
    });

    it("shortens the wait by a quarter at the lowest jitter", async () => {
      vi.mocked(Math.random).mockReturnValue(0);
      fetchMock.mockResolvedValue(googlePage());

      const outcome = start("signed_url");
      await advance(374);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await advance(5_000);
      await outcome;
    });

    it("lengthens the wait by a quarter at the highest jitter", async () => {
      vi.mocked(Math.random).mockReturnValue(1);
      fetchMock.mockResolvedValue(googlePage());

      const outcome = start("signed_url");
      await advance(624);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await advance(5_000);
      await outcome;
    });
  });

  describe("timeouts", () => {
    it("aborts a signed-URL request at 15 s and retries it", async () => {
      const signals: AbortSignal[] = [];
      fetchMock
        .mockImplementationOnce(hang(signals))
        .mockResolvedValueOnce(reply(200));

      const outcome = start("signed_url");
      await advance(14_999);
      expect(signals[0].aborted).toBe(false);
      await advance(1);
      expect(signals[0].aborted).toBe(true);
      await advance(500);

      expect(await outcome).toHaveProperty("response");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("aborts a storage session start at 15 s and retries it", async () => {
      fetchMock
        .mockImplementationOnce(hang())
        .mockResolvedValueOnce(reply(200));

      const outcome = start("session_start");
      await advance(15_000);
      await advance(500);

      expect(await outcome).toHaveProperty("response");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("reports a signed-URL request that keeps timing out", async () => {
      fetchMock.mockImplementation(hang());

      const outcome = start("signed_url");
      await advance(15_000);
      await advance(500);
      await advance(15_000);
      await advance(1_500);
      await advance(15_000);
      const { error } = await outcome;

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(error?.message).toBe(
        "Builder.io signed-URL request failed (no response): timed out after 15000 ms",
      );
    });

    it("gives upload complete 120 s and never resends it after that timeout", async () => {
      const signals: AbortSignal[] = [];
      fetchMock.mockImplementation(hang(signals));

      const outcome = start("complete");
      await advance(119_999);
      expect(signals[0].aborted).toBe(false);
      await advance(1);
      const { error } = await outcome;
      await advance(60_000);

      expect(signals[0].aborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(error).toMatchObject({ step: "complete", status: 0, attempts: 1 });
      expect(error?.message).toBe(
        "Builder.io upload complete failed (no response): timed out after 120000 ms",
      );
    });

    it("stops the clock once a response arrives", async () => {
      const signals: AbortSignal[] = [];
      fetchMock.mockImplementation(
        (_url: string, init: { signal: AbortSignal }) => {
          signals.push(init.signal);
          return Promise.resolve(reply(200));
        },
      );

      await start("signed_url");
      await advance(200_000);

      expect(signals[0].aborted).toBe(false);
    });

    it("stops the clock on an attempt that got a gateway error", async () => {
      const signals: AbortSignal[] = [];
      fetchMock
        .mockImplementationOnce(
          (_url: string, init: { signal: AbortSignal }) => {
            signals.push(init.signal);
            return Promise.resolve(googlePage());
          },
        )
        .mockResolvedValueOnce(reply(200));

      const outcome = start("signed_url");
      await advance(500);
      await outcome;
      await advance(60_000);

      expect(signals[0].aborted).toBe(false);
    });
  });

  describe("the error it throws", () => {
    const everyHeader = {
      server: "Google Frontend",
      via: "1.1 google",
      "x-served-by": "cache-chi-1",
      "x-cache": "MISS",
      "x-cloud-trace-context": "abc;o=1",
      "x-amz-cf-id": "cf-id",
      "x-amz-cf-pop": "ORD1",
      "cf-ray": "ray-1",
      "retry-after": "30",
      date: "Thu, 12 Nov 2026 20:00:00 GMT",
    };

    it("carries the step, status, attempts and trace ids, with no page in the message", async () => {
      fetchMock.mockResolvedValue(googlePage(everyHeader));

      const outcome = start("signed_url");
      await advance(500);
      await advance(1_500);
      const { error } = await outcome;

      expect(error).toBeInstanceOf(BuilderGatewayError);
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({
        name: "BuilderGatewayError",
        provider: "builder",
        step: "signed_url",
        status: 502,
        attempts: 3,
        isHtml: true,
      });
      expect(error?.message).toBe(
        "Builder.io signed-URL request failed (502): HTML error page returned instead of JSON",
      );
      expect(error?.traceIds).toEqual(sentTraceIds());
      expect(error?.traceIds).toHaveLength(3);
      expect(new Set(error?.traceIds).size).toBe(3);
      expect(error?.cause).toBeUndefined();
      expect(Object.hasOwn(error as object, "cause")).toBe(false);
    });

    it("keeps only the response headers that say which layer answered", async () => {
      fetchMock.mockResolvedValue(
        googlePage({
          ...everyHeader,
          "set-cookie": "session=secret-cookie",
          authorization: "Bearer secret-token",
          "x-internal": "private",
        }),
      );

      const outcome = start("complete");
      for (const wait of WAITS.complete) await advance(wait);
      const { error } = await outcome;

      expect(error?.headers).toEqual({
        ...everyHeader,
        "content-type": "text/html; charset=UTF-8",
      });
    });

    it("keeps a JSON error body from the gateway in the message", async () => {
      fetchMock.mockResolvedValue(
        reply(500, { body: '{"message":"Failed to complete upload"}' }),
      );

      const { error } = await start("complete");

      expect(error?.message).toBe(
        'Builder.io upload complete failed (500): {"message":"Failed to complete upload"}',
      );
      expect(error?.isHtml).toBe(false);
    });

    it("has no trace ids for the storage session start, which sends none", async () => {
      fetchMock.mockResolvedValue(reply(400));

      const { error } = await start("session_start");

      expect(error?.traceIds).toEqual([]);
    });
  });

  describe("the logs", () => {
    it("log each failed attempt with its status, time, trace id and headers", async () => {
      fetchMock.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve(googlePage({ server: "Google Frontend" })),
              250,
            ),
          ),
      );

      const outcome = start("signed_url");
      await advance(250);
      await advance(500);
      await advance(250);
      await advance(1_500);
      await advance(250);
      await outcome;

      const [first, , third] = warn.mock.calls;
      expect(warn).toHaveBeenCalledTimes(3);
      expect(first[0]).toBe(
        "[builder-upload] signed_url attempt 1/3 failed, retrying",
      );
      expect(first[1]).toEqual({
        status: 502,
        elapsedMs: 250,
        traceId: sentTraceIds()[0],
        headers: {
          server: "Google Frontend",
          "content-type": "text/html; charset=UTF-8",
        },
      });
      expect(third[0]).toBe("[builder-upload] signed_url attempt 3/3 failed");
    });

    it("say there was no response, and no trace id when none was sent", async () => {
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));

      const outcome = start("session_start");
      for (const wait of WAITS.session_start) await advance(wait);
      await outcome;

      expect(warn.mock.calls[0][1]).toEqual({
        status: "no response",
        elapsedMs: 0,
        traceId: null,
        headers: {},
      });
    });

    it("never include the token", async () => {
      fetchMock.mockResolvedValue(googlePage());

      const outcome = start("complete");
      for (const wait of WAITS.complete) await advance(wait);
      const { error } = await outcome;

      expect(
        JSON.stringify([
          warn.mock.calls,
          log.mock.calls,
          error?.headers,
          error?.message,
        ]),
      ).not.toContain("secret-token");
    });
  });
});

describe("describeErrorBody", () => {
  const withBody = (
    body: string,
    headers: Record<string, string> = {},
    statusText = "Bad Gateway",
  ) => reply(502, { body, headers, statusText });

  it("reduces an HTML error page, found by content type, to one line", async () => {
    await expect(
      describeErrorBody(
        withBody("not html at all", {
          "content-type": "TEXT/HTML; charset=utf-8",
        }),
      ),
    ).resolves.toEqual({
      detail: "HTML error page returned instead of JSON",
      isHtml: true,
    });
  });

  it.each([
    "<!DOCTYPE html><html></html>",
    "  \n<!doctype HTML>",
    "<html lang=en>",
    "<HTML>",
  ])("recognizes an HTML page by its start: %s", async (body) => {
    await expect(describeErrorBody(withBody(body))).resolves.toMatchObject({
      isHtml: true,
    });
  });

  it.each([
    '{"message":"bad html"}',
    "<htmlfoo>",
    "<!doctypehtml>",
    "oops <html>",
    "<div>",
  ])("does not mistake this for an HTML page: %s", async (body) => {
    await expect(describeErrorBody(withBody(body))).resolves.toMatchObject({
      isHtml: false,
    });
  });

  it("keeps a short text body, trimmed", async () => {
    await expect(
      describeErrorBody(
        withBody('  {"message":"nope"}\n', {
          "content-type": "application/json",
        }),
      ),
    ).resolves.toEqual({ detail: '{"message":"nope"}', isHtml: false });
  });

  it("cuts a long body to 500 characters", async () => {
    const { detail } = await describeErrorBody(withBody("x".repeat(600)));

    expect(detail).toBe("x".repeat(500));
  });

  it("falls back to the status text for an empty body", async () => {
    await expect(describeErrorBody(withBody("  \n"))).resolves.toEqual({
      detail: "Bad Gateway",
      isHtml: false,
    });
  });

  it("says so when the body cannot be read", async () => {
    const unreadable = {
      ...reply(502, { statusText: "Bad Gateway" }),
      text: async () => {
        throw new Error("stream reset");
      },
    } as unknown as Response;

    await expect(describeErrorBody(unreadable)).resolves.toEqual({
      detail: "Bad Gateway (response body unreadable)",
      isHtml: false,
    });
  });

  it("names a missing status text when the body cannot be read", async () => {
    const unreadable = {
      ...reply(502, { statusText: "" }),
      text: async () => {
        throw new Error("stream reset");
      },
    } as unknown as Response;

    await expect(describeErrorBody(unreadable)).resolves.toEqual({
      detail: "no status text (response body unreadable)",
      isHtml: false,
    });
  });
});

describe("BuilderGatewayError", () => {
  const details = {
    step: "complete" as const,
    status: 502,
    attempts: 4,
    isHtml: true,
    traceIds: ["a", "b"],
    headers: { server: "Google Frontend" },
  };

  it("holds what it was given", () => {
    const error = new BuilderGatewayError("failed", details);

    expect(error).toMatchObject({
      name: "BuilderGatewayError",
      message: "failed",
      provider: "builder",
      ...details,
    });
    expect(Object.hasOwn(error, "cause")).toBe(false);
  });

  it("keeps the error that caused it", () => {
    const cause = new TypeError("fetch failed");

    expect(new BuilderGatewayError("failed", { ...details, cause }).cause).toBe(
      cause,
    );
  });
});
