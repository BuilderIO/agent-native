import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { AuthSession } from "./auth.js";

const sentryMock = vi.hoisted(() => {
  const mockScope = {
    setUser: vi.fn(),
    setTag: vi.fn(),
  };
  return {
    missing: false,
    loadFailure: undefined as Error | undefined,
    init: vi.fn(),
    getIsolationScope: vi.fn(() => mockScope),
    withScope: vi.fn((fn: (scope: typeof mockScope) => unknown) =>
      fn(mockScope),
    ),
    captureException: vi.fn(() => "evt_test"),
    mockScope,
  };
});

vi.mock("@sentry/node", () => {
  if (sentryMock.loadFailure) throw sentryMock.loadFailure;
  if (sentryMock.missing) {
    throw Object.assign(new Error("Cannot find package '@sentry/node'"), {
      code: "ERR_MODULE_NOT_FOUND",
    });
  }
  return {
    init: sentryMock.init,
    getIsolationScope: sentryMock.getIsolationScope,
    withScope: sentryMock.withScope,
    captureException: sentryMock.captureException,
  };
});

describe("server/sentry", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    sentryMock.init.mockClear();
    sentryMock.loadFailure = undefined;
    sentryMock.captureException.mockClear();
    sentryMock.mockScope.setUser.mockClear();
    sentryMock.mockScope.setTag.mockClear();
    sentryMock.missing = false;
  });

  afterEach(() => {
    process.env = originalEnv;
    sentryMock.missing = false;
    sentryMock.loadFailure = undefined;
    vi.resetModules();
  });

  describe("initServerSentry", () => {
    it("does not call Sentry.init when SENTRY_SERVER_DSN is unset", async () => {
      delete process.env.SENTRY_SERVER_DSN;
      delete process.env.SENTRY_DSN;
      delete process.env.SENTRY_CLIENT_KEY;
      delete process.env.SENTRY_PROJECT_ID;
      delete process.env.SENTRY_INGEST_HOST;
      const { initServerSentry, isServerSentryEnabled } =
        await import("./sentry.js");

      expect(await initServerSentry()).toBe(false);
      expect(sentryMock.init).not.toHaveBeenCalled();
      expect(isServerSentryEnabled()).toBe(false);
    });

    it("keeps server boot healthy when the optional Sentry peer is missing", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      sentryMock.missing = true;
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { initServerSentry, isServerSentryEnabled } =
        await import("./sentry.js");

      await expect(initServerSentry()).resolves.toBe(false);
      expect(isServerSentryEnabled()).toBe(false);
      expect(sentryMock.init).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0]?.[0]).toContain("Server Sentry disabled");
      expect(error.mock.calls[0]?.[0]).toContain("pnpm add @sentry/node");
      error.mockRestore();
    });

    it("disables Sentry on any peer load failure without rejecting boot", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      sentryMock.loadFailure = new Error("Sentry module failed to load");
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { initServerSentry, isServerSentryEnabled } =
        await import("./sentry.js");

      await expect(initServerSentry()).resolves.toBe(false);
      await expect(initServerSentry()).resolves.toBe(false);
      expect(isServerSentryEnabled()).toBe(false);
      expect(sentryMock.init).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0]?.[0]).toContain("Server Sentry disabled");
      error.mockRestore();
    });

    it("initializes with the DSN when present", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      process.env.NODE_ENV = "production";
      const { initServerSentry, isServerSentryEnabled } =
        await import("./sentry.js");

      expect(await initServerSentry()).toBe(true);
      expect(sentryMock.init).toHaveBeenCalledTimes(1);
      const cfg = sentryMock.init.mock.calls[0][0];
      expect(cfg.dsn).toBe("https://test@example/123");
      expect(cfg.environment).toBe("production");
      expect(cfg.sendDefaultPii).toBe(false);
      expect(cfg.tracesSampleRate).toBe(0);
      expect(typeof cfg.beforeSend).toBe("function");
      expect(isServerSentryEnabled()).toBe(true);
    });

    it("uses the explicit deployment lane for Sentry", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      process.env.SENTRY_ENVIRONMENT = "production";
      process.env.AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT = "beta";
      const { initServerSentry } = await import("./sentry.js");

      await initServerSentry();

      const cfg = sentryMock.init.mock.calls[0][0];
      expect(cfg.environment).toBe("beta");
      const event = cfg.beforeSend({ tags: { existing: "tag" } });
      expect(event.tags).toEqual({
        existing: "tag",
        deployment_environment: "beta",
      });
    });

    it("falls back to the common SENTRY_DSN when SENTRY_SERVER_DSN is unset", async () => {
      delete process.env.SENTRY_SERVER_DSN;
      process.env.SENTRY_DSN = "https://common@example/456";
      const { initServerSentry } = await import("./sentry.js");

      expect(await initServerSentry()).toBe(true);
      expect(sentryMock.init.mock.calls[0][0].dsn).toBe(
        "https://common@example/456",
      );
    });

    it("can construct a DSN from Netlify client key and project env vars", async () => {
      delete process.env.SENTRY_SERVER_DSN;
      delete process.env.SENTRY_DSN;
      process.env.SENTRY_CLIENT_KEY = "public_key";
      process.env.SENTRY_PROJECT_ID = "4511270423822336";
      process.env.SENTRY_INGEST_HOST = "o1.ingest.us.sentry.io";
      const { initServerSentry } = await import("./sentry.js");

      expect(await initServerSentry()).toBe(true);
      expect(sentryMock.init.mock.calls[0][0].dsn).toBe(
        "https://public_key@o1.ingest.us.sentry.io/4511270423822336",
      );
    });

    it("respects SENTRY_SERVER_TRACES_SAMPLE_RATE override", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      process.env.SENTRY_SERVER_TRACES_SAMPLE_RATE = "0.25";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

      expect(sentryMock.init.mock.calls[0][0].tracesSampleRate).toBe(0.25);
    });

    it("clamps invalid trace rates to 0", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      process.env.SENTRY_SERVER_TRACES_SAMPLE_RATE = "abc";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

      expect(sentryMock.init.mock.calls[0][0].tracesSampleRate).toBe(0);
    });

    it("is idempotent — calling twice does not re-initialize", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();
      await initServerSentry();
      expect(sentryMock.init).toHaveBeenCalledTimes(1);
    });
  });

  describe("beforeSend", () => {
    it("redacts SQL parameters from Sentry message fields", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

      const privateValue = "example transcript content";
      const value = `DrizzleQueryError: Failed query: insert into dictations (text) values ($1)\nparams: ${privateValue}`;
      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const result = beforeSend({
        message: value,
        logentry: { message: value, params: [privateValue] },
        exception: { values: [{ type: "DrizzleQueryError", value }] },
      } as never) as {
        message: string;
        logentry: { message: string; params?: unknown[] };
        exception: { values: Array<{ value: string }> };
      };

      expect(JSON.stringify(result)).not.toContain(privateValue);
      expect(result.exception.values[0]?.value).toContain("params: <redacted>");
      expect(result.logentry.params).toBeUndefined();
    });

    it("keeps unrelated parameters for non-SQL query diagnostics", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

      const privateValue = "example transcript content";
      const diagnosticValue = "report lookup details";
      const sqlFailure = `DrizzleQueryError: Failed query: insert into dictations (text) values ($1)\nparams: ${privateValue}`;
      const diagnostic = `query failed: report service timed out\nparams: ${diagnosticValue}`;
      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const result = beforeSend({
        message: diagnostic,
        logentry: { message: diagnostic, params: [diagnosticValue] },
        exception: {
          values: [{ type: "DrizzleQueryError", value: sqlFailure }],
        },
        contexts: {
          report: { message: diagnostic, params: [diagnosticValue] },
        },
      } as never) as {
        message: string;
        logentry: { message: string; params: unknown[] };
        exception: { values: Array<{ value: string }> };
        contexts: { report: { params: string[] } };
      };

      expect(JSON.stringify(result)).not.toContain(privateValue);
      expect(result.exception.values[0]?.value).toContain("params: <redacted>");
      expect(result.message).toContain(`params: ${diagnosticValue}`);
      expect(result.logentry.params).toEqual([diagnosticValue]);
      expect(result.contexts.report.params).toEqual([diagnosticValue]);
    });

    it("keeps parameters for structured search queries", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

      const searchParams = ["customer@example.com"];
      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const result = beforeSend({
        message: "Customer search failed",
        logentry: {
          message: "Customer search failed",
          query: "search customers by email",
          params: searchParams,
        },
        contexts: {
          search: { query: "email contains", params: searchParams },
        },
        exception: {
          values: [{ type: "Error", value: "Customer search failed" }],
        },
      } as never) as {
        logentry: { params: unknown[] };
        contexts: { search: { params: unknown[] } };
      };

      expect(result.logentry.params).toEqual(searchParams);
      expect(result.contexts.search.params).toEqual(searchParams);
    });

    it("preserves log-entry params when nested SQL params are redacted", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

      const diagnosticParams = ["report lookup details"];
      const privateValue = "private customer value";
      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const result = beforeSend({
        logentry: {
          message: "Customer search completed",
          params: diagnosticParams,
          cause: { query: "values ($1)", params: [privateValue] },
        },
      } as never) as {
        logentry: { params: string[]; cause: { params: unknown } };
      };

      expect(result.logentry.params).toEqual(diagnosticParams);
      expect(result.logentry.cause.params).toBe("<redacted>");
      expect(JSON.stringify(result)).not.toContain(privateValue);
    });

    it("redacts parameters for structured standalone VALUES SQL", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

      const privateValue = "private customer value";
      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const result = beforeSend({
        logentry: { query: "values ($1)", params: [privateValue] },
      } as never) as { logentry: { params: unknown } };

      expect(result.logentry.params).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain(privateValue);
    });

    it("redacts EXPLAIN queries after leading SQL comments", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

      const privateValue = "private customer value";
      const message =
        `Failed query: /* plan */\n-- analyze the plan\n` +
        `EXPLAIN ANALYZE SELECT id FROM customers\n\tparams: ${privateValue}`;
      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const result = beforeSend({
        exception: { values: [{ type: "DrizzleQueryError", value: message }] },
        logentry: { message, params: [privateValue] },
      } as never) as {
        exception: { values: Array<{ value: string }> };
        logentry: { params?: unknown[] };
      };

      expect(result.exception.values[0]?.value).toContain("params: <redacted>");
      expect(result.logentry.params).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain(privateValue);
    });

    it("redacts parameterized PostgreSQL CALL failures", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

      const privateValue = "private customer value";
      const message = `Failed query: CALL process_user($1)\n\tparams: ${privateValue}`;
      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const result = beforeSend({
        exception: {
          values: [{ type: "DrizzleQueryError", value: message }],
        },
        logentry: { message, params: [privateValue] },
      } as never) as {
        exception: { values: Array<{ value: string }> };
        logentry: { params?: unknown[] };
      };

      expect(result.exception.values[0]?.value).toContain("params: <redacted>");
      expect(result.logentry.params).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain(privateValue);
    });

    it.each([
      ["EXECUTE", "EXECUTE prepared_statement($1)"],
      ["COPY", "COPY (SELECT email FROM users WHERE email = $1) TO STDOUT"],
    ])(
      "redacts parameterized PostgreSQL %s statements",
      async (_statement, query) => {
        process.env.SENTRY_SERVER_DSN = "https://test@example/123";
        const { initServerSentry } = await import("./sentry.js");
        await initServerSentry();

        const privateValue = "private customer value";
        const message = `Failed query: ${query}\n\tparams: ${privateValue}`;
        const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
        const result = beforeSend({
          message,
          logentry: { message, params: [privateValue] },
          exception: {
            values: [{ type: "DrizzleQueryError", value: message }],
          },
        } as never) as {
          message: string;
          logentry: { message: string; params?: unknown[] };
          exception: { values: Array<{ value: string }> };
        };

        expect(result.message).toContain("params: <redacted>");
        expect(result.logentry.message).toContain("params: <redacted>");
        expect(result.logentry.params).toBeUndefined();
        expect(result.exception.values[0]?.value).toContain(
          "params: <redacted>",
        );
        expect(JSON.stringify(result)).not.toContain(privateValue);
      },
    );

    it("redacts extra params associated with a root SQL failure", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

      const privateValue = "private customer value";
      const message = `DrizzleQueryError: Failed query: SELECT email FROM users WHERE email = $1\n\tparams: ${privateValue}`;
      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const result = beforeSend({
        message,
        extra: {
          params: [privateValue],
          unrelated: { params: ["diagnostic"] },
        },
      } as never) as {
        extra: { params: unknown; unrelated: { params: string[] } };
      };

      expect(result.extra.params).toBe("<redacted>");
      expect(result.extra.unrelated.params).toEqual(["diagnostic"]);
      expect(JSON.stringify(result)).not.toContain(privateValue);
    });

    it("redacts structured params associated with raw SQL messages", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

      const privateValue = "private customer value";
      const message =
        `/* insert customer */ INSERT INTO customers (name) VALUES ($1)` +
        `\n\tparams: ${privateValue}`;
      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const result = beforeSend({
        message,
        params: [privateValue],
        logentry: { message, params: [privateValue] },
        extra: {
          cause: { message, params: [privateValue] },
          unrelated: { params: ["diagnostic"] },
        },
      } as never) as {
        message: string;
        params: unknown;
        logentry: { message: string; params?: unknown[] };
        extra: {
          cause: { params: unknown };
          unrelated: { params: string[] };
        };
      };

      expect(result.message).toContain("params: <redacted>");
      expect(result.params).toBe("<redacted>");
      expect(result.logentry.message).toContain("params: <redacted>");
      expect(result.logentry.params).toBeUndefined();
      expect(result.extra.cause.params).toBe("<redacted>");
      expect(result.extra.unrelated.params).toEqual(["diagnostic"]);
      expect(JSON.stringify(result)).not.toContain(privateValue);
    });

    it("redacts nested serialized SQL errors with bound parameters", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

      const privateValue = "example transcript content";
      const query = "insert into dictations (text) values ($1)";
      const message = `Failed query: ${query}\n\tparams: ${privateValue}`;
      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const result = beforeSend({
        exception: {
          values: [
            {
              type: "Error",
              value: "Object captured as exception with keys: cause",
            },
          ],
        },
        extra: {
          __serialized__: {
            cause: { message, query, params: [privateValue] },
          },
        },
      } as never) as { extra?: Record<string, unknown> };

      expect(JSON.stringify(result)).not.toContain(privateValue);
      expect(
        (
          result.extra?.__serialized__ as {
            cause: { message: string; params: unknown };
          }
        ).cause.params,
      ).toBe("<redacted>");
      expect(
        (
          result.extra?.__serialized__ as {
            cause: { message: string; params: unknown };
          }
        ).cause.message,
      ).toContain("\tparams: <redacted>");
    });

    it("preserves serialized stack frames after redacting SQL params", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

      const privateValue = "private customer value";
      const name = "DrizzleQueryError";
      const query = "values ($1)";
      const message = `Failed query: ${query}\n\tparams: ${privateValue}`;
      const stack = `${name}: ${message}\n    at loadTranscript (server/db.ts:5:7)`;
      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const result = beforeSend({
        exception: {
          values: [
            {
              type: "Error",
              value: "Object captured as exception with keys: cause",
            },
          ],
        },
        extra: {
          __serialized__: {
            cause: {
              name,
              message,
              query,
              params: [privateValue],
              stack,
            },
          },
        },
      } as never) as { extra?: Record<string, unknown> };

      const cause = (
        result.extra?.__serialized__ as {
          cause: { stack: string };
        }
      ).cause;
      expect(cause.stack).toContain("params: <redacted>");
      expect(cause.stack).toContain("at loadTranscript");
      expect(JSON.stringify(result)).not.toContain(privateValue);
    });

    it("redacts SQL parameters in breadcrumbs and context data", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

      const privateValue = "example transcript content";
      const value = `Failed query: insert into dictations (text) values ($1)\n\tparams: ${privateValue}`;
      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const result = beforeSend({
        exception: { values: [{ type: "Error", value }] },
        breadcrumbs: [
          { message: value, data: { params: [privateValue] } },
          { message: "Search completed", data: { params: ["unrelated"] } },
        ],
        contexts: {
          database: { lastError: value },
          unrelated: { params: ["unrelated"] },
        },
        request: { data: { params: ["unrelated"] } },
        extra: { unrelated: { params: ["unrelated"] } },
      } as never) as {
        breadcrumbs: Array<{ message: string; data: { params: unknown } }>;
        contexts: {
          database: { lastError: string };
          unrelated: { params: string[] };
        };
        request: { data: { params: string[] } };
        extra: { unrelated: { params: string[] } };
      };

      expect(JSON.stringify(result)).not.toContain(privateValue);
      expect(result.breadcrumbs[0]?.message).toContain("params: <redacted>");
      expect(result.breadcrumbs[0]?.data.params).toBe("<redacted>");
      expect(result.breadcrumbs[1]?.data.params).toEqual(["unrelated"]);
      expect(result.contexts.database.lastError).toContain(
        "params: <redacted>",
      );
      expect(result.contexts.unrelated.params).toEqual(["unrelated"]);
      expect(result.request.data.params).toEqual(["unrelated"]);
      expect(result.extra.unrelated.params).toEqual(["unrelated"]);
    });

    it("drops ValidationError exceptions", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const result = beforeSend({
        exception: { values: [{ type: "ValidationError" }] },
      } as never);
      expect(result).toBeNull();
    });

    it("strips authorization, cookie, and set-cookie headers", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

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
      await initServerSentry();

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
      await initServerSentry();

      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const result = beforeSend({
        user: { ip_address: "1.2.3.4" },
      } as never);
      expect(result.user).toBeUndefined();
    });

    it("drops socket hang up unhandled rejections from node:_http_client", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const result = beforeSend({
        exception: {
          values: [
            {
              type: "Error",
              value: "socket hang up",
              mechanism: { type: "onunhandledrejection" },
              stacktrace: {
                frames: [
                  {
                    function: "Socket.socketOnEnd",
                    filename: "node:_http_client",
                  },
                ],
              },
            },
          ],
        },
      } as never);
      expect(result).toBeNull();
    });

    it("drops auto.node socket hang up unhandled rejections from node:_http_client", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const result = beforeSend({
        exception: {
          values: [
            {
              type: "Error",
              value: "socket hang up",
              mechanism: { type: "auto.node.onunhandledrejection" },
              stacktrace: {
                frames: [
                  { function: "process.processTicksAndRejections" },
                  {
                    function: "Socket.socketOnEnd",
                    filename: "node:_http_client",
                  },
                ],
              },
            },
          ],
        },
      } as never);
      expect(result).toBeNull();
    });

    it("drops SDK-only ErrorEvent unhandled rejections", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const result = beforeSend({
        exception: {
          values: [
            {
              type: "Error",
              value: "[object ErrorEvent]",
              mechanism: { type: "auto.node.onunhandledrejection" },
              stacktrace: {
                frames: [
                  { filename: "node:internal/process/promises" },
                  {
                    filename:
                      "/var/task/_libs/sentry__browser+sentry__core.mjs",
                  },
                ],
              },
            },
          ],
        },
      } as never);
      expect(result).toBeNull();
    });

    it("drops ErrorEvent rejections whose only in_app frames are bundled SDK chunks", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const result = beforeSend({
        exception: {
          values: [
            {
              type: "Error",
              value: "[object ErrorEvent]",
              mechanism: { type: "auto.node.onunhandledrejection" },
              stacktrace: {
                frames: [
                  { filename: "node:internal/process/promises" },
                  {
                    filename:
                      "/var/task/_libs/@sentry/node+import-in-the-middle.mjs",
                    in_app: true,
                  },
                  {
                    filename:
                      "/var/task/_libs/sentry__browser+sentry__core.mjs",
                    function: "Gr",
                    in_app: true,
                  },
                ],
              },
            },
          ],
        },
      } as never);
      expect(result).toBeNull();
    });

    it("keeps ErrorEvent unhandled rejections with application frames", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const event = {
        exception: {
          values: [
            {
              type: "Error",
              value: "[object ErrorEvent]",
              mechanism: { type: "auto.node.onunhandledrejection" },
              stacktrace: {
                frames: [
                  {
                    filename: "/app/server.js",
                    function: "handle",
                    in_app: true,
                  },
                  {
                    filename:
                      "/var/task/_libs/sentry__browser+sentry__core.mjs",
                  },
                ],
              },
            },
          ],
        },
      };
      const result = beforeSend(event as never);
      expect(result).not.toBeNull();
    });

    it("keeps socket hang up errors that aren't unhandled rejections", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const event = {
        exception: {
          values: [
            {
              type: "Error",
              value: "socket hang up",
              mechanism: { type: "generic" },
              stacktrace: {
                frames: [
                  {
                    function: "Socket.socketOnEnd",
                    filename: "node:_http_client",
                  },
                ],
              },
            },
          ],
        },
      };
      const result = beforeSend(event as never);
      expect(result).not.toBeNull();
    });

    it("keeps socket hang up rejections without an _http_client frame", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const event = {
        exception: {
          values: [
            {
              type: "Error",
              value: "socket hang up",
              mechanism: { type: "onunhandledrejection" },
              stacktrace: {
                frames: [{ function: "userCode", filename: "/app/server.js" }],
              },
            },
          ],
        },
      };
      const result = beforeSend(event as never);
      expect(result).not.toBeNull();
    });

    it("drops metadata-only SDK ErrorEvent payloads", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const result = beforeSend({
        metadata: {
          filename: "/var/task/_libs/sentry__browser+sentry__core.mjs",
          function: "Gr",
          value: "[object ErrorEvent]",
        },
      } as never);
      expect(result).toBeNull();
    });

    it("drops bare HTTPError Unauthorized events", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

      const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend;
      const result = beforeSend({
        exception: {
          values: [
            {
              type: "HTTPError",
              value: "Unauthorized",
            },
          ],
        },
      } as never);
      expect(result).toBeNull();
    });

    it("strips runtime_env from contexts", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry } = await import("./sentry.js");
      await initServerSentry();

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
      delete process.env.SENTRY_DSN;
      const { setSentryUserForRequest } = await import("./sentry.js");
      setSentryUserForRequest({ email: "a@b.com" });
      expect(sentryMock.mockScope.setUser).not.toHaveBeenCalled();
    });

    it("sets id/email/username and orgId tag when session present", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry, setSentryUserForRequest } =
        await import("./sentry.js");
      await initServerSentry();

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
      await initServerSentry();

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
      await initServerSentry();

      setSentryUserForRequest(null);
      expect(sentryMock.mockScope.setUser).toHaveBeenCalledWith(null);
      expect(sentryMock.mockScope.setTag).toHaveBeenCalledWith("orgId", null);
    });
  });

  describe("captureRouteError", () => {
    it("no-ops when Sentry isn't initialized", async () => {
      delete process.env.SENTRY_SERVER_DSN;
      delete process.env.SENTRY_DSN;
      const { captureRouteError } = await import("./sentry.js");
      const result = captureRouteError(new Error("boom"));
      expect(result).toBeUndefined();
      expect(sentryMock.captureException).not.toHaveBeenCalled();
    });

    it("captures with route/method/userAgent tags", async () => {
      process.env.SENTRY_SERVER_DSN = "https://test@example/123";
      const { initServerSentry, captureRouteError } =
        await import("./sentry.js");
      await initServerSentry();

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
