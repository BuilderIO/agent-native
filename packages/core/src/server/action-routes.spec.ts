import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { A2AIdentityVerificationUnavailableError } from "../a2a/server.js";
import type { ActionEntry } from "../agent/production-agent.js";
import {
  getRequestContext,
  getRequestRunContext,
  markExplicitPersonalOrgScope,
  markRequestIdentityAuthenticatedAtMs,
} from "./request-context.js";

const mockNotifyActionChange = vi.hoisted(() => vi.fn());
const mockResolveOrgIdForEmail = vi.hoisted(() => vi.fn());
const mockResolveOrgByDomain = vi.hoisted(() => vi.fn());
const mockGetSession = vi.hoisted(() => vi.fn(async () => null));
const mockGetOrgContext = vi.hoisted(() =>
  vi.fn(async () => ({ orgId: undefined })),
);
const mockVerifyA2ATokenWithClaims = vi.hoisted(() => vi.fn());
const mockConsumeOneTimeJti = vi.hoisted(() => vi.fn(async () => false));
const mockResolveEmbedSessionFromRequest = vi.hoisted(() =>
  vi.fn(async () => null),
);
const mockIsExpiredMcpDirectoryWidgetSessionRequest = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => false),
);
const mockRegisterAuthPublicPaths = vi.hoisted(() => vi.fn());
const mockHasUiActionCapability = vi.hoisted(() => vi.fn(() => false));
const mockCountActionFailure = vi.hoisted(() => vi.fn());
const mockCountCredentialState = vi.hoisted(() => vi.fn());

vi.mock("../tracking/failure-counters.js", () => ({
  countActionFailure: mockCountActionFailure,
  countCredentialState: mockCountCredentialState,
}));

function fakeUnsignedJwt(payload: Record<string, string>): string {
  const encode = (value: Record<string, string>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.not-a-real-signature`;
}

vi.mock("h3", () => ({
  createError: (opts: any) =>
    Object.assign(new Error(opts?.statusMessage), opts),
  defineEventHandler: (handler: any) => handler,
  getMethod: (event: any) => event._method ?? "GET",
  getQuery: (event: any) => event._query ?? {},
  readBody: async (event: any) => event._body,
  getHeader: (event: any, name: string) => event._headers?.[name.toLowerCase()],
  getRequestHeader: (event: any, name: string) =>
    event._headers?.[name.toLowerCase()],
  getRequestIP: (event: any) =>
    event._ip ?? event.req?.socket?.remoteAddress ?? event.ip ?? "127.0.0.1",
  getRequestURL: (event: any) =>
    new URL(
      event.req?.url ??
        `${event._headers?.["x-forwarded-proto"] ?? "http"}://${event._headers?.host ?? "localhost"}/_agent-native/actions/test`,
    ),
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
  actionCallIsReadOnly: (
    entry: { readOnly?: boolean },
    _params: unknown,
    fallback: boolean,
  ) => entry.readOnly ?? fallback,
  notifyActionChange: (...args: unknown[]) => mockNotifyActionChange(...args),
  notifyActionChangeForResponse: (...args: unknown[]) =>
    mockNotifyActionChange(...args),
}));

vi.mock("../org/context.js", () => ({
  resolveOrgIdForEmail: (...args: unknown[]) =>
    mockResolveOrgIdForEmail(...args),
  getOrgContext: (...args: unknown[]) => mockGetOrgContext(...args),
  resolveOrgByDomain: (...args: unknown[]) => mockResolveOrgByDomain(...args),
  isFederationMembershipValidatedForEvent: () => false,
}));

vi.mock("./auth.js", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  registerAuthPublicPaths: (...args: unknown[]) =>
    mockRegisterAuthPublicPaths(...args),
  isLoopbackRequest: () => false,
}));
vi.mock("./embed-session.js", () => ({
  isExpiredMcpDirectoryWidgetSessionRequest: (...args: unknown[]) =>
    mockIsExpiredMcpDirectoryWidgetSessionRequest(...args),
  hasExplicitEmbedSessionCredential: (event: any) =>
    event._hasExplicitEmbedSessionCredential ??
    Boolean(
      event._query?.__an_embed_token ||
      (event._headers?.authorization?.startsWith("Bearer ") &&
        (event._headers?.["x-agent-native-embed-target"] ||
          event._query?.__an_embed_target)),
    ),
  resolveEmbedSessionFromRequest: (...args: unknown[]) =>
    mockResolveEmbedSessionFromRequest(...args),
  resolvedEmbedCapabilityScope: (session: { scope?: string } | null) =>
    session?.scope?.startsWith("capability:") ? session.scope : undefined,
}));
vi.mock("../a2a-claims.js", () => ({
  verifyA2ATokenWithClaims: (...args: unknown[]) =>
    mockVerifyA2ATokenWithClaims(...args),
}));
vi.mock("./identity-sso-store.js", () => ({
  consumeOneTimeJti: (...args: unknown[]) => mockConsumeOneTimeJti(...args),
}));
vi.mock("./ui-action-capability.js", () => ({
  hasUiActionCapability: (...args: unknown[]) =>
    mockHasUiActionCapability(...args),
}));

describe("mountActionRoutes", () => {
  afterEach(() => {
    delete process.env.AGENT_USER_EMAIL;
    delete process.env.AGENT_ORG_ID;
    delete process.env.AGENT_USER_TIMEZONE;
    delete process.env.AGENT_NATIVE_BUILD_ID;
    delete process.env.AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION;
    mockNotifyActionChange.mockReset();
    mockResolveOrgIdForEmail.mockReset();
    mockResolveOrgByDomain.mockReset();
    mockResolveOrgByDomain.mockResolvedValue({
      orgId: "receiver-org",
      orgName: "Builder.io",
    });
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue(null);
    mockGetOrgContext.mockReset();
    mockGetOrgContext.mockResolvedValue({ orgId: undefined });
    mockVerifyA2ATokenWithClaims.mockReset();
    mockConsumeOneTimeJti.mockReset();
    mockConsumeOneTimeJti.mockResolvedValue(false);
    mockResolveEmbedSessionFromRequest.mockReset();
    mockResolveEmbedSessionFromRequest.mockResolvedValue(null);
    mockIsExpiredMcpDirectoryWidgetSessionRequest.mockReset();
    mockIsExpiredMcpDirectoryWidgetSessionRequest.mockResolvedValue(false);
    mockHasUiActionCapability.mockReset();
    mockHasUiActionCapability.mockReturnValue(false);
    vi.restoreAllMocks();
  });

  it("rejects cached frontend clients before an action can read or write", async () => {
    process.env.AGENT_NATIVE_BUILD_ID = "server-build";
    process.env.AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION = "fallback-v1";
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const run = vi.fn(async () => ({ ok: true }));
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };

    mountActionRoutes(
      nitroApp,
      { test: { run } as any },
      {
        clientCompatibilityVersion: "slides-write-v1",
      },
    );
    const event = {
      _method: "POST",
      _headers: {
        origin: "https://embedded.example.com",
        "x-agent-native-frontend": "1",
      },
      req: { json: vi.fn(async () => ({})) },
    };

    await expect(mounted[0]!.handler(event)).resolves.toMatchObject({
      code: "client_build_mismatch",
      serverBuildId: "server-build",
      requiredCompatibility: "slides-write-v1",
    });
    expect(event).toMatchObject({
      _status: 409,
      _responseHeaders: {
        "cache-control": "no-store",
        "access-control-expose-headers":
          "X-Agent-Native-Client-Mismatch,X-Agent-Native-Build-Id,X-Agent-Native-Client-Compatibility,Retry-After,X-Agent-Native-Browser-Persist,x-agent-native-widget-session-expired",
        "x-agent-native-client-mismatch": "1",
      },
    });
    expect(event.req.json).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("marks only an expired, renewable widget session as a typed 401", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const run = vi.fn(async () => ({ ok: true }));
    mountActionRoutes(
      {
        use: vi.fn((path: string, handler: any) =>
          mounted.push({ path, handler }),
        ),
      },
      { update: { http: { method: "POST" }, requiresAuth: true, run } as any },
    );

    mockIsExpiredMcpDirectoryWidgetSessionRequest.mockResolvedValueOnce(true);
    const event: any = {
      _method: "POST",
      _hasExplicitEmbedSessionCredential: true,
      _headers: { authorization: "Bearer expired-token" },
      req: {
        url: "http://app.test/_agent-native/actions/update",
        json: async () => ({}),
      },
    };
    await expect(mounted[0]!.handler(event)).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(event._responseHeaders).toMatchObject({
      "x-agent-native-widget-session-expired": "1",
    });
    expect(mockIsExpiredMcpDirectoryWidgetSessionRequest).toHaveBeenCalledWith(
      event,
    );

    const invalidEvent = {
      ...event,
      _responseHeaders: undefined,
    };
    await expect(mounted[0]!.handler(invalidEvent)).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(invalidEvent._responseHeaders).not.toHaveProperty(
      "x-agent-native-widget-session-expired",
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("allows matching frontend clients and leaves non-frontend callers unaffected", async () => {
    process.env.AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION = "spaces-v1";
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const run = vi.fn(async () => ({ ok: true }));
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };

    mountActionRoutes(
      nitroApp,
      { test: { run } as any },
      {
        getOwnerFromEvent: async () => "owner@example.com",
      },
    );
    const matchingFrontend = {
      _method: "POST",
      _headers: {
        "x-agent-native-frontend": "1",
        "x-agent-native-client-compatibility": "spaces-v1",
      },
      req: { json: async () => ({}) },
    };
    const agentCaller = {
      _method: "POST",
      _headers: {},
      req: { json: async () => ({}) },
    };

    await expect(mounted[0]!.handler(matchingFrontend)).resolves.toBeTruthy();
    await expect(mounted[0]!.handler(agentCaller)).resolves.toBeTruthy();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it.each(["PUT", "DELETE"] as const)(
    "accepts frontend mutation RPCs for actions exposed as %s",
    async (method) => {
      const { mountActionRoutes } = await import("./action-routes.js");
      const mounted: Array<{ path: string; handler: any }> = [];
      const run = vi.fn(async (params, ctx) => ({
        ok: true,
        params,
        caller: ctx?.caller,
      }));
      const nitroApp = {
        use: vi.fn((path: string, handler: any) =>
          mounted.push({ path, handler }),
        ),
      };

      mountActionRoutes(nitroApp, {
        "delete-item": {
          http: { method },
          run,
        } as any,
      });

      const frontendPost = {
        _method: "POST",
        _headers: { "x-agent-native-frontend": "1" },
        req: {
          url: "http://app.test/_agent-native/actions/delete-item",
          json: vi.fn(async () => ({ id: "item-1" })),
        },
      };
      await expect(mounted[0]!.handler(frontendPost)).resolves.toEqual({
        ok: true,
        params: { id: "item-1" },
        caller: "frontend",
      });
      expect(run).toHaveBeenCalledOnce();

      const directPost = {
        _method: "POST",
        _headers: {},
        req: {
          url: "http://app.test/_agent-native/actions/delete-item",
          json: vi.fn(async () => ({ id: "item-2" })),
        },
      };
      await expect(mounted[0]!.handler(directPost)).resolves.toEqual({
        error: `Method not allowed. Use ${method}.`,
      });
      expect(directPost).toMatchObject({ _status: 405 });
      expect(directPost.req.json).not.toHaveBeenCalled();
      expect(run).toHaveBeenCalledOnce();
    },
  );

  it("does not trust the frontend header for UI-only actions", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const run = vi.fn(async () => ({ ok: true }));
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };

    mountActionRoutes(
      nitroApp,
      {
        "delete-account-data": {
          run,
          uiOnly: true,
          agentTool: false,
          mcpTool: false,
          toolCallable: false,
        } as any,
      },
      { getOwnerFromEvent: async () => "owner@example.com" },
    );

    const event = {
      _method: "POST",
      _headers: { "x-agent-native-frontend": "1" },
      req: { json: async () => ({}) },
    };

    await expect(mounted[0]!.handler(event)).resolves.toEqual({
      error: "This action can only be called from the signed-in app UI.",
      errorCode: "ui_capability_required",
    });
    expect(event._status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects cross-origin UI-only actions even with a valid capability", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const run = vi.fn(async () => ({ ok: true }));
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    mockHasUiActionCapability.mockReturnValue(true);

    mountActionRoutes(
      nitroApp,
      {
        "delete-account-data": {
          run,
          uiOnly: true,
          agentTool: false,
          mcpTool: false,
          toolCallable: false,
        } as any,
      },
      { getOwnerFromEvent: async () => "owner@example.com" },
    );

    const event = {
      _method: "POST",
      _headers: {
        host: "app.example.com",
        origin: "https://evil.example.com",
        "x-agent-native-frontend": "1",
      },
      req: { json: async () => ({}) },
    };

    await expect(mounted[0]!.handler(event)).resolves.toEqual({
      error: "This action can only be called from the signed-in app UI.",
      errorCode: "ui_capability_required",
    });
    expect(event._status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });

  it.each(["GET", "HEAD", "OPTIONS"] as const)(
    "does not treat a frontend POST as a %s action call",
    async (method) => {
      const { mountActionRoutes } = await import("./action-routes.js");
      const mounted: Array<{ path: string; handler: any }> = [];
      const run = vi.fn(async () => ({ ok: true }));
      const nitroApp = {
        use: vi.fn((path: string, handler: any) =>
          mounted.push({ path, handler }),
        ),
      };

      mountActionRoutes(nitroApp, {
        "get-item": {
          http: { method },
          run,
        } as any,
      });
      const event = {
        _method: "POST",
        _headers: { "x-agent-native-frontend": "1" },
        req: {
          url: "http://app.test/_agent-native/actions/get-item",
          json: vi.fn(async () => ({})),
        },
      };

      await expect(mounted[0]!.handler(event)).resolves.toEqual({
        error: `Method not allowed. Use ${method}.`,
      });
      expect(event).toMatchObject({ _status: 405 });
      expect(event.req.json).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    },
  );

  it("mounts package actions registered through another core module instance", async () => {
    const packageCore = await import("./action-discovery.js");
    const packageRun = vi.fn(async () => ({ source: "package" }));
    packageCore.registerPackageActions({
      "cross-instance-package-action": {
        tool: { description: "Package action", parameters: {} },
        http: { method: "GET" },
        readOnly: true,
        requiresAuth: false,
        run: packageRun,
      } as ActionEntry,
    });

    vi.resetModules();
    const hostCore = await import("./action-discovery.js");
    expect(hostCore).not.toBe(packageCore);

    const actions: Record<string, ActionEntry> = {};
    hostCore.mergePackageActions(actions);
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const { mountActionRoutes } = await import("./action-routes.js");
    mountActionRoutes(nitroApp, actions);

    const result = await mounted[0].handler({
      _method: "GET",
      req: {
        url: "http://app.test/_agent-native/actions/cross-instance-package-action",
      },
    });

    expect(result).toEqual({ source: "package" });
    expect(packageRun).toHaveBeenCalledOnce();
  });

  it("marks GET results for browser persistence unless the action opts out", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const run = vi.fn(async () => ({ ok: true }));
    const definition = (extra: Record<string, unknown>) =>
      ({
        tool: { description: "Read", parameters: {} },
        http: { method: "GET" },
        readOnly: true,
        requiresAuth: false,
        run,
        ...extra,
      }) as any;
    mountActionRoutes(nitroApp, {
      "list-things": definition({}),
      "reveal-secret": definition({ persistInBrowser: false }),
    });
    const responseFor = async (name: string) => {
      const event: any = {
        _method: "GET",
        req: { url: `http://app.test/_agent-native/actions/${name}` },
      };
      await mounted
        .find((entry) => entry.path.endsWith(`/${name}`))!
        .handler(event);
      return event._responseHeaders ?? {};
    };

    expect(await responseFor("list-things")).toMatchObject({
      "x-agent-native-browser-persist": "allow",
      "cache-control": "no-store",
    });
    expect(await responseFor("reveal-secret")).not.toHaveProperty(
      "x-agent-native-browser-persist",
    );
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

  it("adds a Better Auth id resolved directly from the trusted owner context", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    let observedAuthUserId: string | undefined;
    const run = vi.fn(async () => {
      observedAuthUserId = getRequestContext()?.authUserId;
      return { ok: true };
    });
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };

    mountActionRoutes(
      nitroApp,
      {
        test: {
          http: { method: "POST" },
          run,
        } as any,
      },
      {
        getOwnerFromEvent: async () => "owner@example.com",
        getAuthUserIdFromEvent: async () => "better-auth-user-1",
      },
    );

    await expect(
      mounted[0]!.handler({
        _method: "POST",
        req: { json: async () => ({}) },
      }),
    ).resolves.toEqual({ ok: true });
    expect(observedAuthUserId).toBe("better-auth-user-1");
  });

  it("carries session validation time across later action-context lookups", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    let observedAuthenticatedAtMs: number | undefined;
    const run = vi.fn(async () => {
      observedAuthenticatedAtMs =
        getRequestContext()?.identityAuthenticatedAtMs;
      return { ok: true };
    });
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const event = {
      context: {},
      _method: "POST",
      req: { json: async () => ({}) },
    };
    markRequestIdentityAuthenticatedAtMs(event, "owner@example.com", 2_000);
    markExplicitPersonalOrgScope(event);

    mountActionRoutes(
      nitroApp,
      { test: { http: { method: "POST" }, run } as any },
      { getOwnerFromEvent: async () => "owner@example.com" },
    );

    try {
      await expect(mounted[0]!.handler(event)).resolves.toEqual({ ok: true });
      expect(observedAuthenticatedAtMs).toBe(2_000);
    } finally {
      now.mockRestore();
    }
  });

  it("continues the action and reports failed optional identity resolution", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    let observedAuthUserId: string | undefined;
    const run = vi.fn(async () => {
      observedAuthUserId = getRequestContext()?.authUserId;
      return { ok: true };
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };

    mountActionRoutes(
      nitroApp,
      {
        test: {
          http: { method: "POST" },
          run,
        } as any,
      },
      {
        getOwnerFromEvent: async () => "owner@example.com",
        getAuthUserIdFromEvent: async () => {
          throw new Error("private resolver details");
        },
      },
    );

    await expect(
      mounted[0]!.handler({
        _method: "POST",
        req: { json: async () => ({}) },
      }),
    ).resolves.toEqual({ ok: true });
    expect(observedAuthUserId).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[agent-actions] Could not resolve canonical tracking identity; continuing without auth_user_id.",
    );
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("private resolver details"),
    );
  });

  it("does not infer the Better Auth id from a matching email", async () => {
    mockGetSession.mockResolvedValue({
      email: "owner@example.com",
      authUserId: "must-not-be-inferred-by-email",
    });
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    let observedAuthUserId: string | undefined;
    const run = vi.fn(async () => {
      observedAuthUserId = getRequestContext()?.authUserId;
      return { ok: true };
    });
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };

    mountActionRoutes(
      nitroApp,
      {
        test: {
          http: { method: "POST" },
          run,
        } as any,
      },
      { getOwnerFromEvent: async () => "owner@example.com" },
    );

    await expect(
      mounted[0]!.handler({
        _method: "POST",
        req: { json: async () => ({}) },
      }),
    ).resolves.toEqual({ ok: true });
    expect(observedAuthUserId).toBeUndefined();
  });

  it("preserves typed action contract conflicts without exposing arbitrary errors", async () => {
    const { ActionContractError } = await import("../action.js");
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const conflict = new ActionContractError("Stale schema", {
      errorCode: "SCHEMA_REVISION_CONFLICT",
      details: { expected: "before", actual: "after" },
    });
    const actions = {
      updateItem: {
        run: vi.fn().mockRejectedValue(conflict),
        http: { method: "POST" as const },
      },
    };
    mountActionRoutes(nitroApp, actions as any, {
      getOwnerFromEvent: async () => "owner@example.com",
    });
    const event = { _method: "POST", req: { json: async () => ({}) } };
    const result = await mounted[0].handler(event);

    expect(event._status).toBe(409);
    expect(result).toEqual({
      error: "Stale schema",
      errorCode: "SCHEMA_REVISION_CONFLICT",
      details: { expected: "before", actual: "after" },
    });
  });

  it("reports an unreadable action body as a contract error", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const run = vi.fn();
    const actions = {
      updateItem: {
        run,
        http: { method: "POST" as const },
      },
    };
    mountActionRoutes(nitroApp, actions as any, {
      getOwnerFromEvent: async () => "owner@example.com",
    });
    const event = {
      _method: "POST",
      req: { json: async () => Promise.reject(new SyntaxError("bad json")) },
    };

    const result = await mounted[0].handler(event);

    expect(event._status).toBe(400);
    expect(result).toEqual({
      error: "Request body must be a valid JSON object.",
      errorCode: "invalid_action_request_body",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects an explicit null body on the H3 fallback", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const run = vi.fn();
    const actions = {
      updateItem: {
        run,
        http: { method: "POST" as const },
      },
    };
    mountActionRoutes(nitroApp, actions as any, {
      getOwnerFromEvent: async () => "owner@example.com",
    });
    const event = { _method: "POST", _body: null, req: {} };

    const result = await mounted[0].handler(event);

    expect(event._status).toBe(400);
    expect(result).toEqual({
      error: "Request body must be a valid JSON object.",
      errorCode: "invalid_action_request_body",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("echoes a fail() message instead of a generic 500", async () => {
    const { fail } = await import("../scripts/utils.js");
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions = {
      getMeeting: {
        run: vi.fn(async () => {
          fail("No such meeting", { errorCode: "not_found", statusCode: 404 });
        }),
        http: { method: "POST" as const },
      },
    };
    mountActionRoutes(nitroApp, actions as any, {
      getOwnerFromEvent: async () => "owner@example.com",
    });
    const event = { _method: "POST", req: { json: async () => ({}) } };
    const result = await mounted[0].handler(event);

    expect(event._status).toBe(404);
    expect(result).toEqual({
      error: "No such meeting",
      errorCode: "not_found",
    });
    expect(mockCountActionFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "getMeeting",
        status: 404,
        errorCode: "not_found",
      }),
    );
  });

  it("forwards a bounded Retry-After for typed quota cooldowns", async () => {
    const { ActionContractError } = await import("../action.js");
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions = {
      markThreadRead: {
        run: vi.fn().mockRejectedValue(
          new ActionContractError("Gmail is temporarily limiting requests.", {
            errorCode: "gmail_quota_cooldown",
            details: { retryAfterSeconds: 900 },
            statusCode: 429,
          }),
        ),
        http: { method: "POST" as const },
      },
    };
    mountActionRoutes(nitroApp, actions as any, {
      getOwnerFromEvent: async () => "owner@example.com",
    });
    const event = { _method: "POST", req: { json: async () => ({}) } };
    const result = await mounted[0]!.handler(event);

    expect(event).toMatchObject({
      _status: 429,
      _responseHeaders: {
        "retry-after": "300",
        "access-control-expose-headers": expect.stringContaining("Retry-After"),
      },
    });
    expect(result).toEqual({
      error: "Gmail is temporarily limiting requests.",
      errorCode: "gmail_quota_cooldown",
      details: { retryAfterSeconds: 900 },
    });
  });

  it("returns 429 and Retry-After for a get-thread cooldown error", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const cooldown = Object.assign(
      new Error("Email service is briefly busy."),
      {
        statusCode: 429,
        errorCode: "gmail_quota_cooldown",
        details: { retryAfterSeconds: 45 },
      },
    );
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    mountActionRoutes(
      nitroApp,
      {
        "get-thread": {
          http: { method: "GET" },
          run: vi.fn().mockRejectedValue(cooldown),
        } as any,
      },
      {
        getOwnerFromEvent: async () => "owner@example.com",
        resolveOrgId: async () => "mail-test-org",
      },
    );
    const event = {
      _method: "GET",
      _query: { accountEmail: "owner@example.com", id: "thread-1" },
      _headers: {},
      req: {},
    };
    const route = mounted.find(({ path }) =>
      path.endsWith("/_agent-native/actions/get-thread"),
    );
    const result = await route!.handler(event);

    expect(event).toMatchObject({
      _status: 429,
      _responseHeaders: { "retry-after": "45" },
    });
    expect(result).toEqual({
      error: "Email service is briefly busy.",
      errorCode: "gmail_quota_cooldown",
      details: { retryAfterSeconds: 45 },
    });
  });

  it("keeps SQL errors generic and redacts bound values from action logs", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const privateValue = "example transcript content";
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const actions = {
      getMeeting: {
        run: vi
          .fn()
          .mockRejectedValue(
            new Error(
              `Failed query: insert into dictations (text) values ($1)\nparams: ${privateValue}`,
            ),
          ),
        http: { method: "POST" as const },
      },
    };
    mountActionRoutes(nitroApp, actions as any, {
      getOwnerFromEvent: async () => "owner@example.com",
    });
    const event = { _method: "POST", req: { json: async () => ({}) } };
    const result = await mounted[0].handler(event);

    expect(event._status).toBe(500);
    expect(result).toEqual({ error: "Internal server error" });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(privateValue);
    expect(JSON.stringify(consoleError.mock.calls)).toContain(
      "params: <redacted>",
    );
    expect(consoleError.mock.calls[0]?.[1]?.error).toMatch(/\n\s+at /);
  });

  it("echoes a missing-credential message instead of a generic 500", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const { FeatureNotConfiguredError } =
      await import("./credential-provider.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions = {
      cleanupTranscript: {
        run: vi.fn().mockRejectedValue(
          new FeatureNotConfiguredError({
            requiredCredential: "BUILDER_PRIVATE_KEY",
            message: "Use Builder.io or add a fallback AI key.",
          }),
        ),
        http: { method: "POST" as const },
      },
    };
    mountActionRoutes(nitroApp, actions as any, {
      getOwnerFromEvent: async () => "owner@example.com",
    });
    const event = { _method: "POST", req: { json: async () => ({}) } };
    const result = await mounted[0].handler(event);

    expect(event._status).toBe(400);
    expect(result).toEqual({
      error: "Use Builder.io or add a fallback AI key.",
      errorCode: "feature_not_configured",
    });
  });

  it("preserves safe action contract metadata for retryable server failures", async () => {
    const { ActionContractError } = await import("../action.js");
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const unavailable = new ActionContractError("Directory unavailable", {
      errorCode: "workspace_feature_flag_directory",
      details: { phase: "directory" },
      statusCode: 503,
    });
    const actions = {
      updateItem: {
        run: vi.fn().mockRejectedValue(unavailable),
        http: { method: "POST" as const },
      },
    };
    mountActionRoutes(nitroApp, actions as any, {
      getOwnerFromEvent: async () => "owner@example.com",
    });
    const event = { _method: "POST", req: { json: async () => ({}) } };
    const result = await mounted[0].handler(event);

    expect(event._status).toBe(503);
    expect(result).toEqual({
      error: "Directory unavailable",
      errorCode: "workspace_feature_flag_directory",
      details: { phase: "directory" },
    });
  });

  it("preserves safe stopped-action metadata without exposing its tool result", async () => {
    const { AgentActionStopError } = await import("../action.js");
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const stopped = new AgentActionStopError("Verification timed out", {
      errorCode: "workspace_feature_flag_verification_timeout",
      details: { phase: "verification-timeout" },
      toolResult: "private agent-only context",
    });
    const actions = {
      updateItem: {
        run: vi.fn().mockRejectedValue(stopped),
        http: { method: "POST" as const },
      },
    };
    mountActionRoutes(nitroApp, actions as any, {
      getOwnerFromEvent: async () => "owner@example.com",
    });
    const event = { _method: "POST", req: { json: async () => ({}) } };
    const result = await mounted[0].handler(event);

    expect(event._status).toBe(500);
    expect(result).toEqual({
      error: "Verification timed out",
      errorCode: "workspace_feature_flag_verification_timeout",
      details: { phase: "verification-timeout" },
    });
    expect(JSON.stringify(result)).not.toContain("private agent-only context");
  });

  it("captures uncategorized action failures with low-cardinality context", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const { registerErrorCaptureProvider } = await import("./capture-error.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const error = new Error("upstream failed");
    const provider = vi.fn(() => "evt_action_failure");
    const unregister = registerErrorCaptureProvider(
      "action-routes-test",
      provider,
    );
    const actions: Record<string, ActionEntry> = {
      "resolve-notion-sync-conflict": {
        run: vi.fn(async () => {
          throw error;
        }),
      } as any,
    };

    try {
      mountActionRoutes(nitroApp, actions);

      const event = {
        _method: "POST",
        _headers: { "x-agent-native-frontend": "1" },
        req: {
          url: "http://app.test/_agent-native/actions/resolve-notion-sync-conflict",
          json: async () => ({}),
        },
      };
      const result = await mounted[0].handler(event);

      expect(result).toEqual({ error: "Internal server error" });
      expect(event._status).toBe(500);
      expect(provider).toHaveBeenCalledWith(error, {
        route: "/_agent-native/actions/resolve-notion-sync-conflict",
        method: "POST",
        tags: {
          action: "resolve-notion-sync-conflict",
          caller: "frontend",
          status_code: "500",
        },
        extra: {
          failureContext: expect.objectContaining({
            route: "/_agent-native/actions/resolve-notion-sync-conflict",
            actionName: "resolve-notion-sync-conflict",
          }),
        },
      });
      expect(mockCountActionFailure).toHaveBeenCalledWith({
        action: "resolve-notion-sync-conflict",
        status: 500,
        caller: "frontend",
        errorCode: undefined,
      });
    } finally {
      unregister();
    }
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

  it("carries the browser session id header into request context", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const { getRequestContext } = await import("./request-context.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      ping: {
        run: vi.fn(async () => ({
          browserSessionId: getRequestContext()?.browserSessionId,
          browserTabId: getRequestContext()?.run?.browserTabId,
          clientPlatform: getRequestContext()?.clientPlatform,
        })),
      } as any,
    };

    mountActionRoutes(nitroApp, actions, {
      getOwnerFromEvent: async () => "alice@example.com",
    });

    const withSession = {
      _method: "POST",
      _headers: {
        "x-agent-native-session-id": "pinned-session-1",
        "x-agent-native-browser-tab": "tab-a",
        "x-agent-native-client-platform": "mobile",
      },
      req: { json: async () => ({}) },
    };
    const withoutSession = {
      _method: "POST",
      _headers: {},
      req: { json: async () => ({}) },
    };

    expect(await mounted[0].handler(withSession)).toEqual({
      browserSessionId: "pinned-session-1",
      browserTabId: "tab-a",
      clientPlatform: "mobile",
    });
    expect(await mounted[0].handler(withoutSession)).toEqual({
      browserSessionId: undefined,
      browserTabId: undefined,
      clientPlatform: undefined,
    });
  });

  it("uses the forwarded gateway origin for request context behind a dev proxy", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const { getRequestContext } = await import("./request-context.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      ping: {
        run: vi.fn(async () => ({
          requestOrigin: getRequestContext()?.requestOrigin,
        })),
      } as any,
    };

    mountActionRoutes(nitroApp, actions, {
      getOwnerFromEvent: async () => "alice@example.com",
    });

    const proxied = {
      _method: "POST",
      _headers: {
        host: "127.0.0.1:8092",
        "x-forwarded-host": "127.0.0.1:8080",
        "x-forwarded-proto": "http",
      },
      req: {
        url: "http://127.0.0.1:8092/dispatch/_agent-native/actions/ping",
        json: async () => ({}),
      },
    };

    expect(await mounted[0].handler(proxied)).toEqual({
      requestOrigin: "http://127.0.0.1:8080",
    });
  });

  it("keeps the forwarded gateway origin when workspace OAuth relay is configured", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("APP_URL", "https://dispatch.agent-native.com");
    const { mountActionRoutes } = await import("./action-routes.js");
    const { getRequestContext } = await import("./request-context.js");
    const { getOrigin } = await import("./google-oauth.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      ping: {
        run: vi.fn(async () => ({
          requestOrigin: getRequestContext()?.requestOrigin,
        })),
      } as any,
    };

    mountActionRoutes(nitroApp, actions, {
      getOwnerFromEvent: async () => "alice@example.com",
    });

    const proxied = {
      _method: "POST",
      _headers: {
        host: "127.0.0.1:8092",
        "x-forwarded-host": "127.0.0.1:8080",
        "x-forwarded-proto": "http",
      },
      req: {
        url: "http://127.0.0.1:8092/dispatch/_agent-native/actions/ping",
        json: async () => ({}),
      },
    };

    expect(getOrigin(proxied as any)).toBe("https://dispatch.agent-native.com");
    expect(await mounted[0].handler(proxied)).toEqual({
      requestOrigin: "http://127.0.0.1:8080",
    });
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

  it("registers optional-auth action routes before the auth guard", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const nitroApp = {
      use: vi.fn(),
    };

    mountActionRoutes(nitroApp, {
      "public-metadata": {
        requiresAuth: false,
        run: vi.fn(async () => ({ ok: true })),
      } as any,
    });

    expect(mockRegisterAuthPublicPaths).toHaveBeenCalledWith(
      ["/_agent-native/actions/public-metadata"],
      nitroApp,
    );
  });

  it("parses get-design metadata-only query booleans on the HTTP route", async () => {
    const { defineAction } = await import("../action.js");
    const { getDesignSchema } =
      await import("../../../../templates/design/actions/get-design.schema.js");
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const run = vi.fn(async (args) => args);

    mountActionRoutes(
      {
        use: vi.fn((path: string, handler: any) =>
          mounted.push({ path, handler }),
        ),
      },
      {
        "get-design": defineAction({
          description: "Test get-design query parsing",
          schema: getDesignSchema,
          http: { method: "GET" },
          requiresAuth: false,
          run,
        }) as any,
      },
    );

    await expect(
      mounted[0]!.handler({
        _method: "GET",
        req: {
          url: "http://app.test/_agent-native/actions/get-design?id=design_1&includeFileContent=false",
        },
      }),
    ).resolves.toEqual({ id: "design_1", includeFileContent: false });
    expect(run).toHaveBeenCalledWith(
      { id: "design_1", includeFileContent: false },
      expect.objectContaining({ caller: "http" }),
    );
  });

  it("propagates a verified capability to a public action without impersonating its owner", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const { getRequestAuthCapability, getRequestUserEmail } =
      await import("./request-context.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    mockResolveEmbedSessionFromRequest.mockResolvedValue({
      email: "ticket-owner@example.com",
      token: "signed-capability",
      targetPath: "/visual-edit/design_1",
      scope: "capability:visual-edit:design:design_1",
    });
    const unauthenticated = Object.assign(new Error("Unauthenticated"), {
      statusCode: 401,
    });

    mountActionRoutes(
      nitroApp,
      {
        "get-design": {
          http: { method: "GET" },
          readOnly: true,
          requiresAuth: false,
          run: vi.fn(async (_args, ctx) => ({
            ctxUserEmail: ctx?.userEmail,
            requestUserEmail: getRequestUserEmail(),
            authCapability: getRequestAuthCapability(),
          })),
        } as any,
      },
      {
        getOwnerFromEvent: async () => {
          throw unauthenticated;
        },
      },
    );

    await expect(
      mounted[0]!.handler({
        _method: "GET",
        req: {
          url: "http://app.test/_agent-native/actions/get-design?id=design_1",
        },
      }),
    ).resolves.toEqual({
      ctxUserEmail: undefined,
      requestUserEmail: undefined,
      authCapability: "capability:visual-edit:design:design_1",
    });
  });

  it("does not let a capability satisfy account-backed write action auth", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const run = vi.fn(async () => ({ ok: true }));
    mockResolveEmbedSessionFromRequest.mockResolvedValue({
      email: "ticket-owner@example.com",
      token: "signed-capability",
      targetPath: "/visual-edit/design_1",
      scope: "capability:visual-edit:design:design_1",
    });
    const unauthenticated = Object.assign(new Error("Unauthenticated"), {
      statusCode: 401,
    });

    mountActionRoutes(
      {
        use: vi.fn((path: string, handler: any) =>
          mounted.push({ path, handler }),
        ),
      },
      {
        "update-design": {
          http: { method: "POST" },
          requiresAuth: true,
          run,
        } as any,
      },
      {
        getOwnerFromEvent: async () => {
          throw unauthenticated;
        },
      },
    );

    await expect(
      mounted[0]!.handler({
        _method: "POST",
        req: {
          url: "http://app.test/_agent-native/actions/update-design",
          json: async () => ({ id: "design_1" }),
        },
      }),
    ).rejects.toBe(unauthenticated);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a failed embed credential before same-origin cookie auth can fall through", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const run = vi.fn(async () => ({ ok: true }));
    const getOwnerFromEvent = vi.fn(async () => "session-user@example.com");
    mockResolveEmbedSessionFromRequest.mockResolvedValue(null);

    mountActionRoutes(
      {
        use: vi.fn((path: string, handler: any) =>
          mounted.push({ path, handler }),
        ),
      },
      {
        "get-document": {
          http: { method: "GET" },
          readOnly: true,
          requiresAuth: true,
          run,
        } as any,
      },
      { getOwnerFromEvent },
    );

    await expect(
      mounted[0]!.handler({
        _method: "GET",
        _query: { __an_embed_token: "revoked-widget-token" },
        _headers: { cookie: "better-auth.session_token=valid-session" },
        req: {
          url: "http://app.test/_agent-native/actions/get-document?id=doc-1&__an_embed_token=revoked-widget-token",
        },
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(getOwnerFromEvent).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("propagates embed revocation lookup failures instead of using cookie auth", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const run = vi.fn(async () => ({ ok: true }));
    const getOwnerFromEvent = vi.fn(async () => "session-user@example.com");
    const unavailable = new Error("revocation lookup unavailable");
    mockResolveEmbedSessionFromRequest.mockRejectedValue(unavailable);

    mountActionRoutes(
      {
        use: vi.fn((path: string, handler: any) =>
          mounted.push({ path, handler }),
        ),
      },
      {
        "get-document": {
          http: { method: "GET" },
          readOnly: true,
          requiresAuth: true,
          run,
        } as any,
      },
      { getOwnerFromEvent },
    );

    await expect(
      mounted[0]!.handler({
        _method: "GET",
        _query: { __an_embed_token: "scoped-widget-token" },
        _headers: { cookie: "better-auth.session_token=valid-session" },
        req: {
          url: "http://app.test/_agent-native/actions/get-document?id=doc-1&__an_embed_token=scoped-widget-token",
        },
      }),
    ).rejects.toBe(unavailable);
    expect(getOwnerFromEvent).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("still permits cookie auth when the request has no embed credential", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const run = vi.fn(async (_args, context) => ({
      userEmail: context?.userEmail,
    }));
    mockResolveEmbedSessionFromRequest.mockResolvedValue(null);

    mountActionRoutes(
      {
        use: vi.fn((path: string, handler: any) =>
          mounted.push({ path, handler }),
        ),
      },
      {
        "get-document": {
          http: { method: "GET" },
          readOnly: true,
          requiresAuth: true,
          run,
        } as any,
      },
      { getOwnerFromEvent: async () => "session-user@example.com" },
    );

    await expect(
      mounted[0]!.handler({
        _method: "GET",
        _headers: {
          cookie:
            "better-auth.session_token=valid-session; an_embed_session=unrelated-widget-cookie",
        },
        req: {
          url: "http://app.test/_agent-native/actions/get-document?id=doc-1",
        },
      }),
    ).resolves.toEqual({ userEmail: "session-user@example.com" });
    expect(run).toHaveBeenCalledOnce();
  });

  it("allows a matching capability on a frontend action request", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const { getRequestAuthCapability } = await import("./request-context.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const run = vi.fn(async (_args, context) => ({
      caller: context?.caller,
      userEmail: context?.userEmail,
      authCapability: getRequestAuthCapability(),
    }));
    mockResolveEmbedSessionFromRequest.mockResolvedValue({
      email: "ticket-owner@example.com",
      token: "signed-capability",
      targetPath: "/visual-edit/design_1",
      scope: "capability:visual-edit:design:design_1",
    });
    const unauthenticated = Object.assign(new Error("Unauthenticated"), {
      statusCode: 401,
    });

    mountActionRoutes(
      {
        use: vi.fn((path: string, handler: any) =>
          mounted.push({ path, handler }),
        ),
      },
      {
        "update-screen-source": {
          http: { method: "POST" },
          requiresAuth: true,
          capabilityScopes: ["visual-edit"],
          run,
        } as any,
      },
      {
        getOwnerFromEvent: async () => {
          throw unauthenticated;
        },
      },
    );

    await expect(
      mounted[0]!.handler({
        _method: "POST",
        _headers: { "x-agent-native-frontend": "1" },
        req: {
          url: "http://app.test/_agent-native/actions/update-screen-source",
          json: async () => ({ designId: "design_1", fileId: "file_1" }),
        },
      }),
    ).resolves.toEqual({
      caller: "frontend",
      userEmail: undefined,
      authCapability: "capability:visual-edit:design:design_1",
    });
    expect(run).toHaveBeenCalledOnce();
  });

  it("limits directory widget tickets to one app, shell resource, and record", async () => {
    const {
      allowsMcpDirectoryWidgetReadAction,
      createMcpDirectoryWidgetReadCapability,
      normalizeMcpDirectoryWidgetReadActionArguments,
    } = await import("../shared/embed-auth.js");
    const { mountActionRoutes } = await import("./action-routes.js");
    const { getRequestAuthCapability, getRequestUserEmail } =
      await import("./request-context.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const runRead = vi.fn(async (_args, context) => ({
      actionUser: context?.userEmail,
      requestUser: getRequestUserEmail(),
      orgId: context?.orgId,
      authCapability: getRequestAuthCapability(),
    }));
    const runDatabaseRead = vi.fn(async (args, context) => ({
      args,
      caller: context?.caller,
    }));
    const runTableQuery = vi.fn(async (args, context) => ({
      args,
      caller: context?.caller,
    }));
    const runWrite = vi.fn(async () => ({ ok: true }));
    const capability = createMcpDirectoryWidgetReadCapability({
      appId: "content",
      resourceUri: "ui://content/shell-v69",
      resourceIds: { documentId: "doc-1" },
      actionArguments: {
        "get-document": { id: "doc-1" },
        "get-content-database": {
          databaseId: "database-1",
          documentId: "doc-1",
          limit: { type: "integerRange", min: 0, max: 5_000 },
        },
        "query-content-database-items": {
          documentId: "doc-1",
          limit: { type: "integerRange", min: 1, max: 5_000 },
          tableQuery: { type: "actionSchema" },
        },
      },
    })!;
    mockResolveEmbedSessionFromRequest.mockResolvedValue({
      email: "ticket-owner@example.com",
      orgId: "org-widget",
      token: "signed-directory-capability",
      targetPath: "/documents",
      scope: capability,
    });

    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    mountActionRoutes(
      nitroApp,
      {
        "get-document": {
          http: { method: "GET" },
          readOnly: true,
          requiresAuth: true,
          run: runRead,
        } as any,
        "mutate-document": {
          http: { method: "POST" },
          readOnly: false,
          requiresAuth: true,
          run: runWrite,
        } as any,
        "private-read": {
          http: { method: "GET" },
          readOnly: true,
          requiresAuth: true,
          run: vi.fn(async () => ({ ok: true })),
        } as any,
        "get-content-database": {
          http: { method: "GET" },
          readOnly: true,
          requiresAuth: true,
          run: runDatabaseRead,
        } as any,
        "query-content-database-items": {
          http: { method: "GET" },
          readOnly: true,
          requiresAuth: true,
          schema: z.object({
            documentId: z.string(),
            limit: z.coerce.number().int().min(1).max(5_000),
            tableQuery: z.object({
              search: z.string().max(500).optional(),
              filters: z
                .array(
                  z.object({
                    key: z.string(),
                    label: z.string(),
                    value: z.string(),
                  }),
                )
                .max(50)
                .optional(),
            }),
          }),
          tool: {
            parameters: {
              type: "object",
              properties: {
                documentId: { type: "string" },
                limit: { type: "integer" },
                tableQuery: { type: "object" },
              },
            },
          },
          run: runTableQuery,
        } as any,
      },
      {
        getOwnerFromEvent: async () => {
          throw Object.assign(new Error("Unauthenticated"), {
            statusCode: 401,
          });
        },
        appId: "content",
        mcpDirectoryWidgetResourceUri: "ui://content/shell-v69",
        mcpDirectoryWidgetReadActionArguments: {
          "get-document": ["id"],
          "get-content-database": ["databaseId", "documentId", "limit"],
          "query-content-database-items": ["documentId", "limit", "tableQuery"],
        },
        mcpDirectoryWidgetReadActionSchemaArguments: {
          "query-content-database-items": ["tableQuery"],
        },
      },
    );

    expect(
      allowsMcpDirectoryWidgetReadAction(capability, {
        actionName: "get-document",
        appId: "content",
        resourceUri: "ui://content/shell-v69",
        args: { id: "doc-1" },
        allowedArgumentNames: ["id"],
      }),
    ).toBe(true);
    expect(
      allowsMcpDirectoryWidgetReadAction(capability, {
        actionName: "private-read",
        appId: "content",
        resourceUri: "ui://content/shell-v69",
        args: { id: "doc-1" },
        allowedArgumentNames: ["id"],
      }),
    ).toBe(false);
    expect(
      normalizeMcpDirectoryWidgetReadActionArguments(capability, {
        actionName: "get-content-database",
        appId: "content",
        resourceUri: "ui://content/shell-v69",
        args: {
          databaseId: "database-1",
          documentId: "doc-1",
          limit: "50",
        },
        allowedArgumentNames: ["databaseId", "documentId", "limit"],
      }),
    ).toEqual({
      databaseId: "database-1",
      documentId: "doc-1",
      limit: 50,
    });
    expect(mockRegisterAuthPublicPaths).toHaveBeenCalledWith(
      ["/_agent-native/actions/get-document"],
      nitroApp,
    );
    expect(mockRegisterAuthPublicPaths).not.toHaveBeenCalledWith(
      ["/_agent-native/actions/private-read"],
      nitroApp,
    );

    await expect(
      mounted[0]!.handler({
        _method: "GET",
        _headers: { "x-agent-native-frontend": "1" },
        _query: { id: "doc-1" },
        req: {
          url: "http://app.test/_agent-native/actions/get-document?id=doc-1",
        },
      }),
    ).resolves.toEqual({
      actionUser: "ticket-owner@example.com",
      requestUser: "ticket-owner@example.com",
      orgId: "org-widget",
      authCapability: capability,
    });

    await expect(
      mounted[1]!.handler({
        _method: "POST",
        _headers: { "x-agent-native-frontend": "1" },
        req: {
          url: "http://app.test/_agent-native/actions/mutate-document",
          json: async () => ({}),
        },
      }),
    ).resolves.toEqual({
      error: "This widget capability only permits its scoped data routes.",
    });
    await expect(
      mounted[2]!.handler({
        _method: "GET",
        _headers: { "x-agent-native-frontend": "1" },
        req: { url: "http://app.test/_agent-native/actions/private-read" },
      }),
    ).resolves.toEqual({
      error: "This widget capability only permits its scoped data routes.",
    });
    await expect(
      mounted[0]!.handler({
        _method: "GET",
        _headers: { "x-agent-native-frontend": "1" },
        _query: { id: "doc-2" },
        req: {
          url: "http://app.test/_agent-native/actions/get-document?id=doc-2",
        },
      }),
    ).resolves.toEqual({
      error: "This widget capability is scoped to a different app resource.",
    });
    await expect(
      mounted[0]!.handler({
        _method: "GET",
        _headers: { "x-agent-native-frontend": "1" },
        _query: { id: "doc-1", includePrivate: "true" },
        req: {
          url: "http://app.test/_agent-native/actions/get-document?id=doc-1&includePrivate=true",
        },
      }),
    ).resolves.toEqual({
      error: "This widget capability is scoped to a different app resource.",
    });
    await expect(
      mounted[0]!.handler({
        _method: "GET",
        _headers: { "x-agent-native-frontend": "1" },
        req: { url: "http://app.test/_agent-native/actions/get-document" },
      }),
    ).resolves.toEqual({
      error: "This widget capability is scoped to a different app resource.",
    });

    await expect(
      mounted[3]!.handler({
        _method: "GET",
        _headers: { "x-agent-native-frontend": "1" },
        _query: {
          databaseId: "database-1",
          documentId: "doc-1",
          limit: "100",
        },
        req: {
          url: "http://app.test/_agent-native/actions/get-content-database?databaseId=database-1&documentId=doc-1&limit=100",
        },
      }),
    ).resolves.toEqual({
      args: {
        databaseId: "database-1",
        documentId: "doc-1",
        limit: 100,
      },
      caller: "mcp-widget",
    });
    await expect(
      mounted[3]!.handler({
        _method: "GET",
        _headers: { "x-agent-native-frontend": "1" },
        _query: {
          databaseId: "database-1",
          documentId: "doc-1",
          limit: "5001",
        },
        req: {
          url: "http://app.test/_agent-native/actions/get-content-database?databaseId=database-1&documentId=doc-1&limit=5001",
        },
      }),
    ).resolves.toEqual({
      error: "This widget capability is scoped to a different app resource.",
    });

    const tableQuery = JSON.stringify({ search: "launch" });
    const validQueryUrl = new URL(
      "http://app.test/_agent-native/actions/query-content-database-items",
    );
    validQueryUrl.searchParams.set("documentId", "doc-1");
    validQueryUrl.searchParams.set("limit", "50");
    validQueryUrl.searchParams.set("tableQuery", tableQuery);
    await expect(
      mounted[4]!.handler({
        _method: "GET",
        _headers: { "x-agent-native-frontend": "1" },
        req: { url: validQueryUrl.href },
      }),
    ).resolves.toEqual({
      args: {
        documentId: "doc-1",
        limit: 50,
        tableQuery: { search: "launch" },
      },
      caller: "mcp-widget",
    });

    const invalidQueryUrl = new URL(validQueryUrl);
    invalidQueryUrl.searchParams.set(
      "tableQuery",
      JSON.stringify({ search: "x".repeat(501) }),
    );
    const invalidQueryRequest = {
      _method: "GET",
      _headers: { "x-agent-native-frontend": "1" },
      req: { url: invalidQueryUrl.href },
      _status: 200,
    };
    await mounted[4]!.handler(invalidQueryRequest);
    expect(invalidQueryRequest._status).toBe(400);
    expect(runTableQuery).toHaveBeenCalledOnce();

    const oversizedQueryUrl = new URL(validQueryUrl);
    oversizedQueryUrl.searchParams.set(
      "tableQuery",
      JSON.stringify({
        filters: [
          { key: "status", label: "Status", value: "x".repeat(33_000) },
        ],
      }),
    );
    const oversizedQueryRequest = {
      _method: "GET",
      _headers: { "x-agent-native-frontend": "1" },
      req: { url: oversizedQueryUrl.href },
      _status: 200,
    };
    await mounted[4]!.handler(oversizedQueryRequest);
    expect(oversizedQueryRequest._status).toBe(400);
    expect(runTableQuery).toHaveBeenCalledOnce();
    expect(runRead).toHaveBeenCalledOnce();
    expect(runDatabaseRead).toHaveBeenCalledOnce();
    expect(runWrite).not.toHaveBeenCalled();
  });

  it("keeps public design reads public and scopes their widget-ticket path", async () => {
    const { createMcpDirectoryWidgetReadCapability } =
      await import("../shared/embed-auth.js");
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const run = vi.fn(async (args, context) => ({
      id: args.id,
      caller: context?.caller,
      userEmail: context?.userEmail,
    }));
    const capability = createMcpDirectoryWidgetReadCapability({
      appId: "design",
      resourceUri: "ui://design/shell-v69",
      resourceIds: { designId: "design-1" },
      actionArguments: { "get-design": { id: "design-1" } },
    })!;
    mockResolveEmbedSessionFromRequest.mockResolvedValue({
      email: "ticket-owner@example.com",
      orgId: "org-design",
      token: "signed-directory-capability",
      targetPath: "/design/design-1",
      scope: capability,
    });
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    mountActionRoutes(
      nitroApp,
      {
        "get-design": {
          http: { method: "GET" },
          readOnly: true,
          requiresAuth: false,
          run,
        } as any,
      },
      {
        getOwnerFromEvent: async () => {
          throw Object.assign(new Error("Unauthenticated"), {
            statusCode: 401,
          });
        },
        appId: "design",
        mcpDirectoryWidgetResourceUri: "ui://design/shell-v69",
        mcpDirectoryWidgetReadActionArguments: { "get-design": ["id"] },
        mcpDirectoryWidgetReadPublicActions: ["get-design"],
      },
    );

    await expect(
      mounted[0]!.handler({
        _method: "GET",
        _headers: { "x-agent-native-frontend": "1" },
        _query: { id: "design-1" },
        req: {
          url: "http://app.test/_agent-native/actions/get-design?id=design-1",
        },
      }),
    ).resolves.toEqual({
      id: "design-1",
      caller: "mcp-widget",
      userEmail: "ticket-owner@example.com",
    });
    await expect(
      mounted[0]!.handler({
        _method: "GET",
        _headers: { "x-agent-native-frontend": "1" },
        _query: { id: "design-2" },
        req: {
          url: "http://app.test/_agent-native/actions/get-design?id=design-2",
        },
      }),
    ).resolves.toEqual({
      error: "This widget capability is scoped to a different app resource.",
    });

    mockResolveEmbedSessionFromRequest.mockResolvedValue(null);
    await expect(
      mounted[0]!.handler({
        _method: "GET",
        _headers: { "x-agent-native-frontend": "1" },
        _query: { id: "public-share-design" },
        req: {
          url: "http://app.test/_agent-native/actions/get-design?id=public-share-design",
        },
      }),
    ).resolves.toEqual({
      id: "public-share-design",
      caller: "frontend",
      userEmail: undefined,
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not let anonymous owners call directory read routes without a scoped ticket", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const run = vi.fn(async (_args, context) => ({
      userEmail: context?.userEmail,
    }));
    mockResolveEmbedSessionFromRequest.mockResolvedValue(null);

    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    mountActionRoutes(
      nitroApp,
      {
        "list-documents": {
          http: { method: "GET" },
          readOnly: true,
          requiresAuth: true,
          run,
        } as any,
      },
      {
        getOwnerFromEvent: async () => "anonymous@example.com",
        getOwnerContextFromEvent: async (event) => ({
          owner: event._headers?.["x-test-owner"] ?? "anonymous@example.com",
          anonymous:
            event._headers?.["x-test-owner"] !== "signed-in@example.com",
        }),
        appId: "content",
        mcpDirectoryWidgetResourceUri: "ui://content/shell-v69",
        mcpDirectoryWidgetReadActionArguments: {
          "list-documents": ["id"],
        },
      },
    );

    const anonymousRequest: any = {
      _method: "GET",
      _headers: { "x-agent-native-frontend": "1" },
      req: { url: "http://app.test/_agent-native/actions/list-documents" },
    };
    await expect(mounted[0]!.handler(anonymousRequest)).resolves.toEqual({
      error: "Unauthorized",
    });
    expect(anonymousRequest._status).toBe(401);
    expect(run).not.toHaveBeenCalled();

    await expect(
      mounted[0]!.handler({
        _method: "GET",
        _headers: {
          "x-agent-native-frontend": "1",
          "x-test-owner": "signed-in@example.com",
        },
        req: { url: "http://app.test/_agent-native/actions/list-documents" },
      }),
    ).resolves.toEqual({ userEmail: "signed-in@example.com" });
    expect(run).toHaveBeenCalledOnce();
  });

  it("uses the canonical fallback app ID and marks ticketed safe reads", async () => {
    const { createMcpDirectoryWidgetReadCapability } =
      await import("../shared/embed-auth.js");
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const run = vi.fn(async (_args, context) => ({
      caller: context?.caller,
      userEmail: context?.userEmail,
      mcpDirectoryWidgetReadOnly: context?.mcpDirectoryWidgetReadOnly,
      mcpDirectoryWidgetResourceIds: context?.mcpDirectoryWidgetResourceIds,
    }));
    const capability = createMcpDirectoryWidgetReadCapability({
      appId: "agent",
      resourceUri: "ui://agent/shell-v69",
      resourceIds: { deckId: "deck-1" },
      actionArguments: { "get-deck": { id: "deck-1" } },
    })!;
    mockResolveEmbedSessionFromRequest.mockResolvedValue({
      email: "ticket-owner@example.com",
      orgId: null,
      token: "signed-directory-capability",
      targetPath: "/deck/deck-1",
      scope: capability,
    });
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };

    mountActionRoutes(
      nitroApp,
      {
        "get-deck": {
          http: { method: "GET" },
          readOnly: false,
          requiresAuth: true,
          run,
        } as any,
      },
      {
        mcpDirectoryWidgetReadActionArguments: { "get-deck": ["id"] },
        mcpDirectoryWidgetReadOnlyActions: ["get-deck"],
        mcpDirectoryWidgetAppId: "agent",
        mcpDirectoryWidgetResourceUri: "ui://agent/shell-v69",
        getOwnerFromEvent: async () => {
          throw Object.assign(new Error("Unauthenticated"), {
            statusCode: 401,
          });
        },
      },
    );

    await expect(
      mounted[0]!.handler({
        _method: "GET",
        _headers: { "x-agent-native-frontend": "1" },
        _query: { id: "deck-1" },
        req: {
          url: "http://app.test/_agent-native/actions/get-deck?id=deck-1",
        },
      }),
    ).resolves.toEqual({
      caller: "mcp-widget",
      userEmail: "ticket-owner@example.com",
      mcpDirectoryWidgetReadOnly: true,
      mcpDirectoryWidgetResourceIds: { deckId: "deck-1" },
    });
    expect(run).toHaveBeenCalledOnce();
    expect(mockNotifyActionChange).not.toHaveBeenCalled();
  });

  it("carries only the ticketed widget write actions into scoped read context", async () => {
    const { createMcpDirectoryWidgetWriteCapability } =
      await import("../shared/embed-auth.js");
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const run = vi.fn(async (_args, context) => ({
      mcpDirectoryWidgetReadOnly: context?.mcpDirectoryWidgetReadOnly,
      mcpDirectoryWidgetWrite: context?.mcpDirectoryWidgetWrite,
    }));
    const capability = createMcpDirectoryWidgetWriteCapability({
      appId: "content",
      resourceUri: "ui://content/shell-v69",
      resourceIds: { documentId: "doc-1", spaceId: "space-1" },
      userEmail: "ticket-owner@example.com",
      orgId: "org-1",
      expiresAtMs: Date.now() + 60_000,
      readActionArguments: { "get-document": { id: "doc-1" } },
      writeActionArguments: {
        "update-document": {
          id: "doc-1",
          content: { type: "actionSchema" },
        },
      },
    })!;
    mockResolveEmbedSessionFromRequest.mockResolvedValue({
      email: "ticket-owner@example.com",
      orgId: "org-1",
      token: "signed-directory-capability",
      targetPath: "/page/doc-1",
      scope: capability,
    });
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };

    mountActionRoutes(
      nitroApp,
      {
        "get-document": {
          http: { method: "GET" },
          readOnly: true,
          requiresAuth: true,
          run,
        } as any,
      },
      {
        mcpDirectoryWidgetReadActionArguments: { "get-document": ["id"] },
        mcpDirectoryWidgetReadOnlyActions: ["get-document"],
        mcpDirectoryWidgetAppId: "content",
        mcpDirectoryWidgetResourceUri: "ui://content/shell-v69",
        getOwnerFromEvent: async () => {
          throw Object.assign(new Error("Unauthenticated"), {
            statusCode: 401,
          });
        },
      },
    );

    await expect(
      mounted[0]!.handler({
        _method: "GET",
        _headers: { "x-agent-native-frontend": "1" },
        _query: { id: "doc-1" },
        req: {
          url: "http://app.test/_agent-native/actions/get-document?id=doc-1",
        },
      }),
    ).resolves.toEqual({
      mcpDirectoryWidgetReadOnly: true,
      mcpDirectoryWidgetWrite: {
        appId: "content",
        resourceIds: { documentId: "doc-1", spaceId: "space-1" },
        actionNames: ["update-document"],
      },
    });
    expect(run).toHaveBeenCalledOnce();
  });

  it("requires authenticated callers for every directory widget write route", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const run = vi.fn(async () => ({ ok: true }));
    const actionNames = [
      "update-document",
      "share-resource",
      "unshare-resource",
      "set-resource-visibility",
      "add-database-item",
      "update-database-item",
      "update-design",
      "update-file",
      "create-file",
      "patch-deck",
    ];
    const actions = Object.fromEntries(
      actionNames.map((name) => [
        name,
        {
          http: { method: "POST" },
          readOnly: false,
          requiresAuth: true,
          run,
        } as any,
      ]),
    );
    const getOwnerContextFromEvent = vi.fn(async () => ({
      owner: "public-00000000-0000-4000-8000-000000000001@agent-native.local",
      anonymous: true,
    }));

    mountActionRoutes(
      {
        use: vi.fn((path: string, handler: any) =>
          mounted.push({ path, handler }),
        ),
      },
      actions,
      {
        appId: "content",
        mcpDirectoryWidgetAppId: "content",
        mcpDirectoryWidgetResourceUri: "ui://content/shell-v69",
        mcpDirectoryWidgetWriteActionArguments: Object.fromEntries(
          actionNames.map((name) => [name, ["id"]]),
        ),
        getOwnerContextFromEvent,
        getOwnerFromEvent: async () =>
          "public-00000000-0000-4000-8000-000000000001@agent-native.local",
      },
    );

    const outcomes = await Promise.all(
      actionNames.map(async (name) => {
        const event: any = {
          _method: "POST",
          _headers: {
            "x-agent-native-frontend": "1",
            host: "content.agent-native.test",
            origin: "https://content.agent-native.test",
            referer: "https://content.agent-native.test/p/public-document",
            cookie: "viewer-id=00000000-0000-4000-8000-000000000001",
          },
          req: {
            url: `https://content.agent-native.test/_agent-native/actions/${name}`,
            json: async () => ({ id: "public-document" }),
          },
        };
        const route = mounted.find(
          ({ path }) => path === `/_agent-native/actions/${name}`,
        );
        const result = await route!.handler(event);
        return { name, status: event._status ?? 200, result };
      }),
    );

    expect(outcomes).toEqual(
      actionNames.map((name) => ({
        name,
        status: 401,
        result: { error: "Unauthorized" },
      })),
    );
    expect(getOwnerContextFromEvent).toHaveBeenCalledTimes(actionNames.length);
    expect(run).not.toHaveBeenCalled();
  });

  describe("Content document share routes in a directory widget", () => {
    const DOCUMENT_ID = "doc-1";
    const OWNER = "ticket-owner@example.com";
    const ORG = "org-1";
    const RESOURCE_URI = "ui://content/shell-v69";
    const schemaField = { type: "actionSchema" as const };
    const writeArguments = {
      "update-document": { id: DOCUMENT_ID, title: schemaField },
      "share-resource": {
        resourceType: "document",
        resourceId: DOCUMENT_ID,
        principalType: schemaField,
        principalId: schemaField,
        role: schemaField,
        notify: schemaField,
        resourceUrl: schemaField,
        message: schemaField,
      },
      "unshare-resource": {
        resourceType: "document",
        resourceId: DOCUMENT_ID,
        principalType: schemaField,
        principalId: schemaField,
      },
      "set-resource-visibility": {
        resourceType: "document",
        resourceId: DOCUMENT_ID,
        visibility: schemaField,
      },
    };
    const readArguments = {
      "list-resource-shares": {
        resourceType: "document",
        resourceId: DOCUMENT_ID,
      },
    };
    const shareBodies: Record<string, Record<string, unknown>> = {
      "share-resource": {
        resourceType: "document",
        resourceId: DOCUMENT_ID,
        principalType: "user",
        principalId: "teammate@example.com",
        role: "viewer",
        notify: false,
        resourceUrl: "/page/doc-1",
        message: "Take a look",
      },
      "unshare-resource": {
        resourceType: "document",
        resourceId: DOCUMENT_ID,
        principalType: "user",
        principalId: "teammate@example.com",
      },
      "set-resource-visibility": {
        resourceType: "document",
        resourceId: DOCUMENT_ID,
        visibility: "org",
      },
    };
    const shareActionNames = Object.keys(shareBodies);
    const unlistedWrites = [
      "delete-document",
      "set-document-discoverability",
      "approve-resource-access-request",
      "create-agent-resource-link",
    ];
    const unlistedReads = ["list-resource-access-requests"];
    const scopeMismatch =
      "This widget write capability is scoped to a different user, app resource, or action.";
    const dataRoutesOnly =
      "This widget capability only permits its scoped data routes.";

    async function mountShareRoutes() {
      const { mountActionRoutes } = await import("./action-routes.js");
      const mounted: Array<{ path: string; handler: any }> = [];
      const run = vi.fn(async (_args: unknown, context: any) => ({
        ok: true,
        caller: context?.caller,
        readOnly: context?.mcpDirectoryWidgetReadOnly,
        grantedActions: context?.mcpDirectoryWidgetWrite?.actionNames,
      }));
      const schemas: Record<string, z.ZodType> = {
        "update-document": z.object({
          id: z.string(),
          title: z.string().optional(),
        }),
        "share-resource": z.object({
          resourceType: z.string(),
          resourceId: z.string(),
          principalType: z.enum(["user", "group", "org"]),
          principalId: z.string(),
          role: z
            .enum(["viewer", "commenter", "editor", "admin"])
            .default("viewer"),
          notify: z.boolean().default(true),
          resourceUrl: z.string().optional(),
          message: z.string().trim().max(500).optional(),
        }),
        "unshare-resource": z.object({
          resourceType: z.string(),
          resourceId: z.string(),
          principalType: z.enum(["user", "group", "org"]),
          principalId: z.string(),
        }),
        "set-resource-visibility": z.object({
          resourceType: z.string(),
          resourceId: z.string(),
          visibility: z.enum(["private", "org", "public"]),
        }),
      };
      const write = (name: string) =>
        ({
          http: { method: "POST" },
          readOnly: false,
          requiresAuth: true,
          schema: schemas[name],
          tool: { parameters: { type: "object", properties: {} } },
          run,
        }) as any;
      const read = () =>
        ({
          http: { method: "GET" },
          readOnly: true,
          requiresAuth: true,
          run,
        }) as any;
      mountActionRoutes(
        {
          use: vi.fn((path: string, handler: any) =>
            mounted.push({ path, handler }),
          ),
        },
        {
          ...Object.fromEntries(
            [...Object.keys(writeArguments), ...unlistedWrites].map((name) => [
              name,
              write(name),
            ]),
          ),
          "list-resource-shares": read(),
          ...Object.fromEntries(unlistedReads.map((name) => [name, read()])),
        },
        {
          appId: "content",
          mcpDirectoryWidgetAppId: "content",
          mcpDirectoryWidgetResourceUri: RESOURCE_URI,
          mcpDirectoryWidgetReadActionArguments: {
            "list-resource-shares": ["resourceType", "resourceId"],
          },
          mcpDirectoryWidgetWriteActionArguments: Object.fromEntries(
            Object.entries(writeArguments).map(([name, args]) => [
              name,
              Object.keys(args),
            ]),
          ),
          mcpDirectoryWidgetWriteActionSchemaArguments: Object.fromEntries(
            Object.entries(writeArguments).map(([name, args]) => [
              name,
              Object.entries(args)
                .filter(([, rule]) => typeof rule !== "string")
                .map(([argumentName]) => argumentName),
            ]),
          ),
          getOwnerFromEvent: async () => {
            throw Object.assign(new Error("Unauthenticated"), {
              statusCode: 401,
            });
          },
        },
      );
      const call = async (
        name: string,
        args: Record<string, unknown>,
        method: "GET" | "POST" = "POST",
      ) => {
        const query = new URLSearchParams(
          Object.entries(args).map(([key, value]) => [key, String(value)]),
        );
        const event: any = {
          _method: method,
          _headers: { "x-agent-native-frontend": "1" },
          req: {
            url: `http://app.test/_agent-native/actions/${name}${method === "GET" ? `?${query}` : ""}`,
            json: async () => args,
          },
        };
        const route = mounted.find(
          ({ path }) => path === `/_agent-native/actions/${name}`,
        );
        const result = await route!.handler(event);
        return { event, result, status: event._status ?? 200 };
      };
      return { call, run };
    }

    async function widgetSession(
      scope: "write" | "read",
      identity: {
        email?: string;
        orgId?: string | null;
        expiresAtMs?: number;
      } = {},
    ) {
      const embedAuth = await import("../shared/embed-auth.js");
      const resourceIds = {
        documentId: DOCUMENT_ID,
        resourceType: "document",
        spaceId: "space-1",
      };
      const capability =
        scope === "write"
          ? embedAuth.createMcpDirectoryWidgetWriteCapability({
              appId: "content",
              resourceUri: RESOURCE_URI,
              resourceIds,
              userEmail: OWNER,
              orgId: ORG,
              expiresAtMs: identity.expiresAtMs ?? Date.now() + 60_000,
              readActionArguments: readArguments,
              writeActionArguments: writeArguments,
            })
          : embedAuth.createMcpDirectoryWidgetReadCapability({
              appId: "content",
              resourceUri: RESOURCE_URI,
              resourceIds,
              actionArguments: readArguments,
            });
      expect(capability).toBeDefined();
      mockResolveEmbedSessionFromRequest.mockResolvedValue({
        email: identity.email ?? OWNER,
        orgId: identity.orgId === undefined ? ORG : identity.orgId,
        token: "signed-directory-capability",
        targetPath: `/page/${DOCUMENT_ID}`,
        scope: capability,
      });
    }

    it("runs each share write for the ticketed document as the widget-write caller", async () => {
      await widgetSession("write");
      const { call, run } = await mountShareRoutes();

      for (const name of shareActionNames) {
        const { status, result } = await call(name, shareBodies[name]!);
        expect(status, name).toBe(200);
        expect(result, name).toMatchObject({
          ok: true,
          caller: "mcp-widget-write",
          grantedActions: [
            "set-resource-visibility",
            "share-resource",
            "unshare-resource",
            "update-document",
          ],
        });
      }
      expect(run).toHaveBeenCalledTimes(shareActionNames.length);
      expect(run.mock.calls.map(([args]) => args)).toEqual(
        shareActionNames.map((name) => shareBodies[name]),
      );
    });

    it("rejects share writes for another document, another resource type, or an omitted binding", async () => {
      await widgetSession("write");
      const { call, run } = await mountShareRoutes();

      for (const name of shareActionNames) {
        const body = shareBodies[name]!;
        const { resourceId: _resourceId, ...withoutResourceId } = body;
        const { resourceType: _resourceType, ...withoutResourceType } = body;
        const {
          resourceId: _id,
          resourceType: _type,
          ...withoutResourceBinding
        } = body;
        const attempts: Record<string, Record<string, unknown>> = {
          "another document": { ...body, resourceId: "doc-2" },
          "another resource type": { ...body, resourceType: "form" },
          "omitted resourceId": withoutResourceId,
          "omitted resourceType": withoutResourceType,
          "both omitted": withoutResourceBinding,
          "unlisted argument": { ...body, ownerEmail: "someone@example.com" },
        };
        for (const [label, attempt] of Object.entries(attempts)) {
          const { status, result } = await call(name, attempt);
          expect({ name, label, status }).toEqual({
            name,
            label,
            status: 403,
          });
          expect(result, `${name} ${label}`).toEqual({ error: scopeMismatch });
        }
      }
      expect(run).not.toHaveBeenCalled();
    });

    it("rejects every unlisted action even with a valid write scope", async () => {
      await widgetSession("write");
      const { call, run } = await mountShareRoutes();

      for (const name of unlistedWrites) {
        const { status, result } = await call(name, {
          resourceType: "document",
          resourceId: DOCUMENT_ID,
          id: DOCUMENT_ID,
        });
        expect({ name, status }).toEqual({ name, status: 403 });
        expect(result, name).toEqual({ error: dataRoutesOnly });
      }
      for (const name of unlistedReads) {
        const { status, result } = await call(
          name,
          { resourceType: "document", resourceId: DOCUMENT_ID },
          "GET",
        );
        expect({ name, status }).toEqual({ name, status: 403 });
        expect(result, name).toEqual({ error: dataRoutesOnly });
      }
      expect(run).not.toHaveBeenCalled();
    });

    it("gives a read-only widget capability no share write route", async () => {
      await widgetSession("read");
      const { call, run } = await mountShareRoutes();

      for (const name of [...shareActionNames, "update-document"]) {
        const { status, result } = await call(
          name,
          shareBodies[name] ?? { id: DOCUMENT_ID, title: "Renamed" },
        );
        expect({ name, status }).toEqual({ name, status: 403 });
        expect(result, name).toEqual({ error: dataRoutesOnly });
      }
      expect(run).not.toHaveBeenCalled();

      const shares = await call(
        "list-resource-shares",
        { resourceType: "document", resourceId: DOCUMENT_ID },
        "GET",
      );
      expect(shares.status).toBe(200);
      expect(shares.result).toEqual({
        ok: true,
        caller: "mcp-widget",
        readOnly: true,
      });
      const otherDocument = await call(
        "list-resource-shares",
        { resourceType: "document", resourceId: "doc-2" },
        "GET",
      );
      expect(otherDocument.status).toBe(403);
      expect(run).toHaveBeenCalledTimes(1);
    });

    it("binds share writes to the ticketed user and organization", async () => {
      const { call, run } = await mountShareRoutes();

      for (const identity of [
        { email: "other@example.com" },
        { orgId: "org-2" },
        { orgId: null },
      ]) {
        await widgetSession("write", identity);
        for (const name of shareActionNames) {
          const { status, result } = await call(name, shareBodies[name]!);
          expect({ name, identity, status }).toEqual({
            name,
            identity,
            status: 403,
          });
          expect(result).toEqual({ error: scopeMismatch });
        }
      }
      expect(run).not.toHaveBeenCalled();
    });

    it("expires share writes with the widget grant", async () => {
      const expiresAtMs = Date.now() + 60_000;
      await widgetSession("write", { expiresAtMs });
      const { call, run } = await mountShareRoutes();

      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(expiresAtMs + 1);
        for (const name of shareActionNames) {
          const { event, status, result } = await call(
            name,
            shareBodies[name]!,
          );
          expect({ name, status }).toEqual({ name, status: 401 });
          expect(result).toEqual({ error: "Unauthorized" });
          expect(event._responseHeaders).toMatchObject({
            "x-agent-native-widget-session-expired": "1",
          });
        }
      } finally {
        vi.useRealTimers();
      }
      expect(run).not.toHaveBeenCalled();
    });

    it("keeps the share list read authenticated for anonymous callers", async () => {
      const { mountActionRoutes } = await import("./action-routes.js");
      const mounted: Array<{ path: string; handler: any }> = [];
      const run = vi.fn(async () => ({ shares: [] }));
      mountActionRoutes(
        {
          use: vi.fn((path: string, handler: any) =>
            mounted.push({ path, handler }),
          ),
        },
        {
          "list-resource-shares": {
            http: { method: "GET" },
            readOnly: true,
            requiresAuth: true,
            run,
          } as any,
        },
        {
          appId: "content",
          mcpDirectoryWidgetAppId: "content",
          mcpDirectoryWidgetResourceUri: RESOURCE_URI,
          mcpDirectoryWidgetReadActionArguments: {
            "list-resource-shares": ["resourceType", "resourceId"],
          },
          getOwnerContextFromEvent: async () => ({
            owner:
              "public-00000000-0000-4000-8000-000000000001@agent-native.local",
            anonymous: true,
          }),
          getOwnerFromEvent: async () =>
            "public-00000000-0000-4000-8000-000000000001@agent-native.local",
        },
      );
      const event: any = {
        _method: "GET",
        _headers: { "x-agent-native-frontend": "1" },
        req: {
          url: "http://app.test/_agent-native/actions/list-resource-shares?resourceType=document&resourceId=public-document",
        },
      };

      await expect(mounted[0]!.handler(event)).resolves.toEqual({
        error: "Unauthorized",
      });
      expect(event._status).toBe(401);
      expect(run).not.toHaveBeenCalled();
    });
  });

  it("rechecks workspace app access for authenticated non-widget write calls", async () => {
    vi.resetModules();
    const workspaceAccess = vi.fn(async () => false);
    vi.doMock("../org/workspace-app-access.js", () => ({
      isWorkspaceAppAccessAllowed: workspaceAccess,
      WORKSPACE_APP_ACCESS_UNAVAILABLE: "unavailable",
      WORKSPACE_APP_ACCESS_UNAVAILABLE_MESSAGE:
        "Workspace app access is temporarily unavailable.",
    }));
    vi.doMock("../org/workspace-app-identity.js", () => ({
      resolveWorkspaceAccessAppId: () => "slides",
    }));

    try {
      const { mountActionRoutes } = await import("./action-routes.js");
      const mounted: Array<{ path: string; handler: any }> = [];
      const run = vi.fn(async () => ({ ok: true }));
      mountActionRoutes(
        {
          use: vi.fn((path: string, handler: any) =>
            mounted.push({ path, handler }),
          ),
        },
        {
          "patch-deck": {
            http: { method: "POST" },
            readOnly: false,
            requiresAuth: true,
            run,
          } as any,
        },
        {
          appId: "slides",
          mcpDirectoryWidgetAppId: "slides",
          mcpDirectoryWidgetResourceUri: "ui://slides/shell-v69",
          mcpDirectoryWidgetWriteActionArguments: {
            "patch-deck": ["deckId"],
          },
          actionRouteAuth: {
            resolveCaller: async () => ({
              owner: "reviewer@example.com",
              anonymous: false,
              orgId: "org-1",
            }),
          },
        },
      );

      const event: any = {
        _method: "POST",
        _headers: {
          "x-agent-native-frontend": "1",
          host: "slides.agent-native.test",
          origin: "https://slides.agent-native.test",
        },
        req: {
          url: "https://slides.agent-native.test/_agent-native/actions/patch-deck",
          json: async () => ({ deckId: "deck-1" }),
        },
      };
      const route = mounted.find(
        ({ path }) => path === "/_agent-native/actions/patch-deck",
      );
      const result = await route!.handler(event);

      expect(event._status).toBe(403);
      expect(result).toEqual({
        error: "You do not have access to this workspace app.",
      });
      expect(workspaceAccess).toHaveBeenCalledWith("slides", {
        email: "reviewer@example.com",
        orgId: "org-1",
      });
      expect(run).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("../org/workspace-app-access.js");
      vi.doUnmock("../org/workspace-app-identity.js");
      vi.resetModules();
    }
  });

  describe("workspace app access on directory read routes", () => {
    async function callReadRoute(
      access: "allowed" | "denied" | "unavailable" | "not-configured",
      caller: "session" | "adapter",
    ) {
      vi.resetModules();
      const workspaceAccess = vi.fn(async () =>
        access === "denied"
          ? false
          : access === "unavailable"
            ? "unavailable"
            : true,
      );
      vi.doMock("../org/workspace-app-access.js", () => ({
        isWorkspaceAppAccessAllowed: workspaceAccess,
        WORKSPACE_APP_ACCESS_UNAVAILABLE: "unavailable",
        WORKSPACE_APP_ACCESS_UNAVAILABLE_MESSAGE:
          "Workspace app access is temporarily unavailable.",
      }));
      vi.doMock("../org/workspace-app-identity.js", () => ({
        resolveWorkspaceAccessAppId: () =>
          access === "not-configured" ? "" : "slides",
      }));

      try {
        const { mountActionRoutes } = await import("./action-routes.js");
        const mounted: Array<{ path: string; handler: any }> = [];
        const run = vi.fn(async () => ({ shares: [] }));
        mountActionRoutes(
          {
            use: vi.fn((path: string, handler: any) =>
              mounted.push({ path, handler }),
            ),
          },
          {
            "list-resource-shares": {
              http: { method: "GET" },
              readOnly: false,
              requiresAuth: true,
              run,
            } as any,
          },
          {
            appId: "slides",
            mcpDirectoryWidgetAppId: "slides",
            mcpDirectoryWidgetResourceUri: "ui://slides/shell-v69",
            mcpDirectoryWidgetReadActionArguments: {
              "list-resource-shares": ["resourceType", "resourceId"],
            },
            mcpDirectoryWidgetReadOnlyActions: ["list-resource-shares"],
            resolveOrgId: async () => "org-1",
            ...(caller === "adapter"
              ? {
                  actionRouteAuth: {
                    resolveCaller: async () => ({
                      owner: "reviewer@example.com",
                      anonymous: false,
                      orgId: "org-1",
                    }),
                  },
                }
              : {
                  getOwnerContextFromEvent: async () => ({
                    owner: "reviewer@example.com",
                    anonymous: false,
                  }),
                }),
          },
        );

        const event: any = {
          _method: "GET",
          _headers: {
            "x-agent-native-frontend": "1",
            host: "slides.agent-native.test",
          },
          _query: { resourceType: "deck", resourceId: "deck-1" },
          req: {
            url: "https://slides.agent-native.test/_agent-native/actions/list-resource-shares?resourceType=deck&resourceId=deck-1",
          },
        };
        const route = mounted.find(
          ({ path }) => path === "/_agent-native/actions/list-resource-shares",
        );
        const result = await route!.handler(event);
        return { event, result, run, workspaceAccess };
      } finally {
        vi.doUnmock("../org/workspace-app-access.js");
        vi.doUnmock("../org/workspace-app-identity.js");
        vi.resetModules();
      }
    }

    it.each(["session", "adapter"] as const)(
      "rejects a %s caller denied access to the workspace app before reading",
      async (caller) => {
        const { event, result, run, workspaceAccess } = await callReadRoute(
          "denied",
          caller,
        );

        expect(event._status).toBe(403);
        expect(result).toEqual({
          error: "You do not have access to this workspace app.",
        });
        expect(workspaceAccess).toHaveBeenCalledWith("slides", {
          email: "reviewer@example.com",
          orgId: "org-1",
        });
        expect(run).not.toHaveBeenCalled();
      },
    );

    it("answers 503 while workspace app access cannot be checked", async () => {
      const { event, result, run } = await callReadRoute(
        "unavailable",
        "session",
      );

      expect(event._status).toBe(503);
      expect(result).toEqual({
        error: "Workspace app access is temporarily unavailable.",
      });
      expect(run).not.toHaveBeenCalled();
    });

    it.each(["allowed", "not-configured"] as const)(
      "runs the read when workspace app access is %s",
      async (access) => {
        const { event, result, run } = await callReadRoute(access, "session");

        expect(event._status).toBeUndefined();
        expect(result).toEqual({ shares: [] });
        expect(run).toHaveBeenCalledOnce();
      },
    );
  });

  it("allows the Design create-file route when workspace app access is not configured", async () => {
    vi.resetModules();
    const workspaceAccess = vi.fn(async () => false);
    vi.doMock("../org/workspace-app-access.js", () => ({
      isWorkspaceAppAccessAllowed: workspaceAccess,
      WORKSPACE_APP_ACCESS_UNAVAILABLE: "unavailable",
      WORKSPACE_APP_ACCESS_UNAVAILABLE_MESSAGE:
        "Workspace app access is temporarily unavailable.",
    }));
    vi.doMock("../org/workspace-app-identity.js", () => ({
      resolveWorkspaceAccessAppId: () => "",
    }));

    try {
      const { mountActionRoutes } = await import("./action-routes.js");
      const mounted: Array<{ path: string; handler: any }> = [];
      const run = vi.fn(async () => ({ id: "file-1", designId: "design-1" }));
      mountActionRoutes(
        {
          use: vi.fn((path: string, handler: any) =>
            mounted.push({ path, handler }),
          ),
        },
        {
          "create-file": {
            http: { method: "POST" },
            readOnly: false,
            requiresAuth: true,
            run,
          } as any,
        },
        {
          appId: "design",
          mcpDirectoryWidgetAppId: "design",
          mcpDirectoryWidgetResourceUri: "ui://design/shell-v69",
          mcpDirectoryWidgetWriteActionArguments: {
            "create-file": ["designId"],
          },
          actionRouteAuth: {
            resolveCaller: async () => ({
              owner: "reviewer@example.com",
              anonymous: false,
              orgId: null,
            }),
          },
        },
      );

      const event: any = {
        _method: "POST",
        _headers: {
          "x-agent-native-frontend": "1",
          host: "design.agent-native.test",
          origin: "https://design.agent-native.test",
        },
        req: {
          url: "https://design.agent-native.test/_agent-native/actions/create-file",
          json: async () => ({
            designId: "design-1",
            filename: "screen.html",
            content: "<main>Screen</main>",
          }),
        },
      };
      const route = mounted.find(
        ({ path }) => path === "/_agent-native/actions/create-file",
      );
      const result = await route!.handler(event);

      expect(event._status ?? 200).toBe(200);
      expect(result).toEqual({ id: "file-1", designId: "design-1" });
      expect(run).toHaveBeenCalledOnce();
      expect(workspaceAccess).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("../org/workspace-app-access.js");
      vi.doUnmock("../org/workspace-app-identity.js");
      vi.resetModules();
    }
  });

  it("returns 401 only for an expired widget write grant bound to this caller", async () => {
    const { createMcpDirectoryWidgetWriteCapability } =
      await import("../shared/embed-auth.js");
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const run = vi.fn(async () => ({ ok: true }));
    const expiresAtMs = Date.now() + 60_000;
    const capability = createMcpDirectoryWidgetWriteCapability({
      appId: "content",
      resourceUri: "ui://content/shell-v69",
      resourceIds: { documentId: "doc-1" },
      userEmail: "ticket-owner@example.com",
      orgId: "org-1",
      expiresAtMs,
      readActionArguments: { "get-document": { id: "doc-1" } },
      writeActionArguments: {
        "update-document": {
          id: "doc-1",
          content: { type: "actionSchema" },
        },
      },
    })!;
    mockResolveEmbedSessionFromRequest.mockResolvedValue({
      email: "ticket-owner@example.com",
      orgId: "org-1",
      token: "signed-directory-capability",
      targetPath: "/page/doc-1",
      scope: capability,
    });
    mountActionRoutes(
      {
        use: vi.fn((path: string, handler: any) =>
          mounted.push({ path, handler }),
        ),
      },
      {
        "update-document": {
          http: { method: "POST" },
          readOnly: false,
          requiresAuth: true,
          run,
        } as any,
      },
      {
        appId: "content",
        mcpDirectoryWidgetAppId: "content",
        mcpDirectoryWidgetResourceUri: "ui://content/shell-v69",
        mcpDirectoryWidgetWriteActionArguments: {
          "update-document": ["id", "content"],
        },
      },
    );

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(expiresAtMs + 1);
      const request = () => ({
        _method: "POST",
        _headers: { "x-agent-native-frontend": "1" },
        req: {
          url: "http://app.test/_agent-native/actions/update-document",
          json: async () => ({ id: "doc-1", content: "Updated" }),
        },
      });
      const expiredOwnerRequest = request();
      await expect(mounted[0]!.handler(expiredOwnerRequest)).resolves.toEqual({
        error: "Unauthorized",
      });
      expect(expiredOwnerRequest._status).toBe(401);
      expect(expiredOwnerRequest._responseHeaders).toMatchObject({
        "x-agent-native-widget-session-expired": "1",
      });

      mockResolveEmbedSessionFromRequest.mockResolvedValue({
        email: "other@example.com",
        orgId: "org-1",
        token: "signed-directory-capability",
        targetPath: "/page/doc-1",
        scope: capability,
      });
      const otherUserRequest = request();
      await expect(mounted[0]!.handler(otherUserRequest)).resolves.toEqual({
        error:
          "This widget write capability is scoped to a different user, app resource, or action.",
      });
      expect(otherUserRequest._status).toBe(403);
      expect(run).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs the Slides share actions as mcp-widget-write for the granted deck only, without needsApproval", async () => {
    const { createMcpDirectoryWidgetWriteCapability } =
      await import("../shared/embed-auth.js");
    const { mountActionRoutes } = await import("./action-routes.js");
    const { CHATGPT_DIRECTORY_PROFILE: profile } =
      await import("../../../../templates/slides/server/lib/chatgpt-directory-tools.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const run = vi.fn(async () => ({ ok: true }));
    const needsApproval = vi.fn(async () => true);
    const shareModules = {
      "list-resource-shares":
        await import("../sharing/actions/list-resource-shares.js"),
      "share-resource": await import("../sharing/actions/share-resource.js"),
      "unshare-resource":
        await import("../sharing/actions/unshare-resource.js"),
      "set-resource-visibility":
        await import("../sharing/actions/set-resource-visibility.js"),
    };
    const shareActions = Object.fromEntries(
      Object.entries(shareModules).map(([name, { default: action }]) => [
        name,
        { ...action, run, needsApproval },
      ]),
    );
    // Mirrors the mcpDirectoryWidget*ActionArguments agent-chat-plugin derives
    // from the profile for actions present in the HTTP registry.
    const writeRules = profile.widgetWriteActionArguments as Record<
      string,
      Record<string, any>
    >;
    const readRules = profile.widgetReadActionArguments as Record<
      string,
      Record<string, any>
    >;
    const schemaArguments = (rules: Record<string, any>) =>
      Object.entries(rules)
        .filter(([, rule]) => typeof rule !== "string")
        .map(([argumentName]) => argumentName);
    const writeNames = [
      "share-resource",
      "unshare-resource",
      "set-resource-visibility",
    ];
    const target = profile.widgetTargets["create-deck"]({}, { id: "deck-a" })!;
    const materialize = (rules: Record<string, any>) =>
      Object.fromEntries(
        Object.entries(rules).map(([argumentName, rule]) => [
          argumentName,
          typeof rule === "string" ? target.resourceIds[rule] : rule,
        ]),
      );
    const capability = createMcpDirectoryWidgetWriteCapability({
      appId: "slides",
      resourceUri: "ui://slides/shell-v69",
      resourceIds: target.resourceIds,
      userEmail: "editor@example.com",
      orgId: "org-1",
      expiresAtMs: Date.now() + 60_000,
      readActionArguments: {
        "list-resource-shares": materialize(readRules["list-resource-shares"]!),
      },
      writeActionArguments: Object.fromEntries(
        writeNames.map((name) => [name, materialize(writeRules[name]!)]),
      ),
    })!;
    mockResolveEmbedSessionFromRequest.mockResolvedValue({
      email: "editor@example.com",
      orgId: "org-1",
      token: "signed-directory-capability",
      targetPath: "/deck/deck-a",
      scope: capability,
    });
    mountActionRoutes(
      {
        use: vi.fn((path: string, handler: any) =>
          mounted.push({ path, handler }),
        ),
      },
      {
        ...shareActions,
        "delete-deck": {
          http: { method: "POST" },
          readOnly: false,
          requiresAuth: true,
          run,
        } as any,
        "create-agent-resource-link": {
          http: { method: "POST" },
          readOnly: false,
          requiresAuth: true,
          run,
        } as any,
      },
      {
        appId: "slides",
        mcpDirectoryWidgetAppId: "slides",
        mcpDirectoryWidgetResourceUri: "ui://slides/shell-v69",
        mcpDirectoryWidgetReadActionArguments: {
          "list-resource-shares": Object.keys(
            readRules["list-resource-shares"]!,
          ),
        },
        mcpDirectoryWidgetWriteActionArguments: Object.fromEntries(
          writeNames.map((name) => [name, Object.keys(writeRules[name]!)]),
        ),
        mcpDirectoryWidgetWriteActionSchemaArguments: Object.fromEntries(
          writeNames.map((name) => [name, schemaArguments(writeRules[name]!)]),
        ),
        getOwnerFromEvent: async () => {
          throw Object.assign(new Error("Unauthenticated"), {
            statusCode: 401,
          });
        },
      },
    );
    const post = async (name: string, body: Record<string, unknown>) => {
      const event: any = {
        _method: "POST",
        _headers: { "x-agent-native-frontend": "1" },
        req: {
          url: `http://app.test/_agent-native/actions/${name}`,
          json: async () => body,
        },
      };
      const route = mounted.find(
        ({ path }) => path === `/_agent-native/actions/${name}`,
      );
      const result = await route!.handler(event);
      return { status: event._status ?? 200, result };
    };
    const shareBody = {
      resourceType: "deck",
      resourceId: "deck-a",
      principalType: "user",
      principalId: "teammate@example.com",
      role: "viewer",
      notify: false,
    };

    await expect(post("share-resource", shareBody)).resolves.toEqual({
      status: 200,
      result: { ok: true },
    });
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(
      shareBody,
      expect.objectContaining({
        caller: "mcp-widget-write",
        userEmail: "editor@example.com",
        orgId: "org-1",
        mcpDirectoryWidgetResourceIds: {
          deckId: "deck-a",
          resourceType: "deck",
        },
        mcpDirectoryWidgetWrite: {
          appId: "slides",
          resourceIds: { deckId: "deck-a", resourceType: "deck" },
          actionNames: [
            "set-resource-visibility",
            "share-resource",
            "unshare-resource",
          ],
        },
      }),
    );
    expect(needsApproval).not.toHaveBeenCalled();

    run.mockClear();
    const unshareBody = {
      resourceType: "deck",
      resourceId: "deck-a",
      principalType: "user",
      principalId: "teammate@example.com",
    };
    const visibilityBody = {
      resourceType: "deck",
      resourceId: "deck-a",
      visibility: "public",
    };
    await expect(post("unshare-resource", unshareBody)).resolves.toMatchObject({
      status: 200,
    });
    await expect(
      post("set-resource-visibility", visibilityBody),
    ).resolves.toMatchObject({ status: 200 });
    expect(run).toHaveBeenCalledTimes(2);
    expect(needsApproval).not.toHaveBeenCalled();

    run.mockClear();
    const denied = [
      ["share-resource", { ...shareBody, resourceId: "deck-b" }],
      ["share-resource", { ...shareBody, resourceType: "document" }],
      ["share-resource", { ...shareBody, ownerEmail: "me@example.com" }],
      ["unshare-resource", { ...unshareBody, resourceId: "deck-b" }],
      ["unshare-resource", { ...unshareBody, resourceType: "document" }],
      ["set-resource-visibility", { ...visibilityBody, resourceId: "deck-b" }],
      ["set-resource-visibility", { ...visibilityBody, resourceType: "form" }],
      ["set-resource-visibility", { ...visibilityBody, extra: true }],
      ["delete-deck", { id: "deck-a", deckId: "deck-a" }],
      [
        "create-agent-resource-link",
        { resourceType: "deck", resourceId: "deck-a" },
      ],
    ] as const;
    for (const [name, body] of denied) {
      const { status } = await post(name, body);
      expect([name, body, status]).toEqual([name, body, 403]);
    }
    expect(run).not.toHaveBeenCalled();
    expect(needsApproval).not.toHaveBeenCalled();

    const read = async (resourceId: string) => {
      const event: any = {
        _method: "GET",
        _headers: { "x-agent-native-frontend": "1" },
        _query: { resourceType: "deck", resourceId },
        req: {
          url: `http://app.test/_agent-native/actions/list-resource-shares?resourceType=deck&resourceId=${resourceId}`,
        },
      };
      const route = mounted.find(
        ({ path }) => path === "/_agent-native/actions/list-resource-shares",
      );
      const result = await route!.handler(event);
      return { status: event._status ?? 200, result };
    };
    await expect(read("deck-a")).resolves.toEqual({
      status: 200,
      result: { ok: true },
    });
    expect(run).toHaveBeenLastCalledWith(
      { resourceType: "deck", resourceId: "deck-a" },
      expect.objectContaining({
        caller: "mcp-widget",
        mcpDirectoryWidgetResourceIds: {
          deckId: "deck-a",
          resourceType: "deck",
        },
      }),
    );
    run.mockClear();
    await expect(read("deck-b")).resolves.toMatchObject({ status: 403 });
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a capability request for a different design", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const run = vi.fn(async () => ({ ok: true }));
    mockResolveEmbedSessionFromRequest
      .mockResolvedValueOnce({
        email: "ticket-owner@example.com",
        token: "signed-capability",
        targetPath: "/visual-edit/design_1",
        scope: "capability:visual-edit:design:design_1",
      })
      .mockResolvedValueOnce({
        email: "ticket-owner@example.com",
        token: "signed-capability",
        targetPath: "/visual-edit/design%2F1",
        scope: "capability:visual-edit:design:design%2F1",
      });
    const unauthenticated = Object.assign(new Error("Unauthenticated"), {
      statusCode: 401,
    });

    mountActionRoutes(
      {
        use: vi.fn((path: string, handler: any) =>
          mounted.push({ path, handler }),
        ),
      },
      {
        "list-files": {
          http: { method: "GET" },
          requiresAuth: true,
          capabilityScopes: ["visual-edit"],
          run,
        } as any,
      },
      {
        getOwnerFromEvent: async () => {
          throw unauthenticated;
        },
      },
    );

    await expect(
      mounted[0]!.handler({
        _method: "GET",
        _headers: { "x-agent-native-frontend": "1" },
        req: {
          url: "http://app.test/_agent-native/actions/list-files?designId=design_2",
        },
      }),
    ).resolves.toEqual({ error: "Unauthorized" });
    expect(run).not.toHaveBeenCalled();

    await expect(
      mounted[0]!.handler({
        _method: "GET",
        _headers: { "x-agent-native-frontend": "1" },
        req: {
          url: "http://app.test/_agent-native/actions/list-files?designId=design%2F1",
        },
      }),
    ).resolves.toEqual({ ok: true });
    expect(run).toHaveBeenCalledOnce();
  });

  it("registers only capability-scoped action routes with the auth guard", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const nitroApp = { use: vi.fn() };
    mockRegisterAuthPublicPaths.mockClear();

    mountActionRoutes(nitroApp, {
      "read-capability": {
        http: { method: "GET" },
        capabilityScopes: ["visual-edit"],
        run: vi.fn(),
      } as any,
      "private-action": {
        http: { method: "GET" },
        run: vi.fn(),
      } as any,
    });

    expect(mockRegisterAuthPublicPaths).toHaveBeenCalledWith(
      ["/_agent-native/actions/read-capability"],
      nitroApp,
    );
    expect(mockRegisterAuthPublicPaths).not.toHaveBeenCalledWith(
      ["/_agent-native/actions/private-action"],
      nitroApp,
    );
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

  it.each([
    {
      source: "Web Request URL",
      event: {
        req: {
          url: "http://app.test/_agent-native/actions/list-things?q=hello&__an_embed_token=embed-test-token&__an_embed_target=%2Fdesign%2F1",
        },
      },
    },
    {
      source: "parsed H3 query object",
      event: {
        req: {},
        _query: {
          q: "hello",
          "__an_embed_token[]": ["embed-test-token"],
          "__an_embed_target[]": ["/design/1"],
        },
      },
    },
  ])(
    "does not pass embed auth query parameters from $source to GET actions",
    async ({ event }) => {
      const { mountActionRoutes } = await import("./action-routes.js");
      const mounted: Array<{ path: string; handler: any }> = [];
      const nitroApp = {
        use: vi.fn((path: string, handler: any) =>
          mounted.push({ path, handler }),
        ),
      };
      const run = vi.fn(async (params) => ({ ok: true, params }));
      const actions: Record<string, ActionEntry> = {
        "list-things": {
          http: { method: "GET" },
          readOnly: true,
          run,
        } as any,
      };

      mountActionRoutes(nitroApp, actions);

      const result = await mounted[0].handler({ _method: "GET", ...event });

      expect(result).toEqual({ ok: true, params: { q: "hello" } });
      expect(run).toHaveBeenCalledWith(
        { q: "hello" },
        {
          userEmail: undefined,
          orgId: null,
          caller: "http",
          actionName: "list-things",
        },
      );
    },
  );

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

  it("passes the client disconnect signal into the action run context", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    let received: any;
    const signal = new AbortController().signal;
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
      req: { json: async () => ({}), signal },
    });

    expect(received.signal).toBe(signal);
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
        tableQuery: z
          .object({
            filters: z.array(
              z.object({
                propertyId: z.string(),
                operator: z.string(),
                value: z.string(),
              }),
            ),
            sorts: z.array(
              z.object({
                propertyId: z.string(),
                direction: z.enum(["asc", "desc"]),
              }),
            ),
          })
          .optional(),
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
        url: `http://app.test/_agent-native/actions/instrument-overview?${new URLSearchParams(
          {
            portfolioId: "p1",
            isin: "US67066G1040",
            includeSeries: "true",
            limit: "5",
            tableQuery: JSON.stringify({
              filters: [
                {
                  propertyId: "status",
                  operator: "equals",
                  value: "published",
                },
              ],
              sorts: [{ propertyId: "date", direction: "desc" }],
            }),
          },
        )}`,
      },
    });

    expect(result).toEqual({
      params: {
        portfolioId: "p1",
        isin: "US67066G1040",
        includeSeries: true,
        limit: 5,
        tableQuery: {
          filters: [
            {
              propertyId: "status",
              operator: "equals",
              value: "published",
            },
          ],
          sorts: [{ propertyId: "date", direction: "desc" }],
        },
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
      _headers: {
        origin: "https://evil.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,x-content-save-origin",
      },
    };
    const result = await mounted[0].handler(event);

    expect(result).toBe("");
    expect(event._status).toBe(403);
    expect(getOwnerFromEvent).not.toHaveBeenCalled();
    expect(actions.mutate.run).not.toHaveBeenCalled();
  });

  it("allows recovery telemetry headers on credentialed action preflights", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const getOwnerFromEvent = vi.fn(async () => "owner@example.com");
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      mutate: { run: vi.fn(async () => ({ ok: true })) } as any,
    };

    mountActionRoutes(nitroApp, actions, { getOwnerFromEvent });

    const event = {
      _method: "OPTIONS",
      _headers: {
        origin: "tauri://localhost",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,x-content-save-origin",
      },
    };
    const result = await mounted[0].handler(event);

    expect(result).toBe("");
    expect(event._status).toBe(204);
    expect(event._responseHeaders["access-control-allow-origin"]).toBe(
      "tauri://localhost",
    );
    expect(event._responseHeaders["access-control-allow-credentials"]).toBe(
      "true",
    );
    expect(
      event._responseHeaders["access-control-allow-headers"]
        .toLowerCase()
        .split(","),
    ).toContain("x-content-save-origin");
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
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,x-content-save-origin",
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
    expect(allowHeaders).toContain("x-request-source");
    expect(allowHeaders).toContain("x-user-timezone");
    expect(allowHeaders).toContain("x-agent-native-session-id");
    expect(allowHeaders.split(",")).toContain("x-content-save-origin");
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
      _headers: { "x-request-source": "browser-tab-1" },
      req: { url: "http://app.test/_agent-native/actions/mutating-read" },
    });

    expect(mockNotifyActionChange).toHaveBeenCalledWith({
      actionName: "mutating-read",
      requestSource: "browser-tab-1",
    });
  });

  it("scopes a mutating call's change event to the resource it declares", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      "update-doc": {
        http: { method: "GET" },
        readOnly: false,
        changeResource: (
          _input: { id: string },
          result: { documentId: string },
        ) => ({
          resourceType: "document",
          resourceId: result.documentId,
        }),
        run: vi.fn(async () => ({ ok: true, documentId: "doc-1" })),
      } as any,
    };

    mountActionRoutes(nitroApp, actions);

    await mounted[0].handler({
      _method: "GET",
      _headers: {},
      req: { url: "http://app.test/_agent-native/actions/update-doc?id=doc-1" },
    });

    expect(mockNotifyActionChange).toHaveBeenCalledWith({
      actionName: "update-doc",
      resourceType: "document",
      resourceId: "doc-1",
    });
  });

  it("publishes change events only for calls that mutate and have not opted out", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      "poll-engine": {
        planMode: {
          effect: (args: { action?: string }) =>
            args.action === "list" ? "read" : "write",
        },
        run: vi.fn(async () => ({ ok: true })),
      } as any,
      "save-position": {
        changeEvents: false,
        run: vi.fn(async () => ({ ok: true })),
      } as any,
      "undeclared-write": { run: vi.fn(async () => ({ ok: true })) } as any,
    };
    mountActionRoutes(nitroApp, actions);
    const call = (name: string, body: Record<string, unknown>) => {
      const mount = mounted.find((entry) => entry.path.endsWith(`/${name}`))!;
      return mount.handler({
        _method: "POST",
        _headers: {},
        req: {
          url: `http://app.test/_agent-native/actions/${name}`,
          json: async () => body,
        },
      });
    };

    await call("poll-engine", { action: "list" });
    await call("save-position", { ms: 1 });
    expect(mockNotifyActionChange).not.toHaveBeenCalled();

    await call("poll-engine", { action: "set" });
    await call("undeclared-write", {});
    expect(
      mockNotifyActionChange.mock.calls.map(([arg]) => arg.actionName),
    ).toEqual(["poll-engine", "undeclared-write"]);
  });

  it("refuses extension tools-bridge calls to provider-api-request", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      "provider-api-request": {
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
      error: "Action 'provider-api-request' is not callable from tools.",
    });
    expect(actions["provider-api-request"].run).not.toHaveBeenCalled();
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
      req: {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"ok":true}'));
            controller.close();
          },
        }),
      },
    };
    const result = await mounted[0].handler(event);

    expect(result).toEqual({ ok: true });
    expect(actions["validate-local-plan-source"].run).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized streamed bodies when Content-Length is absent", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      "validate-local-plan-source": {
        maxBodyBytes: 16,
        requiresAuth: false,
        run: vi.fn(async () => ({ ok: true })),
      } as any,
    };

    mountActionRoutes(nitroApp, actions);

    const event = {
      _method: "POST",
      _headers: {},
      req: {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('{"value":"too long"}'),
            );
            controller.close();
          },
        }),
      },
    };
    const result = await mounted[0].handler(event);

    expect(event._status).toBe(413);
    expect(result).toEqual({
      error: "Request body too large (max 16 bytes)",
    });
    expect(actions["validate-local-plan-source"].run).not.toHaveBeenCalled();
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

    const event = {
      _method: "POST",
      _headers: {},
      req: { json: async () => ({}) },
    };
    const result = await mounted[0].handler(event);

    expect(result).toEqual({ ok: true });
    expect(actions["share-resource"].run).toHaveBeenCalledTimes(1);
  });

  it("accepts built-in feature flag delegation without template adapter", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    mockVerifyA2ATokenWithClaims.mockResolvedValue({
      email: "admin@example.com",
      orgId: "org-1",
      orgDomain: "builder.io",
      jti: "request-1",
      issuer: "https://analytics.example",
      scope: ["flags:read"],
    });
    const mounted: Array<{ path: string; handler: any }> = [];
    const getOwnerFromEvent = vi.fn(async () => "cookie@example.com");
    let context: any;
    mountActionRoutes(
      { use: (path: string, handler: any) => mounted.push({ path, handler }) },
      {
        "list-feature-flags": {
          run: async (_: unknown, ctx: any) => {
            context = ctx;
            return { ok: true };
          },
        } as any,
      },
      { getOwnerFromEvent },
    );
    const token = fakeUnsignedJwt({
      org_id: "org-1",
      jti: "request-1",
      scope: "flags:read",
    });
    await mounted[0].handler({
      _method: "POST",
      _headers: { authorization: `Bearer ${token}` },
      context: {},
      req: { json: async () => ({}) },
    });
    expect(context).toMatchObject({
      caller: "a2a",
      userEmail: "admin@example.com",
      orgId: "org-1",
      networkProtocol: "a2a",
      networkId: "request-1",
      networkPeer: "https://analytics.example",
    });
    expect(getOwnerFromEvent).not.toHaveBeenCalled();
    expect(mockResolveOrgByDomain).not.toHaveBeenCalled();
  });

  it("recognizes a scope-only delegation in a space-separated scope claim", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    mockVerifyA2ATokenWithClaims.mockResolvedValue({
      email: "admin@example.com",
      orgId: "org-1",
      orgDomain: "builder.io",
      jti: "request-scope-only",
      scope: ["other:read", "flags:read"],
    });
    const mounted: Array<{ path: string; handler: any }> = [];
    const getOwnerFromEvent = vi.fn(async () => "cookie@example.com");
    let context: any;
    mountActionRoutes(
      { use: (path: string, handler: any) => mounted.push({ path, handler }) },
      {
        "list-feature-flags": {
          run: async (_: unknown, ctx: any) => {
            context = ctx;
            return { ok: true };
          },
        } as any,
      },
      { getOwnerFromEvent },
    );
    const token = fakeUnsignedJwt({ scope: "other:read flags:read" });

    await mounted[0].handler({
      _method: "POST",
      _headers: { authorization: `Bearer ${token}` },
      context: {},
      req: { json: async () => ({}) },
    });

    expect(context).toMatchObject({
      caller: "a2a",
      userEmail: "admin@example.com",
      orgId: "org-1",
    });
    expect(mockVerifyA2ATokenWithClaims).toHaveBeenCalledOnce();
    expect(getOwnerFromEvent).not.toHaveBeenCalled();
    expect(mockResolveOrgByDomain).not.toHaveBeenCalled();
  });

  it("leaves ordinary bearer auth to legacy owner resolution", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const getOwnerFromEvent = vi.fn(async () => "legacy@example.com");
    let context: any;
    mountActionRoutes(
      { use: (path: string, handler: any) => mounted.push({ path, handler }) },
      {
        "list-feature-flags": {
          run: async (_: unknown, ctx: any) => {
            context = ctx;
            return { ok: true };
          },
        } as any,
      },
      { getOwnerFromEvent },
    );
    await mounted[0].handler({
      _method: "POST",
      _headers: { authorization: "Bearer opaque-legacy-token" },
      context: {},
      req: { json: async () => ({}) },
    });
    expect(context).toMatchObject({
      caller: "http",
      userEmail: "legacy@example.com",
    });
    expect(context.networkProtocol).toBeUndefined();
    expect(context.networkId).toBeUndefined();
    expect(context.networkPeer).toBeUndefined();
    expect(mockVerifyA2ATokenWithClaims).not.toHaveBeenCalled();
  });

  it("leaves ordinary JWTs with common identity claims to legacy auth", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const getOwnerFromEvent = vi.fn(async () => "session@example.com");
    let context: any;
    mountActionRoutes(
      { use: (path: string, handler: any) => mounted.push({ path, handler }) },
      {
        "list-feature-flags": {
          run: async (_: unknown, ctx: any) => {
            context = ctx;
            return { ok: true };
          },
        } as any,
      },
      { getOwnerFromEvent },
    );
    const token = fakeUnsignedJwt({
      org_id: "org-1",
      jti: "ordinary-session-token",
      scope: "openid profile",
    });

    await mounted[0].handler({
      _method: "POST",
      _headers: { authorization: `Bearer ${token}` },
      context: {},
      req: { json: async () => ({}) },
    });

    expect(context).toMatchObject({
      caller: "http",
      userEmail: "session@example.com",
    });
    expect(mockVerifyA2ATokenWithClaims).not.toHaveBeenCalled();
  });

  it("falls back to built-in delegation after a custom adapter returns null", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    mockVerifyA2ATokenWithClaims.mockResolvedValue({
      email: "writer@example.com",
      orgId: "org-2",
      orgDomain: "builder.io",
      jti: "request-2",
      scope: ["flags:write"],
    });
    const mounted: Array<{ path: string; handler: any }> = [];
    let context: any;
    mountActionRoutes(
      { use: (path: string, handler: any) => mounted.push({ path, handler }) },
      {
        "set-feature-flag": {
          run: async (_: unknown, ctx: any) => {
            context = ctx;
            return { ok: true };
          },
        } as any,
      },
      { actionRouteAuth: { resolveCaller: async () => null } },
    );
    const token = fakeUnsignedJwt({
      org_id: "org-2",
      jti: "request-2",
      scope: "flags:write",
    });
    await mounted[0].handler({
      _method: "POST",
      _headers: { authorization: `Bearer ${token}` },
      context: {},
      req: { json: async () => ({}) },
    });
    expect(context).toMatchObject({
      caller: "a2a",
      userEmail: "writer@example.com",
      orgId: "org-2",
    });
    expect(mockConsumeOneTimeJti).toHaveBeenCalledWith("request-2");
  });

  it("rejects a replayed built-in feature flag mutation", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    mockVerifyA2ATokenWithClaims.mockResolvedValue({
      email: "writer@example.com",
      orgId: "org-2",
      orgDomain: "builder.io",
      jti: "replayed-request",
      scope: ["flags:write"],
    });
    mockConsumeOneTimeJti.mockResolvedValue(true);
    const mounted: Array<{ path: string; handler: any }> = [];
    const run = vi.fn(async () => ({ ok: true }));
    mountActionRoutes(
      { use: (path: string, handler: any) => mounted.push({ path, handler }) },
      { "set-feature-flag": { run } as any },
    );
    const token = fakeUnsignedJwt({
      org_id: "org-2",
      jti: "replayed-request",
      scope: "flags:write",
    });

    await expect(
      mounted[0].handler({
        _method: "POST",
        _headers: { authorization: `Bearer ${token}` },
        context: {},
        req: { json: async () => ({}) },
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(run).not.toHaveBeenCalled();
  });

  it("hard-rejects an invalid declared feature flag delegation", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    mockVerifyA2ATokenWithClaims.mockResolvedValue(null);
    const mounted: Array<{ path: string; handler: any }> = [];
    const getOwnerFromEvent = vi.fn(async () => "cookie@example.com");
    mountActionRoutes(
      { use: (path: string, handler: any) => mounted.push({ path, handler }) },
      {
        "list-feature-flags": { run: async () => ({ ok: true }) } as any,
      },
      { getOwnerFromEvent },
    );
    const token = fakeUnsignedJwt({
      org_id: "org-1",
      jti: "request-3",
      scope: "flags:read",
    });
    await expect(
      mounted[0].handler({
        _method: "POST",
        _headers: { authorization: `Bearer ${token}` },
        context: {},
        req: { json: async () => ({}) },
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(getOwnerFromEvent).not.toHaveBeenCalled();
  });

  it("preserves unavailable org identity lookup as a 503", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    mockVerifyA2ATokenWithClaims.mockRejectedValue(
      new A2AIdentityVerificationUnavailableError(new Error("database down")),
    );
    const mounted: Array<{ path: string; handler: any }> = [];
    mountActionRoutes(
      { use: (path: string, handler: any) => mounted.push({ path, handler }) },
      { "list-feature-flags": { run: vi.fn() } as any },
    );
    const token = fakeUnsignedJwt({
      org_id: "org-1",
      jti: "request-lookup-failed",
      scope: "flags:read",
    });

    await expect(
      mounted[0].handler({
        _method: "POST",
        _headers: { authorization: `Bearer ${token}` },
        context: {},
        req: { json: async () => ({}) },
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: "Identity verification temporarily unavailable",
    });
  });

  it("keeps verified org scope when the current domain lookup is unavailable", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    mockVerifyA2ATokenWithClaims.mockResolvedValue({
      email: "admin@example.com",
      orgId: "sender-org",
      orgDomain: "outside.example",
      jti: "request-unknown-domain",
      scope: ["flags:read"],
    });
    mockResolveOrgByDomain.mockResolvedValue(null);
    const mounted: Array<{ path: string; handler: any }> = [];
    let context: any;
    mountActionRoutes(
      { use: (path: string, handler: any) => mounted.push({ path, handler }) },
      {
        "list-feature-flags": {
          run: async (_: unknown, ctx: any) => {
            context = ctx;
            return { ok: true };
          },
        } as any,
      },
    );

    await mounted[0].handler({
      _method: "POST",
      _headers: {
        authorization: `Bearer ${fakeUnsignedJwt({ scope: "flags:read" })}`,
      },
      context: {},
      req: { json: async () => ({}) },
    });
    expect(mockResolveOrgByDomain).not.toHaveBeenCalled();
    expect(context).toMatchObject({
      caller: "a2a",
      userEmail: "admin@example.com",
      orgId: "sender-org",
    });
  });

  it("allows allowlisted no-org list and set delegations without active-org fallback", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    process.env.AGENT_NATIVE_FEATURE_FLAG_ADMIN_EMAILS = "admin@example.com";
    mockResolveOrgByDomain.mockResolvedValue(null);
    mockResolveOrgIdForEmail.mockResolvedValue("unrelated-active-org");

    for (const [actionName, scope] of [
      ["list-feature-flags", "flags:read"],
      ["set-feature-flag", "flags:write"],
    ] as const) {
      mockVerifyA2ATokenWithClaims.mockResolvedValue({
        email: "ADMIN@example.com",
        orgId: null,
        orgDomain: "outside.example",
        jti: `${actionName}-no-org`,
        issuer: "https://analytics.example",
        scope: [scope],
      });
      const mounted: Array<{ path: string; handler: any }> = [];
      let context: any;
      mountActionRoutes(
        {
          use: (path: string, handler: any) => mounted.push({ path, handler }),
        },
        {
          [actionName]: {
            run: async (_params: unknown, ctx: any) => {
              context = ctx;
              return { ok: true };
            },
          },
        } as any,
      );

      await mounted[0].handler({
        _method: "POST",
        _headers: {
          authorization: `Bearer ${fakeUnsignedJwt({ scope })}`,
        },
        context: {},
        req: { json: async () => ({}) },
      });

      expect(context).toMatchObject({
        caller: "a2a",
        userEmail: "ADMIN@example.com",
        orgId: null,
      });
    }

    expect(mockResolveOrgIdForEmail).not.toHaveBeenCalled();
  });

  it("runs the action scoped to actionRouteAuth.resolveCaller and skips getOwnerFromEvent", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const { AGENT_RUN_OWNER_CONTEXT_KEY } =
      await import("./agent-run-context.js");
    const { getRequestUserEmail, getRequestUserName } =
      await import("./request-context.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const getOwnerFromEvent = vi.fn(async () => "session-user@example.com");
    let received: any;
    const actions: Record<string, ActionEntry> = {
      "do-thing": {
        run: vi.fn(async (_params, ctx) => {
          received = {
            ctx,
            requestUserEmail: getRequestUserEmail(),
            requestUserName: getRequestUserName(),
          };
          return { ok: true };
        }),
      } as any,
    };

    mountActionRoutes(nitroApp, actions, {
      getOwnerFromEvent,
      actionRouteAuth: {
        resolveCaller: async () => ({
          owner: "a2a-caller@example.com",
          anonymous: false,
          name: "A2A Caller",
        }),
      },
    });

    const event = {
      _method: "POST",
      _headers: {},
      context: {} as Record<string, unknown>,
      req: { json: async () => ({}) },
    };
    const result = await mounted[0].handler(event);

    expect(result).toEqual({ ok: true });
    expect(received.ctx.userEmail).toBe("a2a-caller@example.com");
    expect(received.requestUserEmail).toBe("a2a-caller@example.com");
    expect(received.requestUserName).toBe("A2A Caller");
    expect(getOwnerFromEvent).not.toHaveBeenCalled();
    expect(event.context[AGENT_RUN_OWNER_CONTEXT_KEY]).toEqual({
      owner: "a2a-caller@example.com",
      anonymous: false,
      name: "A2A Caller",
    });
  });

  it("lists and re-enables a disabled workspace app through its registered actions", async () => {
    vi.resetModules();
    let app = {
      id: "account-expert",
      name: "Account Expert",
      description: "Account research workspace",
      path: "/account-expert",
      visibility: "private",
      org_enabled: false,
    };
    const membershipLookups: unknown[][] = [];
    const updates: unknown[][] = [];
    const execute = vi.fn(async (query: { sql: string; args?: unknown[] }) => {
      const sql = query.sql.replace(/\s+/g, " ").trim().toLowerCase();
      if (sql.startsWith("select role from org_members")) {
        membershipLookups.push(query.args ?? []);
        return { rows: [{ role: "owner" }], rowsAffected: 0 };
      }
      if (
        sql.startsWith(
          "select id, name, description, path, visibility, org_enabled",
        )
      ) {
        return { rows: [{ ...app }], rowsAffected: 0 };
      }
      if (sql.startsWith("select id from workspace_apps")) {
        return {
          rows: query.args?.[1] === "org-1" ? [{ id: app.id }] : [],
          rowsAffected: 0,
        };
      }
      if (sql.startsWith("update workspace_apps")) {
        updates.push(query.args ?? []);
        app = {
          ...app,
          visibility: String(query.args?.[0]),
          org_enabled: Boolean(query.args?.[1]),
        };
        return { rows: [], rowsAffected: 1 };
      }
      throw new Error(`Unexpected workspace app access query: ${query.sql}`);
    });
    const recordActionAudit = vi.fn();
    const track = vi.fn();
    vi.doMock("../db/client.js", () => ({
      getDbExec: () => ({ execute }),
      isTransientDatabaseError: () => false,
    }));
    vi.doMock("../audit/record.js", () => ({ recordActionAudit }));
    vi.doMock("../tracking/registry.js", () => ({ track }));

    try {
      const [
        { mountActionRoutes },
        { default: listWorkspaceAppAccess },
        { default: setWorkspaceAppAccess },
      ] = await Promise.all([
        import("./action-routes.js"),
        import("../org/actions/list-workspace-app-access.js"),
        import("../org/actions/set-workspace-app-access.js"),
      ]);
      const mounted: Array<{ path: string; handler: any }> = [];
      const nitroApp = {
        use: vi.fn((path: string, handler: any) =>
          mounted.push({ path, handler }),
        ),
      };
      mountActionRoutes(
        nitroApp,
        {
          "list-workspace-app-access": listWorkspaceAppAccess as any,
          "set-workspace-app-access": setWorkspaceAppAccess as any,
        },
        {
          actionRouteAuth: {
            resolveCaller: async () => ({
              owner: "owner@example.com",
              anonymous: false,
              orgId: "org-1",
            }),
          },
        },
      );
      const handlerFor = (name: string) =>
        mounted.find(({ path }) => path === `/_agent-native/actions/${name}`)!
          .handler;
      const listEvent = () => ({
        _method: "GET",
        _headers: {},
        context: {},
        req: {
          url: "http://app.test/_agent-native/actions/list-workspace-app-access",
        },
      });

      await expect(
        handlerFor("list-workspace-app-access")(listEvent()),
      ).resolves.toEqual({
        apps: [
          {
            id: "account-expert",
            name: "Account Expert",
            description: "Account research workspace",
            path: "/account-expert",
            mode: "disabled",
          },
        ],
      });

      await expect(
        handlerFor("set-workspace-app-access")({
          _method: "POST",
          _headers: {},
          context: {},
          req: {
            url: "http://app.test/_agent-native/actions/set-workspace-app-access",
            json: async () => ({ appId: "account-expert", mode: "restricted" }),
          },
        }),
      ).resolves.toEqual({ appId: "account-expert", mode: "restricted" });

      await expect(
        handlerFor("list-workspace-app-access")(listEvent()),
      ).resolves.toMatchObject({
        apps: [{ id: "account-expert", mode: "restricted" }],
      });
      expect(membershipLookups).toEqual([
        ["org-1", "owner@example.com"],
        ["org-1", "owner@example.com"],
        ["org-1", "owner@example.com"],
      ]);
      expect(updates).toEqual([
        ["private", true, expect.any(Number), "account-expert", "org-1"],
      ]);
      expect(recordActionAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "success",
          args: { appId: "account-expert", mode: "restricted" },
          ctx: expect.objectContaining({
            actionName: "set-workspace-app-access",
            userEmail: "owner@example.com",
            orgId: "org-1",
          }),
        }),
      );
      expect(track).toHaveBeenCalled();
    } finally {
      vi.doUnmock("../db/client.js");
      vi.doUnmock("../audit/record.js");
      vi.doUnmock("../tracking/registry.js");
      vi.resetModules();
    }
  });

  it("passes the original mounted pathname to action auth adapters", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const resolveCaller = vi.fn(async (event: any) => {
      expect(event.path).toBe("/");
      expect(event.context._mountedPathname).toBe(
        "/_agent-native/actions/do-thing",
      );
      return {
        owner: "a2a-caller@example.com",
        anonymous: false,
        orgId: "org-builder",
      };
    });
    const run = vi.fn(async () => ({ ok: true }));
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };

    mountActionRoutes(
      nitroApp,
      { "do-thing": { run } as any },
      { actionRouteAuth: { resolveCaller } },
    );

    await expect(
      mounted[0]!.handler({
        _method: "POST",
        _headers: {},
        path: "/",
        context: {
          _mountedPathname: "/_agent-native/actions/do-thing",
        },
        req: { json: async () => ({}) },
      }),
    ).resolves.toEqual({ ok: true });
    expect(resolveCaller).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });

  it("falls through to getOwnerFromEvent when resolveCaller returns null", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const getOwnerFromEvent = vi.fn(async () => "session-user@example.com");
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
      getOwnerFromEvent,
      actionRouteAuth: { resolveCaller: async () => null },
    });

    await mounted[0].handler({
      _method: "POST",
      _headers: {},
      context: {},
      req: { json: async () => ({}) },
    });

    expect(getOwnerFromEvent).toHaveBeenCalledTimes(1);
    expect(received.userEmail).toBe("session-user@example.com");
  });

  it("hard-rejects with 401 when resolveCaller throws (session chain not consulted)", async () => {
    // Contract: a throw means "the credential is mine but invalid". It must NOT
    // fall through to getOwnerFromEvent/getSession — otherwise a forged A2A
    // bearer plus a live same-origin cookie would run as the session user.
    const { mountActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const getOwnerFromEvent = vi.fn(async () => "session-user@example.com");
    const actions: Record<string, ActionEntry> = {
      "do-thing": {
        run: vi.fn(async () => ({ ok: true })),
      } as any,
    };

    mountActionRoutes(nitroApp, actions, {
      getOwnerFromEvent,
      actionRouteAuth: {
        resolveCaller: async () => {
          throw new Error("verifier exploded");
        },
      },
    });

    await expect(
      mounted[0].handler({
        _method: "POST",
        _headers: {},
        context: {},
        req: { json: async () => ({}) },
      }),
    ).rejects.toMatchObject({ statusCode: 401 });

    expect(getOwnerFromEvent).not.toHaveBeenCalled();
    expect(actions["do-thing"].run).not.toHaveBeenCalled();
  });

  it("scopes the adapter-resolved caller to an owner-derived orgId", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const { getRequestOrgId } = await import("./request-context.js");
    mockResolveOrgIdForEmail.mockResolvedValue("org-owner-derived");
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
          received = { ctx, requestOrgId: getRequestOrgId() };
          return { ok: true };
        }),
      } as any,
    };

    mountActionRoutes(nitroApp, actions, {
      getOwnerFromEvent: async () => "session-user@example.com",
      resolveOrgId: async () => null,
      actionRouteAuth: {
        resolveCaller: async () => ({
          owner: "a2a-caller@example.com",
          anonymous: false,
        }),
      },
    });

    await mounted[0].handler({
      _method: "POST",
      _headers: {},
      context: {} as Record<string, unknown>,
      req: { json: async () => ({}) },
    });

    expect(mockResolveOrgIdForEmail).toHaveBeenCalledWith(
      "a2a-caller@example.com",
    );
    expect(received.ctx.orgId).toBe("org-owner-derived");
    expect(received.requestOrgId).toBe("org-owner-derived");
  });

  it("falls back to the stored active org for a cookie session that resolved none", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const { getRequestOrgId } = await import("./request-context.js");
    mockResolveOrgIdForEmail.mockResolvedValue("org-stored-active");
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
          received = { ctx, requestOrgId: getRequestOrgId() };
          return { ok: true };
        }),
      } as any,
    };

    mountActionRoutes(nitroApp, actions, {
      getOwnerFromEvent: async () => "steve@example.com",
      resolveOrgId: async () => null,
    });

    await mounted[0].handler({
      _method: "POST",
      _headers: { "x-agent-native-frontend": "1" },
      req: { json: async () => ({}) },
    });

    expect(mockResolveOrgIdForEmail).toHaveBeenCalledWith("steve@example.com");
    expect(received.ctx.orgId).toBe("org-stored-active");
    expect(received.requestOrgId).toBe("org-stored-active");
  });

  it("keeps an explicit Personal selection personal", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    mockResolveOrgIdForEmail.mockResolvedValue(null);
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
      getOwnerFromEvent: async () => "steve@example.com",
      resolveOrgId: async () => null,
    });

    await mounted[0].handler({
      _method: "POST",
      _headers: { "x-agent-native-frontend": "1" },
      req: { json: async () => ({}) },
    });

    expect(received.orgId).toBeNull();
  });

  it.each(['relation "org_members" does not exist'])(
    "suppresses the verified first-boot missing org table error: %s",
    async (message) => {
      const { mountActionRoutes } = await import("./action-routes.js");
      mockResolveOrgIdForEmail.mockRejectedValue(new Error(message));
      const mounted: Array<{ path: string; handler: any }> = [];
      const nitroApp = {
        use: vi.fn((path: string, handler: any) =>
          mounted.push({ path, handler }),
        ),
      };
      let received: any;
      mountActionRoutes(
        nitroApp,
        {
          "do-thing": {
            run: vi.fn(async (_params, ctx) => {
              received = ctx;
              return { ok: true };
            }),
          } as any,
        },
        {
          getOwnerFromEvent: async () => "steve@example.com",
          resolveOrgId: async () => null,
        },
      );

      await expect(
        mounted[0].handler({
          _method: "POST",
          _headers: { "x-agent-native-frontend": "1" },
          req: { json: async () => ({}) },
        }),
      ).resolves.toEqual({ ok: true });
      expect(received.orgId).toBeNull();
    },
  );

  it("propagates persistent org-resolution failures", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const error = new Error("permission denied for table org_members");
    mockResolveOrgIdForEmail.mockRejectedValue(error);
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const run = vi.fn(async () => ({ ok: true }));
    mountActionRoutes(
      nitroApp,
      { "do-thing": { run } as any },
      {
        getOwnerFromEvent: async () => "steve@example.com",
        resolveOrgId: async () => null,
      },
    );

    await expect(
      mounted[0].handler({
        _method: "POST",
        _headers: { "x-agent-native-frontend": "1" },
        req: { json: async () => ({}) },
      }),
    ).rejects.toBe(error);
    expect(run).not.toHaveBeenCalled();
  });

  it("preserves transient org-resolution failures", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const error = Object.assign(new Error("db query timed out"), {
      code: "57014",
    });
    mockResolveOrgIdForEmail.mockRejectedValue(error);
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const run = vi.fn(async () => ({ ok: true }));
    mountActionRoutes(
      nitroApp,
      { "do-thing": { run } as any },
      {
        getOwnerFromEvent: async () => "steve@example.com",
        resolveOrgId: async () => null,
      },
    );

    await expect(
      mounted[0].handler({
        _method: "POST",
        _headers: { "x-agent-native-frontend": "1" },
        req: { json: async () => ({}) },
      }),
    ).rejects.toBe(error);
    expect(run).not.toHaveBeenCalled();
  });

  it("never lets the ambient session org override the adapter caller's org", async () => {
    // A request can carry BOTH a valid A2A bearer and an unrelated same-origin
    // browser cookie. The identity comes from the token, so the org must too:
    // the session-backed resolveOrgId (and getSession/getOrgContext) must not
    // be consulted, or the token caller would execute under the cookie user's
    // org — a cross-org confusion.
    const { mountActionRoutes } = await import("./action-routes.js");
    const { getRequestOrgId } = await import("./request-context.js");
    mockResolveOrgIdForEmail.mockResolvedValue("org-of-a2a-caller");
    mockGetSession.mockResolvedValue({
      email: "cookie-user@example.com",
      orgId: "org-of-cookie-user",
    } as any);
    mockGetOrgContext.mockResolvedValue({ orgId: "org-of-cookie-user" });
    const resolveOrgId = vi.fn(async () => "org-of-cookie-user");
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
          received = { ctx, requestOrgId: getRequestOrgId() };
          return { ok: true };
        }),
      } as any,
    };

    mountActionRoutes(nitroApp, actions, {
      getOwnerFromEvent: async () => "cookie-user@example.com",
      resolveOrgId,
      actionRouteAuth: {
        resolveCaller: async () => ({
          owner: "a2a-caller@example.com",
          anonymous: false,
        }),
      },
    });

    await mounted[0].handler({
      _method: "POST",
      _headers: {},
      context: {} as Record<string, unknown>,
      req: { json: async () => ({}) },
    });

    expect(received.ctx.orgId).toBe("org-of-a2a-caller");
    expect(received.requestOrgId).toBe("org-of-a2a-caller");
    expect(resolveOrgId).not.toHaveBeenCalled();
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockGetOrgContext).not.toHaveBeenCalled();
  });

  it("uses the adapter-asserted orgId verbatim, skipping the owner lookup", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const { getRequestOrgId } = await import("./request-context.js");
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
          received = { ctx, requestOrgId: getRequestOrgId() };
          return { ok: true };
        }),
      } as any,
    };

    mountActionRoutes(nitroApp, actions, {
      resolveOrgId: async () => "org-of-cookie-user",
      actionRouteAuth: {
        resolveCaller: async () => ({
          owner: "a2a-caller@example.com",
          anonymous: false,
          orgId: "org-from-token",
        }),
      },
    });

    await mounted[0].handler({
      _method: "POST",
      _headers: {},
      context: {} as Record<string, unknown>,
      req: { json: async () => ({}) },
    });

    expect(received.ctx.orgId).toBe("org-from-token");
    expect(received.requestOrgId).toBe("org-from-token");
    expect(mockResolveOrgIdForEmail).not.toHaveBeenCalled();
  });

  it("keeps adapter-resolved Personal callers out of an ambient session org", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const { getRequestContext, getRequestOrgId } =
      await import("./request-context.js");
    mockGetSession.mockResolvedValue({
      email: "cookie-user@example.com",
      orgId: "org-from-cookie",
    } as any);
    mockGetOrgContext.mockResolvedValue({ orgId: "org-from-cookie" });
    const resolveOrgId = vi.fn(async () => "org-from-cookie");
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
          received = {
            ctx,
            requestContext: getRequestContext(),
            requestOrgId: getRequestOrgId(),
          };
          return { ok: true };
        }),
      } as any,
    };

    mountActionRoutes(nitroApp, actions, {
      getOwnerFromEvent: async () => "cookie-user@example.com",
      resolveOrgId,
      actionRouteAuth: {
        resolveCaller: async () => ({
          owner: "personal-caller@example.com",
          anonymous: false,
          orgId: null,
        }),
      },
    });

    await mounted[0].handler({
      _method: "POST",
      _headers: { cookie: "better-auth.session_token=unrelated" },
      context: {} as Record<string, unknown>,
      req: { json: async () => ({}) },
    });

    expect(received.ctx.orgId).toBeNull();
    expect(received.requestOrgId).toBeUndefined();
    expect(received.requestContext.orgScope).toBe("personal");
    expect(resolveOrgId).not.toHaveBeenCalled();
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockGetOrgContext).not.toHaveBeenCalled();
  });

  it("does not seed the adapter's orgId into the owner context", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const { AGENT_RUN_OWNER_CONTEXT_KEY } =
      await import("./agent-run-context.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const actions: Record<string, ActionEntry> = {
      "do-thing": { run: vi.fn(async () => ({ ok: true })) } as any,
    };

    mountActionRoutes(nitroApp, actions, {
      actionRouteAuth: {
        resolveCaller: async () => ({
          owner: "a2a-caller@example.com",
          anonymous: false,
          name: "A2A Caller",
          orgId: "org-from-token",
        }),
      },
    });

    const event = {
      _method: "POST",
      _headers: {},
      context: {} as Record<string, unknown>,
      req: { json: async () => ({}) },
    };
    await mounted[0].handler(event);

    expect(event.context[AGENT_RUN_OWNER_CONTEXT_KEY]).toEqual({
      owner: "a2a-caller@example.com",
      anonymous: false,
      name: "A2A Caller",
    });
  });
});

describe("action boundary error classification", () => {
  async function invoke(error: unknown) {
    const { mountActionRoutes } = await import("./action-routes.js");
    const { registerErrorCaptureProvider } = await import("./capture-error.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const provider = vi.fn(() => "evt_boundary");
    const unregister = registerErrorCaptureProvider(
      "action-boundary-test",
      provider,
    );
    try {
      mountActionRoutes(nitroApp, {
        "do-thing": {
          run: vi.fn(async () => {
            throw error;
          }),
          http: { method: "POST" as const },
        } as any,
      });
      const event = { _method: "POST", req: { json: async () => ({}) } };
      const result = await mounted[0].handler(event);
      return { status: (event as any)._status, result, captured: provider };
    } finally {
      unregister();
    }
  }

  it("types a missing LLM provider as a 424 and does not capture it", async () => {
    const { EngineError } = await import("../agent/engine/types.js");
    const { status, result, captured } = await invoke(
      new EngineError(
        'No LLM provider is connected. (engine "anthropic" has no ANTHROPIC_API_KEY)',
        { errorCode: "missing_credentials", statusCode: 401 },
      ),
    );

    expect(status).toBe(424);
    expect(result).toEqual({
      error: expect.stringContaining("No LLM provider is connected."),
      errorCode: "llm_provider_missing",
    });
    expect(JSON.stringify(result)).not.toContain("ANTHROPIC_API_KEY");
    expect(captured).not.toHaveBeenCalled();
    expect(mockCountActionFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "do-thing",
        status: 424,
        errorCode: "llm_provider_missing",
      }),
    );
    expect(mockCountCredentialState).toHaveBeenCalledWith(
      { kind: "missing", credential: "provider" },
      "action_route",
    );
  });

  it("recognizes a code-less missing-provider error by its message", async () => {
    const { status, result, captured } = await invoke(
      new Error(
        "No LLM provider is connected. Open Settings > Agent > AI providers.",
      ),
    );

    expect(status).toBe(424);
    expect(result).toMatchObject({ errorCode: "llm_provider_missing" });
    expect(captured).not.toHaveBeenCalled();
  });

  it("keeps a credential store outage a captured 500", async () => {
    const { EngineError } = await import("../agent/engine/types.js");
    const error = new EngineError("LLM credential store is unavailable", {
      errorCode: "credential_store_unavailable",
    });
    const { status, result, captured } = await invoke(error);

    expect(status).toBe(500);
    expect(result).toEqual({ error: "Internal server error" });
    expect(captured).toHaveBeenCalledWith(error, expect.anything());
  });

  it("does not read another typed code as a missing provider", async () => {
    const error = Object.assign(new Error("Token rejected"), {
      errorCode: "unauthorized",
    });
    const { status, result, captured } = await invoke(error);

    expect(status).toBe(500);
    expect(result).toEqual({ error: "Internal server error" });
    expect(captured).toHaveBeenCalledTimes(1);
  });

  it("returns a fail() conflict typed and uncaptured", async () => {
    const { fail } = await import("../action.js");
    let thrown: unknown;
    try {
      fail("This update was prepared from an outdated revision.", {
        errorCode: "plan_revision_conflict",
        statusCode: 409,
      });
    } catch (error) {
      thrown = error;
    }
    const { status, result, captured } = await invoke(thrown);

    expect(status).toBe(409);
    expect(result).toEqual({
      error: "This update was prepared from an outdated revision.",
      errorCode: "plan_revision_conflict",
    });
    expect(captured).not.toHaveBeenCalled();
  });

  it("treats an error marked expected with a typed code as user-facing", async () => {
    const conflict = Object.assign(new Error("Edit conflict"), {
      expected: true,
      errorCode: "edit_conflict",
    });
    const defaulted = await invoke(conflict);
    expect(defaulted.status).toBe(409);
    expect(defaulted.result).toEqual({
      error: "Edit conflict",
      errorCode: "edit_conflict",
    });
    expect(defaulted.captured).not.toHaveBeenCalled();

    const explicit = await invoke(
      Object.assign(new Error("Gone"), {
        expected: true,
        errorCode: "gone",
        statusCode: 404,
      }),
    );
    expect(explicit.status).toBe(404);
    expect(explicit.captured).not.toHaveBeenCalled();
  });

  it("does not trust an expected marker without a typed code", async () => {
    const error = Object.assign(new Error("relation does not exist"), {
      expected: true,
    });
    const { status, result, captured } = await invoke(error);

    expect(status).toBe(500);
    expect(result).toEqual({ error: "Internal server error" });
    expect(captured).toHaveBeenCalledTimes(1);
  });

  it("keeps an unclassified bare Error loud: 500 and captured", async () => {
    const error = new Error("Generation run not found.");
    const { status, result, captured } = await invoke(error);

    expect(status).toBe(500);
    expect(result).toEqual({ error: "Internal server error" });
    expect(captured).toHaveBeenCalledWith(error, expect.anything());
  });

  it("keeps code-less LLM and credential bugs that are not a missing provider loud", async () => {
    for (const message of [
      "LLM response missing required field 'slides'",
      "AI engine returned no content; a tool_result block is required",
      "Invalid BUILDER_PRIVATE_KEY for space abc: 401 from Builder content API",
    ]) {
      const error = new Error(message);
      const { status, result, captured } = await invoke(error);

      expect(status, message).toBe(500);
      expect(result).toEqual({ error: "Internal server error" });
      expect(captured).toHaveBeenCalledWith(error, expect.anything());
    }
  });

  it("still types a code-less error naming an unset provider key as a 424", async () => {
    for (const message of [
      "ANTHROPIC_API_KEY is not set",
      "Missing OPENAI_API_KEY for the agent engine",
    ]) {
      const { status, result, captured } = await invoke(new Error(message));

      expect(status, message).toBe(424);
      expect(result).toMatchObject({ errorCode: "llm_provider_missing" });
      expect(captured).not.toHaveBeenCalled();
    }
  });

  it("keeps a fail() typed missing_credentials error's own message and status", async () => {
    const { fail } = await import("../action.js");
    const message =
      "The dream job would run as __organization__:org-1, which has no LLM provider connected. An admin of that organization must connect one.";
    let thrown: unknown;
    try {
      fail(message, { errorCode: "missing_credentials", statusCode: 409 });
    } catch (error) {
      thrown = error;
    }
    const { status, result, captured } = await invoke(thrown);

    expect(status).toBe(409);
    expect(result).toEqual({
      error: message,
      errorCode: "missing_credentials",
    });
    expect(captured).not.toHaveBeenCalled();
  });
});

describe("mountWebMcpActionRoutes", () => {
  it("mounts MCP-only actions on the external MCP route", async () => {
    const { mountWebMcpActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const run = vi.fn(async () => ({ acknowledged: true }));
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };

    mountWebMcpActionRoutes(
      nitroApp,
      {
        acknowledge: {
          tool: {
            description: "Acknowledge an applied handoff",
            parameters: { type: "object" },
          },
          run,
          agentTool: false,
          mcpTool: true,
        } as any,
      },
      { getOwnerFromEvent: vi.fn(async () => "owner@example.com") },
    );

    const route = mounted.find(({ path }) => path === "/mcp/tool/acknowledge");
    expect(route).toBeDefined();
    await expect(
      route?.handler({
        _method: "POST",
        _headers: {},
        req: { json: async () => ({}) },
      }),
    ).resolves.toEqual({ acknowledged: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("projects eligible actions, including http:false, through the shared dispatcher", async () => {
    const { mountWebMcpActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const run = vi.fn(async (_args, context) => ({ caller: context.caller }));
    const getOwnerFromEvent = vi.fn(async () => "owner@example.com");
    const resolveCaller = vi.fn(async () => ({
      owner: "delegated@example.com",
      anonymous: false,
    }));
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };

    mountWebMcpActionRoutes(
      nitroApp,
      {
        eligible: {
          tool: { description: "Eligible", parameters: { type: "object" } },
          run,
          http: false,
          readOnly: true,
        } as any,
        hidden: {
          tool: { description: "Hidden", parameters: { type: "object" } },
          run: vi.fn(),
          agentTool: false,
        } as any,
        approval: {
          tool: { description: "Approval", parameters: { type: "object" } },
          run: vi.fn(),
          needsApproval: true,
        } as any,
        "invalid name": {
          tool: { description: "Invalid", parameters: { type: "object" } },
          run: vi.fn(),
        } as any,
      },
      {
        getOwnerFromEvent,
        actionRouteAuth: { resolveCaller },
        manifest: {
          name: "Clips",
          description: "Read clips",
          instructions: "Call view-screen before editing.",
          websiteUrl: "https://clips.example.com",
        },
      },
    );

    const compatibilityRoute = mounted.find(
      ({ path }) => path === "/.well-known/mcp.json",
    );
    const manifestRoute = mounted.find(
      ({ path }) => path === "/_agent-native/webmcp/manifest",
    );
    const invocationRoute = mounted.find(
      ({ path }) => path === "/_agent-native/webmcp/actions/eligible",
    );
    const compatibilityInvocationRoute = mounted.find(
      ({ path }) => path === "/mcp/tool/eligible",
    );
    const approvalInvocationRoute = mounted.find(
      ({ path }) => path === "/_agent-native/webmcp/actions/approval",
    );

    expect(mockRegisterAuthPublicPaths).toHaveBeenCalledWith(
      [
        "/_agent-native/webmcp/manifest",
        "/_agent-native/webmcp/actions/eligible",
        "/_agent-native/webmcp/actions/approval",
        "/mcp/tool/eligible",
        "/mcp/tool/approval",
      ],
      nitroApp,
    );

    const compatibilityManifest = await compatibilityRoute?.handler({
      _method: "GET",
      _headers: {
        host: "clips.example.com",
        "x-forwarded-proto": "https",
      },
    });
    expect(compatibilityManifest).toMatchObject({
      schema_version: "v1",
      protocol: "WebMCP",
      name: "Clips",
      description: "Read clips",
      instructions: expect.stringContaining("Call view-screen before editing."),
      website_url: "https://clips.example.com",
      endpoints: {
        mcp: "https://clips.example.com/mcp",
        httpTools: "https://clips.example.com/mcp/tool",
        authenticatedWebMcp:
          "https://clips.example.com/_agent-native/webmcp/manifest",
        a2a: "https://clips.example.com/.well-known/agent-card.json",
      },
      webmcp: { scope: "page-local", browserRequired: true },
      tools: [
        {
          name: "eligible",
          title: "Eligible",
          description: "Eligible",
          parameters: { type: "object" },
          inputSchema: { type: "object" },
          endpoint: "https://clips.example.com/mcp/tool/eligible",
          method: "POST",
          readOnly: true,
          requiresAuth: true,
        },
        {
          name: "approval",
          title: "Approval",
          description: "Approval",
          parameters: { type: "object" },
          inputSchema: { type: "object" },
          endpoint: "https://clips.example.com/mcp/tool/approval",
          method: "POST",
          requiresAuth: true,
        },
      ],
    });

    await expect(
      manifestRoute?.handler({ _method: "GET", _headers: {} }),
    ).resolves.toEqual([
      {
        name: "eligible",
        title: "Eligible",
        description: "Eligible",
        inputSchema: { type: "object" },
        readOnly: true,
      },
      {
        name: "approval",
        title: "Approval",
        description: "Approval",
        inputSchema: { type: "object" },
        readOnly: false,
      },
    ]);
    expect(getOwnerFromEvent).toHaveBeenCalled();

    await expect(
      invocationRoute?.handler({
        _method: "POST",
        _headers: {},
        req: { json: async () => ({}) },
      }),
    ).resolves.toEqual({ caller: "webmcp" });
    expect(run).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ caller: "webmcp", actionName: "eligible" }),
    );
    expect(resolveCaller).not.toHaveBeenCalled();

    await expect(
      compatibilityInvocationRoute?.handler({
        _method: "POST",
        _headers: {},
        req: { json: async () => ({}) },
      }),
    ).resolves.toEqual({ caller: "webmcp" });
    expect(run).toHaveBeenCalledTimes(2);

    const approvalResult = await approvalInvocationRoute?.handler({
      _method: "POST",
      _headers: {},
      req: { json: async () => ({}) },
    });
    expect(approvalResult).toMatchObject({
      error: expect.stringContaining("ask the user to confirm"),
      errorCode: "approval_required",
    });
  });

  it("evaluates needsApproval against schema-validated args, not raw JSON", async () => {
    const { mountWebMcpActionRoutes } = await import("./action-routes.js");
    const { z } = await import("zod");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const run = vi.fn(async (args) => ({ ranWith: args }));
    const schema = z.object({
      dryRun: z.preprocess(
        (v) => (v === "false" ? false : v),
        z.boolean().default(true),
      ),
    });

    mountWebMcpActionRoutes(
      nitroApp,
      {
        remediate: {
          tool: { description: "Remediate", parameters: { type: "object" } },
          schema,
          run,
          needsApproval: (args: { dryRun: boolean }) => args.dryRun === false,
        } as any,
      },
      { getOwnerFromEvent: vi.fn(async () => "owner@example.com") },
    );

    const invocationRoute = mounted.find(
      ({ path }) => path === "/_agent-native/webmcp/actions/remediate",
    );

    await expect(
      invocationRoute?.handler({
        _method: "POST",
        _headers: {},
        req: { json: async () => ({}) },
      }),
    ).resolves.toEqual({ ranWith: { dryRun: true } });

    const coercedResult = await invocationRoute?.handler({
      _method: "POST",
      _headers: {},
      req: { json: async () => ({ dryRun: "false" }) },
    });
    expect(coercedResult).toMatchObject({ errorCode: "approval_required" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not re-validate an already-validated call through a real defineAction entry", async () => {
    const { mountWebMcpActionRoutes } = await import("./action-routes.js");
    const { defineAction } = await import("../action.js");
    const { z } = await import("zod");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    const run = vi.fn(async (args: { tag: string }) => ({ ranWith: args }));
    const action = defineAction({
      description: "Tag",
      schema: z.object({
        tag: z.preprocess((v) => `${v}!`, z.string()),
      }),
      needsApproval: () => false,
      run,
    });

    mountWebMcpActionRoutes(
      nitroApp,
      { tag: action as unknown as ActionEntry },
      { getOwnerFromEvent: vi.fn(async () => "owner@example.com") },
    );

    const invocationRoute = mounted.find(
      ({ path }) => path === "/_agent-native/webmcp/actions/tag",
    );
    await expect(
      invocationRoute?.handler({
        _method: "POST",
        _headers: {},
        req: { json: async () => ({ tag: "a" }) },
      }),
    ).resolves.toEqual({ ranWith: { tag: "a!" } });
  });

  it("filters manifest.keyToolNames to tools this manifest actually lists", async () => {
    const { mountWebMcpActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };

    mountWebMcpActionRoutes(
      nitroApp,
      {
        eligible: {
          tool: { description: "Eligible", parameters: { type: "object" } },
          run: vi.fn(),
          readOnly: true,
        } as any,
        hidden: {
          tool: { description: "Hidden", parameters: { type: "object" } },
          run: vi.fn(),
          agentTool: false,
        } as any,
      },
      {
        getOwnerFromEvent: vi.fn(async () => "owner@example.com"),
        manifest: {
          name: "Clips",
          description: "Read clips",
          keyToolNames: ["eligible", "hidden"],
        },
      },
    );

    const compatibilityRoute = mounted.find(
      ({ path }) => path === "/.well-known/mcp.json",
    );
    const compatibilityManifest = await compatibilityRoute?.handler({
      _method: "GET",
      _headers: { host: "clips.example.com", "x-forwarded-proto": "https" },
    });

    expect(compatibilityManifest.instructions).toContain(
      "Key tools for this app: eligible.",
    );
    expect(compatibilityManifest.instructions).not.toContain("hidden");
  });

  it("resolves browser tab and canonical auth identity for WebMCP actions", async () => {
    const { mountWebMcpActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const run = vi.fn(async () => ({
      browserTabId: getRequestRunContext()?.browserTabId,
      authUserId: getRequestContext()?.authUserId,
    }));
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };

    mountWebMcpActionRoutes(
      nitroApp,
      {
        eligible: {
          tool: { description: "Eligible", parameters: { type: "object" } },
          run,
          readOnly: true,
        } as any,
      },
      {
        getOwnerContextFromEvent: async () => ({
          owner: "owner@example.com",
          name: "Owner",
          anonymous: false,
          authUserId: "canonical-auth-user-1",
        }),
      },
    );

    const webMcpRoute = mounted.find(
      ({ path }) => path === "/_agent-native/webmcp/actions/eligible",
    );
    const mcpToolRoute = mounted.find(
      ({ path }) => path === "/mcp/tool/eligible",
    );

    await expect(
      webMcpRoute?.handler({
        _method: "POST",
        _headers: { "x-agent-native-browser-tab": "tab-abc123" },
        req: { json: async () => ({}) },
      }),
    ).resolves.toEqual({
      browserTabId: "tab-abc123",
      authUserId: "canonical-auth-user-1",
    });

    await expect(
      mcpToolRoute?.handler({
        _method: "POST",
        _headers: { "x-agent-native-browser-tab": "tab-abc123" },
        req: { json: async () => ({}) },
      }),
    ).resolves.toEqual({
      browserTabId: "tab-abc123",
      authUserId: "canonical-auth-user-1",
    });

    await expect(
      webMcpRoute?.handler({
        _method: "POST",
        _headers: {},
        req: { json: async () => ({}) },
      }),
    ).resolves.toEqual({
      browserTabId: undefined,
      authUserId: "canonical-auth-user-1",
    });
  });

  it("serves only explicitly public read-only actions to anonymous pages", async () => {
    const { mountWebMcpActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const publicRun = vi.fn(async (_args, context) => ({
      userEmail: context.userEmail,
    }));
    const privateRun = vi.fn();
    const getOwnerFromEvent = vi.fn(async () => {
      throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    });
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };

    mountWebMcpActionRoutes(
      nitroApp,
      {
        "search-docs": {
          tool: {
            description: "Search public docs",
            parameters: { type: "object" },
          },
          run: publicRun,
          http: false,
          requiresAuth: false,
          readOnly: true,
          publicAgent: {
            expose: true,
            readOnly: true,
            requiresAuth: false,
          },
        } as any,
        "private-docs": {
          tool: {
            description: "Read private docs",
            parameters: { type: "object" },
          },
          run: privateRun,
          http: false,
          requiresAuth: false,
          readOnly: true,
        } as any,
        "vetoed-docs": {
          tool: {
            description: "Never expose these docs",
            parameters: { type: "object" },
          },
          run: vi.fn(),
          http: false,
          requiresAuth: false,
          readOnly: true,
          agentTool: true,
          mcpTool: false,
          publicAgent: {
            expose: true,
            readOnly: true,
            requiresAuth: false,
          },
        } as any,
      },
      { getOwnerFromEvent },
    );

    const manifestRoute = mounted.find(
      ({ path }) => path === "/_agent-native/webmcp/manifest",
    );
    const invocationRoute = mounted.find(
      ({ path }) => path === "/_agent-native/webmcp/actions/search-docs",
    );
    const guessedPrivateRoute = mounted.find(
      ({ path }) => path === "/_agent-native/webmcp/actions/private-docs",
    );
    const vetoedRoute = mounted.find(
      ({ path }) => path === "/_agent-native/webmcp/actions/vetoed-docs",
    );

    await expect(
      manifestRoute?.handler({ _method: "GET", _headers: {} }),
    ).resolves.toEqual([
      {
        name: "search-docs",
        description: "Search public docs",
        inputSchema: { type: "object" },
        readOnly: true,
        title: "Search docs",
      },
    ]);
    expect(getOwnerFromEvent).toHaveBeenCalledTimes(1);
    expect(vetoedRoute).toBeUndefined();

    await expect(
      invocationRoute?.handler({
        _method: "POST",
        _headers: {},
        req: { json: async () => ({}) },
      }),
    ).resolves.toEqual({ userEmail: undefined });
    expect(publicRun).toHaveBeenCalledTimes(1);
    await expect(
      guessedPrivateRoute?.handler({
        _method: "POST",
        _headers: {},
        req: { json: async () => ({}) },
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(privateRun).not.toHaveBeenCalled();
  });

  it("filters signed-out WebMCP actions to the matching capability scope", async () => {
    const { mountWebMcpActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    mockResolveEmbedSessionFromRequest.mockResolvedValue({
      email: "ticket-owner@example.com",
      token: "signed-capability",
      targetPath: "/visual-edit/design_1",
      scope: "capability:visual-edit:design:design_1",
    });
    const unauthenticated = Object.assign(new Error("Unauthorized"), {
      statusCode: 401,
    });

    mountWebMcpActionRoutes(
      nitroApp,
      {
        "visual-edit": {
          tool: { description: "Visual edit", parameters: {} },
          run: vi.fn(),
          capabilityScopes: ["visual-edit"],
        } as any,
        "other-capability": {
          tool: { description: "Other capability", parameters: {} },
          run: vi.fn(),
          capabilityScopes: ["other"],
        } as any,
      },
      {
        getOwnerFromEvent: async () => {
          throw unauthenticated;
        },
      },
    );

    const manifestRoute = mounted.find(
      ({ path }) => path === "/_agent-native/webmcp/manifest",
    );
    await expect(
      manifestRoute?.handler({ _method: "GET", _headers: {} }),
    ).resolves.toEqual([
      {
        name: "visual-edit",
        title: "Visual edit",
        description: "Visual edit",
        inputSchema: {},
        readOnly: false,
      },
    ]);

    const otherRoute = mounted.find(
      ({ path }) => path === "/_agent-native/webmcp/actions/other-capability",
    );
    await expect(
      otherRoute?.handler({
        _method: "POST",
        _headers: {},
        req: { json: async () => ({}) },
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("keeps directory-widget read manifests and WebMCP calls scoped when a session cookie is present", async () => {
    const { createMcpDirectoryWidgetReadCapability } =
      await import("../shared/embed-auth.js");
    const { mountWebMcpActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const run = vi.fn(async (_args, context) => ({
      caller: context.caller,
      userEmail: context.userEmail,
      mcpDirectoryWidgetReadOnly: context.mcpDirectoryWidgetReadOnly,
    }));
    const runUnscopedPublicRead = vi.fn();
    const capability = createMcpDirectoryWidgetReadCapability({
      appId: "design",
      resourceUri: "ui://design/shell-v69",
      resourceIds: { designId: "d1" },
      actionArguments: { "get-design": { id: "d1" } },
    })!;
    mockResolveEmbedSessionFromRequest.mockResolvedValue({
      email: "ticket-owner@example.com",
      token: "signed-directory-capability",
      targetPath: "/design/d1",
      scope: capability,
    });
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };

    mountWebMcpActionRoutes(
      nitroApp,
      {
        "get-design": {
          tool: { description: "Read this design", parameters: {} },
          run,
          http: { method: "GET" },
          readOnly: true,
        } as any,
        "update-design": {
          tool: { description: "Update a design", parameters: {} },
          run: vi.fn(),
          http: { method: "POST" },
          readOnly: false,
        } as any,
        "get-other-design": {
          tool: { description: "Read another design", parameters: {} },
          run: vi.fn(),
          http: { method: "GET" },
          readOnly: true,
        } as any,
        "search-public-docs": {
          tool: { description: "Search public docs", parameters: {} },
          run: runUnscopedPublicRead,
          http: { method: "GET" },
          requiresAuth: false,
          readOnly: true,
          publicAgent: {
            expose: true,
            readOnly: true,
            requiresAuth: false,
          },
        } as any,
      },
      {
        getOwnerContextFromEvent: async () => ({
          owner: "cookie-owner@example.com",
          anonymous: false,
        }),
        mcpDirectoryWidgetReadActionArguments: { "get-design": ["id"] },
        mcpDirectoryWidgetReadOnlyActions: ["get-design"],
        mcpDirectoryWidgetAppId: "design",
        mcpDirectoryWidgetResourceUri: "ui://design/shell-v69",
      },
    );

    const manifestRoute = mounted.find(
      ({ path }) => path === "/_agent-native/webmcp/manifest",
    );
    const webMcpRoute = mounted.find(
      ({ path }) => path === "/_agent-native/webmcp/actions/get-design",
    );
    const unscopedPublicRoute = mounted.find(
      ({ path }) => path === "/_agent-native/webmcp/actions/search-public-docs",
    );
    const mcpToolRoute = mounted.find(
      ({ path }) => path === "/mcp/tool/get-design",
    );
    await expect(
      manifestRoute?.handler({ _method: "GET", _headers: {} }),
    ).resolves.toEqual([
      {
        name: "get-design",
        title: "Get design",
        description: "Read this design",
        inputSchema: {},
        readOnly: true,
      },
    ]);

    await expect(
      webMcpRoute?.handler({
        _method: "POST",
        _headers: {},
        req: { json: async () => ({ id: "d1" }) },
      }),
    ).resolves.toEqual({
      caller: "mcp-widget",
      userEmail: "ticket-owner@example.com",
      mcpDirectoryWidgetReadOnly: true,
    });
    expect(run).toHaveBeenCalledOnce();

    await expect(
      mcpToolRoute?.handler({
        _method: "POST",
        _headers: {},
        req: { json: async () => ({ id: "d1" }) },
      }),
    ).resolves.toEqual({
      error: "This widget capability only permits its scoped data routes.",
    });
    expect(run).toHaveBeenCalledOnce();

    await expect(
      unscopedPublicRoute?.handler({
        _method: "POST",
        _headers: {},
        req: { json: async () => ({}) },
      }),
    ).resolves.toEqual({
      error: "This widget capability only permits its scoped data routes.",
    });
    expect(runUnscopedPublicRead).not.toHaveBeenCalled();
  });

  it("does not let a bootstrap capability match ordinary visual-edit actions", async () => {
    const { mountWebMcpActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };
    mockResolveEmbedSessionFromRequest.mockResolvedValue({
      email: "bootstrap-owner@example.com",
      token: "signed-bootstrap-capability",
      targetPath: "/visual-edit",
      scope: `capability:visual-edit-bootstrap:${"a".repeat(32)}`,
    });

    mountWebMcpActionRoutes(
      nitroApp,
      {
        "open-visual-edit": {
          tool: { description: "Open visual edit", parameters: {} },
          run: vi.fn(),
          capabilityScopes: ["visual-edit-bootstrap"],
        } as any,
        "ordinary-visual-edit": {
          tool: { description: "Ordinary visual edit", parameters: {} },
          run: vi.fn(),
          capabilityScopes: ["visual-edit"],
        } as any,
      },
      {
        getOwnerFromEvent: async () => {
          throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
        },
      },
    );

    const manifestRoute = mounted.find(
      ({ path }) => path === "/_agent-native/webmcp/manifest",
    );
    await expect(
      manifestRoute?.handler({ _method: "GET", _headers: {} }),
    ).resolves.toEqual([
      {
        name: "open-visual-edit",
        title: "Open visual edit",
        description: "Open visual edit",
        inputSchema: {},
        readOnly: false,
      },
    ]);
  });

  it("does not treat a synthetic anonymous owner as authenticated", async () => {
    const { mountWebMcpActionRoutes } = await import("./action-routes.js");
    const mounted: Array<{ path: string; handler: any }> = [];
    const publicRun = vi.fn(async (_args, context) => ({
      userEmail: context.userEmail,
    }));
    const mutationRun = vi.fn();
    const getOwnerContextFromEvent = vi.fn(async () => ({
      owner: "public-owner",
      anonymous: true,
    }));
    const nitroApp = {
      use: vi.fn((path: string, handler: any) =>
        mounted.push({ path, handler }),
      ),
    };

    mountWebMcpActionRoutes(
      nitroApp,
      {
        "search-docs": {
          tool: { description: "Search public docs", parameters: {} },
          run: publicRun,
          http: false,
          requiresAuth: false,
          readOnly: true,
          publicAgent: {
            expose: true,
            readOnly: true,
            requiresAuth: false,
          },
        } as any,
        "mutate-docs": {
          tool: { description: "Mutate docs", parameters: {} },
          run: mutationRun,
          http: false,
          readOnly: false,
        } as any,
      },
      { getOwnerContextFromEvent },
    );

    const manifestRoute = mounted.find(
      ({ path }) => path === "/_agent-native/webmcp/manifest",
    );
    const mutationRoute = mounted.find(
      ({ path }) => path === "/_agent-native/webmcp/actions/mutate-docs",
    );

    await expect(
      manifestRoute?.handler({ _method: "GET", _headers: {} }),
    ).resolves.toEqual([
      {
        name: "search-docs",
        description: "Search public docs",
        inputSchema: {},
        readOnly: true,
        title: "Search docs",
      },
    ]);
    await expect(
      mutationRoute?.handler({
        _method: "POST",
        _headers: {},
        req: { json: async () => ({}) },
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(mutationRun).not.toHaveBeenCalled();
  });
});

describe("get-actions-batch through mounted action routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs each item through its own route and keeps item failures isolated", async () => {
    const { mountActionRoutes } = await import("./action-routes.js");
    const { default: batchAction } = await import("./get-actions-batch.js");
    const routes = new Map<string, any>();
    const listRun = vi.fn(async () => ({ designs: [{ id: "d1" }] }));
    const saveRun = vi.fn(async () => ({ saved: true }));
    const deckRun = vi.fn(async () => {
      throw Object.assign(new Error("Not allowed for this deck"), {
        statusCode: 403,
        errorCode: "forbidden",
      });
    });
    const nitroApp: any = {
      use: (path: string, handler: any) => routes.set(path, handler),
    };
    nitroApp.fetch = async (request: Request): Promise<Response> => {
      const handler = routes.get(new URL(request.url).pathname);
      if (!handler) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
        });
      }
      const event: any = {
        _method: request.method,
        _headers: Object.fromEntries(request.headers),
        headers: request.headers,
        _query: {},
        req: request,
      };
      let body: unknown;
      try {
        body = await handler(event);
      } catch (error) {
        event._status = (error as { statusCode?: number }).statusCode ?? 500;
        body = { error: (error as Error).message };
      }
      return new Response(JSON.stringify(body ?? null), {
        status: event._status ?? 200,
        headers: {
          "Content-Type": "application/json",
          ...(event._responseHeaders ?? {}),
        },
      });
    };

    mountActionRoutes(nitroApp, {
      "list-designs": {
        http: { method: "GET" },
        requiresAuth: false,
        run: listRun,
      },
      "save-deck": {
        http: { method: "POST" },
        requiresAuth: false,
        run: saveRun,
      },
      "get-deck": {
        http: { method: "GET" },
        requiresAuth: false,
        run: deckRun,
      },
      "get-actions-batch": batchAction,
    } as any);

    const response = await nitroApp.fetch(
      new Request("http://app.test/_agent-native/actions/get-actions-batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Native-Frontend": "1",
        },
        body: JSON.stringify({
          requests: [
            { action: "list-designs", query: "limit=5" },
            { action: "save-deck", query: "" },
            { action: "get-deck", query: "" },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const { results } = await response.json();
    expect(results[0]).toMatchObject({
      status: 200,
      body: { designs: [{ id: "d1" }] },
    });
    expect(results[1]).toMatchObject({ status: 405 });
    expect(results[2]).toEqual({
      status: 403,
      error: { error: "Not allowed for this deck", errorCode: "forbidden" },
      headers: {},
    });
    expect(listRun).toHaveBeenCalledTimes(1);
    expect(saveRun).not.toHaveBeenCalled();
    expect(deckRun).toHaveBeenCalledTimes(1);
  });
});
