import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AuthSession } from "./auth.js";

// Mock @sentry/node BEFORE we import the module under test so the spied
// versions of init / setUser / captureException are observed.
const sentryMock = vi.hoisted(() => {
  const mockScope = {
    setUser: vi.fn(),
    setTag: vi.fn(),
  };
  return {
    init: vi.fn(),
    getIsolationScope: vi.fn(() => mockScope),
    withScope: vi.fn((fn: (scope: typeof mockScope) => unknown) =>
      fn(mockScope),
    ),
    captureException: vi.fn(() => "evt_test"),
    mockScope,
  };
});

vi.mock("@sentry/node", () => ({
  init: sentryMock.init,
  getIsolationScope: sentryMock.getIsolationScope,
  withScope: sentryMock.withScope,
  captureException: sentryMock.captureException,
}));

describe("server/sentry", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    sentryMock.init.mockClear();
    sentryMock.captureException.mockClear();
    sentryMock.mockScope.setUser.mockClear();
    sentryMock.mockScope.setTag.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  describe("initServerSentry", () => {
    it("does not call Sentry.init when SENTRY_SERVER_DSN is unset", async () => {
      delete process.env.SENTRY_SERVER_DSN;
      const { initServerSentry, isServerSentryEnabled } =
        await import("./sentry.js");

      expect(initServerSentry()).toBe(false);
      expect(sentryMock.init).not.toHaveBeenCalled();
      expect(isServerSentryEnabled()).toBe(false);
    });

    it("initializes with the DSN when present", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      process.env.NODE_ENV = "production";
      const { initServerSentry, isServerSentryEnabled } =
        await import("./sentry.js");

      expect(initServerSentry()).toBe(true);
      expect(sentryMock.init).toHaveBeenCalledTimes(1);
      const cfg = sentryMock.init.mock.calls[0][0];
      expect(cfg.dsn).toBe("https://test@example/123");
      expect(cfg.environment).toBe("production");
      expect(cfg.sendDefaultPii).toBe(false);
      expect(cfg.tracesSampleRate).toBe(0);
      expect(typeof cfg.beforeSend).toBe("function");
      expect(isServerSentryEnabled()).toBe(true);
    });

    it("respects SENTRY_SERVER_TRACES_SAMPLE_RATE override", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      process.env.SENTRY_SERVER_TRACES_SAMPLE_RATE = "0.25";
      const { initServerSentry } = await import("./sentry.js");
      initServerSentry();

      expect(sentryMock.init.mock.calls[0][0].tracesSampleRate).toBe(0.25);
    });

    it("clamps invalid trace rates to 0", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      process.env.SENTRY_SERVER_TRACES_SAMPLE_RATE = "abc";
      const { initServerSentry } = await import("./sentry.js");
      initServerSentry();

      expect(sentryMock.init.mock.calls[0][0].tracesSampleRate).toBe(0);
    });

    it("is idempotent — calling twice does not re-initialize", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      initServerSentry();
      initServerSentry();
      expect(sentryMock.init).toHaveBeenCalledTimes(1);
    });
  });

  describe("beforeSend", () => {
    it("drops ValidationError exceptions", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      initServerSentry();

      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const result = beforeSend({
        exception: { values: [{ type: "ValidationError" }] },
      } as never);
      expect(result).toBeNull();
    });

    it("strips authorization, cookie, and set-cookie headers", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      initServerSentry();

      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const event = {
        request: {
          headers: {
            authorization: "Bearer secret",
            cookie: "session=abc",
            "set-cookie": "x=1",
            "user-agent": "Mozilla/5.0",
          },
          cookies: { session: "abc" },
        },
      };
      const result = beforeSend(event as never);
      const headers = (result as typeof event).request.headers;
      expect(headers).not.toHaveProperty("authorization");
      expect(headers).not.toHaveProperty("cookie");
      expect(headers).not.toHaveProperty("set-cookie");
      expect(headers["user-agent"]).toBe("Mozilla/5.0");
      expect((result as typeof event).request).not.toHaveProperty("cookies");
    });

    it("strips ip_address but keeps explicit identity fields", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      initServerSentry();

      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const result = beforeSend({
        user: {
          id: "user_123",
          email: "alice@example.com",
          ip_address: "1.2.3.4",
        },
      } as never);
      expect(result.user).toEqual({
        id: "user_123",
        email: "alice@example.com",
      });
    });

    it("drops the user object when only ip_address was set", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      initServerSentry();

      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const result = beforeSend({
        user: { ip_address: "1.2.3.4" },
      } as never);
      expect(result.user).toBeUndefined();
    });

    it("strips runtime_env from contexts", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      initServerSentry();

      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const result = beforeSend({
        contexts: {
          runtime_env: { DATABASE_URL: "postgres://..." },
          os: { name: "darwin" },
        },
      } as never);
      expect(result.contexts).not.toHaveProperty("runtime_env");
      expect(result.contexts.os).toEqual({ name: "darwin" });
    });
  });

  describe("setSentryUserForRequest", () => {
    it("no-ops when Sentry isn't initialized", async () => {
      delete process.env.SENTRY_SERVER_DSN;
      const { setSentryUserForRequest } = await import("./sentry.js");
      setSentryUserForRequest({ email: "a@b.com" });
      expect(sentryMock.mockScope.setUser).not.toHaveBeenCalled();
    });

    it("sets id/email/username and orgId tag when session present", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry, setSentryUserForRequest } =
        await import("./sentry.js");
      initServerSentry();

      const session: AuthSession = {
        email: "alice@example.com",
        userId: "u_abc",
        name: "Alice",
        orgId: "org_42",
        orgRole: "admin",
      };
      setSentryUserForRequest(session);

      expect(sentryMock.mockScope.setUser).toHaveBeenCalledWith({
        id: "u_abc",
        email: "alice@example.com",
        username: "Alice",
      });
      expect(sentryMock.mockScope.setTag).toHaveBeenCalledWith(
        "orgId",
        "org_42",
      );
      expect(sentryMock.mockScope.setTag).toHaveBeenCalledWith(
        "orgRole",
        "admin",
      );
    });

    it("falls back to email as id when userId is missing", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry, setSentryUserForRequest } =
        await import("./sentry.js");
      initServerSentry();

      setSentryUserForRequest({ email: "alice@example.com" });
      expect(sentryMock.mockScope.setUser).toHaveBeenCalledWith({
        id: "alice@example.com",
        email: "alice@example.com",
        username: undefined,
      });
    });

    it("clears the user when session is null", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry, setSentryUserForRequest } =
        await import("./sentry.js");
      initServerSentry();

      setSentryUserForRequest(null);
      expect(sentryMock.mockScope.setUser).toHaveBeenCalledWith(null);
      expect(sentryMock.mockScope.setTag).toHaveBeenCalledWith("orgId", null);
    });
  });

  describe("captureRouteError", () => {
    it("no-ops when Sentry isn't initialized", async () => {
      delete process.env.SENTRY_SERVER_DSN;
      const { captureRouteError } = await import("./sentry.js");
      const result = captureRouteError(new Error("boom"));
      expect(result).toBeUndefined();
      expect(sentryMock.captureException).not.toHaveBeenCalled();
    });

    it("captures with route/method/userAgent tags", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry, captureRouteError } =
        await import("./sentry.js");
      initServerSentry();

      const err = new Error("boom");
      const result = captureRouteError(err, {
        route: "/_agent-native/agent-chat",
        method: "POST",
        userAgent: "Mozilla/5.0",
      });

      expect(result).toBe("evt_test");
      expect(sentryMock.captureException).toHaveBeenCalledWith(err);
      expect(sentryMock.mockScope.setTag).toHaveBeenCalledWith(
        "route",
        "/_agent-native/agent-chat",
      );
      expect(sentryMock.mockScope.setTag).toHaveBeenCalledWith(
        "method",
        "POST",
      );
      expect(sentryMock.mockScope.setTag).toHaveBeenCalledWith(
        "userAgent",
        "Mozilla/5.0",
      );
    });
  });
});
