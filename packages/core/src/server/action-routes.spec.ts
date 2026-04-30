import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionEntry } from "../agent/production-agent.js";

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

describe("mountActionRoutes", () => {
  afterEach(() => {
    delete process.env.AGENT_USER_EMAIL;
    delete process.env.AGENT_ORG_ID;
    delete process.env.AGENT_USER_TIMEZONE;
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

  it("clears legacy env request context when later action requests omit values", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      ping: {
        run: vi.fn(async () => ({
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
      envUserEmail: undefined,
      envOrgId: undefined,
      envTimezone: undefined,
    });
    expect(process.env.AGENT_USER_EMAIL).toBeUndefined();
    expect(process.env.AGENT_ORG_ID).toBeUndefined();
    expect(process.env.AGENT_USER_TIMEZONE).toBeUndefined();
  });
});
