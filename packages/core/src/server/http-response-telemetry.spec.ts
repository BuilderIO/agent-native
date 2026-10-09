import { AsyncLocalStorage } from "node:async_hooks";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withDbTimeout } from "../db/client.js";
import { createDatabaseRequestTelemetry } from "../db/request-telemetry.js";
import { registerObservabilityProvider } from "../observability/otel-provider.js";
import {
  type AgentSpan,
  __resetAgentTracerCache,
  __setAgentTracerForTests,
} from "../observability/tracing.js";
import {
  registerTrackingProvider,
  unregisterTrackingProvider,
  type TrackingEvent,
} from "../tracking/index.js";
import {
  getHttpRequestTelemetryId,
  installHttpResponseTelemetryHooks,
  normalizeHttpTelemetryPath,
  recordFrameworkReadyWait,
  registerHttpRequestTelemetryActionRoute,
  setHttpRequestTelemetryActionName,
} from "./http-response-telemetry.js";

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
  __resetAgentTracerCache();
  vi.unstubAllEnvs();
});

function createHooks(nitroApp: Record<string, unknown> = {}) {
  const requestHooks: Array<(event: any) => unknown> = [];
  const responseHooks: Array<(response: Response, event: any) => unknown> = [];
  nitroApp.hooks = {
    hook(name: string, handler: (...args: any[]) => unknown) {
      if (name === "request") requestHooks.push(handler);
      if (name === "response") responseHooks.push(handler);
    },
  };
  installHttpResponseTelemetryHooks(nitroApp);
  return { requestHooks, responseHooks, nitroApp };
}

function eventFor(path: string) {
  const url = new URL(`https://plan.agent-native.com${path}`);
  return {
    url,
    context: {},
    req: new Request(url, { method: "GET" }),
    res: { status: 200, headers: new Headers(), errHeaders: new Headers() },
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

    const startupState = (globalThis as any)[
      Symbol.for("@agent-native/core/db.startup-telemetry-state")
    ] as {
      captureUntil: number;
      claimed: boolean;
      telemetry: ReturnType<typeof createDatabaseRequestTelemetry>;
    };
    startupState.claimed = false;
    startupState.captureUntil = Date.now() + 120_000;
    startupState.telemetry = createDatabaseRequestTelemetry();

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
    expect(startupState.claimed).toBe(false);
    setHttpRequestTelemetryActionName(event as any, "list-visual-plans");
    await withDbTimeout("connect", async () => undefined, 100);
    await withDbTimeout("query", async () => undefined, 100);
    recordFrameworkReadyWait(event as any, 12);
    expect(startupState.claimed).toBe(true);
    const response = new Response("{}", { status: 201 });
    await responseHooks[0](response, event);

    const telemetry = tracked.find((entry) => entry.name === "http.response");
    expect(telemetry?.properties).toMatchObject({
      status_code: 201,
      path: "/_agent-native/actions/list-visual-plans",
      action_name: "list-visual-plans",
      measurement: "nitro_request",
      sample_rate: 1,
      sample_weight: 1,
      sampled: false,
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
    expect(response.headers.get("server-timing")).toContain("db-queries;dur=1");
    expect(response.headers.get("server-timing")).toContain(
      "db-connects;dur=1",
    );
    expect(response.headers.get("server-timing")).toContain("startup-db;dur=");
    expect(response.headers.get("x-agent-native-request-id")).toBe(
      telemetry?.properties?.request_id,
    );
  });

  it("includes measured DB counters on cacheable cold pages", async () => {
    const { requestHooks, responseHooks } = createHooks();
    const event = eventFor("/");
    await requestHooks[0](event);
    await withDbTimeout(
      "query",
      async () => ({ rows: [{ name: "forms" }, { name: "responses" }] }),
      100,
      undefined,
      {
        sql: "SELECT name FROM information_schema.columns JOIN forms_migrations ON true",
      },
    );

    const response = new Response("<html></html>", {
      headers: { "cache-control": "public, s-maxage=60" },
    });
    await responseHooks[0](response, event);

    const timing = response.headers.get("server-timing") ?? "";
    expect(timing).toContain("dbq=1");
    expect(timing).toContain("dbrows=2");
    expect(timing).toContain("dbcatalog=1");
    expect(timing).toContain("dbmigrations=1");
    expect(timing).toMatch(/startupdb(?:q=|=unavailable)/);
  });

  it("flushes the response OTel mirror from its request scope", async () => {
    const spanNames: string[] = [];
    __setAgentTracerForTests({
      startSpan(name: string): AgentSpan {
        spanNames.push(name);
        return {
          setAttribute() {},
          setAttributes() {},
          setStatus() {},
          recordException() {},
          end() {},
        };
      },
    });
    processState.requestSequence = 5;
    const { requestHooks, responseHooks } = createHooks();
    const event = eventFor("/");

    await requestHooks[0](event);
    await responseHooks[0](new Response("ok"), event);

    expect(spanNames).toContain("http.server");
  });

  it("matches parameterized action routes before the handler runs", async () => {
    const tracked: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "http-response-telemetry-test",
      track(event) {
        tracked.push(event);
      },
    });
    const nitroApp = {};
    registerHttpRequestTelemetryActionRoute(
      "/_agent-native/actions/reports/:reportId",
      "get-report",
      "/_agent-native/actions/reports/:reportId",
      nitroApp,
    );
    const { requestHooks, responseHooks } = createHooks(nitroApp);
    const event = eventFor("/_agent-native/actions/reports/report-123");

    await requestHooks[0](event);
    await responseHooks[0](new Response("ok"), event);

    expect(
      tracked.find((entry) => entry.name === "http.response")?.properties,
    ).toMatchObject({
      action_name: "get-report",
      route_template: "/_agent-native/actions/reports/:reportId",
    });
  });

  it("weights sampled warm action responses", async () => {
    vi.stubEnv("AGENT_NATIVE_HTTP_TELEMETRY_SAMPLE_RATE", "0.25");
    processState.requestSequence = 5;
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.1);
    try {
      const { requestHooks, responseHooks } = createHooks();
      const tracked: TrackingEvent[] = [];
      registerTrackingProvider({
        name: "http-response-telemetry-test",
        track(event) {
          tracked.push(event);
        },
      });

      const event = eventFor(
        "/_agent-native/actions/list-transactional-email-ai-requests",
      );
      await requestHooks[0](event);
      setHttpRequestTelemetryActionName(
        event as any,
        "list-transactional-email-ai-requests",
      );
      await responseHooks[0](new Response("{}"), event);

      expect(tracked[0]).toMatchObject({
        name: "http.response",
        properties: {
          action_name: "list-transactional-email-ai-requests",
          sample_rate: 0.25,
          sample_weight: 4,
          sampled: true,
        },
      });
    } finally {
      randomSpy.mockRestore();
    }
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
    setHttpRequestTelemetryActionName(actionEvent as any, "get-visual-plan");
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

  it("retains 4xx telemetry for registered WebMCP action routes", async () => {
    vi.stubEnv("AGENT_NATIVE_HTTP_TELEMETRY_SAMPLE_RATE", "0");
    const nitroApp = {};
    registerHttpRequestTelemetryActionRoute(
      "/_agent-native/webmcp/actions/protected-report",
      "protected-report",
      "/_agent-native/webmcp/actions/:action",
      nitroApp,
    );
    const { requestHooks, responseHooks } = createHooks(nitroApp);
    const tracked: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "http-response-telemetry-test",
      track(event) {
        tracked.push(event);
      },
    });

    const event = eventFor("/_agent-native/webmcp/actions/protected-report");
    await requestHooks[0](event);
    await responseHooks[0](new Response("forbidden", { status: 403 }), event);

    expect(tracked).toHaveLength(1);
    expect(tracked[0]?.properties).toMatchObject({
      action_name: "protected-report",
      status_code: 403,
    });
  });

  it("honors constrained dynamic route patterns", async () => {
    const nitroApp = {};
    registerHttpRequestTelemetryActionRoute(
      "/_agent-native/actions/reports/:id(\\d+)",
      "get-numeric-report",
      "/_agent-native/actions/reports/:id(\\d+)",
      nitroApp,
    );
    registerHttpRequestTelemetryActionRoute(
      "/_agent-native/actions/reports/:slug",
      "get-slug-report",
      "/_agent-native/actions/reports/:slug",
      nitroApp,
    );
    const { requestHooks, responseHooks } = createHooks(nitroApp);
    const tracked: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "http-response-telemetry-test",
      track(event) {
        tracked.push(event);
      },
    });

    const event = eventFor("/_agent-native/actions/reports/abc");
    await requestHooks[0](event);
    await responseHooks[0](new Response("ok"), event);

    expect(tracked[0]?.properties).toMatchObject({
      action_name: "get-slug-report",
      route_template: "/_agent-native/actions/reports/:slug",
    });
  });

  it("records unknown action URLs under the action template without naming an action", async () => {
    const { requestHooks, responseHooks } = createHooks();
    processState.requestSequence = 5;
    const tracked: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "http-response-telemetry-test",
      track(event) {
        tracked.push(event);
      },
    });

    const event = eventFor("/_agent-native/actions/unknown-customer-value");
    await requestHooks[0](event);
    await responseHooks[0](new Response("not found", { status: 404 }), event);

    expect(tracked[0]?.properties).not.toHaveProperty("action_name");
    expect(tracked[0]?.properties).toMatchObject({
      route_template: "/_agent-native/actions/:action",
    });
  });

  it("uses registered action metadata before the route handler runs", async () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/docs");
    const nitroApp = {};
    registerHttpRequestTelemetryActionRoute(
      "/mcp/tool/protected-report",
      "protected-report",
      "/mcp/tool/:action",
      nitroApp,
    );
    const { requestHooks, responseHooks } = createHooks(nitroApp);
    processState.requestSequence = 5;
    const tracked: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "http-response-telemetry-test",
      track(event) {
        tracked.push(event);
      },
    });

    const event = eventFor("/docs/mcp/tool/protected-report");
    await requestHooks[0](event);
    await responseHooks[0](new Response("forbidden", { status: 401 }), event);

    expect(tracked[0]).toMatchObject({
      name: "http.response",
      properties: {
        action_name: "protected-report",
        route_template: "/mcp/tool/:action",
        route_kind: "framework",
        status_code: 401,
      },
    });
  });

  it("does not recursively track analytics ingestion requests", async () => {
    const { requestHooks, responseHooks } = createHooks();
    processState.requestSequence = 5;

    const tracked: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "http-response-telemetry-test",
      track(event) {
        tracked.push(event);
      },
    });

    for (const path of [
      "/track",
      "/track/",
      "/api/analytics/track",
      "/api/analytics/track/",
      "/api/events/track",
      "/api/events/track/",
      "/_agent-native/track",
      "/_agent-native/track/",
    ]) {
      const event = eventFor(path);
      await requestHooks[0](event);
      await responseHooks[0](new Response("", { status: 202 }), event);
    }

    expect(tracked).toHaveLength(0);
  });

  it("records the HTTP duration metric for requests tracking does not sample, then flushes", async () => {
    vi.stubEnv("AGENT_NATIVE_HTTP_TELEMETRY_SAMPLE_RATE", "0");
    processState.requestSequence = 5;
    const recorded: Array<Record<string, string | number> | undefined> = [];
    const forceFlush = vi.fn(async () => {});
    const unregister = registerObservabilityProvider({
      meterProvider: {
        getMeter: () => ({
          createHistogram: (name: string) => ({
            record: (
              _value: number,
              attributes?: Record<string, string | number>,
            ) => {
              if (name === "http.server.request.duration") {
                recorded.push(attributes);
              }
            },
          }),
          createCounter: () => ({ add() {} }),
        }),
        forceFlush,
      },
    });
    try {
      const { requestHooks, responseHooks } = createHooks();
      const tracked: TrackingEvent[] = [];
      registerTrackingProvider({
        name: "http-response-telemetry-test",
        track(event) {
          tracked.push(event);
        },
      });

      const event = eventFor("/some/page");
      await requestHooks[0](event);
      await responseHooks[0](new Response("ok"), event);

      expect(tracked).toHaveLength(0);
      expect(recorded).toEqual([
        {
          "http.request.method": "GET",
          "http.response.status_code": 200,
          "http.route": "page",
        },
      ]);
      expect(forceFlush).toHaveBeenCalledOnce();
    } finally {
      unregister();
    }
  });

  describe("flush handoff", () => {
    const netlifyStoreKey = Symbol.for(
      "@netlify/functions/request-context-store",
    );
    let releaseFlush: () => void = () => undefined;
    let forceFlush: ReturnType<typeof vi.fn>;
    let unregister: () => void = () => undefined;

    beforeEach(() => {
      processState.requestSequence = 5;
      const pending = new Promise<void>((resolve) => {
        releaseFlush = resolve;
      });
      forceFlush = vi.fn(() => pending);
      unregister = registerObservabilityProvider({
        meterProvider: {
          getMeter: () => ({
            createHistogram: () => ({ record() {} }),
            createCounter: () => ({ add() {} }),
          }),
          forceFlush,
        },
      });
    });

    afterEach(() => {
      releaseFlush();
      unregister();
      delete (globalThis as Record<symbol, unknown>)[netlifyStoreKey];
    });

    async function respond(
      event: ReturnType<typeof eventFor>,
      run: <T>(fn: () => T) => T = (fn) => fn(),
    ) {
      const { requestHooks, responseHooks } = createHooks();
      await requestHooks[0](event);
      let settled = false;
      const hook = run(() =>
        Promise.resolve(responseHooks[0](new Response("ok"), event)),
      ).then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { hook, settled: () => settled };
    }

    async function expectHandedOffExport(handedOff: Promise<unknown>[]) {
      expect(handedOff).toHaveLength(1);
      expect(forceFlush).toHaveBeenCalledOnce();
      let exported = false;
      void handedOff[0].then(() => {
        exported = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(exported).toBe(false);
      releaseFlush();
      await handedOff[0];
      expect(exported).toBe(true);
    }

    it("returns before the export finishes when the request carries waitUntil", async () => {
      const event = eventFor("/some/page");
      const handedOff: Promise<unknown>[] = [];
      Object.assign(event.req, {
        waitUntil: (promise: Promise<unknown>) => handedOff.push(promise),
      });

      const { settled } = await respond(event);

      expect(settled()).toBe(true);
      await expectHandedOffExport(handedOff);
    });

    it("uses the Netlify request context store when the request has no waitUntil", async () => {
      const handedOff: Promise<unknown>[] = [];
      const store = new AsyncLocalStorage<{
        context: { waitUntil: (promise: Promise<unknown>) => void };
      }>();
      (globalThis as Record<symbol, unknown>)[netlifyStoreKey] = store;
      const context = {
        waitUntil: (promise: Promise<unknown>) => {
          handedOff.push(promise);
        },
      };

      const { settled } = await respond(eventFor("/some/page"), (fn) =>
        store.run({ context }, fn),
      );

      expect(settled()).toBe(true);
      await expectHandedOffExport(handedOff);
    });

    it("exports inline when the export finishes within the deadline and no waitUntil exists", async () => {
      let exported = false;
      forceFlush.mockImplementationOnce(async () => {
        exported = true;
      });
      const { requestHooks, responseHooks } = createHooks();
      const event = eventFor("/some/page");
      await requestHooks[0](event);
      await responseHooks[0](new Response("ok"), event);

      expect(exported).toBe(true);
    });

    it("releases the response at the deadline when the export is still running and no waitUntil exists", async () => {
      const { requestHooks, responseHooks } = createHooks();
      const event = eventFor("/some/page");
      await requestHooks[0](event);
      const startedAt = Date.now();
      await responseHooks[0](new Response("ok"), event);

      expect(Date.now() - startedAt).toBeLessThan(1_000);
      expect(forceFlush).toHaveBeenCalledOnce();
    });
  });

  describe("handoff duration", () => {
    let recorded: Array<{ name: string; value: number }>;
    let nowSpy: ReturnType<typeof vi.spyOn>;
    let unregister: () => void = () => undefined;
    const startedAt = 1_000_000;

    function registerMeter(forceFlush: () => Promise<void>) {
      unregister = registerObservabilityProvider({
        meterProvider: {
          getMeter: () => ({
            createHistogram: (name: string) => ({
              record: (value: number) => recorded.push({ name, value }),
            }),
            createCounter: () => ({ add() {} }),
          }),
          forceFlush,
        },
      });
    }

    beforeEach(() => {
      processState.requestSequence = 5;
      recorded = [];
      nowSpy = vi.spyOn(Date, "now").mockReturnValue(startedAt);
    });

    afterEach(() => {
      nowSpy.mockRestore();
      unregister();
    });

    function durations(name: string) {
      return recorded.filter((r) => r.name === name).map((r) => r.value);
    }

    it("includes an inline export that holds the response", async () => {
      registerMeter(async () => {
        nowSpy.mockReturnValue(startedAt + 3_200);
      });
      const { requestHooks, responseHooks } = createHooks();
      const event = eventFor("/some/page");
      await requestHooks[0](event);
      nowSpy.mockReturnValue(startedAt + 1_200);
      await responseHooks[0](new Response("ok"), event);

      expect(durations("http.server.request.duration")).toEqual([1.2]);
      expect(durations("agent_native.http.server.handoff.duration")).toEqual([
        3.2,
      ]);
    });

    it("excludes an export handed to waitUntil", async () => {
      let releaseFlush: () => void = () => undefined;
      registerMeter(
        () =>
          new Promise<void>((resolve) => {
            releaseFlush = resolve;
          }),
      );
      const { requestHooks, responseHooks } = createHooks();
      const event = eventFor("/some/page");
      const handedOff: Promise<unknown>[] = [];
      Object.assign(event.req, {
        waitUntil: (promise: Promise<unknown>) => handedOff.push(promise),
      });
      await requestHooks[0](event);
      nowSpy.mockReturnValue(startedAt + 1_200);
      await responseHooks[0](new Response("ok"), event);

      expect(durations("agent_native.http.server.handoff.duration")).toEqual([
        1.2,
      ]);
      expect(handedOff).toHaveLength(1);
      releaseFlush();
      await handedOff[0];
    });
  });

  it("attributes a framework 401 to its route on the metric and the span", async () => {
    processState.requestSequence = 5;
    const recorded: Array<Record<string, string | number> | undefined> = [];
    const spanAttributes: Array<Record<string, unknown> | undefined> = [];
    __setAgentTracerForTests({
      startSpan(
        _name: string,
        options?: { attributes?: Record<string, unknown> },
      ): AgentSpan {
        spanAttributes.push(options?.attributes);
        return {
          setAttribute() {},
          setAttributes() {},
          setStatus() {},
          recordException() {},
          end() {},
        };
      },
    });
    const unregister = registerObservabilityProvider({
      meterProvider: {
        getMeter: () => ({
          createHistogram: (name: string) => ({
            record: (
              _value: number,
              attributes?: Record<string, string | number>,
            ) => {
              if (name === "http.server.request.duration") {
                recorded.push(attributes);
              }
            },
          }),
          createCounter: () => ({ add() {} }),
        }),
      },
    });
    try {
      const { requestHooks, responseHooks } = createHooks();
      const event = eventFor(
        "/_agent-native/agent-chat/runs/run-1783002639448-8rptjt/events",
      );
      await requestHooks[0](event);
      await responseHooks[0](
        new Response("unauthorized", { status: 401 }),
        event,
      );

      expect(recorded).toEqual([
        {
          "http.request.method": "GET",
          "http.response.status_code": 401,
          "http.route": "/_agent-native/agent-chat/runs/:runId/events",
        },
      ]);
      expect(spanAttributes[0]).toMatchObject({
        "http.route": "/_agent-native/agent-chat/runs/:runId/events",
        "http.status_code": 401,
      });
    } finally {
      unregister();
    }
  });

  it("ends the HTTP duration metric at the response boundary, not after the tracking flush", async () => {
    processState.requestSequence = 5;
    const recorded: number[] = [];
    const unregister = registerObservabilityProvider({
      meterProvider: {
        getMeter: () => ({
          createHistogram: (name: string) => ({
            record: (value: number) => {
              if (name === "http.server.request.duration") recorded.push(value);
            },
          }),
          createCounter: () => ({ add() {} }),
        }),
      },
    });
    const startedAt = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(startedAt);
    __setAgentTracerForTests({
      startSpan(): AgentSpan {
        // The tracking flush outlives the response by several seconds.
        nowSpy.mockReturnValue(startedAt + 9_000);
        return {
          setAttribute() {},
          setAttributes() {},
          setStatus() {},
          recordException() {},
          end() {},
        };
      },
    });
    try {
      const { requestHooks, responseHooks } = createHooks();
      const event = eventFor("/some/page");
      await requestHooks[0](event);
      nowSpy.mockReturnValue(startedAt + 1_200);
      await responseHooks[0](new Response("ok"), event);

      expect(recorded).toEqual([1.2]);
    } finally {
      nowSpy.mockRestore();
      unregister();
    }
  });

  it("reports the pre-handler boot phases on a cold start", async () => {
    const { requestHooks, responseHooks } = createHooks();
    processState.requestSequence = 0;

    const event = eventFor("/_agent-native/actions/list-visual-plans");
    await requestHooks[0](event);
    setHttpRequestTelemetryActionName(event as any, "list-visual-plans");
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
    expect(line?.db_measured).toBe(true);
  });

  it("does not throw from the request hook where AsyncLocalStorage cannot enterWith", async () => {
    const storageKey = Symbol.for(
      "@agent-native/core/db.request-telemetry-storage",
    );
    const globalRef = globalThis as Record<symbol, unknown>;
    const originalStorage = globalRef[storageKey];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    globalRef[storageKey] = {
      getStore: () => undefined,
      run: (_store: unknown, fn: () => unknown) => fn(),
      enterWith: () => {
        throw new Error("asyncLocalStorage.enterWith() is not implemented");
      },
    };
    try {
      const { requestHooks, responseHooks } = createHooks();
      processState.requestSequence = 0;

      for (const path of ["/_agent-native/jobs/_process-sweep", "/"]) {
        const event = eventFor(path);
        expect(() => requestHooks[0](event)).not.toThrow();
        await responseHooks[0](new Response("{}"), event);
      }

      expect(loggedLines()[0]).toMatchObject({
        cold_start: true,
        db_measured: false,
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      globalRef[storageKey] = originalStorage;
      warnSpy.mockRestore();
    }
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
    expect(timing).not.toContain("app;dur=");
    expect(timing).not.toContain("db;dur=");
    const desc = /desc="([^"]+)"/.exec(timing)?.[1] ?? "";
    expect(Date.parse(desc.split(" ")[0] ?? "")).not.toBeNaN();
  });

  it("keeps phase timings on a response no shared cache will replay", async () => {
    const { requestHooks, responseHooks } = createHooks();
    processState.requestSequence = 5;

    const event = eventFor("/_agent-native/actions/get-visual-plan");
    await requestHooks[0](event);
    setHttpRequestTelemetryActionName(event as any, "get-visual-plan");
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

  it("attributes http.response app/template from the deploy URL instead of the unset display name", async () => {
    vi.stubEnv("APP_URL", "https://slides.agent-native.com");
    const { requestHooks, responseHooks } = createHooks();
    const tracked: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "http-response-telemetry-test",
      track(event) {
        tracked.push(event);
      },
    });

    const event = eventFor("/_agent-native/actions/get-deck");
    await requestHooks[0](event);
    await responseHooks[0](new Response("ok"), event);

    expect(
      tracked.find((entry) => entry.name === "http.response")?.properties,
    ).toMatchObject({ app: "slides", template: "slides" });
  });

  it("attributes a beta host to the production app slug", async () => {
    vi.stubEnv("APP_URL", "https://beta.slides.agent-native.com");
    const { requestHooks, responseHooks } = createHooks();
    const tracked: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "http-response-telemetry-test",
      track(event) {
        tracked.push(event);
      },
    });

    const event = eventFor("/_agent-native/actions/get-deck");
    await requestHooks[0](event);
    await responseHooks[0](new Response("ok"), event);

    expect(
      tracked.find((entry) => entry.name === "http.response")?.properties,
    ).toMatchObject({ app: "slides", template: "slides" });
  });

  it("writes the request-id header to both h3 response header buckets before the handler runs, so a guard's thrown error still carries it", async () => {
    const { requestHooks } = createHooks();
    const event = eventFor("/_agent-native/actions/get-labs");

    await requestHooks[0](event);

    const requestId = getHttpRequestTelemetryId(event as any);
    expect(requestId).toEqual(expect.any(String));
    expect(event.res.headers.get("x-agent-native-request-id")).toBe(requestId);
    expect(event.res.errHeaders.get("x-agent-native-request-id")).toBe(
      requestId,
    );
  });

  it("carries app attribution into the slow-request log line too", async () => {
    vi.stubEnv("APP_URL", "https://slides.agent-native.com");
    const { requestHooks, responseHooks } = createHooks();
    processState.requestSequence = 5;

    const startedAt = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(startedAt);
    const event = eventFor("/reports/42");
    await requestHooks[0](event);
    nowSpy.mockReturnValue(startedAt + 2_400);
    await responseHooks[0](new Response("ok"), event);
    nowSpy.mockRestore();

    expect(loggedLines()[0]).toMatchObject({ app: "slides" });
  });
});
