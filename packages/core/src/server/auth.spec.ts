import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("server/auth", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
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
}): any {
  const query = opts?.query || {};
  const qs = Object.entries(query)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const url = qs ? `/?${qs}` : "/";
  return {
    // h3 v2 shape: event.req is the web Request, event.url is a parsed URL,
    // event.res holds the response headers map.
    req: {
      method: "GET",
      url: `http://localhost${url}`,
      headers: new Headers({ host: "localhost" }),
    },
    url: new URL(`http://localhost${url}`),
    res: {
      headers: new Headers(),
      status: 200,
    },
    // Legacy v1 shape kept for any code paths still using event.node.req
    node: {
      req: {
        headers: { host: "localhost" },
        url,
        method: "GET",
      },
      res: {
        setHeader: vi.fn(),
        getHeader: vi.fn(),
        appendHeader: vi.fn(),
      },
    },
    headers: new Headers(),
    context: {},
    path: url,
    _cookies: opts?.cookies || {},
  };
}
