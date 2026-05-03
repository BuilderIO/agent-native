import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("server/auth", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.doUnmock("./better-auth-instance.js");
    vi.doUnmock("../db/client.js");
    vi.resetModules();
  });

  describe("shouldSkipEmailVerification", () => {
    it("is enabled by default in development and test", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const { shouldSkipEmailVerification } =
        await import("./better-auth-instance.js");

      expect(shouldSkipEmailVerification()).toBe(true);

      vi.stubEnv("NODE_ENV", "test");
      expect(shouldSkipEmailVerification()).toBe(true);
    });

    it("is disabled by default in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      const { shouldSkipEmailVerification } =
        await import("./better-auth-instance.js");

      expect(shouldSkipEmailVerification()).toBe(false);
    });

    it("is enabled by AUTH_SKIP_EMAIL_VERIFICATION=1", async () => {
      vi.stubEnv("AUTH_SKIP_EMAIL_VERIFICATION", "1");
      const { shouldSkipEmailVerification } =
        await import("./better-auth-instance.js");

      expect(shouldSkipEmailVerification()).toBe(true);
    });

    it("treats blank, false, and 0 as disabled", async () => {
      const { shouldSkipEmailVerification } =
        await import("./better-auth-instance.js");

      vi.stubEnv("AUTH_SKIP_EMAIL_VERIFICATION", "");
      expect(shouldSkipEmailVerification()).toBe(false);

      vi.stubEnv("AUTH_SKIP_EMAIL_VERIFICATION", "false");
      expect(shouldSkipEmailVerification()).toBe(false);

      vi.stubEnv("AUTH_SKIP_EMAIL_VERIFICATION", "0");
      expect(shouldSkipEmailVerification()).toBe(false);
    });
  });

  describe("autoMountAuth", () => {
    it("throws when app is null/undefined in production mode", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "secret");
      delete process.env.AUTH_MODE;
      const { autoMountAuth } = await import("./auth.js");

      await expect(autoMountAuth(null as any)).rejects.toThrow(
        "autoMountAuth: H3 app is required",
      );
    });

    it("returns false when app is null in local mode", async () => {
      vi.stubEnv("AUTH_MODE", "local");
      const { autoMountAuth } = await import("./auth.js");

      expect(await autoMountAuth(null as any)).toBe(false);
    });

    it("returns false when app is null in dev mode", async () => {
      vi.stubEnv("NODE_ENV", "development");
      delete process.env.AUTH_MODE;
      const { autoMountAuth } = await import("./auth.js");

      expect(await autoMountAuth(null as any)).toBe(false);
    });

    it("returns false in AUTH_MODE=local (auth skipped)", async () => {
      vi.stubEnv("AUTH_MODE", "local");
      const { autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      expect(await autoMountAuth(app)).toBe(false);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("local"));
      logSpy.mockRestore();
    });

    it("enables Better Auth in dev when AUTH_MODE=local is not set", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("DEBUG", "1");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      delete process.env.AUTH_DISABLED;
      delete process.env.AUTH_MODE;
      const { autoMountAuth } = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const app = createMockApp();
      const result = await autoMountAuth(app);

      expect(result).toBe(true);
      const allLogs = logSpy.mock.calls.map((c) => c[0]).join(" ");
      expect(
        allLogs.includes("Better Auth") ||
          allLogs.includes("Auth guard registered"),
      ).toBe(true);
      logSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("returns false when AUTH_DISABLED=true in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AUTH_DISABLED", "true");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      delete process.env.AUTH_MODE;
      const { autoMountAuth } = await import("./auth.js");

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const app = createMockApp();
      expect(await autoMountAuth(app)).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("enables Better Auth when no tokens in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("DEBUG", "1");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      delete process.env.AUTH_DISABLED;
      delete process.env.AUTH_MODE;
      const { autoMountAuth } = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const app = createMockApp();
      const result = await autoMountAuth(app);

      // Returns true even if Better Auth init fails — auth guard is still
      // registered as a fallback to block unauthenticated access.
      expect(result).toBe(true);
      // Either Better Auth initialized successfully, or the fallback guard was registered
      const allLogs = logSpy.mock.calls.map((c) => c[0]).join(" ");
      expect(
        allLogs.includes("Better Auth") ||
          allLogs.includes("Auth guard registered"),
      ).toBe(true);
      logSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("mounts generic Google OAuth routes by default when credentials are configured", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("GOOGLE_CLIENT_ID", "google-client");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-secret");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      delete process.env.AUTH_DISABLED;
      delete process.env.AUTH_MODE;

      vi.doMock("./better-auth-instance.js", () => ({
        getBetterAuth: vi.fn(async () => ({
          handler: vi.fn(async () => new Response("{}")),
          api: {
            getSession: vi.fn(async () => null),
            signInEmail: vi.fn(),
            signUpEmail: vi.fn(),
            signOut: vi.fn(),
            listOrganizations: vi.fn(),
          },
        })),
        getBetterAuthSync: vi.fn(() => undefined),
      }));

      const { autoMountAuth } = await import("./auth.js");
      const app = createMockApp();
      await autoMountAuth(app);

      const paths = app.use.mock.calls
        .map((call: any[]) => call[0])
        .filter((path: unknown): path is string => typeof path === "string");
      expect(paths).toContain("/_agent-native/google/auth-url");
      expect(paths).toContain("/_agent-native/google/callback");
    });

    it("lets templates own Google OAuth routes when opted out", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("GOOGLE_CLIENT_ID", "google-client");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-secret");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      delete process.env.AUTH_DISABLED;
      delete process.env.AUTH_MODE;

      vi.doMock("./better-auth-instance.js", () => ({
        getBetterAuth: vi.fn(async () => ({
          handler: vi.fn(async () => new Response("{}")),
          api: {
            getSession: vi.fn(async () => null),
            signInEmail: vi.fn(),
            signUpEmail: vi.fn(),
            signOut: vi.fn(),
            listOrganizations: vi.fn(),
          },
        })),
        getBetterAuthSync: vi.fn(() => undefined),
      }));

      const { autoMountAuth } = await import("./auth.js");
      const app = createMockApp();
      await autoMountAuth(app, {
        googleOnly: true,
        mountGoogleOAuthRoutes: false,
      });

      const paths = app.use.mock.calls
        .map((call: any[]) => call[0])
        .filter((path: unknown): path is string => typeof path === "string");
      expect(paths).not.toContain("/_agent-native/google/auth-url");
      expect(paths).not.toContain("/_agent-native/google/callback");
      expect(paths).toContain("/_agent-native/auth/ba");
    });

    it("passes through an already-mounted generic Google route when a template opts out later", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("GOOGLE_CLIENT_ID", "google-client");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-secret");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      delete process.env.AUTH_DISABLED;
      delete process.env.AUTH_MODE;

      vi.doMock("./better-auth-instance.js", () => ({
        getBetterAuth: vi.fn(async () => ({
          handler: vi.fn(async () => new Response("{}")),
          api: {
            getSession: vi.fn(async () => null),
            signInEmail: vi.fn(),
            signUpEmail: vi.fn(),
            signOut: vi.fn(),
            listOrganizations: vi.fn(),
          },
        })),
        getBetterAuthSync: vi.fn(() => undefined),
      }));

      const { autoMountAuth } = await import("./auth.js");
      const app = createMockApp();
      await autoMountAuth(app);

      const authUrlHandler = app.use.mock.calls.find(
        (call: any[]) => call[0] === "/_agent-native/google/auth-url",
      )?.[1];
      expect(authUrlHandler).toBeTypeOf("function");

      await autoMountAuth(app, {
        googleOnly: true,
        mountGoogleOAuthRoutes: false,
      });

      expect(
        await authUrlHandler(
          createMockEvent({ path: "/_agent-native/google/auth-url" }),
        ),
      ).toBeUndefined();
    });

    it("mounts auth when ACCESS_TOKEN is set in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "my-secret");
      vi.stubEnv("DEBUG", "1");
      delete process.env.AUTH_MODE;
      const { autoMountAuth } = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const app = createMockApp();
      const result = await autoMountAuth(app);

      expect(result).toBe(true);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("1 access token(s)"),
      );
      logSpy.mockRestore();
    });

    it("recognizes auth routes under APP_BASE_PATH in the global guard", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "my-secret");
      vi.stubEnv("APP_BASE_PATH", "/docs");
      delete process.env.AUTH_MODE;
      const { autoMountAuth } = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const app = createMockApp();
      await autoMountAuth(app);
      logSpy.mockRestore();

      const guard = app.use.mock.calls
        .map((call: any[]) => call[0])
        .find((arg: unknown) => typeof arg === "function");
      expect(guard).toBeTypeOf("function");

      const result = await guard(
        createMockEvent({ path: "/docs/_agent-native/auth/session" }),
      );
      expect(result).toBeUndefined();
    });

    it("serves mounted login and signup pages from the framework guard", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      delete process.env.AUTH_DISABLED;
      delete process.env.AUTH_MODE;
      const { autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app, {
        getSession: async () => null,
        loginHtml: "<!doctype html><title>QA login</title>",
      });

      const guard = app.use.mock.calls
        .map((call: any[]) => call[0])
        .find((arg: unknown) => typeof arg === "function");
      expect(guard).toBeTypeOf("function");

      for (const path of ["/dispatch/login", "/dispatch/signup"]) {
        const result = await guard(createMockEvent({ path }));

        expect(result).toBeInstanceOf(Response);
        expect((result as Response).status).toBe(200);
        expect(await (result as Response).text()).toContain("QA login");
      }
    });

    it("redirects mounted login and signup pages when a session already exists", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      delete process.env.AUTH_DISABLED;
      delete process.env.AUTH_MODE;
      const { autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app, {
        getSession: async () => ({ email: "qa+local@example.com" }),
        loginHtml: "<!doctype html><title>QA login</title>",
      });

      const guard = app.use.mock.calls
        .map((call: any[]) => call[0])
        .find((arg: unknown) => typeof arg === "function");
      expect(guard).toBeTypeOf("function");

      for (const path of ["/dispatch/login", "/dispatch/signup"]) {
        const result = await guard(createMockEvent({ path }));

        expect(result).toBeInstanceOf(Response);
        expect((result as Response).status).toBe(302);
        expect((result as Response).headers.get("location")).toBe("/dispatch");
      }
    });

    it("allows app-state request-source headers in CORS preflight responses", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "my-secret");
      delete process.env.AUTH_MODE;
      const { autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app);

      const guard = app.use.mock.calls
        .map((call: any[]) => call[0])
        .find((arg: unknown) => typeof arg === "function");
      expect(guard).toBeTypeOf("function");

      const event = createMockEvent({
        path: "/_agent-native/application-state/navigation",
        headers: {
          origin: "http://localhost:1420",
          "access-control-request-method": "PUT",
          "access-control-request-headers": "x-request-source,content-type",
        },
      });
      event.req.method = "OPTIONS";
      event.node.req.method = "OPTIONS";

      const result = await guard(event);

      expect(result).toBe("");
      expect(event.res.status).toBe(204);
      expect(event.res.headers.get("access-control-allow-methods")).toContain(
        "HEAD",
      );
      expect(event.res.headers.get("access-control-allow-headers")).toContain(
        "X-Request-Source",
      );
    });

    it("rejects disallowed cross-origin preflight before auth", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "my-secret");
      delete process.env.AUTH_MODE;
      const { autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app);

      const guard = app.use.mock.calls
        .map((call: any[]) => call[0])
        .find((arg: unknown) => typeof arg === "function");
      expect(guard).toBeTypeOf("function");

      const event = createMockEvent({
        path: "/_agent-native/actions/list-decks",
        headers: {
          origin: "https://evil.example",
          "access-control-request-method": "GET",
        },
      });
      event.req.method = "OPTIONS";
      event.node.req.method = "OPTIONS";

      const result = await guard(event);

      expect(result).toBe("");
      expect(event.res.status).toBe(403);
      expect(event.res.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("accepts HEAD on the auth session endpoint", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "my-secret");
      delete process.env.AUTH_MODE;
      const { autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app);

      const sessionHandler = app.use.mock.calls.find(
        (call: any[]) => call[0] === "/_agent-native/auth/session",
      )?.[1];
      expect(sessionHandler).toBeTypeOf("function");

      const event = createMockEvent({ path: "/_agent-native/auth/session" });
      event.req.method = "HEAD";
      event.node.req.method = "HEAD";

      const result = await sessionHandler(event);

      expect(event.res.status).toBe(200);
      expect(result).toEqual({ error: "Not authenticated" });
    });

    it("desktop exchange establishes the session cookie when redeeming a token", async () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      delete process.env.AUTH_DISABLED;
      delete process.env.AUTH_MODE;

      const mockExecute = vi.fn().mockImplementation(({ sql, args }: any) => {
        if (
          typeof sql === "string" &&
          sql.includes("DELETE FROM sessions") &&
          args?.[0] === "dex:flow-1"
        ) {
          return {
            rows: [{ email: "session-token-abc::user@gmail.com" }],
          };
        }
        return { rows: [] };
      });
      vi.doMock("../db/client.js", () => ({
        getDbExec: () => ({ execute: mockExecute }),
        isPostgres: () => false,
        isLocalDatabase: () => false,
        intType: () => "INTEGER",
        retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
      }));
      vi.doMock("./better-auth-instance.js", () => ({
        getBetterAuth: vi.fn(async () => ({
          handler: vi.fn(async () => new Response("{}")),
          api: {
            getSession: vi.fn(async () => null),
            signInEmail: vi.fn(),
            signUpEmail: vi.fn(),
            signOut: vi.fn(),
            listOrganizations: vi.fn(),
          },
        })),
        getBetterAuthSync: vi.fn(() => undefined),
      }));

      const { autoMountAuth } = await import("./auth.js");
      const app = createMockApp();
      await autoMountAuth(app);

      const exchangeHandler = app.use.mock.calls.find(
        (call: any[]) => call[0] === "/_agent-native/auth/desktop-exchange",
      )?.[1];
      expect(exchangeHandler).toBeTypeOf("function");

      const event = createMockEvent({
        path: "/_agent-native/auth/desktop-exchange",
        query: { flow_id: "flow-1" },
      });
      const result = await exchangeHandler(event);

      expect(result).toEqual({
        token: "session-token-abc",
        email: "user@gmail.com",
      });
      expect(event.res.headers.get("set-cookie")).toContain(
        "session-token-abc",
      );
    });

    it("desktop exchange can deliver OAuth errors to the app surface", async () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      delete process.env.AUTH_DISABLED;
      delete process.env.AUTH_MODE;

      vi.doMock("../db/client.js", () => ({
        getDbExec: () => ({ execute: vi.fn(async () => ({ rows: [] })) }),
        isPostgres: () => false,
        isLocalDatabase: () => false,
        intType: () => "INTEGER",
        retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
      }));
      vi.doMock("./better-auth-instance.js", () => ({
        getBetterAuth: vi.fn(async () => ({
          handler: vi.fn(async () => new Response("{}")),
          api: {
            getSession: vi.fn(async () => null),
            signInEmail: vi.fn(),
            signUpEmail: vi.fn(),
            signOut: vi.fn(),
            listOrganizations: vi.fn(),
          },
        })),
        getBetterAuthSync: vi.fn(() => undefined),
      }));

      const { autoMountAuth, setDesktopExchangeError } =
        await import("./auth.js");
      const app = createMockApp();
      await autoMountAuth(app);
      setDesktopExchangeError("flow-error", {
        message: "Sign out and try again.",
        code: "account_owner_mismatch",
        accountId: "steve@builder.io",
        attemptedOwner: "other@example.com",
      });

      const exchangeHandler = app.use.mock.calls.find(
        (call: any[]) => call[0] === "/_agent-native/auth/desktop-exchange",
      )?.[1];
      const result = await exchangeHandler(
        createMockEvent({
          path: "/_agent-native/auth/desktop-exchange",
          query: { flow_id: "flow-error" },
        }),
      );

      expect(result).toEqual({
        error: "Sign out and try again.",
        message: "Sign out and try again.",
        code: "account_owner_mismatch",
        accountId: "steve@builder.io",
        attemptedOwner: "other@example.com",
      });
    });

    it("strips APP_BASE_PATH before forwarding requests to Better Auth", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("APP_BASE_PATH", "/docs");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      delete process.env.AUTH_DISABLED;
      delete process.env.AUTH_MODE;

      let forwardedPath = "";
      vi.doMock("./better-auth-instance.js", () => ({
        getBetterAuth: vi.fn(async () => ({
          handler: async (request: Request) => {
            forwardedPath = new URL(request.url).pathname;
            return new Response(JSON.stringify({ ok: true }), {
              headers: { "content-type": "application/json" },
            });
          },
          api: {
            getSession: vi.fn(async () => null),
            signInEmail: vi.fn(),
            signUpEmail: vi.fn(),
            signOut: vi.fn(),
            listOrganizations: vi.fn(),
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

      const fullPath = "/docs/_agent-native/auth/ba/sign-in/email";
      const request = new Request(`http://localhost${fullPath}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const event = {
        req: request,
        url: new URL("http://localhost/sign-in/email"),
        res: { headers: new Headers(), status: 200 },
        node: {
          req: { headers: {}, url: fullPath, method: "POST" },
          res: {
            setHeader: vi.fn(),
            getHeader: vi.fn(),
            appendHeader: vi.fn(),
          },
        },
        headers: request.headers,
        context: {
          _mountedPathname: fullPath,
          _mountPrefix: "/docs/_agent-native/auth/ba",
        },
        path: "/sign-in/email",
      };

      await baHandler(event);

      expect(forwardedPath).toBe("/_agent-native/auth/ba/sign-in/email");
    });

    it("supports multiple ACCESS_TOKENS", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKENS", "token1, token2, token3");
      vi.stubEnv("DEBUG", "1");
      delete process.env.ACCESS_TOKEN;
      delete process.env.AUTH_MODE;
      const { autoMountAuth } = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const app = createMockApp();
      const result = await autoMountAuth(app);

      expect(result).toBe(true);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("3 access token(s)"),
      );
      logSpy.mockRestore();
    });

    it("deduplicates tokens across ACCESS_TOKEN and ACCESS_TOKENS", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "shared");
      vi.stubEnv("ACCESS_TOKENS", "shared,unique1,unique2");
      vi.stubEnv("DEBUG", "1");
      delete process.env.AUTH_MODE;
      const { autoMountAuth } = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const app = createMockApp();
      await autoMountAuth(app);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("3 access token(s)"),
      );
      logSpy.mockRestore();
    });

    it("returns true when custom getSession is provided in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("DEBUG", "1");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      delete process.env.AUTH_MODE;
      const { autoMountAuth } = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const app = createMockApp();
      const result = await autoMountAuth(app, {
        getSession: async () => ({ email: "test@test.com" }),
      });

      expect(result).toBe(true);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("custom getSession"),
      );
      logSpy.mockRestore();
    });
  });

  describe("getSession", () => {
    it("returns local session in AUTH_MODE=local", async () => {
      vi.stubEnv("AUTH_MODE", "local");
      const { getSession, autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app);

      const event = createMockEvent();
      const session = await getSession(event);
      expect(session).toEqual({ email: "local@localhost" });
    });

    it("returns local session in AUTH_MODE=local regardless of NODE_ENV", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AUTH_MODE", "local");
      const { getSession, autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app);

      const event = createMockEvent();
      const session = await getSession(event);
      expect(session).toEqual({ email: "local@localhost" });
    });

    it("promotes _session query tokens even while AUTH_MODE=local is active", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AUTH_MODE", "local");

      const mockExecute = vi.fn().mockImplementation(({ sql, args }: any) => {
        if (
          typeof sql === "string" &&
          sql.includes("SELECT") &&
          args?.[0] === "mobile-token-abc"
        ) {
          return {
            rows: [{ email: "user@gmail.com", created_at: Date.now() }],
          };
        }
        return { rows: [] };
      });
      vi.doMock("../db/client.js", () => ({
        getDbExec: () => ({ execute: mockExecute }),
        isPostgres: () => false,
        isLocalDatabase: () => true,
        intType: () => "INTEGER",
        retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
      }));

      const { getSession } = await import("./auth.js");
      const event = createMockEvent({
        query: { _session: "mobile-token-abc" },
      });

      expect(await getSession(event)).toEqual({
        email: "user@gmail.com",
        token: "mobile-token-abc",
      });
      expect(event.res.headers.get("set-cookie")).toContain("mobile-token-abc");
    });

    it("still returns local session in dev after AUTH_MODE=local is cleared (dev fallback)", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("AUTH_MODE", "local");
      const { getSession, autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app);

      const event = createMockEvent();
      expect(await getSession(event)).toEqual({ email: "local@localhost" });

      delete process.env.AUTH_MODE;

      // Dev-mode safety net — still returns local@localhost
      expect(await getSession(event)).toEqual({ email: "local@localhost" });
    });

    it("returns null in production when AUTH_MODE=local is cleared", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AUTH_MODE", "local");
      const { getSession, autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      await autoMountAuth(app);

      const event = createMockEvent();
      expect(await getSession(event)).toEqual({ email: "local@localhost" });

      delete process.env.AUTH_MODE;

      expect(await getSession(event)).toBeNull();
    });

    it("falls through to _session query param when custom getSession returns null", async () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      delete process.env.AUTH_MODE;

      const mockExecute = vi.fn().mockImplementation(({ sql, args }: any) => {
        if (
          typeof sql === "string" &&
          sql.includes("SELECT") &&
          args?.[0] === "mobile-token-abc"
        ) {
          return {
            rows: [{ email: "user@gmail.com", created_at: Date.now() }],
          };
        }
        return { rows: [] };
      });
      vi.doMock("../db/client.js", () => ({
        getDbExec: () => ({ execute: mockExecute }),
        isPostgres: () => false,
        isLocalDatabase: () => true,
        intType: () => "INTEGER",
        retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
      }));

      const authModule = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const app = createMockApp();
      await authModule.autoMountAuth(app, {
        getSession: async () => null,
      });
      logSpy.mockRestore();

      const event = createMockEvent({
        query: { _session: "mobile-token-abc" },
      });
      const session = await authModule.getSession(event);

      expect(session).toEqual({
        email: "user@gmail.com",
        token: "mobile-token-abc",
      });
    });

    it("uses custom getSession result when it returns a session", async () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      delete process.env.AUTH_MODE;

      const authModule = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const app = createMockApp();
      await authModule.autoMountAuth(app, {
        getSession: async () => ({ email: "custom@auth.com" }),
      });
      logSpy.mockRestore();

      const event = createMockEvent({ query: { _session: "some-token" } });
      const session = await authModule.getSession(event);

      expect(session).toEqual({ email: "custom@auth.com" });
    });
  });

  describe("safeReturnPath", () => {
    async function load() {
      const m = await import("./auth.js");
      return m.safeReturnPath;
    }

    it("returns '/' for null / empty / missing input", async () => {
      const safeReturnPath = await load();
      expect(safeReturnPath(null)).toBe("/");
      expect(safeReturnPath(undefined)).toBe("/");
      expect(safeReturnPath("")).toBe("/");
    });

    it("preserves a same-origin path", async () => {
      const safeReturnPath = await load();
      expect(safeReturnPath("/share/abc")).toBe("/share/abc");
      expect(safeReturnPath("/share/abc?x=1&y=2")).toBe("/share/abc?x=1&y=2");
      expect(safeReturnPath("/share/abc#section")).toBe("/share/abc#section");
      expect(safeReturnPath("/")).toBe("/");
    });

    it("blocks network-path references (//evil.com/...)", async () => {
      const safeReturnPath = await load();
      expect(safeReturnPath("//evil.com/path")).toBe("/");
      expect(safeReturnPath("//evil.com")).toBe("/");
    });

    it("blocks backslash-bypass that WHATWG normalises to //", async () => {
      const safeReturnPath = await load();
      // WHATWG URL parser converts `\` to `/` for HTTP scheme — a naive
      // `startsWith("//")` check would miss this.
      expect(safeReturnPath("/\\evil.com/path")).toBe("/");
      expect(safeReturnPath("\\\\evil.com/path")).toBe("/");
    });

    it("blocks absolute URLs and non-http schemes", async () => {
      const safeReturnPath = await load();
      expect(safeReturnPath("https://evil.com/path")).toBe("/");
      expect(safeReturnPath("http://evil.com/path")).toBe("/");
      expect(safeReturnPath("javascript:alert(1)")).toBe("/");
      expect(safeReturnPath("data:text/html,<x>")).toBe("/");
    });

    it("rejects control characters (header-injection defence)", async () => {
      const safeReturnPath = await load();
      expect(safeReturnPath("/foo\r\nLocation: /evil")).toBe("/");
      expect(safeReturnPath("/foo\nbar")).toBe("/");
      expect(safeReturnPath("/foo\tbar")).toBe("/");
      expect(safeReturnPath("/foo\x00bar")).toBe("/");
    });

    it("rejects scheme-changing absolute URLs even on same hostname", async () => {
      const safeReturnPath = await load();
      // Different scheme is a different origin — must reject.
      expect(safeReturnPath("https://safe-base.invalid/foo")).toBe("/");
    });

    it("strips host parts and returns just path/search/hash", async () => {
      const safeReturnPath = await load();
      // Even a same-origin absolute URL should normalise to just the path.
      // (We can't construct one easily without knowing the sentinel base,
      // so the test below covers the network-path resolve case which uses
      // the parsed segments.)
      expect(safeReturnPath("/foo?bar=1#baz")).toBe("/foo?bar=1#baz");
    });
  });

  describe("OAuth state returnUrl round-trip", () => {
    beforeEach(() => {
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-signing-key-do-not-use");
    });

    it("encodes and decodes returnUrl through signed state", async () => {
      const { encodeOAuthState, decodeOAuthState } =
        await import("./google-oauth.js");
      const state = encodeOAuthState(
        "http://x/cb",
        undefined,
        false,
        false,
        undefined,
        "/share/abc?x=1",
      );
      const decoded = decodeOAuthState(state, "http://x/cb");
      expect(decoded.returnUrl).toBe("/share/abc?x=1");
    });

    it("encodes and decodes app id through signed state for frame routing", async () => {
      const { encodeOAuthState, decodeOAuthState } =
        await import("./google-oauth.js");
      const state = encodeOAuthState({
        redirectUri: "http://x/cb",
        app: "mail",
      });
      const decoded = decodeOAuthState(state, "http://x/cb");
      expect(decoded.app).toBe("mail");
    });

    it("produces undefined returnUrl when none was encoded (backwards compat)", async () => {
      const { encodeOAuthState, decodeOAuthState } =
        await import("./google-oauth.js");
      const state = encodeOAuthState("http://x/cb");
      const decoded = decodeOAuthState(state, "http://x/cb");
      expect(decoded.returnUrl).toBeUndefined();
    });

    it("rejects tampered state — mutated payload fails HMAC", async () => {
      const { encodeOAuthState, decodeOAuthState } =
        await import("./google-oauth.js");
      const state = encodeOAuthState(
        "http://x/cb",
        undefined,
        false,
        false,
        undefined,
        "/safe",
      );
      // Flip a byte in the data half.
      const dotIdx = state.lastIndexOf(".");
      const data = state.slice(0, dotIdx);
      const sig = state.slice(dotIdx + 1);
      const tampered = data.slice(0, -1) + "X" + "." + sig;
      const decoded = decodeOAuthState(tampered, "http://x/fallback");
      // Bad signature → falls back to default; return is dropped.
      expect(decoded.redirectUri).toBe("http://x/fallback");
      expect(decoded.returnUrl).toBeUndefined();
    });

    it("decodes returnUrl as raw string — same-origin validation runs at the consumer", async () => {
      const { encodeOAuthState, decodeOAuthState } =
        await import("./google-oauth.js");
      // If a malicious actor with a leaked signing key encoded a cross-
      // origin URL, decode would surface it — but the consumer
      // (oauthCallbackResponse) runs safeReturnPath, so the redirect still
      // lands on "/". This test documents the layered defence.
      const state = encodeOAuthState(
        "http://x/cb",
        undefined,
        false,
        false,
        undefined,
        "//evil.com/path",
      );
      const decoded = decodeOAuthState(state, "http://x/cb");
      expect(decoded.returnUrl).toBe("//evil.com/path");
      // But safeReturnPath would catch this:
      const { safeReturnPath } = await import("./auth.js");
      expect(safeReturnPath(decoded.returnUrl)).toBe("/");
    });
  });

  describe("onboarding Google sign-in", () => {
    it("navigates in the current tab instead of leaving a duplicate app tab", async () => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");

      const { getOnboardingHtml } = await import("./onboarding-html.js");
      const html = getOnboardingHtml({ googleOnly: true });

      expect(html).toContain("window.location.href = data.url");
      expect(html).not.toContain("window.open(data.url");
      expect(html).not.toContain("Waiting for sign-in");
    });

    it("renders marketing assets under APP_BASE_PATH", async () => {
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      const { getOnboardingHtml } = await import("./onboarding-html.js");
      const html = getOnboardingHtml({
        marketing: {
          appName: "Dispatch",
          tagline: "Coordinate the workspace",
        },
      });

      expect(html).toContain('src="/dispatch/agent-native-icon-dark.svg"');
      expect(html).not.toContain('src="/agent-native-icon-dark.svg"');
    });

    it("defaults the active tab from the login or signup path", async () => {
      const { getOnboardingHtml } = await import("./onboarding-html.js");
      const html = getOnboardingHtml();

      expect(html).toContain("var path = location.pathname");
      expect(html).toContain("path === '/login' || path.endsWith('/login')");
      expect(html).toContain("path === '/signup' || path.endsWith('/signup')");
    });
  });

  describe("onboarding signup verification flow", () => {
    it("renders a dedicated email verification step after signup", async () => {
      const { getOnboardingHtml } = await import("./onboarding-html.js");
      const html = getOnboardingHtml();

      expect(html).toContain('id="verification-step"');
      expect(html).toContain('id="verify-continue"');
      expect(html).toContain('id="resend-verification"');
      expect(html).toContain('id="back-to-signup"');
      expect(html).toContain("showVerificationStep(email)");
      expect(html).toContain("callbackURL: __anGetReturnPath()");
      expect(html).not.toContain(
        "Account created! Check your email to verify, then sign in.",
      );
    });
  });

  describe("OAuth callback copy", () => {
    it("uses the requested app name for desktop exchange completion", async () => {
      const { oauthCallbackResponse } = await import("./google-oauth.js");
      const response = await Promise.resolve(
        oauthCallbackResponse(createMockEvent(), "steve@example.com", {
          desktop: true,
          flowId: "flow-1",
          sessionToken: "token-1",
          appName: "Mail",
        }),
      );
      expect(response).toBeInstanceOf(Response);
      const html = await (response as Response).text();
      expect(html).toContain("return to Mail");
      expect(html).not.toContain("return to Clips");
    });

    it("uses a deep link for Electron desktop exchange completion", async () => {
      const { oauthCallbackResponse } = await import("./google-oauth.js");
      const response = await Promise.resolve(
        oauthCallbackResponse(
          createMockEvent({
            headers: { "user-agent": "Agent Native Electron" },
            query: { state: "state-1" },
          }),
          "steve@example.com",
          {
            desktop: true,
            flowId: "flow-1",
            sessionToken: "token-1",
            appName: "Mail",
          },
        ),
      );

      expect(response).toBeInstanceOf(Response);
      const html = await (response as Response).text();
      expect(html).toContain("agentnative://oauth-complete");
      expect(html).toContain("token=token-1");
      expect(html).toContain("state=state-1");
      expect(html).not.toContain("return to Mail");
    });
  });

  describe("getAppUrl", () => {
    it("preserves APP_BASE_PATH for framework callback URLs", async () => {
      vi.stubEnv("APP_BASE_PATH", "/docs/");
      const { getAppUrl } = await import("./google-oauth.js");
      const event = createMockEvent({
        headers: {
          host: "app.example.test",
          "x-forwarded-proto": "https",
        },
      });

      expect(getAppUrl(event, "/_agent-native/google/callback")).toBe(
        "https://app.example.test/docs/_agent-native/google/callback",
      );
    });
  });

  describe("resolveOAuthRedirectUri", () => {
    it("defaults root workspace framework-route requests to the root callback", async () => {
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      const { resolveOAuthRedirectUri } = await import("./google-oauth.js");
      const event = createMockEvent({
        path: "/_agent-native/google/auth-url",
        headers: {
          host: "agent-workspace.builder.io",
          "x-forwarded-proto": "https",
        },
      });

      expect(resolveOAuthRedirectUri(event)).toBe(
        "https://agent-workspace.builder.io/_agent-native/google/callback",
      );
    });

    it("defaults app-base framework-route requests to the app-base callback", async () => {
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      const { resolveOAuthRedirectUri } = await import("./google-oauth.js");
      const event = createMockEvent({
        path: "/dispatch/_agent-native/google/auth-url",
        headers: {
          host: "agent-workspace.builder.io",
          "x-forwarded-proto": "https",
        },
      });

      expect(resolveOAuthRedirectUri(event)).toBe(
        "https://agent-workspace.builder.io/dispatch/_agent-native/google/callback",
      );
    });

    it("allows same-origin root and app-base framework redirect overrides", async () => {
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      const { resolveOAuthRedirectUri } = await import("./google-oauth.js");
      const headers = {
        host: "agent-workspace.builder.io",
        "x-forwarded-proto": "https",
      };

      expect(
        resolveOAuthRedirectUri(
          createMockEvent({
            path: "/_agent-native/google/auth-url",
            headers,
            query: {
              redirect_uri:
                "https://agent-workspace.builder.io/_agent-native/google/callback",
            },
          }),
        ),
      ).toBe(
        "https://agent-workspace.builder.io/_agent-native/google/callback",
      );
      expect(
        resolveOAuthRedirectUri(
          createMockEvent({
            path: "/dispatch/_agent-native/google/auth-url",
            headers,
            query: {
              redirect_uri:
                "https://agent-workspace.builder.io/dispatch/_agent-native/google/callback",
            },
          }),
        ),
      ).toBe(
        "https://agent-workspace.builder.io/dispatch/_agent-native/google/callback",
      );
    });

    it("rejects cross-origin redirect overrides", async () => {
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      const { resolveOAuthRedirectUri } = await import("./google-oauth.js");
      const event = createMockEvent({
        path: "/_agent-native/google/auth-url",
        headers: {
          host: "agent-workspace.builder.io",
          "x-forwarded-proto": "https",
        },
        query: {
          redirect_uri: "https://evil.example/_agent-native/google/callback",
        },
      });

      expect(resolveOAuthRedirectUri(event)).toBeNull();
    });

    it("rejects root redirect overrides from app-base framework-route requests", async () => {
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      const { resolveOAuthRedirectUri } = await import("./google-oauth.js");
      const event = createMockEvent({
        path: "/dispatch/_agent-native/google/auth-url",
        headers: {
          host: "agent-workspace.builder.io",
          "x-forwarded-proto": "https",
        },
        query: {
          redirect_uri:
            "https://agent-workspace.builder.io/_agent-native/google/callback",
        },
      });

      expect(resolveOAuthRedirectUri(event)).toBeNull();
    });
  });
});

// --- Mock helpers ---

function createMockApp(): any {
  return {
    use: vi.fn(),
  };
}

function createMockEvent(opts?: {
  cookies?: Record<string, string>;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  path?: string;
}): any {
  const query = opts?.query || {};
  const headers = opts?.headers || {};
  const qs = Object.entries(query)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const pathname = opts?.path || "/";
  const url = qs ? `${pathname}?${qs}` : pathname;
  const requestHeaders = new Headers({ host: "localhost", ...headers });
  return {
    // h3 v2 shape: event.req is the web Request, event.url is a parsed URL,
    // event.res holds the response headers map.
    req: {
      method: "GET",
      url: `http://localhost${url}`,
      headers: requestHeaders,
    },
    url: new URL(`http://localhost${url}`),
    res: {
      headers: new Headers(),
      status: 200,
    },
    // Legacy v1 shape kept for any code paths still using event.node.req
    node: {
      req: {
        headers: { host: "localhost", ...headers },
        url,
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
    path: url,
    _cookies: opts?.cookies || {},
  };
}
