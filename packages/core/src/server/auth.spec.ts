import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test the functions we can isolate without needing a full H3 server:
// - getAccessTokens (via autoMountAuth behavior)
// - isPublicPath (internal, tested indirectly)
// - isDevMode (tested via getSession behavior)

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
      const { autoMountAuth } = await import("./auth.js");

      expect(() => autoMountAuth(null as any)).toThrow(
        "autoMountAuth: H3 app is required",
      );
    });

    it("returns false when app is null in dev mode", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const { autoMountAuth } = await import("./auth.js");

      expect(autoMountAuth(null as any)).toBe(false);
    });

    it("returns false in dev mode (auth skipped)", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const { autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      expect(autoMountAuth(app)).toBe(false);
    });

    it("returns false when AUTH_DISABLED=true in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AUTH_DISABLED", "true");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      const { autoMountAuth } = await import("./auth.js");

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const app = createMockApp();
      expect(autoMountAuth(app)).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("exits process when no tokens in production without AUTH_DISABLED", async () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      delete process.env.AUTH_DISABLED;
      const { autoMountAuth } = await import("./auth.js");

      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation((() => {}) as any);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const app = createMockApp();
      autoMountAuth(app);

      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("mounts auth when ACCESS_TOKEN is set in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKEN", "my-secret");
      const { autoMountAuth } = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const app = createMockApp();
      const result = autoMountAuth(app);

      expect(result).toBe(true);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("1 access token(s)"),
      );
      logSpy.mockRestore();
    });

    it("supports multiple ACCESS_TOKENS", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ACCESS_TOKENS", "token1, token2, token3");
      delete process.env.ACCESS_TOKEN;
      const { autoMountAuth } = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const app = createMockApp();
      const result = autoMountAuth(app);

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
      const { autoMountAuth } = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const app = createMockApp();
      autoMountAuth(app);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("3 access token(s)"),
      );
      logSpy.mockRestore();
    });

    it("returns true when custom getSession is provided in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      const { autoMountAuth } = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const app = createMockApp();
      const result = autoMountAuth(app, {
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
    it("returns dev session in development mode", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const { getSession, autoMountAuth } = await import("./auth.js");

      // Init dev mode
      const app = createMockApp();
      autoMountAuth(app);

      const event = createMockEvent();
      const session = await getSession(event);
      expect(session).toEqual({ email: "local@localhost" });
    });

    it("returns dev session in test mode", async () => {
      vi.stubEnv("NODE_ENV", "test");
      const { getSession, autoMountAuth } = await import("./auth.js");

      const app = createMockApp();
      autoMountAuth(app);

      const event = createMockEvent();
      const session = await getSession(event);
      expect(session).toEqual({ email: "local@localhost" });
    });

    it("falls through to _session query param when custom getSession returns null", async () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;

      // Mock the DB layer so getSessionEmail resolves the token
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
        // CREATE TABLE / ALTER TABLE
        return { rows: [] };
      });
      vi.doMock("../db/client.js", () => ({
        getDbExec: () => ({ execute: mockExecute }),
        isPostgres: () => false,
        intType: () => "INTEGER",
      }));

      const authModule = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const app = createMockApp();
      authModule.autoMountAuth(app, {
        // Custom getSession that returns null (simulates no cookie in WebView)
        getSession: async () => null,
      });
      logSpy.mockRestore();

      // Create event with _session query param (mobile WebView bridge)
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

      const authModule = await import("./auth.js");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const app = createMockApp();
      authModule.autoMountAuth(app, {
        getSession: async () => ({ email: "custom@auth.com" }),
      });
      logSpy.mockRestore();

      // Even with _session in query, custom auth takes priority when it succeeds
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
    node: {
      req: {
        headers: { host: "localhost" },
        url,
      },
      res: {
        setHeader: vi.fn(),
        getHeader: vi.fn(),
        appendHeader: vi.fn(),
      },
    },
    context: {},
    path: url,
    _cookies: opts?.cookies || {},
  };
}
