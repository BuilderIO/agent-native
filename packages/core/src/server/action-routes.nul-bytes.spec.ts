import { createApp } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineAction } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";

const { browserSession } = vi.hoisted(() => ({ browserSession: vi.fn() }));
vi.mock("./auth.js", async (original) => ({
  ...(await original<typeof import("./auth.js")>()),
  getBrowserCookieSession: browserSession,
}));
vi.mock("../org/context.js", async (original) => ({
  ...(await original<typeof import("./org/context.js")>()),
  resolveOrgIdForEmail: async () => "org-1",
  resolveOrgScopeForEmail: async () => ({ status: "resolved", orgId: "org-1" }),
}));
vi.mock("./framework-request-handler.js", () => ({
  getH3App: (app: unknown) => app,
}));
vi.mock("./ui-action-capability.js", () => ({
  hasUiActionCapability: () => true,
}));
vi.mock("./action-change.js", () => ({
  actionCallIsReadOnly: () => false,
  notifyActionChange: vi.fn(),
  notifyActionChangeForResponse: async () => true,
}));

import { mountActionRoutes } from "./action-routes.js";

afterEach(() => {
  vi.clearAllMocks();
});

async function callRoute(
  actions: Record<string, ActionEntry>,
  url: string,
  init?: RequestInit,
) {
  browserSession.mockResolvedValue({
    email: "qa@example.test",
    orgId: "org-1",
  });
  const app = createApp();
  mountActionRoutes(app as Parameters<typeof mountActionRoutes>[0], actions, {
    appId: "test-app",
  });
  const req = new Request(`http://localhost${url}`, {
    ...init,
    headers: {
      "X-Agent-Native-Frontend": "1",
      ...(init?.headers ?? {}),
    },
  });
  return app.fetch(req);
}

describe("action-routes NUL-byte and Postgres 22021/22P05 defense", () => {
  it("returns 400 action_invalid_parameters on POST and GET NUL-byte payloads without invoking handler", async () => {
    const postRun = vi.fn(async () => ({ ok: true }));
    const getRun = vi.fn(async () => ({ ok: true }));
    const actions: Record<string, ActionEntry> = {
      "create-item": defineAction({
        description: "Create item",
        schema: z.object({ title: z.string() }),
        run: postRun,
      }),
      "search-items": defineAction({
        description: "Search items",
        http: { method: "GET" },
        readOnly: true,
        schema: z.object({ query: z.string() }),
        run: getRun,
      }),
    };

    const postRes = await callRoute(
      actions,
      "/_agent-native/actions/create-item",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "bad\u0000title" }),
      },
    );
    expect(postRes.status).toBe(400);
    const postJson = await postRes.json();
    expect(postJson.errorCode).toBe("action_invalid_parameters");
    expect(postRun).not.toHaveBeenCalled();

    const getRes = await callRoute(
      actions,
      "/_agent-native/actions/search-items?query=bad%00query",
      { method: "GET" },
    );
    expect(getRes.status).toBe(400);
    const getJson = await getRes.json();
    expect(getJson.errorCode).toBe("action_invalid_parameters");
    expect(getRun).not.toHaveBeenCalled();

    const untypedRun = vi.fn(async () => ({ ok: true }));
    const untypedRes = await callRoute(
      {
        "untyped-action": {
          run: untypedRun,
        } as unknown as ActionEntry,
      },
      "/_agent-native/actions/untyped-action",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "raw\u0000nul" }),
      },
    );
    expect(untypedRes.status).toBe(400);
    const untypedJson = await untypedRes.json();
    expect(untypedJson.errorCode).toBe("action_invalid_parameters");
    expect(untypedRun).not.toHaveBeenCalled();
  });

  it("maps PostgreSQL 22021 / 22P05 NUL-byte driver errors to 400 without leaking query details", async () => {
    const actions: Record<string, ActionEntry> = {
      "pg-utf8-fail": defineAction({
        description: "Simulates PG 22021",
        schema: z.object({ payload: z.string() }),
        run: async () => {
          const cause = Object.assign(
            new Error('invalid byte sequence for encoding "UTF8": 0x00'),
            { code: "22021" },
          );
          throw Object.assign(
            new Error("Failed query: insert into secret_tbl"),
            {
              cause,
            },
          );
        },
      }),
      "pg-jsonb-fail": defineAction({
        description: "Simulates PG 22P05",
        schema: z.object({ payload: z.string() }),
        run: async () => {
          throw Object.assign(
            new Error("unsupported Unicode escape sequence"),
            { code: "22P05" },
          );
        },
      }),
    };

    for (const actionName of ["pg-utf8-fail", "pg-jsonb-fail"]) {
      const res = await callRoute(
        actions,
        `/_agent-native/actions/${actionName}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload: "clean" }),
        },
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({
        error: "Invalid action parameters",
        errorCode: "action_invalid_parameters",
      });
    }
  });
});
