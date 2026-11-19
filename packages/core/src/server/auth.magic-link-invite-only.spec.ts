import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";

// On an invite-only workspace Better Auth refuses a stranger's magic link
// inside verify and answers in JSON. These specs pin the page, the desktop
// redirect, and the cases that keep JSON. They live outside auth.spec.ts,
// which imports from templates/, so that they run in the mutation sandbox.

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExistsConcurrently: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));

const AUTH_PUBLIC_PATHS_REGISTRY_KEY = Symbol.for(
  "@agent-native/core/auth.publicPaths",
);
const INVITE_ONLY_MESSAGE =
  "This workspace is invite-only. Ask an administrator for an invitation.";
const DESKTOP_CALLBACK_PATH = "/_agent-native/auth/magic-link/desktop-callback";

function clearAuthPublicPathRegistry(): void {
  const globalState = globalThis as unknown as {
    [key: symbol]: unknown;
  };
  delete globalState[AUTH_PUBLIC_PATHS_REGISTRY_KEY];
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createMockApp(): any {
  return { use: vi.fn() };
}

function createMockEvent(opts?: {
  query?: Record<string, string>;
  headers?: Record<string, string>;
  path?: string;
}): any {
  const query = opts?.query || {};
  const headers = opts?.headers || {};
  const qs = new URLSearchParams(query).toString();
  const pathname = opts?.path || "/";
  const url = qs ? `${pathname}?${qs}` : pathname;
  const requestHeaders = new Headers({ host: "localhost", ...headers });
  return {
    req: {
      method: "GET",
      url: `http://localhost${url}`,
      headers: requestHeaders,
    },
    url: new URL(`http://localhost${url}`),
    res: { headers: new Headers(), status: 200 },
    node: {
      req: { headers: { host: "localhost", ...headers }, url, method: "GET" },
      res: { setHeader: vi.fn(), getHeader: vi.fn(), appendHeader: vi.fn() },
    },
    headers: requestHeaders,
    context: {},
    path: url,
    _cookies: {},
  };
}

function createPostEvent(path: string, request: Request): any {
  const requestHeaders = Object.fromEntries(request.headers.entries());
  const event = createMockEvent({ path, headers: requestHeaders });
  event.req = request;
  event.headers = request.headers;
  event.node.req.method = "POST";
  event.node.req.headers = requestHeaders;
  return event;
}

function createJsonPostEvent(path: string, body: unknown): any {
  return createPostEvent(
    path,
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function createFormPostEvent(path: string, body: Record<string, string>): any {
  return createPostEvent(
    path,
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    }),
  );
}

/** Calls the Better Auth catch-all route the way h3 mounts it. */
function verifyThrough(baHandler: (event: any) => Promise<any>) {
  return (fullPath: string) => {
    const request = new Request(`http://localhost${fullPath}`, {
      method: "GET",
      headers: { host: "localhost" },
    });
    return baHandler({
      req: request,
      url: new URL(`http://localhost${fullPath}`),
      res: { headers: new Headers(), status: 200 },
      node: {
        req: { headers: { host: "localhost" }, url: fullPath, method: "GET" },
        res: { setHeader: vi.fn(), getHeader: vi.fn(), appendHeader: vi.fn() },
      },
      headers: request.headers,
      context: {
        _mountedPathname: fullPath,
        _mountPrefix: "/_agent-native/auth/ba",
      },
      path: fullPath,
    }) as Promise<Response>;
  };
}

describe("magic-link verify on an invite-only workspace", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    clearAuthPublicPathRegistry();
  });

  afterEach(() => {
    clearAuthPublicPathRegistry();
    resetAppConfigForTests();
    process.env = originalEnv;
    vi.doUnmock("./better-auth-instance.js");
    vi.doUnmock("../db/client.js");
    vi.doUnmock("../org/context.js");
    vi.resetModules();
  });

  it("shows a stranger's magic link the invite-only page instead of JSON", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.ACCESS_TOKEN;
    delete process.env.ACCESS_TOKENS;

    vi.doMock("../db/client.js", () => ({
      getDbExec: () => ({
        execute: vi.fn(async () => ({ rows: [] })),
      }),
      retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
      describeDbError: (err: unknown) => String(err),
    }));
    // Better Auth refuses the new user inside verify and answers in JSON. The
    // token picks the refusal, so one mount covers each case.
    vi.doMock("./better-auth-instance.js", () => ({
      getBetterAuth: vi.fn(async () => ({
        handler: async (request: Request) =>
          new URL(request.url).searchParams.get("token") === "forbidden-token"
            ? jsonResponse(403, { code: "FORBIDDEN", message: "FORBIDDEN" })
            : jsonResponse(403, {
                code: "INVITE_ONLY",
                message: "INVITE_ONLY",
              }),
        api: {
          getSession: vi.fn(async () => null),
          signInEmail: vi.fn(),
          signUpEmail: vi.fn(),
          signOut: vi.fn(),
        },
      })),
      getBetterAuthSync: vi.fn(() => undefined),
    }));

    const { autoMountAuth } = await import("./auth.js");
    const app = createMockApp();
    await autoMountAuth(app);

    const baHandler = app.use.mock.calls.find(
      (call: any[]) => call[0] === "/_agent-native/auth/ba",
    )?.[1];
    expect(baHandler).toBeTypeOf("function");
    const verify = verifyThrough(baHandler);
    const verifyPath = "/_agent-native/auth/ba/magic-link/verify";

    const page = await verify(
      `${verifyPath}?token=stranger-token&callbackURL=%2F`,
    );
    expect(page.status).toBe(403);
    expect(page.headers.get("content-type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain(INVITE_ONLY_MESSAGE);
    expect(html).toContain('href="/sign-in"');
    expect(html).not.toContain("INVITE_ONLY");

    // A desktop error callback on this origin gets the error redirect.
    const errorCallbackURL = encodeURIComponent(
      `${DESKTOP_CALLBACK_PATH}?flow_id=flow-1`,
    );
    const redirect = await verify(
      `${verifyPath}?token=stranger-token&callbackURL=%2F&errorCallbackURL=${errorCallbackURL}`,
    );
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("cache-control")).toBe("no-store");
    expect(redirect.headers.get("referrer-policy")).toBe("no-referrer");
    const location = new URL(redirect.headers.get("location")!);
    expect(location.pathname).toBe(DESKTOP_CALLBACK_PATH);
    expect(location.searchParams.get("flow_id")).toBe("flow-1");
    expect(location.searchParams.get("error")).toBe("INVITE_ONLY");

    // The same path on another origin, or another path here, gets the page.
    for (const elsewhere of [
      `https://elsewhere.example${DESKTOP_CALLBACK_PATH}`,
      "/settings",
    ]) {
      const refused = await verify(
        `${verifyPath}?token=stranger-token&callbackURL=%2F&errorCallbackURL=${encodeURIComponent(elsewhere)}`,
      );
      expect(refused.status).toBe(403);
      expect(refused.headers.get("location")).toBeNull();
      await expect(refused.text()).resolves.toContain(INVITE_ONLY_MESSAGE);
    }

    // Without a callbackURL the verify is an API call, so it keeps JSON.
    const api = await verify(`${verifyPath}?token=stranger-token`);
    expect(api.status).toBe(403);
    await expect(api.json()).resolves.toMatchObject({ code: "INVITE_ONLY" });

    // Any other refusal keeps Better Auth's JSON.
    const forbidden = await verify(
      `${verifyPath}?token=forbidden-token&callbackURL=%2F`,
    );
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get("content-type")).toContain("application/json");
  });

  it("tells the desktop app when a stranger's magic link is invite-only", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RESEND_API_KEY", "resend-example-key");
    const getSession = vi.fn(async () => null);
    vi.doMock("./better-auth-instance.js", () => ({
      getBetterAuth: vi.fn(async () => ({
        handler: vi.fn(async () =>
          jsonResponse(403, { code: "INVITE_ONLY", message: "INVITE_ONLY" }),
        ),
        api: {
          getSession,
          signInEmail: vi.fn(),
          signInMagicLink: vi.fn(async () => ({ status: true })),
          signUpEmail: vi.fn(),
          signOut: vi.fn(),
        },
      })),
      getBetterAuthSync: vi.fn(() => ({ api: { getSession } })),
    }));
    vi.doMock("../db/client.js", () => ({
      getDbExec: () => ({ execute: vi.fn(async () => ({ rows: [] })) }),
      getRefusedLocalDatabaseSource: () => null,
      isLocalDatabase: () => true,
      retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
    }));
    vi.doMock("../org/context.js", () => ({
      resolveOrgIdForEmailViaEvent: vi.fn(async () => null),
    }));

    const { autoMountAuth } = await import("./auth.js");
    const app = createMockApp();
    await autoMountAuth(app);
    const handlerFor = (path: string) =>
      app.use.mock.calls.find((call: any[]) => call[0] === path)?.[1];
    const magicLinkHandler = handlerFor("/_agent-native/auth/magic-link");
    const landingHandler = handlerFor(
      "/_agent-native/auth/magic-link/desktop-landing",
    );
    const callbackHandler = handlerFor(DESKTOP_CALLBACK_PATH);
    const exchangeHandler = handlerFor("/_agent-native/auth/desktop-exchange");

    const flow = await magicLinkHandler(
      createJsonPostEvent("/_agent-native/auth/magic-link", {
        email: "stranger@example.com",
        callbackURL: DESKTOP_CALLBACK_PATH,
      }),
    );
    expect(flow).toMatchObject({ ok: true, flowId: expect.any(String) });

    const landing = await landingHandler(
      createFormPostEvent("/_agent-native/auth/magic-link/desktop-landing", {
        token: "stranger-token",
        callbackURL:
          `${DESKTOP_CALLBACK_PATH}?flow_id=${flow.flowId}` +
          `&verifier=${flow.verifier}`,
      }),
    );
    expect(landing).toBeInstanceOf(Response);
    expect((landing as Response).status).toBe(302);
    expect((landing as Response).headers.get("cache-control")).toBe("no-store");
    const callback = new URL(
      (landing as Response).headers.get("location")!,
      "http://localhost",
    );
    expect(callback.pathname).toBe(DESKTOP_CALLBACK_PATH);
    expect(callback.searchParams.get("error")).toBe("INVITE_ONLY");

    const callbackPage = await callbackHandler(
      createMockEvent({
        path: callback.pathname,
        query: Object.fromEntries(callback.searchParams),
      }),
    );
    expect((callbackPage as Response).status).toBe(403);
    await expect((callbackPage as Response).text()).resolves.toContain(
      INVITE_ONLY_MESSAGE,
    );

    await expect(
      exchangeHandler(
        createMockEvent({
          path: "/_agent-native/auth/desktop-exchange",
          query: { flow_id: flow.flowId },
          headers: { "x-agent-native-desktop-verifier": flow.verifier },
        }),
      ),
    ).resolves.toMatchObject({
      error: INVITE_ONLY_MESSAGE,
      code: "INVITE_ONLY",
    });
  });
});
