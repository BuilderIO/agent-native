import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExistsConcurrently: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));

function bearerEvent(token: string): any {
  const headers = new Headers({
    host: "localhost",
    authorization: `Bearer ${token}`,
  });
  return {
    req: { method: "GET", url: "http://localhost/", headers },
    url: new URL("http://localhost/"),
    res: { headers: new Headers(), status: 200 },
    node: {
      req: {
        headers: { host: "localhost", authorization: `Bearer ${token}` },
        url: "/",
        method: "GET",
      },
      res: { setHeader: vi.fn(), getHeader: vi.fn(), appendHeader: vi.fn() },
    },
    headers,
    context: {},
    path: "/",
  };
}

function mockAuthWithBetterAuthSessions(activeTokens: Record<string, string>) {
  vi.doMock("./better-auth-instance.js", () => ({
    getBetterAuth: vi.fn(async () => ({
      handler: vi.fn(async () => new Response("{}")),
      api: {
        getSession: vi.fn(async () => null),
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
        const sql: string = typeof query === "string" ? query : query.sql;
        if (sql.includes("to_regclass")) {
          return { rows: [{ user_table: "user", session_table: "session" }] };
        }
        if (sql.includes('FROM "session" s JOIN "user" u')) {
          const email = activeTokens[query.args?.[0]];
          return { rows: email ? [{ email }] : [] };
        }
        return { rows: [] };
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

describe("bearer session tokens", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("accepts an active Better Auth session token with no legacy sessions row", async () => {
    mockAuthWithBetterAuthSessions({ "ba-only-token": "member@example.com" });
    const { autoMountAuth, getSession } = await import("./auth.js");
    await autoMountAuth({ use: vi.fn() } as any, {});

    await expect(
      getSession(bearerEvent("ba-only-token")),
    ).resolves.toMatchObject({
      email: "member@example.com",
      token: "ba-only-token",
    });
  });

  it("rejects a bearer token that is neither a legacy nor an active Better Auth session", async () => {
    mockAuthWithBetterAuthSessions({});
    const { autoMountAuth, getSession } = await import("./auth.js");
    await autoMountAuth({ use: vi.fn() } as any, {});

    await expect(getSession(bearerEvent("unknown-token"))).resolves.toBeNull();
  });
});
