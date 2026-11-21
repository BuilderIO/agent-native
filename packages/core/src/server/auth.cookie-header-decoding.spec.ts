import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExistsConcurrently: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));

function cookieEvent(cookie: string): any {
  // Browsers send the cookie percent-encoded, which `Headers` accepts as-is.
  const headers = new Headers({ host: "localhost", cookie });
  return {
    req: { method: "GET", url: "http://localhost/", headers },
    url: new URL("http://localhost/"),
    res: { headers: new Headers(), status: 200 },
    node: {
      req: {
        headers: { host: "localhost", cookie },
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

const baGetSession = vi.fn();

function mockBetterAuth() {
  vi.doMock("./better-auth-instance.js", () => ({
    getBetterAuth: vi.fn(async () => ({
      handler: vi.fn(async () => new Response("{}")),
      api: {
        getSession: baGetSession,
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
      const execute = vi.fn(async () => ({ rows: [] }));
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

describe("session lookup with cookies that do not decode to a header value", () => {
  beforeEach(() => {
    vi.resetModules();
    baGetSession.mockReset();
    baGetSession.mockImplementation(
      async ({ headers }: { headers: Headers }) => {
        const cookie = headers.get("cookie") ?? "";
        return cookie.includes("an_session=session-token")
          ? {
              user: { id: "u1", email: "member@example.com", name: "Member" },
              session: { token: "session-token" },
            }
          : null;
      },
    );
  });

  it.each([
    ["a wide character", "_shop_ref=%E2%9C%93%20ok", "%E2%9C%93%20ok"],
    ["an encoded LF", "_shop_ref=%0Aa", "%0Aa"],
    ["an encoded CR", "_shop_ref=a%0Db", "a%0Db"],
    ["an encoded NUL", "_shop_ref=a%00b", "a%00b"],
  ])(
    "resolves the session when a cookie holds %s",
    async (_label, unsafeCookie, rawValue) => {
      mockBetterAuth();
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const { autoMountAuth, getSession } = await import("./auth.js");
      await autoMountAuth({ use: vi.fn() } as any, {});

      await expect(
        getSession(cookieEvent(`${unsafeCookie}; an_session=session-token`)),
      ).resolves.toMatchObject({ email: "member@example.com" });

      expect(baGetSession).toHaveBeenCalled();
      const headers = baGetSession.mock.calls[0][0].headers as Headers;
      const forwarded = headers.get("cookie") ?? "";
      // The unsafe cookie is forwarded still encoded, so `Headers` accepts it.
      expect(forwarded).toContain(`_shop_ref=${rawValue}`);
      expect(() => new Headers({ cookie: forwarded })).not.toThrow();
      expect(errors).not.toHaveBeenCalledWith(
        "[auth] ba.api.getSession error:",
        expect.anything(),
      );
      errors.mockRestore();
    },
  );
});
