import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A self-contained spec for the additional session provider, kept apart from
// auth.spec.ts (which reaches into the Design template, so cannot run in the
// mutation sandbox) so that the lines it covers are mutation-tested.

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExistsConcurrently: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));

function createMockApp(): any {
  return { use: vi.fn() };
}

function createMockEvent(opts?: { headers?: Record<string, string> }): any {
  const headers = opts?.headers || {};
  const requestHeaders = new Headers({ host: "localhost", ...headers });
  return {
    req: {
      method: "GET",
      url: "http://localhost/",
      headers: requestHeaders,
    },
    url: new URL("http://localhost/"),
    res: { headers: new Headers(), status: 200 },
    node: {
      req: {
        headers: { host: "localhost", ...headers },
        url: "/",
        method: "GET",
      },
      res: {
        setHeader: vi.fn(),
        getHeader: vi.fn(),
        appendHeader: vi.fn(),
      },
    },
    headers: requestHeaders,
    context: {},
    path: "/",
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("./better-auth-instance.js");
  vi.doUnmock("../db/client.js");
  vi.doUnmock("./framework-request-handler.js");
});

describe("additional session provider", () => {
  const memberEmail = "member@example.com";
  const hostEmail = "host-user@example.com";
  let builtInSession: ReturnType<typeof vi.fn>;

  function mockBuiltInAuth() {
    builtInSession = vi.fn(async () => ({
      user: { id: "ba-user", email: memberEmail },
      session: { token: "ba-token" },
    }));
    vi.doMock("./better-auth-instance.js", () => ({
      getBetterAuth: vi.fn(async () => ({
        handler: vi.fn(async () => new Response("{}")),
        api: {
          getSession: builtInSession,
          signInEmail: vi.fn(),
          signInMagicLink: vi.fn(),
          signUpEmail: vi.fn(),
          signOut: vi.fn(),
        },
      })),
      getBetterAuthSync: vi.fn(() => undefined),
    }));
    vi.doMock("../db/client.js", () => ({
      getDbExec: () => {
        const execute = vi.fn(async (query: any) => {
          const sql = typeof query === "string" ? query : query.sql;
          return sql?.includes("to_regclass")
            ? { rows: [{ user_table: "user", session_table: "session" }] }
            : { rows: [] };
        });
        return {
          execute,
          transaction: async (
            run: (tx: { execute: typeof execute }) => unknown,
          ) => run({ execute }),
        };
      },
      getRefusedLocalDatabaseSource: () => null,
      isLocalDatabase: () => true,
      retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
      describeDbError: (error: unknown) => String(error),
    }));
    vi.doMock("./framework-request-handler.js", () => ({
      getH3App: (app: any) => app,
    }));
  }

  const cookieEvent = () =>
    createMockEvent({ headers: { cookie: "host-login=1" } });

  it("uses the provider's session when it recognizes the request", async () => {
    mockBuiltInAuth();
    const { autoMountAuth, getSession } = await import("./auth.js");
    const getAdditionalSession = vi.fn(async () => ({ email: hostEmail }));
    await autoMountAuth(createMockApp(), { getAdditionalSession });

    await expect(getSession(cookieEvent())).resolves.toMatchObject({
      email: hostEmail,
    });
    expect(builtInSession).not.toHaveBeenCalled();
  });

  it("does not let the cookie provider override an explicit bearer credential", async () => {
    mockBuiltInAuth();
    const { autoMountAuth, getSession } = await import("./auth.js");
    const getAdditionalSession = vi.fn(async () => ({ email: hostEmail }));
    await autoMountAuth(createMockApp(), { getAdditionalSession });

    const event = createMockEvent({
      headers: { cookie: "host-login=1", authorization: "Bearer some-token" },
    });
    const session = await getSession(event);

    expect(getAdditionalSession).not.toHaveBeenCalled();
    expect(session?.email).not.toBe(hostEmail);
  });

  it("still uses the cookie provider when the authorization header is not a bearer credential", async () => {
    mockBuiltInAuth();
    const { autoMountAuth, getSession } = await import("./auth.js");
    await autoMountAuth(createMockApp(), {
      getAdditionalSession: async () => ({ email: hostEmail }),
    });

    await expect(
      getSession(
        createMockEvent({
          headers: { cookie: "host-login=1", authorization: "Basic abc" },
        }),
      ),
    ).resolves.toMatchObject({ email: hostEmail });
  });

  it("resolves the built-in session when the provider does not recognize the request", async () => {
    mockBuiltInAuth();
    const { autoMountAuth, getSession } = await import("./auth.js");
    const getAdditionalSession = vi.fn(async () => null);
    await autoMountAuth(createMockApp(), { getAdditionalSession });

    await expect(getSession(cookieEvent())).resolves.toMatchObject({
      email: memberEmail,
    });
    expect(getAdditionalSession).toHaveBeenCalled();
  });

  it("refuses the request, rather than becoming another identity, when the provider cannot answer", async () => {
    mockBuiltInAuth();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { autoMountAuth, getSession, isSessionResolutionUnavailable } =
        await import("./auth.js");
      await autoMountAuth(createMockApp(), {
        getAdditionalSession: async () => {
          throw new Error("provider down");
        },
      });
      const event = cookieEvent();

      // A built-in session exists for this browser, but it is not who the
      // request claimed to be: no session, and a 503 rather than a 401.
      await expect(getSession(event)).resolves.toBeNull();
      expect(isSessionResolutionUnavailable(event)).toBe(true);
      expect(builtInSession).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it("keeps the built-in sign-in routes instead of replacing them", async () => {
    mockBuiltInAuth();
    const { autoMountAuth } = await import("./auth.js");
    const app = createMockApp();
    await autoMountAuth(app, { getAdditionalSession: async () => null });

    const mounted = app.use.mock.calls.map((call: any[]) => call[0]);
    expect(mounted).toContain("/_agent-native/auth/ba");

    const replaced = createMockApp();
    await import("./auth.js").then(({ autoMountAuth: mount }) =>
      mount(replaced, { getSession: async () => null }),
    );
    expect(replaced.use.mock.calls.map((call: any[]) => call[0])).not.toContain(
      "/_agent-native/auth/ba",
    );
  });

  it("leaves getSession in charge when both are set", async () => {
    mockBuiltInAuth();
    const { autoMountAuth, getSession } = await import("./auth.js");
    const getAdditionalSession = vi.fn(async () => ({ email: hostEmail }));
    await autoMountAuth(createMockApp(), {
      getSession: async () => ({ email: "custom@example.com" }),
      getBrowserSession: async () => ({ email: "custom@example.com" }),
      getAdditionalSession,
    });

    await expect(getSession(cookieEvent())).resolves.toMatchObject({
      email: "custom@example.com",
    });
    expect(getAdditionalSession).not.toHaveBeenCalled();
  });

  describe("in browser-cookie checks", () => {
    it("uses the provider's cookie session when it recognizes the request", async () => {
      mockBuiltInAuth();
      const { autoMountAuth, getBrowserCookieSession } =
        await import("./auth.js");
      await autoMountAuth(createMockApp(), {
        getAdditionalSession: async () => null,
        getAdditionalBrowserSession: async () => ({ email: hostEmail }),
      });

      await expect(
        getBrowserCookieSession(cookieEvent()),
      ).resolves.toMatchObject({ email: hostEmail });
      expect(builtInSession).not.toHaveBeenCalled();
    });

    it("does not ask the provider about a request with no cookie", async () => {
      mockBuiltInAuth();
      const { autoMountAuth, getBrowserCookieSession } =
        await import("./auth.js");
      const getAdditionalBrowserSession = vi.fn(async () => ({
        email: hostEmail,
      }));
      await autoMountAuth(createMockApp(), {
        getAdditionalSession: async () => null,
        getAdditionalBrowserSession,
      });

      await expect(
        getBrowserCookieSession(createMockEvent()),
      ).resolves.toBeNull();
      expect(getAdditionalBrowserSession).not.toHaveBeenCalled();
    });

    it("resolves the built-in cookie session when the provider returns null, and refuses when it cannot answer", async () => {
      mockBuiltInAuth();
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const {
          autoMountAuth,
          getBrowserCookieSession,
          isSessionResolutionUnavailable,
        } = await import("./auth.js");
        let behavior: "null" | "throw" = "null";
        await autoMountAuth(createMockApp(), {
          getAdditionalSession: async () => null,
          getAdditionalBrowserSession: async () => {
            if (behavior === "throw") throw new Error("provider down");
            return null;
          },
        });

        await expect(
          getBrowserCookieSession(cookieEvent()),
        ).resolves.toMatchObject({ email: memberEmail });
        behavior = "throw";
        const failing = cookieEvent();
        await expect(getBrowserCookieSession(failing)).resolves.toBeNull();
        expect(isSessionResolutionUnavailable(failing)).toBe(true);
      } finally {
        error.mockRestore();
      }
    });
  });

  describe("when auth is mounted again on the same app", () => {
    it("adds a provider on the second mount", async () => {
      mockBuiltInAuth();
      const { autoMountAuth, getSession } = await import("./auth.js");
      const app = createMockApp();
      await autoMountAuth(app);
      await autoMountAuth(app, {
        getAdditionalSession: async () => ({ email: hostEmail }),
        getAdditionalBrowserSession: async () => ({ email: hostEmail }),
        trustCustomEmailVerification: true,
      });

      await expect(getSession(cookieEvent())).resolves.toMatchObject({
        email: hostEmail,
        emailVerified: true,
      });
    });

    it("lets a later getSession take over from the provider", async () => {
      mockBuiltInAuth();
      const { autoMountAuth, getSession } = await import("./auth.js");
      const app = createMockApp();
      const getAdditionalSession = vi.fn(async () => ({ email: hostEmail }));
      await autoMountAuth(app, { getAdditionalSession });
      await autoMountAuth(app, {
        getSession: async () => ({ email: "custom@example.com" }),
      });

      await expect(getSession(cookieEvent())).resolves.toMatchObject({
        email: "custom@example.com",
      });
      expect(getAdditionalSession).not.toHaveBeenCalled();
    });
  });

  describe("on sign-out", () => {
    it("ends the provider's session too", async () => {
      mockBuiltInAuth();
      const { autoMountAuth, logout } = await import("./auth.js");
      const clearAdditionalSession = vi.fn(async () => {});
      await autoMountAuth(createMockApp(), {
        getAdditionalSession: async () => ({ email: hostEmail }),
        clearAdditionalSession,
      });

      await expect(logout(cookieEvent())).resolves.toEqual({ ok: true });
      expect(clearAdditionalSession).toHaveBeenCalledTimes(1);
    });

    it("reports a failed sign-out when the provider's session could not be ended", async () => {
      mockBuiltInAuth();
      const { autoMountAuth, logout } = await import("./auth.js");
      await autoMountAuth(createMockApp(), {
        getAdditionalSession: async () => ({ email: hostEmail }),
        clearAdditionalSession: async () => {
          throw new Error("store down");
        },
      });
      const event = cookieEvent();

      await expect(logout(event)).resolves.toEqual({
        error: "Unable to revoke session",
      });
      expect(event.res.status).toBe(503);
    });

    it("ends the provider's session on sign-out of all sessions too", async () => {
      mockBuiltInAuth();
      const { autoMountAuth } = await import("./auth.js");
      const clearAdditionalSession = vi.fn(async () => {});
      const app = createMockApp();
      await autoMountAuth(app, {
        getAdditionalSession: async () => ({ email: hostEmail }),
        clearAdditionalSession,
      });
      const handler = app.use.mock.calls.find(
        (call: any[]) => call[0] === "/_agent-native/auth/logout-all",
      )?.[1];
      const event = cookieEvent();
      event.req.method = "POST";

      await expect(handler(event)).resolves.toEqual({ ok: true });
      expect(clearAdditionalSession).toHaveBeenCalledTimes(1);
    });

    it("signs out normally when there is no additional provider", async () => {
      mockBuiltInAuth();
      const { autoMountAuth, logout } = await import("./auth.js");
      await autoMountAuth(createMockApp());

      await expect(logout(cookieEvent())).resolves.toEqual({ ok: true });
    });
  });

  it("marks the provider's sessions verified only when the host opts in", async () => {
    mockBuiltInAuth();
    const { autoMountAuth, getSession } = await import("./auth.js");
    await autoMountAuth(createMockApp(), {
      getAdditionalSession: async () => ({ email: hostEmail }),
      trustCustomEmailVerification: true,
    });

    await expect(getSession(cookieEvent())).resolves.toMatchObject({
      email: hostEmail,
      emailVerified: true,
    });
  });
});
