import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createSsrfSafeDispatcher = vi.fn();
const isBlockedExtensionUrlWithDns = vi.fn();

vi.mock("@agent-native/core/extensions/url-safety", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@agent-native/core/extensions/url-safety")
    >();
  return {
    ...actual,
    createSsrfSafeDispatcher: (...args: unknown[]) =>
      createSsrfSafeDispatcher(...args),
    isBlockedExtensionUrlWithDns: (...args: unknown[]) =>
      isBlockedExtensionUrlWithDns(...args),
  };
});

import {
  evaluateAssertions,
  evaluateCheck,
  matchesStatus,
  normalizeAssertions,
  normalizeStatusMatcher,
  runMonitorCheck,
  shouldOpenMonitorIncident,
  type Assertion,
  type CheckOutcome,
  type StatusMatcher,
} from "./uptime-monitors";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  createSsrfSafeDispatcher.mockReset();
  isBlockedExtensionUrlWithDns.mockReset();
  createSsrfSafeDispatcher.mockResolvedValue(null);
  isBlockedExtensionUrlWithDns.mockResolvedValue(false);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("matchesStatus", () => {
  it("matches by status class", () => {
    const matcher: StatusMatcher = { mode: "class", classes: ["2xx", "3xx"] };
    expect(matchesStatus(200, matcher)).toBe(true);
    expect(matchesStatus(301, matcher)).toBe(true);
    expect(matchesStatus(404, matcher)).toBe(false);
    expect(matchesStatus(500, matcher)).toBe(false);
    expect(matchesStatus(null, matcher)).toBe(false);
  });

  it("matches by explicit code list", () => {
    const matcher: StatusMatcher = { mode: "list", codes: [200, 204] };
    expect(matchesStatus(200, matcher)).toBe(true);
    expect(matchesStatus(204, matcher)).toBe(true);
    expect(matchesStatus(201, matcher)).toBe(false);
  });

  it("matches by range", () => {
    const matcher: StatusMatcher = { mode: "range", min: 200, max: 299 };
    expect(matchesStatus(250, matcher)).toBe(true);
    expect(matchesStatus(300, matcher)).toBe(false);
  });
});

describe("evaluateAssertions", () => {
  const ctx = {
    statusCode: 200,
    latencyMs: 1200,
    bodyText: "<html>Welcome to Acme status: ok</html>",
    headers: { "content-type": "text/html; charset=utf-8" },
  };

  it("passes when expected text is present and forbidden text is absent", () => {
    const assertions: Assertion[] = [
      { type: "body_contains", value: "Welcome to Acme" },
      { type: "body_absent", value: "Internal Server Error" },
    ];
    expect(evaluateAssertions(assertions, ctx)).toEqual([]);
  });

  it("fails when expected text is missing", () => {
    const failures = evaluateAssertions(
      [{ type: "body_contains", value: "Goodbye" }],
      ctx,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].type).toBe("body_contains");
  });

  it("fails when forbidden text is present", () => {
    const failures = evaluateAssertions(
      [{ type: "body_absent", value: "status: ok" }],
      ctx,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].type).toBe("body_absent");
  });

  it("evaluates header assertions case-insensitively by name", () => {
    expect(
      evaluateAssertions(
        [
          {
            type: "header_contains",
            header: "Content-Type",
            value: "text/html",
          },
        ],
        ctx,
      ),
    ).toEqual([]);
    const failures = evaluateAssertions(
      [
        {
          type: "header_equals",
          header: "Content-Type",
          value: "application/json",
        },
      ],
      ctx,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].type).toBe("header_equals");
  });

  it("flags slow responses via max_latency_ms", () => {
    const failures = evaluateAssertions(
      [{ type: "max_latency_ms", value: 1000 }],
      ctx,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].type).toBe("max_latency_ms");
  });
});

describe("evaluateCheck classification", () => {
  const matcher: StatusMatcher = { mode: "class", classes: ["2xx"] };

  it("is up when status matches and all assertions pass", () => {
    const result = evaluateCheck({
      statusCode: 200,
      latencyMs: 120,
      bodyText: "ok",
      headers: {},
      matcher,
      assertions: [{ type: "body_contains", value: "ok" }],
    });
    expect(result.status).toBe("up");
    expect(result.ok).toBe(true);
    expect(result.failedAssertions).toEqual([]);
  });

  it("is down on unexpected status", () => {
    const result = evaluateCheck({
      statusCode: 503,
      latencyMs: 90,
      bodyText: "",
      headers: {},
      matcher,
      assertions: [],
    });
    expect(result.status).toBe("down");
    expect(result.ok).toBe(false);
    expect(result.failedAssertions[0]).toContain("503");
  });

  it("is down when a body assertion fails even if status is fine", () => {
    const result = evaluateCheck({
      statusCode: 200,
      latencyMs: 90,
      bodyText: "maintenance",
      headers: {},
      matcher,
      assertions: [{ type: "body_contains", value: "Welcome" }],
    });
    expect(result.status).toBe("down");
  });

  it("is degraded when only the latency assertion fails", () => {
    const result = evaluateCheck({
      statusCode: 200,
      latencyMs: 5000,
      bodyText: "ok",
      headers: {},
      matcher,
      assertions: [{ type: "max_latency_ms", value: 1000 }],
    });
    expect(result.status).toBe("degraded");
    expect(result.ok).toBe(false);
  });

  it("is down on a network/timeout fetch error", () => {
    const result = evaluateCheck({
      statusCode: null,
      latencyMs: null,
      bodyText: "",
      headers: {},
      matcher,
      assertions: [],
      fetchError: "Timed out after 10000ms",
      errorKind: "network",
    });
    expect(result.status).toBe("down");
  });

  it("is error on a config (SSRF/invalid URL) fetch error", () => {
    const result = evaluateCheck({
      statusCode: null,
      latencyMs: null,
      bodyText: "",
      headers: {},
      matcher,
      assertions: [],
      fetchError: "SSRF blocked: ...",
      errorKind: "config",
    });
    expect(result.status).toBe("error");
  });
});

describe("normalizeStatusMatcher", () => {
  it("defaults to the 2xx class", () => {
    expect(normalizeStatusMatcher(undefined)).toEqual({
      mode: "class",
      classes: ["2xx"],
    });
    expect(normalizeStatusMatcher({ mode: "class", classes: [] })).toEqual({
      mode: "class",
      classes: ["2xx"],
    });
  });

  it("normalizes and orders a range", () => {
    expect(
      normalizeStatusMatcher({ mode: "range", min: 299, max: 200 }),
    ).toEqual({ mode: "range", min: 200, max: 299 });
  });

  it("filters invalid codes from a list", () => {
    expect(
      normalizeStatusMatcher({ mode: "list", codes: [200, 9999, "204"] }),
    ).toEqual({ mode: "list", codes: [200, 204] });
  });
});

describe("normalizeAssertions", () => {
  it("drops unknown types and empty values, and requires header names", () => {
    const assertions = normalizeAssertions([
      { type: "body_contains", value: "hi" },
      { type: "body_contains", value: "  " },
      { type: "bogus", value: "x" },
      { type: "header_contains", value: "text/html" }, // missing header
      { type: "header_equals", header: "X-Env", value: "prod" },
      { type: "max_latency_ms", value: 0 }, // zero dropped
      { type: "max_latency_ms", value: 2500 },
    ]);
    expect(assertions).toEqual([
      { type: "body_contains", value: "hi" },
      { type: "header_equals", header: "X-Env", value: "prod" },
      { type: "max_latency_ms", value: 2500 },
    ]);
  });
});

describe("runMonitorCheck SSRF guard", () => {
  const base = {
    method: "GET" as const,
    requestHeaders: {},
    requestBody: null,
    timeoutMs: 5000,
    expectedStatus: { mode: "class", classes: ["2xx"] } as StatusMatcher,
    assertions: [] as Assertion[],
    followRedirects: true,
  };

  it("blocks loopback addresses without touching the network", async () => {
    const outcome = await runMonitorCheck(
      { ...base, url: "http://127.0.0.1:8080/health" },
      { allowPrivateHosts: false },
    );
    expect(outcome.status).toBe("error");
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/SSRF blocked/i);
  });

  it("blocks localhost", async () => {
    const outcome = await runMonitorCheck(
      { ...base, url: "http://localhost/health" },
      { allowPrivateHosts: false },
    );
    expect(outcome.status).toBe("error");
  });

  it("blocks the cloud metadata IP", async () => {
    const outcome = await runMonitorCheck(
      { ...base, url: "http://169.254.169.254/latest/meta-data/" },
      { allowPrivateHosts: false },
    );
    expect(outcome.status).toBe("error");
  });

  it("blocks private RFC1918 ranges", async () => {
    const outcome = await runMonitorCheck(
      { ...base, url: "http://10.0.0.5/" },
      { allowPrivateHosts: false },
    );
    expect(outcome.status).toBe("error");
  });

  it("rejects non-http(s) schemes", async () => {
    const outcome = await runMonitorCheck(
      { ...base, url: "file:///etc/passwd" },
      { allowPrivateHosts: false },
    );
    expect(outcome.status).toBe("error");
  });
});

describe("runMonitorCheck response body reads", () => {
  const base = {
    url: "https://example.com/health",
    method: "GET" as const,
    requestHeaders: {},
    requestBody: null,
    timeoutMs: 5000,
    expectedStatus: { mode: "class", classes: ["2xx"] } as StatusMatcher,
    assertions: [] as Assertion[],
    followRedirects: true,
  };

  it("skips response body reads when no body assertion needs them", async () => {
    const cancel = vi.fn(async () => {});
    globalThis.fetch = vi.fn(async () => {
      return {
        status: 200,
        headers: new Headers(),
        body: {
          cancel,
          getReader() {
            throw new Error("body should not be read");
          },
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const outcome = await runMonitorCheck(base, { allowPrivateHosts: true });

    expect(outcome.status).toBe("up");
    expect(outcome.ok).toBe(true);
    expect(outcome.statusCode).toBe(200);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("reads response bodies when body assertions are configured", async () => {
    const encoder = new TextEncoder();
    globalThis.fetch = vi.fn(async () => {
      let done = false;
      return {
        status: 200,
        headers: new Headers(),
        body: {
          getReader() {
            return {
              async read() {
                if (done) return { done: true, value: undefined };
                done = true;
                return {
                  done: false,
                  value: encoder.encode("maintenance"),
                };
              },
              async cancel() {},
            };
          },
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const outcome = await runMonitorCheck(
      {
        ...base,
        assertions: [{ type: "body_contains", value: "ok" }],
      },
      { allowPrivateHosts: true },
    );

    expect(outcome.status).toBe("down");
    expect(outcome.error).toContain("Body is missing expected text");
  });

  it("bounds body assertion reads after headers arrive", async () => {
    let releaseRead:
      | ((value: { done: boolean; value?: Uint8Array }) => void)
      | null = null;
    const cancel = vi.fn(async () => {
      releaseRead?.({ done: true });
    });
    globalThis.fetch = vi.fn(async () => {
      return {
        status: 200,
        headers: new Headers(),
        body: {
          getReader() {
            return {
              read() {
                return new Promise<{ done: boolean; value?: Uint8Array }>(
                  (resolve) => {
                    releaseRead = resolve;
                  },
                );
              },
              cancel,
            };
          },
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const outcome = await runMonitorCheck(
      {
        ...base,
        timeoutMs: 1000,
        assertions: [{ type: "body_contains", value: "ok" }],
      },
      { allowPrivateHosts: true },
    );

    expect(outcome.status).toBe("down");
    expect(outcome.statusCode).toBe(200);
    expect(outcome.error).toContain(
      "Response body read timed out after 1000ms",
    );
    expect(cancel).toHaveBeenCalled();
  });
});

describe("runMonitorCheck timeout budget", () => {
  // MIN_TIMEOUT_MS is 1000 — keep tests at/above that floor.
  const base = {
    url: "https://example.com/health",
    method: "GET" as const,
    requestHeaders: {},
    requestBody: null,
    timeoutMs: 1000,
    expectedStatus: { mode: "class", classes: ["2xx"] } as StatusMatcher,
    assertions: [] as Assertion[],
    followRedirects: false,
  };

  it("does not bill SSRF dispatcher/DNS setup against the request timeout", async () => {
    createSsrfSafeDispatcher.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return null;
    });
    isBlockedExtensionUrlWithDns.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return false;
    });

    globalThis.fetch = vi.fn(async () => {
      return {
        status: 200,
        headers: new Headers(),
        body: null,
        async text() {
          return "ok";
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const outcome = await runMonitorCheck(base, { allowPrivateHosts: false });

    expect(outcome.status).toBe("up");
    expect(outcome.ok).toBe(true);
    expect(outcome.statusCode).toBe(200);
    expect(outcome.error).toBeNull();
    expect(outcome.diagnostics.source).toBe("unknown");
    expect(outcome.diagnostics.timings.ssrfSetupMs).toBeGreaterThanOrEqual(600);
    expect(outcome.diagnostics.timings.requestMs).toBeGreaterThanOrEqual(0);
    expect(outcome.diagnostics.response?.statusCode).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("stores only safe response metadata in diagnostics", async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        status: 302,
        url: "https://example.com/callback?code=secret-example",
        headers: new Headers({
          location: "https://example.com/callback?code=secret-example",
          server: "example",
        }),
        body: null,
        async text() {
          return "";
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const outcome = await runMonitorCheck(
      { ...base, expectedStatus: { mode: "class", classes: ["3xx"] } },
      { allowPrivateHosts: true },
    );

    expect(outcome.status).toBe("up");
    expect(outcome.diagnostics.response?.finalHost).toBe("example.com");
    expect(outcome.diagnostics.response?.finalUrl).toBeUndefined();
    expect(outcome.diagnostics.response?.headers).toEqual({
      server: "example",
    });
  });

  it("still reports a real fetch timeout after headers never arrive", async () => {
    globalThis.fetch = vi.fn((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        if (!signal) return;
        if (signal.aborted) {
          reject(new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    }) as unknown as typeof fetch;

    const outcome = await runMonitorCheck(base, { allowPrivateHosts: true });

    expect(outcome.status).toBe("down");
    expect(outcome.ok).toBe(false);
    expect(outcome.statusCode).toBeNull();
    expect(outcome.error).toBe("Timed out after 1000ms");
    expect(outcome.latencyMs).toBe(1000);
    expect(outcome.diagnostics.error).toMatchObject({
      kind: "timeout",
      message: "Timed out after 1000ms",
    });
    expect(outcome.diagnostics.timings.requestMs).toBeGreaterThanOrEqual(1000);
  });
});

describe("shouldOpenMonitorIncident", () => {
  const timeoutOutcome: CheckOutcome = {
    checkedAt: "2026-07-08T00:00:00.000Z",
    status: "down",
    ok: false,
    statusCode: null,
    latencyMs: null,
    error: "Timed out after 10000ms",
    failedAssertions: ["Timed out after 10000ms"],
    diagnostics: {
      source: "unknown",
      runtime: {},
      request: {
        method: "GET",
        timeoutMs: 10000,
        followRedirects: true,
        assertionTypes: [],
        bodyReadRequired: false,
        allowPrivateHosts: false,
      },
      timings: {},
    },
  };

  it("requires confirmation for transient no-response failures", () => {
    expect(shouldOpenMonitorIncident(timeoutOutcome, 0, 2)).toBe(false);
    expect(shouldOpenMonitorIncident(timeoutOutcome, 1, 2)).toBe(true);
  });

  it("requires confirmation for transient latency degradations", () => {
    const degradedOutcome: CheckOutcome = {
      ...timeoutOutcome,
      status: "degraded",
      statusCode: 200,
      latencyMs: 4500,
      error: "Response took 4500ms (max 1000ms)",
      failedAssertions: ["Response took 4500ms (max 1000ms)"],
    };

    expect(shouldOpenMonitorIncident(degradedOutcome, 0, 2)).toBe(false);
    expect(shouldOpenMonitorIncident(degradedOutcome, 1, 2)).toBe(true);
  });

  it("opens immediately for HTTP failures that returned a response", () => {
    expect(
      shouldOpenMonitorIncident(
        {
          ...timeoutOutcome,
          statusCode: 503,
          latencyMs: 120,
          error: "Unexpected status 503",
          failedAssertions: ["Unexpected status 503"],
        },
        0,
        2,
      ),
    ).toBe(true);
  });

  it("does not send recovery notifications for suppressed flap incidents", () => {
    const source = readFileSync(
      new URL("./uptime-monitors.ts", import.meta.url),
      "utf8",
    );
    const recoveryIndex = source.indexOf("if (open.notificationDelivered)");
    const notifyIndex = source.indexOf("await notifyMonitorRecovered");

    expect(recoveryIndex).toBeGreaterThan(-1);
    expect(notifyIndex).toBeGreaterThan(recoveryIndex);
  });

  it("tracks actual down-notification delivery for recovery alerts", () => {
    const source = readFileSync(
      new URL("./uptime-monitors.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("delivery.deliveredChannels.length > 0");
    expect(source).toContain("notificationDelivered,");
  });
});
