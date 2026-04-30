import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionEntry } from "../agent/production-agent.js";

const mockRecordChange = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getMethod: (event: any) => event._method ?? "GET",
  getQuery: (event: any) => event._query ?? {},
  getHeader: (event: any, name: string) => event._headers?.[name.toLowerCase()],
  setResponseStatus: (event: any, status: number) => {
    event._status = status;
  },
}));

vi.mock("./framework-request-handler.js", () => ({
  getH3App: (app: any) => app,
}));

vi.mock("./poll.js", () => ({
  recordChange: (...args: unknown[]) => mockRecordChange(...args),
}));

describe("mountActionRoutes", () => {
  afterEach(() => {
    delete process.env.AGENT_USER_EMAIL;
    delete process.env.AGENT_ORG_ID;
    delete process.env.AGENT_USER_TIMEZONE;
    mockRecordChange.mockReset();
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
    expect(actions["list-things"].run).toHaveBeenCalledWith({ q: "hello" });
    expect(mockRecordChange).not.toHaveBeenCalled();
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

    expect(mockRecordChange).toHaveBeenCalledWith({
      source: "action",
      type: "change",
      key: "mutating-read",
    });
  });
});
