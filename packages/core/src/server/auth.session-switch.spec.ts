import type { H3Event } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";

type AuthModule = typeof import("./auth.js");
const previousOwner = "previous-owner@example.test";
const nextOwner = "next-owner@example.test";
const previousToken = "previous-login";
const nextToken = "next-login";

class BrowserCookies {
  private values = new Map<string, string>();
  seed(name: string, value: string, partitioned = false) {
    this.values.set(
      `${name}||/|${partitioned ? "partitioned" : "plain"}`,
      value,
    );
  }
  apply(lines: string[]) {
    for (const line of lines) {
      const [pair = "", ...attributes] = line
        .split(";")
        .map((value) => value.trim());
      const split = pair.indexOf("=");
      if (split < 1) throw new Error("Invalid fixture Set-Cookie");
      const name = pair.slice(0, split),
        value = pair.slice(split + 1);
      const attrs = new Map(
        attributes.map((attribute) => {
          const at = attribute.indexOf("=");
          return [
            attribute.slice(0, at < 0 ? undefined : at).toLowerCase(),
            at < 0 ? "" : attribute.slice(at + 1),
          ];
        }),
      );
      const key = `${name}|${(attrs.get("domain") ?? "").replace(/^\./, "")}|${attrs.get("path") ?? "/"}|${attrs.has("partitioned") ? "partitioned" : "plain"}`;
      if (
        attrs.get("max-age") === "0" ||
        (attrs.has("expires") &&
          Date.parse(attrs.get("expires") ?? "") <= Date.now())
      )
        this.values.delete(key);
      else this.values.set(key, value);
    }
  }
  header() {
    return [...this.values]
      .map(([key, value]) => `${key.split("|")[0]}=${value}`)
      .join("; ");
  }
  get(name: string, partitioned = false) {
    return this.values.get(
      `${name}||/|${partitioned ? "partitioned" : "plain"}`,
    );
  }
}

function event(cookie: string, body?: Record<string, string>): H3Event {
  const path = body
    ? "/_agent-native/auth/login"
    : "/_agent-native/auth/session";
  const headers = new Headers({
    cookie,
    host: "localhost",
    ...(body ? { "content-type": "application/json" } : {}),
  });
  const req = new Request(`https://localhost${path}`, {
    method: body ? "POST" : "GET",
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
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
        method: req.method,
        url: path,
        headers: Object.fromEntries(headers),
      },
      res: { setHeader: vi.fn(), getHeader: vi.fn(), appendHeader: vi.fn() },
    },
  } as unknown as H3Event;
}

async function fixture(
  challenge = false,
  rejected = false,
  persistFailed = false,
) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("ACCESS_TOKEN", undefined);
  vi.stubEnv("ACCESS_TOKENS", undefined);
  vi.stubEnv("AUTH_DISABLED", undefined);
  let prefix = "";
  const sessionApi = vi.fn(async ({ headers }: { headers: Headers }) => {
    const pairs = new Map(
      (headers.get("cookie") ?? "")
        .split(/;\s*/)
        .filter(Boolean)
        .map((pair) => {
          const at = pair.indexOf("=");
          return [pair.slice(0, at), pair.slice(at + 1)];
        }),
    );
    if (
      ![`${prefix}.session_token`, `__Secure-${prefix}.session_token`].some(
        (name) => pairs.get(name) === previousToken,
      )
    )
      return null;
    return {
      session: {
        id: "previous-session",
        token: previousToken,
        userId: "previous-user",
        expiresAt: new Date(Date.now() + 3600000),
      },
      user: {
        id: "previous-user",
        email: previousOwner,
        emailVerified: true,
        name: "Previous owner",
      },
    };
  });
  const signIn = vi.fn(async () => {
    if (rejected) throw new Error("INVALID_EMAIL_OR_PASSWORD");
    return challenge
      ? {
          response: { twoFactorRedirect: true },
          headers: new Headers({
            "set-cookie": "an.two_factor=next-challenge; Path=/; HttpOnly",
          }),
        }
      : { token: nextToken };
  });
  const authApi = {
    handler: vi.fn(async () => new Response("{}")),
    api: {
      getSession: sessionApi,
      signInEmail: signIn,
      signUpEmail: vi.fn(),
      signOut: vi.fn(),
    },
  };
  vi.doMock("./better-auth-instance.js", () => ({
    getBetterAuth: async () => authApi,
    getBetterAuthSync: () => undefined,
  }));
  vi.doMock("../db/client.js", () => ({
    getDbExec: () => ({
      execute: vi.fn(async (statement: { sql: string; args?: unknown[] }) => {
        if (persistFailed && statement.sql.startsWith("INSERT INTO sessions"))
          throw new Error("fixture database unavailable");
        if (
          /^\s*SELECT email, created_at FROM sessions/.test(statement.sql) &&
          statement.args?.[0] === nextToken
        )
          return { rows: [{ email: nextOwner, created_at: Date.now() }] };
        return { rows: [] };
      }),
    }),
    isLocalDatabase: () => true,
    retryOnDdlRace: (run: () => Promise<unknown>) => run(),
  }));
  vi.doMock("../db/ddl-guard.js", () => ({
    ensureTableExists: async () => {},
    ensureColumnExists: async () => {},
    ensureIndexExists: async () => {},
    ensureIndexExistsConcurrently: async () => {},
  }));
  vi.doMock("../org/context.js", async (original) => ({
    ...(await original<object>()),
    resolveOrgIdForEmailViaEvent: async () => null,
  }));
  const auth = await import("./auth.js");
  prefix = auth.BETTER_AUTH_COOKIE_PREFIX;
  const routes = new Map<string, (request: H3Event) => unknown>();
  await auth.autoMountAuth({
    use: (path: string, handler: (request: H3Event) => unknown) =>
      routes.set(path, handler),
  } as unknown as Parameters<AuthModule["autoMountAuth"]>[0]);
  const login = routes.get("/_agent-native/auth/login");
  if (!login) throw new Error("Login route was not mounted");
  return { auth, prefix, login, signIn };
}

async function owner(auth: AuthModule, cookies: BrowserCookies) {
  return (await auth.getSession(event(cookies.header())))?.email ?? null;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.doUnmock("./better-auth-instance.js");
  vi.doUnmock("../db/client.js");
  vi.doUnmock("../db/ddl-guard.js");
  vi.doUnmock("../org/context.js");
});

describe("password sign-in with an existing browser session", () => {
  it("control: a new framework session alone resolves its owner", async () => {
    const { auth } = await fixture();
    const jar = new BrowserCookies();
    const issue = event("");
    auth.setFrameworkSessionCookie(issue, nextToken);
    jar.apply(issue.res.headers.getSetCookie());
    expect(await owner(auth, jar)).toBe(nextOwner);
  });
  it.each([
    { secure: false, partitioned: false },
    { secure: true, partitioned: false },
    { secure: false, partitioned: true },
    { secure: true, partitioned: true },
  ])(
    "replaces the prior owner after a successful login ($secure/$partitioned)",
    async ({ secure, partitioned }) => {
      const { auth, prefix, login, signIn } = await fixture();
      const jar = new BrowserCookies();
      const name = `${secure ? "__Secure-" : ""}${prefix}.session_token`;
      jar.seed(name, previousToken, partitioned);
      jar.seed(`${prefix}.session_data`, "previous-cache");
      jar.seed(`${prefix}.dont_remember`, "1");
      jar.seed(`${prefix}.two_factor`, "existing-challenge");
      jar.seed("an_other.session_token", "unrelated-login");
      jar.seed("theme", "dark");
      expect(await owner(auth, jar)).toBe(previousOwner);
      const request = event(jar.header(), {
        email: nextOwner,
        password: "fixture-password",
      });
      await expect(login(request)).resolves.toMatchObject({ ok: true });
      expect(signIn).toHaveBeenCalledOnce();
      jar.apply(request.res.headers.getSetCookie());
      expect(await owner(auth, jar)).toBe(nextOwner);
      expect(jar.get(`${prefix}.two_factor`)).toBe("existing-challenge");
      expect(jar.get("an_other.session_token")).toBe("unrelated-login");
      expect(jar.get("theme")).toBe("dark");
    },
  );
  it("preserves the current identity while a second factor is still required", async () => {
    const { auth, prefix, login } = await fixture(true);
    const jar = new BrowserCookies();
    jar.seed(`${prefix}.session_token`, previousToken);
    const request = event(jar.header(), {
      email: nextOwner,
      password: "fixture-password",
    });
    await expect(login(request)).resolves.toMatchObject({
      twoFactorRedirect: true,
    });
    jar.apply(request.res.headers.getSetCookie());
    expect(await owner(auth, jar)).toBe(previousOwner);
    expect(jar.get(`${prefix}.session_token`)).toBe(previousToken);
  });
  it("keeps the prior identity when password validation fails", async () => {
    const { auth, prefix, login } = await fixture(false, true);
    const jar = new BrowserCookies();
    jar.seed(`${prefix}.session_token`, previousToken);
    const request = event(jar.header(), {
      email: nextOwner,
      password: "fixture-password",
    });
    await expect(login(request)).resolves.toMatchObject({
      error: expect.any(String),
    });
    jar.apply(request.res.headers.getSetCookie());
    expect(await owner(auth, jar)).toBe(previousOwner);
  });
  it("establishes the new identity with no previous cookie", async () => {
    const { auth, login } = await fixture();
    const jar = new BrowserCookies();
    const request = event(jar.header(), {
      email: nextOwner,
      password: "fixture-password",
    });
    await expect(login(request)).resolves.toMatchObject({ ok: true });
    jar.apply(request.res.headers.getSetCookie());
    expect(await owner(auth, jar)).toBe(nextOwner);
  });
  it("retains the previous identity if session persistence fails after validation", async () => {
    const { auth, prefix, login } = await fixture(false, false, true);
    const jar = new BrowserCookies();
    jar.seed(`${prefix}.session_token`, previousToken);
    const request = event(jar.header(), {
      email: nextOwner,
      password: "fixture-password",
    });
    await expect(login(request)).resolves.toMatchObject({
      error: expect.any(String),
    });
    jar.apply(request.res.headers.getSetCookie());
    expect(await owner(auth, jar)).toBe(previousOwner);
    expect(jar.get(auth.COOKIE_NAME, true)).toBeUndefined();
  });
});
