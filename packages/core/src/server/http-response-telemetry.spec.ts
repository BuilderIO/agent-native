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

beforeEach(() => {
  vi.stubEnv("AGENT_NATIVE_HTTP_TELEMETRY_SAMPLE_RATE", "1");
});

afterEach(() => {
  unregisterTrackingProvider("http-response-telemetry-test");
  vi.unstubAllEnvs();
});

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
});
