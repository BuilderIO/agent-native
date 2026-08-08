import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withDbTimeout } from "../db/client.js";
import {
  registerTrackingProvider,
  unregisterTrackingProvider,
  type TrackingEvent,
} from "../tracking/index.js";
import {
  installHttpResponseTelemetryHooks,
  normalizeHttpTelemetryPath,
  recordFrameworkReadyWait,
} from "./http-response-telemetry.js";

// The module keeps its cold-start bookkeeping on globalThis under this symbol.
// Reaching for it lets a test pin whether a request is process request #1
// instead of depending on which spec ran first.
const processState = (globalThis as any)[
  Symbol.for("@agent-native/core/http-response-telemetry.process-state")
] as { requestSequence: number; moduleEvalUptimeMs: number };

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("AGENT_NATIVE_HTTP_TELEMETRY_SAMPLE_RATE", "1");
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  unregisterTrackingProvider("http-response-telemetry-test");
  vi.unstubAllEnvs();
});

function createHooks() {
  const requestHooks: Array<(event: any) => unknown> = [];
  const responseHooks: Array<(response: Response, event: any) => unknown> = [];
  installHttpResponseTelemetryHooks({
    hooks: {
      hook(name: string, handler: (...args: any[]) => unknown) {
        if (name === "request") requestHooks.push(handler);
        if (name === "response") responseHooks.push(handler);
      },
    },
  });
  return { requestHooks, responseHooks };
}

function eventFor(path: string) {
  const url = new URL(`https://plan.agent-native.com${path}`);
  return {
    url,
    context: {},
    req: new Request(url, { method: "GET" }),
    res: { status: 200, headers: new Headers() },
  };
}

function loggedLines(): Array<Record<string, unknown>> {
  return logSpy.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.includes("agent-native.slow_request"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("http response telemetry", () => {
  it("normalizes high-cardinality path segments before tracking", () => {
    expect(
      normalizeHttpTelemetryPath(
        "/design/_agent-native/agent-chat/runs/run-1783002639448-8rptjt/events",
      ),
    ).toBe("/design/_agent-native/agent-chat/runs/:id/events");
    expect(
      normalizeHttpTelemetryPath(
        "/api/session-replay/recordings/2f6d6628-b9fa-4c09-8cef-306928123456",
      ),
    ).toBe("/api/session-replay/recordings/:id");
  });

  it("tracks Web Response timing with cold-start and DB phase fields", async () => {
    const requestHooks: Array<(event: any) => unknown> = [];
    const responseHooks: Array<(response: Response, event: any) => unknown> =
      [];
    const nitroApp = {
      hooks: {
        hook(name: string, handler: (...args: any[]) => unknown) {
          if (name === "request") requestHooks.push(handler);
          if (name === "response") responseHooks.push(handler);
        },
      },
    };
    const tracked: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "http-response-telemetry-test",
      track(event) {
        tracked.push(event);
      },
    });
    installHttpResponseTelemetryHooks(nitroApp);

    await withDbTimeout("connect", async () => undefined, 100);

    const url = new URL(
      "https://plan.agent-native.com/_agent-native/actions/list-visual-plans",
    );
    const event = {
      url,
      context: {},
      req: new Request(url, { method: "GET" }),
      res: { status: 201, headers: new Headers() },
    };

    await requestHooks[0](event);
    await withDbTimeout("connect", async () => undefined, 100);
    await withDbTimeout("query", async () => undefined, 100);
    recordFrameworkReadyWait(event as any, 12);
    const response = new Response("{}", { status: 201 });
    await responseHooks[0](response, event);

    const telemetry = tracked.find((entry) => entry.name === "http.response");
    expect(telemetry?.properties).toMatchObject({
      status_code: 201,
      path: "/_agent-native/actions/list-visual-plans",
      measurement: "nitro_request",
      framework_ready_wait_ms: 12,
      db_operation_count: 2,
      db_query_count: 1,
      db_connect_count: 1,
      db_error_count: 0,
      startup_db_connect_count: 1,
    });
    expect(telemetry?.properties?.request_id).toEqual(expect.any(String));
    expect(telemetry?.properties?.request_sequence).toEqual(expect.any(Number));
    expect(telemetry?.properties?.process_age_ms).toEqual(expect.any(Number));
    expect(telemetry?.properties?.boot_to_module_ms).toEqual(
      expect.any(Number),
    );
    expect(telemetry?.properties?.module_to_request_ms).toEqual(
      expect.any(Number),
    );
    expect(response.headers.get("server-timing")).toContain("app;dur=");
    expect(response.headers.get("server-timing")).toContain("startup;dur=12");
    expect(response.headers.get("server-timing")).toContain("db;dur=");
    expect(response.headers.get("server-timing")).toContain("startup-db;dur=");
    expect(response.headers.get("x-agent-native-request-id")).toBe(
      telemetry?.properties?.request_id,
    );
  });

  it("always tracks 4xx action routes when success sampling is disabled", async () => {
    vi.stubEnv("AGENT_NATIVE_HTTP_TELEMETRY_SAMPLE_RATE", "0");
    const requestHooks: Array<(event: any) => unknown> = [];
    const responseHooks: Array<(response: Response, event: any) => unknown> =
      [];
    const nitroApp = {
      hooks: {
        hook(name: string, handler: (...args: any[]) => unknown) {
          if (name === "request") requestHooks.push(handler);
          if (name === "response") responseHooks.push(handler);
        },
      },
    };
    const tracked: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "http-response-telemetry-test",
      track(event) {
        tracked.push(event);
      },
    });
    installHttpResponseTelemetryHooks(nitroApp);

    const warmupUrl = new URL("https://plan.agent-native.com/");
    const warmupEvent = {
      url: warmupUrl,
      context: {},
      req: new Request(warmupUrl),
      res: { status: 200, headers: new Headers() },
    };
    await requestHooks[0](warmupEvent);
    await responseHooks[0](new Response("ok"), warmupEvent);
    tracked.length = 0;

    const actionUrl = new URL(
      "https://plan.agent-native.com/_agent-native/actions/get-visual-plan",
    );
    const actionEvent = {
      url: actionUrl,
      context: {},
      req: new Request(actionUrl),
      res: { status: 403, headers: new Headers() },
    };
    await requestHooks[0](actionEvent);
    await responseHooks[0](
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
      actionEvent,
    );

    expect(tracked).toHaveLength(1);
    expect(tracked[0]).toMatchObject({
      name: "http.response",
      properties: {
        path: "/_agent-native/actions/get-visual-plan",
        status_code: 403,
        status_class: "4xx",
      },
    });
  });

  it("reports the pre-handler boot phases on a cold start", async () => {
    const { requestHooks, responseHooks } = createHooks();
    processState.requestSequence = 0;

    const event = eventFor("/_agent-native/actions/list-visual-plans");
    await requestHooks[0](event);
    const response = new Response("{}");
    await responseHooks[0](response, event);

    const timing = response.headers.get("server-timing") ?? "";
    expect(timing).toContain("boot;dur=");
    expect(timing).toContain("init;dur=");

    const [line] = loggedLines();
    expect(line).toMatchObject({
      event: "agent-native.slow_request",
      cold_start: true,
      request_sequence: 1,
      path: "/_agent-native/actions/list-visual-plans",
      status: 200,
    });
    expect(line?.boot_to_module_ms).toEqual(expect.any(Number));
    expect(line?.module_to_request_ms).toEqual(expect.any(Number));
  });

  it("does not put live phase timings on a shared-cacheable response", async () => {
    const { requestHooks, responseHooks } = createHooks();
    processState.requestSequence = 5;

    const event = eventFor("/");
    await requestHooks[0](event);
    const response = new Response("<html></html>", {
      headers: {
        "cache-control": "public, max-age=0, stale-while-revalidate=604800",
      },
    });
    await responseHooks[0](response, event);

    const timing = response.headers.get("server-timing") ?? "";
    expect(timing).toContain("origin;dur=");
    // A replayed header must not name a phase a later visitor would read as
    // the cost of their own request.
    expect(timing).not.toContain("app;dur=");
    expect(timing).not.toContain("db;dur=");
    // The render's wall-clock time is what makes the replay visible.
    const desc = /desc="([^"]+)"/.exec(timing)?.[1] ?? "";
    expect(Date.parse(desc.split(" ")[0] ?? "")).not.toBeNaN();
  });

  it("keeps phase timings on a response no shared cache will replay", async () => {
    const { requestHooks, responseHooks } = createHooks();
    processState.requestSequence = 5;

    const event = eventFor("/_agent-native/actions/get-visual-plan");
    await requestHooks[0](event);
    const response = new Response("{}", {
      headers: { "cache-control": "private, no-store" },
    });
    await responseHooks[0](response, event);

    expect(response.headers.get("server-timing")).toContain("app;dur=");
    expect(response.headers.get("server-timing")).not.toContain("origin;dur=");
  });

  it("logs slow warm requests once and leaves fast ones silent", async () => {
    const { requestHooks, responseHooks } = createHooks();
    processState.requestSequence = 5;

    const fastEvent = eventFor("/");
    await requestHooks[0](fastEvent);
    await responseHooks[0](new Response("ok"), fastEvent);
    expect(loggedLines()).toHaveLength(0);

    const startedAt = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(startedAt);
    const slowEvent = eventFor("/reports/42");
    await requestHooks[0](slowEvent);
    nowSpy.mockReturnValue(startedAt + 2_400);
    await responseHooks[0](new Response("ok"), slowEvent);
    nowSpy.mockRestore();

    const lines = loggedLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      event: "agent-native.slow_request",
      cold_start: false,
      duration_ms: 2_400,
      path: "/reports/:id",
    });
  });
});
