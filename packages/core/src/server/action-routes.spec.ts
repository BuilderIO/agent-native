import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActionEntry } from "../agent/production-agent.js";

const mockNotifyActionChange = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getMethod: (event: any) => event._method ?? "GET",
  getQuery: (event: any) => event._query ?? {},
  getHeader: (event: any, name: string) => event._headers?.[name.toLowerCase()],
  setResponseStatus: (event: any, status: number) => {
    event._status = status;
  },
  setResponseHeader: (event: any, name: string, value: string) => {
    event._responseHeaders = {
      ...(event._responseHeaders ?? {}),
      [name.toLowerCase()]: value,
    };
  },
}));

vi.mock("./framework-request-handler.js", () => ({
  getH3App: (app: any) => app,
}));

vi.mock("./action-change.js", () => ({
  notifyActionChange: (...args: unknown[]) => mockNotifyActionChange(...args),
}));

describe("mountActionRoutes", () => {
  afterEach(() => {
    delete process.env.AGENT_USER_EMAIL;
    delete process.env.AGENT_ORG_ID;
    delete process.env.AGENT_USER_TIMEZONE;
    mockNotifyActionChange.mockReset();
    vi.restoreAllMocks();
  });

  it("uses action error statusCode for HTTP responses", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const err = Object.assign(new Error("Forbidden"), { statusCode: 403 });
    const actions: Record<string, ActionEntry> = {
      "share-resource": {
        run: vi.fn(async () => {
          throw err;
        }),
      } as any,
    };

    mountActionRoutes(nitroApp, actions, {
      getOwnerFromEvent: async () => "owner@example.com",
    });

    const event = { _method: "POST", req: { json: async () => ({}) } };
    const result = await mounted[0].handler(event);

    expect(result).toEqual({ error: "Forbidden" });
    expect(event._status).toBe(403);
  });

  it("serializes plain string action results as JSON strings", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      "archive-email": {
        run: vi.fn(async () => "Archived 1 email(s) successfully"),
      } as any,
    };

    mountActionRoutes(nitroApp, actions);

    const event = { _method: "POST", req: { json: async () => ({}) } };
    const result = await mounted[0].handler(event);

    expect(event._responseHeaders["content-type"]).toBe("application/json");
    expect(JSON.parse(result)).toBe("Archived 1 email(s) successfully");
  });

  it("isolates request context without mutating process.env", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const { getRequestOrgId, getRequestTimezone, getRequestUserEmail } =
      await import("./request-context.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    process.env.AGENT_USER_EMAIL = "stale@example.com";
    process.env.AGENT_ORG_ID = "stale-org";
    process.env.AGENT_USER_TIMEZONE = "UTC";
    const actions: Record<string, ActionEntry> = {
      ping: {
        run: vi.fn(async () => ({
          userEmail: getRequestUserEmail(),
          orgId: getRequestOrgId(),
          timezone: getRequestTimezone(),
          envUserEmail: process.env.AGENT_USER_EMAIL,
          envOrgId: process.env.AGENT_ORG_ID,
          envTimezone: process.env.AGENT_USER_TIMEZONE,
        })),
      } as any,
    };

    mountActionRoutes(nitroApp, actions, {
      getOwnerFromEvent: async (event) => event._owner,
      resolveOrgId: async (event) => event._orgId ?? null,
    });

    const first = {
      _method: "POST",
      _owner: "alice@example.com",
      _orgId: "org-a",
      _headers: { "x-user-timezone": "America/New_York" },
      req: { json: async () => ({}) },
    };
    const second = {
      _method: "POST",
      _owner: undefined,
      _orgId: undefined,
      _headers: {},
      req: { json: async () => ({}) },
    };

    await mounted[0].handler(first);
    const result = await mounted[0].handler(second);

    expect(result).toEqual({
      userEmail: undefined,
      orgId: undefined,
      timezone: undefined,
      envUserEmail: "stale@example.com",
      envOrgId: "stale-org",
      envTimezone: "UTC",
    });
    expect(process.env.AGENT_USER_EMAIL).toBe("stale@example.com");
    expect(process.env.AGENT_ORG_ID).toBe("stale-org");
    expect(process.env.AGENT_USER_TIMEZONE).toBe("UTC");
  });

  it("runs optional-auth actions with an anonymous request context when auth resolution returns 401", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const { getRequestUserEmail } = await import("./request-context.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      "public-metadata": {
        http: { method: "GET" },
        readOnly: true,
        requiresAuth: false,
        run: vi.fn(async (_args, ctx) => ({
          ctxUserEmail: ctx?.userEmail,
          requestUserEmail: getRequestUserEmail(),
        })),
      } as any,
    };
    const unauthenticated = Object.assign(new Error("Unauthenticated"), {
      statusCode: 401,
    });

    mountActionRoutes(nitroApp, actions, {
      getOwnerFromEvent: async () => {
        throw unauthenticated;
      },
    });

    const result = await mounted[0].handler({
      _method: "GET",
      req: {
        url: "http://app.test/_agent-native/actions/public-metadata?id=plan_1",
      },
    });

    expect(result).toEqual({
      ctxUserEmail: undefined,
      requestUserEmail: undefined,
    });
  });

  it("allows HEAD for GET actions", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      "list-things": {
        http: { method: "GET" },
        readOnly: true,
        run: vi.fn(async (params) => ({ ok: true, params })),
      } as any,
    };

    mountActionRoutes(nitroApp, actions);

    const event = {
      _method: "HEAD",
      req: { url: "http://app.test/_agent-native/actions/list-things?q=hello" },
    };
    const result = await mounted[0].handler(event);

    expect(result).toEqual({ ok: true, params: { q: "hello" } });
    expect(actions["list-things"].run).toHaveBeenCalledWith(
      { q: "hello" },
      {
        userEmail: undefined,
        orgId: null,
        caller: "http",
        actionName: "list-things",
      },
    );
    expect(mockNotifyActionChange).not.toHaveBeenCalled();
  });

  it("passes a run ctx with resolved identity and caller=http", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    let received: any;
    const actions: Record<string, ActionEntry> = {
      "do-thing": {
        run: vi.fn(async (_params, ctx) => {
          received = ctx;
          return { ok: true };
        }),
      } as any,
    };

    mountActionRoutes(nitroApp, actions, {
      getOwnerFromEvent: async () => "alice@example.com",
      resolveOrgId: async () => "org-a",
    });

    await mounted[0].handler({
      _method: "POST",
      _headers: {},
      req: { json: async () => ({}) },
    });

    expect(received).toEqual({
      userEmail: "alice@example.com",
      orgId: "org-a",
      caller: "http",
      actionName: "do-thing",
    });
    // No SSE sender on the HTTP surface.
    expect(received.send).toBeUndefined();
  });

  it("tags browser-originated calls (x-agent-native-frontend) as caller=frontend", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    let received: any;
    const actions: Record<string, ActionEntry> = {
      "do-thing": {
        run: vi.fn(async (_params, ctx) => {
          received = ctx;
          return { ok: true };
        }),
      } as any,
    };

    mountActionRoutes(nitroApp, actions, {
      getOwnerFromEvent: async () => "alice@example.com",
      resolveOrgId: async () => null,
    });

    await mounted[0].handler({
      _method: "POST",
      _headers: { "x-agent-native-frontend": "1" },
      req: { json: async () => ({}) },
    });

    expect(received).toEqual({
      userEmail: "alice@example.com",
      orgId: null,
      caller: "frontend",
      actionName: "do-thing",
    });
  });

  it("parses bracketed and repeated GET params as arrays", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      "list-assets": {
        http: { method: "GET" },
        readOnly: true,
        run: vi.fn(async (params) => ({ params })),
      } as any,
    };

    mountActionRoutes(nitroApp, actions);

    const result = await mounted[0].handler({
      _method: "GET",
      req: {
        url: "http://app.test/_agent-native/actions/list-assets?candidateRunIds[]=run-1&candidateRunIds[]=run-2&libraryIds[]=lib-1&tag=hero&tag=logo&search=logos",
      },
    });

    expect(result).toEqual({
      params: {
        candidateRunIds: ["run-1", "run-2"],
        libraryIds: ["lib-1"],
        tag: ["hero", "logo"],
        search: "logos",
      },
    });
  });

  it("parses bracketed GET params as arrays through the getQuery fallback", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      "list-assets": {
        http: { method: "GET" },
        readOnly: true,
        run: vi.fn(async (params) => ({ params })),
      } as any,
    };

    mountActionRoutes(nitroApp, actions);

    const result = await mounted[0].handler({
      _method: "GET",
      _query: {
        "candidateRunIds[]": ["run-1", "run-2"],
        "libraryIds[]": "lib-1",
        tag: ["hero", "logo"],
        search: "logos",
      },
    });

    expect(result).toEqual({
      params: {
        candidateRunIds: ["run-1", "run-2"],
        libraryIds: ["lib-1"],
        tag: ["hero", "logo"],
        search: "logos",
      },
    });
  });

  it("coerces boolean and number GET params to their schema types (useActionQuery round-trip)", async () => {
    // `useActionQuery` serializes every param into the query string, so a
    // boolean `true` arrives at the server as the string "true" and a number
    // as "5" (URLSearchParams stringifies everything). A schema-validated GET
    // action expects real boolean/number, so without coercion Zod rejects them
    // with "expected boolean, received string". This exercises the full route
    // path (parse query → validating run) to prove the values round-trip to
    // native types. Regression guard for the `instrument-overview` report.
    const { mountActionRoutes } = await import("./action-routes.js");
    const { defineAction } = await import("../action.js");
    const { z } = await import("zod");

    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };

    const overview = defineAction({
      description: "instrument overview",
      http: { method: "GET" },
      schema: z.object({
        portfolioId: z.string(),
        isin: z.string(),
        baseCurrency: z.string().optional(),
        includeSeries: z.boolean().optional(),
        limit: z.number().optional(),
      }),
      run: async (params: any) => ({ params }),
    });

    const actions: Record<string, ActionEntry> = {
      "instrument-overview": overview as unknown as ActionEntry,
    };

    mountActionRoutes(nitroApp, actions);

    const result = await mounted[0].handler({
      _method: "GET",
      req: {
        url: "http://app.test/_agent-native/actions/instrument-overview?portfolioId=p1&isin=US67066G1040&includeSeries=true&limit=5",
      },
    });

    expect(result).toEqual({
      params: {
        portfolioId: "p1",
        isin: "US67066G1040",
        includeSeries: true,
        limit: 5,
      },
    });
  });

  it("short-circuits OPTIONS without resolving auth context", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const getOwnerFromEvent = vi.fn(async () => "owner@example.com");
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      mutate: {
        run: vi.fn(async () => ({ ok: true })),
      } as any,
    };

    mountActionRoutes(nitroApp, actions, { getOwnerFromEvent });

    const event = { _method: "OPTIONS" };
    const result = await mounted[0].handler(event);

    expect(result).toBe("");
    expect(event._status).toBe(204);
    expect(getOwnerFromEvent).not.toHaveBeenCalled();
    expect(actions.mutate.run).not.toHaveBeenCalled();
  });

  it("rejects OPTIONS from disallowed cross-origin callers", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const getOwnerFromEvent = vi.fn(async () => "owner@example.com");
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      mutate: {
        run: vi.fn(async () => ({ ok: true })),
      } as any,
    };

    mountActionRoutes(nitroApp, actions, { getOwnerFromEvent });

    const event = {
      _method: "OPTIONS",
      _headers: { origin: "https://evil.example" },
    };
    const result = await mounted[0].handler(event);

    expect(result).toBe("");
    expect(event._status).toBe(403);
    expect(getOwnerFromEvent).not.toHaveBeenCalled();
    expect(actions.mutate.run).not.toHaveBeenCalled();
  });

  it("allows Claude MCP app embed action preflights without credentials", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const getOwnerFromEvent = vi.fn(async () => "owner@example.com");
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      mutate: {
        run: vi.fn(async () => ({ ok: true })),
      } as any,
    };

    mountActionRoutes(nitroApp, actions, { getOwnerFromEvent });

    const event = {
      _method: "OPTIONS",
      _headers: {
        origin: "https://520ba469ac5783c72c33d79bea940871.claudemcpcontent.com",
      },
    };
    const result = await mounted[0].handler(event);

    expect(result).toBe("");
    expect(event._status).toBe(204);
    expect(event._responseHeaders["access-control-allow-origin"]).toBe(
      "https://520ba469ac5783c72c33d79bea940871.claudemcpcontent.com",
    );
    expect(
      event._responseHeaders["access-control-allow-credentials"],
    ).toBeUndefined();
    const allowHeaders =
      event._responseHeaders["access-control-allow-headers"].toLowerCase();
    expect(allowHeaders).toContain("x-agent-native-embed-target");
    expect(allowHeaders).toContain("x-user-timezone");
    expect(getOwnerFromEvent).not.toHaveBeenCalled();
    expect(actions.mutate.run).not.toHaveBeenCalled();
  });

  it("emits refresh events for mutating GET actions with readOnly false", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      "mutating-read": {
        http: { method: "GET" },
        readOnly: false,
        run: vi.fn(async () => ({ ok: true })),
      } as any,
    };

    mountActionRoutes(nitroApp, actions);

    await mounted[0].handler({
      _method: "GET",
      req: { url: "http://app.test/_agent-native/actions/mutating-read" },
    });

    expect(mockNotifyActionChange).toHaveBeenCalledWith({
      actionName: "mutating-read",
    });
  });

  // ---------------------------------------------------------------------
  // Tools-bridge gating (audit H5)
  // ---------------------------------------------------------------------

  it("refuses tools-bridge calls when toolCallable === false", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      "share-resource": {
        toolCallable: false,
        run: vi.fn(async () => ({ ok: true })),
      } as any,
    };

    mountActionRoutes(nitroApp, actions);

    const event = {
      _method: "POST",
      _headers: { "x-agent-native-tool-bridge": "1" },
      req: { json: async () => ({}) },
    };
    const result = await mounted[0].handler(event);

    expect(event._status).toBe(403);
    expect(result).toEqual({
      error: "Action 'share-resource' is not callable from tools.",
    });
    expect(actions["share-resource"].run).not.toHaveBeenCalled();
  });

  it("allows tools-bridge calls when toolCallable === true", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      "list-things": {
        toolCallable: true,
        http: { method: "GET" },
        readOnly: true,
        run: vi.fn(async () => ({ ok: true })),
      } as any,
    };

    mountActionRoutes(nitroApp, actions);

    const event = {
      _method: "GET",
      _headers: { "x-agent-native-tool-bridge": "1" },
      req: { url: "http://app.test/_agent-native/actions/list-things" },
    };
    const result = await mounted[0].handler(event);

    expect(result).toEqual({ ok: true });
  });

  it("allows tools-bridge calls when toolCallable is undefined (default-allow)", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      "legacy-action": {
        run: vi.fn(async () => ({ ok: true })),
      } as any,
    };

    mountActionRoutes(nitroApp, actions);

    const event = {
      _method: "POST",
      _headers: { "x-agent-native-tool-bridge": "1" },
      req: { json: async () => ({}) },
    };
    const result = await mounted[0].handler(event);

    expect(actions["legacy-action"].run).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
  });

  // ---------------------------------------------------------------------
  // Per-action body-size guard (maxBodyBytes)
  // ---------------------------------------------------------------------

  it("rejects oversize POST bodies with 413 before parsing when maxBodyBytes is set", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const json = vi.fn(async () => ({}));
    const actions: Record<string, ActionEntry> = {
      "validate-local-plan-source": {
        maxBodyBytes: 1024,
        requiresAuth: false,
        run: vi.fn(async () => ({ ok: true })),
      } as any,
    };

    mountActionRoutes(nitroApp, actions);

    const event = {
      _method: "POST",
      _headers: { "content-length": String(2048) },
      req: { json },
    };
    const result = await mounted[0].handler(event);

    expect(event._status).toBe(413);
    expect(result).toEqual({
      error: "Request body too large (max 1024 bytes)",
    });
    // The body is never parsed and the action never runs.
    expect(json).not.toHaveBeenCalled();
    expect(actions["validate-local-plan-source"].run).not.toHaveBeenCalled();
  });

  it("allows POST bodies within maxBodyBytes", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      "validate-local-plan-source": {
        maxBodyBytes: 1024,
        requiresAuth: false,
        run: vi.fn(async () => ({ ok: true })),
      } as any,
    };

    mountActionRoutes(nitroApp, actions);

    const event = {
      _method: "POST",
      _headers: { "content-length": String(512) },
      req: { json: async () => ({}) },
    };
    const result = await mounted[0].handler(event);

    expect(result).toEqual({ ok: true });
    expect(actions["validate-local-plan-source"].run).toHaveBeenCalledTimes(1);
  });

  it("does not gate actions without maxBodyBytes on Content-Length", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      "do-thing": {
        run: vi.fn(async () => ({ ok: true })),
      } as any,
    };

    mountActionRoutes(nitroApp, actions);

    const event = {
      _method: "POST",
      _headers: { "content-length": String(50 * 1024 * 1024) },
      req: { json: async () => ({}) },
    };
    const result = await mounted[0].handler(event);

    expect(result).toEqual({ ok: true });
    expect(actions["do-thing"].run).toHaveBeenCalledTimes(1);
  });

  it("does not gate non-bridge calls (header absent) on toolCallable", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      "share-resource": {
        toolCallable: false,
        run: vi.fn(async () => ({ ok: true })),
      } as any,
    };

    mountActionRoutes(nitroApp, actions);

    // No X-Agent-Native-Tool-Bridge header — this is a regular UI/agent call.
    const event = {
      _method: "POST",
      _headers: {},
      req: { json: async () => ({}) },
    };
    const result = await mounted[0].handler(event);

    expect(result).toEqual({ ok: true });
    expect(actions["share-resource"].run).toHaveBeenCalledTimes(1);
  });
});
