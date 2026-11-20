import type { H3Event } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function makeEvent(cookie: string): H3Event {
  const path = "/_agent-native/auth/session";
  const headers = new Headers({
    cookie,
    host: "localhost",
  });
  const req = new Request(`https://localhost${path}`, {
    method: "GET",
    headers,
  });
  return {
    req,
    headers,
    url: new URL(req.url),
    res: { headers: new Headers(), status: 200 },
    context: {},
    path,
    node: {
      req: {
        method: "GET",
        url: path,
        headers: Object.fromEntries(headers),
      },
      res: { setHeader: vi.fn(), getHeader: vi.fn(), appendHeader: vi.fn() },
    },
  } as unknown as H3Event;
}

describe("rolling framework session cookies", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("rolls legacy session created_at and re-issues Set-Cookie after 24h", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ACCESS_TOKEN", undefined);
    vi.stubEnv("ACCESS_TOKENS", undefined);
    vi.stubEnv("AUTH_DISABLED", undefined);

    const token = "legacy-roll-token-1";
    const initialCreatedAt = Date.now() - ONE_DAY_MS - 60_000;
    let storedCreatedAt = initialCreatedAt;
    const updates: Array<{ sql: string; args: unknown[] }> = [];

    vi.doMock("../db/client.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../db/client.js")>()),
      getDbExec: () => ({
        execute: async (query: string | { sql: string; args?: unknown[] }) => {
          const sql = typeof query === "string" ? query : query.sql;
          const args = typeof query === "string" ? [] : (query.args ?? []);
          if (sql.includes("CREATE TABLE")) return { rows: [] };
          if (sql.includes("SELECT email, created_at FROM sessions")) {
            return {
              rows: [
                {
                  email: "active@example.test",
                  created_at: storedCreatedAt,
                },
              ],
            };
          }
          if (sql.includes("UPDATE sessions SET created_at")) {
            updates.push({ sql, args });
            storedCreatedAt = Number(args[0]);
            return { rows: [] };
          }
          if (sql.includes('FROM "user"')) {
            return { rows: [{ email_verified: 1 }] };
          }
          return { rows: [] };
        },
      }),
      isPostgres: () => false,
    }));

    vi.doMock("./better-auth-instance.js", () => ({
      getBetterAuth: async () => null,
      getBetterAuthSync: () => null,
      isBetterAuthActive: () => false,
      getBetterAuthCookiePrefix: () => "an",
    }));

    const auth = await import("./auth.js");
    const ev = makeEvent(`an_session=${token}`);
    const session = await auth.getSession(ev);

    expect(session?.email).toBe("active@example.test");
    expect(updates).toHaveLength(1);
    expect(storedCreatedAt).toBeGreaterThan(initialCreatedAt + ONE_DAY_MS);
    const setCookies = ev.res.headers.getSetCookie?.() ?? [];
    expect(setCookies.some((c) => c.includes(`an_session=${token}`))).toBe(
      true,
    );
  });

  it("does not roll or re-issue Set-Cookie when session was refreshed less than 24h ago", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ACCESS_TOKEN", undefined);
    vi.stubEnv("ACCESS_TOKENS", undefined);
    vi.stubEnv("AUTH_DISABLED", undefined);

    const token = "fresh-session-token-1";
    const freshCreatedAt = Date.now() - 60 * 60 * 1000;
    const updates: Array<{ sql: string; args: unknown[] }> = [];

    vi.doMock("../db/client.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../db/client.js")>()),
      getDbExec: () => ({
        execute: async (query: string | { sql: string; args?: unknown[] }) => {
          const sql = typeof query === "string" ? query : query.sql;
          const args = typeof query === "string" ? [] : (query.args ?? []);
          if (sql.includes("CREATE TABLE")) return { rows: [] };
          if (sql.includes("SELECT email, created_at FROM sessions")) {
            return {
              rows: [
                {
                  email: "fresh@example.test",
                  created_at: freshCreatedAt,
                },
              ],
            };
          }
          if (sql.includes("UPDATE sessions SET created_at")) {
            updates.push({ sql, args });
            return { rows: [] };
          }
          if (sql.includes('FROM "user"')) {
            return { rows: [{ email_verified: 1 }] };
          }
          return { rows: [] };
        },
      }),
      isPostgres: () => false,
    }));

    vi.doMock("./better-auth-instance.js", () => ({
      getBetterAuth: async () => null,
      getBetterAuthSync: () => null,
      isBetterAuthActive: () => false,
      getBetterAuthCookiePrefix: () => "an",
    }));

    const auth = await import("./auth.js");
    const ev = makeEvent(`an_session=${token}`);
    const session = await auth.getSession(ev);

    expect(session?.email).toBe("fresh@example.test");
    expect(updates).toHaveLength(0);
    const setCookies = ev.res.headers.getSetCookie?.() ?? [];
    expect(setCookies.some((c) => c.includes(`an_session=${token}`))).toBe(
      false,
    );
  });

  it("rolls Better Auth session table expiry and re-issues Set-Cookie after 24h", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ACCESS_TOKEN", undefined);
    vi.stubEnv("ACCESS_TOKENS", undefined);
    vi.stubEnv("AUTH_DISABLED", undefined);

    const token = "ba-mirror-token-1";
    const oldExpires = new Date(Date.now() + 28 * ONE_DAY_MS).toISOString();
    const updates: Array<{ sql: string; args: unknown[] }> = [];

    vi.doMock("../db/client.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../db/client.js")>()),
      getDbExec: () => ({
        execute: async (query: string | { sql: string; args?: unknown[] }) => {
          const sql = typeof query === "string" ? query : query.sql;
          const args = typeof query === "string" ? [] : (query.args ?? []);
          if (sql.includes("CREATE TABLE")) return { rows: [] };
          if (sql.includes("SELECT email, created_at FROM sessions")) {
            return { rows: [] };
          }
          if (sql.includes('FROM "session" s JOIN "user"')) {
            return {
              rows: [
                {
                  email: "oauth@example.test",
                  expires_at: oldExpires,
                },
              ],
            };
          }
          if (sql.includes('UPDATE "session" SET expires_at')) {
            updates.push({ sql, args });
            return { rows: [] };
          }
          if (sql.includes('FROM "user"')) {
            return { rows: [{ email_verified: 1 }] };
          }
          return { rows: [] };
        },
      }),
      isPostgres: () => false,
    }));

    vi.doMock("./better-auth-instance.js", () => ({
      getBetterAuth: async () => null,
      getBetterAuthSync: () => null,
      isBetterAuthActive: () => false,
      getBetterAuthCookiePrefix: () => "an",
    }));

    const auth = await import("./auth.js");
    const ev = makeEvent(`an_session=${token}`);
    const session = await auth.getSession(ev);

    expect(session?.email).toBe("oauth@example.test");
    expect(updates).toHaveLength(1);
    const setCookies = ev.res.headers.getSetCookie?.() ?? [];
    expect(setCookies.some((c) => c.includes(`an_session=${token}`))).toBe(
      true,
    );
  });
});
