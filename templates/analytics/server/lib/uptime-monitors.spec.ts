import { describe, expect, it } from "vitest";

import {
  evaluateAssertions,
  evaluateCheck,
  matchesStatus,
  normalizeAssertions,
  normalizeStatusMatcher,
  runMonitorCheck,
  type Assertion,
  type StatusMatcher,
} from "./uptime-monitors";

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
