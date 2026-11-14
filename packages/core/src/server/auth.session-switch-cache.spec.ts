import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
// Uses only synthetic in-memory SDK accounts; no network or provider writes.
// Covers client identity replacement, not revocation of old server sessions.
// Covers the configured session cookie cache and HTTPS partitioned cookies.
// Production plugins and domain-scoped cookies still need separate coverage.
import type { H3Event } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";

type AuthModule = typeof import("./auth.js");
type NativeAuth = ReturnType<typeof betterAuth>;

const previousOwner = "previous-owner@example.test";
const nextOwner = "next-owner@example.test";
const previousPassword = "previous fixture passphrase";
const nextPassword = "next fixture passphrase";
const wrongPassword = "wrong fixture passphrase";
let outboundRequests = 0;
const fixtureSecret =
  "native better-auth fixture secret phrase, in-memory only";

class BrowserCookies {
  private values = new Map<string, string>();
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
      if (
        (name.startsWith("__Secure-") || attrs.has("partitioned")) &&
        !attrs.has("secure")
      )
        throw new Error("Fixture received a secure cookie without Secure");
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

// Reads the real SDK cookie without printing it.
function sessionCookie(lines: string[]): { name: string; value: string } {
  const line =
    lines.find((l) => /^(__Secure-)?[^=]*\.session_token=/.test(l)) ?? "";
  const eq = line.indexOf("=");
  return { name: line.slice(0, eq), value: line.slice(eq + 1).split(";")[0] };
}

async function fixture() {
  vi.resetModules();
  outboundRequests = 0;
  vi.stubGlobal("fetch", async () => {
    outboundRequests += 1;
    throw new Error("External network forbidden in SDK fixture");
  });
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("BETTER_AUTH_TELEMETRY", "0");
  vi.stubEnv("ACCESS_TOKEN", undefined);
  vi.stubEnv("ACCESS_TOKENS", undefined);
  vi.stubEnv("AUTH_DISABLED", undefined);

  let prefix = "";
  let native: NativeAuth | undefined;
  // token -> owner, filled only by the real signInEmail's returned token.
  const issued = new Map<string, string>();
  const persisted = new Map<string, { email: string; created_at: number }>();

  vi.doMock("./better-auth-instance.js", () => ({
    getBetterAuth: async () => {
      if (!prefix) throw new Error("native SDK requested before cookie prefix");
      return (native ??= betterAuth({
        baseURL: "https://fixture.example.test",
        secret: fixtureSecret,
        database: memoryAdapter({
          user: [],
          session: [],
          account: [],
          verification: [],
        }),
        telemetry: { enabled: false },
        logger: { disabled: true },
        rateLimit: { enabled: false },
        emailAndPassword: { enabled: true, requireEmailVerification: false },
        session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
        advanced: {
          cookiePrefix: prefix,
          useSecureCookies: true,
          defaultCookieAttributes: {
            sameSite: "none",
            secure: true,
            partitioned: true,
          },
        },
      }));
    },
    getBetterAuthSync: () => native,
    getBetterAuthInternalAdapter: async () =>
      (await native!.$context).internalAdapter,
  }));
  vi.doMock("../db/client.js", () => ({
    getDbExec: () => ({
      execute: vi.fn(async (statement: { sql: string; args?: unknown[] }) => {
        if (
          typeof statement.sql === "string" &&
          /^\s*INSERT INTO sessions/.test(statement.sql)
        ) {
          persisted.set(String(statement.args?.[0]), {
            email: String(statement.args?.[1]),
            created_at: Number(statement.args?.[2]),
          });
        }
        if (/^\s*SELECT email, created_at FROM sessions/.test(statement.sql)) {
          const row = persisted.get(String(statement.args?.[0]));
          return { rows: row ? [row] : [] };
        }
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

  const auth = (await import("./auth.js")) as AuthModule;
  prefix = auth.BETTER_AUTH_COOKIE_PREFIX;

  const { getBetterAuth } = await import("./better-auth-instance.js");
  const sdk = (await getBetterAuth()) as unknown as NativeAuth;

  // Seed both example.test users through the real SDK.
  const seeded = await sdk.api.signUpEmail({
    body: {
      email: previousOwner,
      password: previousPassword,
      name: "Previous owner",
    },
    returnHeaders: true,
  });
  await sdk.api.signUpEmail({
    body: { email: nextOwner, password: nextPassword, name: "Next owner" },
    returnHeaders: true,
  });
  const previousSetCookies = seeded.headers.getSetCookie();
  for (const suffix of ["session_token", "session_data"]) {
    const line = previousSetCookies.find((value) =>
      value.startsWith(`__Secure-${prefix}.${suffix}=`),
    );
    expect(Boolean(line)).toBe(true);
    expect(/;\s*Secure(?:;|$)/i.test(line ?? "")).toBe(true);
    expect(/;\s*Partitioned(?:;|$)/i.test(line ?? "")).toBe(true);
    expect(/;\s*SameSite=None(?:;|$)/i.test(line ?? "")).toBe(true);
  }

  // Dynamic capture: delegate to the real method, record the issued token.
  const realSignIn = sdk.api.signInEmail.bind(sdk.api);
  const signInSpy = vi
    .spyOn(sdk.api, "signInEmail")
    .mockImplementation(async (options: any) => {
      const result: any = await realSignIn(options);
      const body = result?.response ?? result;
      if (typeof body?.token === "string")
        issued.set(body.token, options.body.email);
      return result;
    });

  const routes = new Map<string, (request: H3Event) => unknown>();
  await auth.autoMountAuth({
    use: (path: string, handler: (request: H3Event) => unknown) =>
      routes.set(path, handler),
  } as unknown as Parameters<AuthModule["autoMountAuth"]>[0]);
  const login = routes.get("/_agent-native/auth/login");
  if (!login) throw new Error("Login route was not mounted");

  return { auth, prefix, login, signInSpy, issued, previousSetCookies };
}

async function owner(auth: AuthModule, cookies: BrowserCookies) {
  return (await auth.getSession(event(cookies.header())))?.email ?? null;
}

afterEach(() => {
  const observedOutboundRequests = outboundRequests;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.doUnmock("./better-auth-instance.js");
  vi.doUnmock("../db/client.js");
  vi.doUnmock("../db/ddl-guard.js");
  vi.doUnmock("../org/context.js");
  expect(observedOutboundRequests).toBe(0);
});

describe("password sign-in with cached partitioned native SDK sessions", () => {
  it("verifies the native signed session, then password login replaces it", async () => {
    const { auth, prefix, login, signInSpy, issued, previousSetCookies } =
      await fixture();
    const cookie = sessionCookie(previousSetCookies);
    expect(cookie.name).toBe(`__Secure-${prefix}.session_token`);
    expect(cookie.value.includes(".")).toBe(true);

    const jar = new BrowserCookies();
    jar.apply(previousSetCookies);
    for (const suffix of ["session_token", "session_data"]) {
      const name = `__Secure-${auth.BETTER_AUTH_COOKIE_PREFIX}.${suffix}`;
      expect(Boolean(jar.get(name, true))).toBe(true);
      expect(Boolean(jar.get(name, false))).toBe(false);
    }
    expect(await owner(auth, jar)).toBe(previousOwner);

    const request = event(jar.header(), {
      email: nextOwner,
      password: nextPassword,
    });
    await expect(login(request)).resolves.toMatchObject({ ok: true });
    expect(signInSpy).toHaveBeenCalledOnce();
    expect(issued.size).toBe(1);

    jar.apply(request.res.headers.getSetCookie());
    expect(issued.has(jar.get(auth.COOKIE_NAME, true) ?? "")).toBe(true);
    expect(await owner(auth, jar)).toBe(nextOwner);
    for (const suffix of ["session_token", "session_data"]) {
      const name = `__Secure-${prefix}.${suffix}`;
      expect(Boolean(jar.get(name, true))).toBe(false);
      expect(Boolean(jar.get(name, false))).toBe(false);
    }
  }, 15000);

  it("keeps the previous native owner when the real password check fails", async () => {
    const { auth, login, signInSpy, issued, previousSetCookies } =
      await fixture();
    const jar = new BrowserCookies();
    jar.apply(previousSetCookies);
    for (const suffix of ["session_token", "session_data"]) {
      const name = `__Secure-${auth.BETTER_AUTH_COOKIE_PREFIX}.${suffix}`;
      expect(Boolean(jar.get(name, true))).toBe(true);
      expect(Boolean(jar.get(name, false))).toBe(false);
    }
    expect(await owner(auth, jar)).toBe(previousOwner);

    const before = jar.header();
    const request = event(jar.header(), {
      email: nextOwner,
      password: wrongPassword,
    });
    await expect(login(request)).resolves.toMatchObject({
      error: expect.any(String),
    });
    expect(signInSpy).toHaveBeenCalledOnce();
    expect(issued.size).toBe(0);

    jar.apply(request.res.headers.getSetCookie());
    expect(jar.header() === before).toBe(true);
    expect(await owner(auth, jar)).toBe(previousOwner);
  }, 15000);

  it("resolves the next owner from a fresh framework password login", async () => {
    const { auth, login, signInSpy, issued } = await fixture();
    const jar = new BrowserCookies();

    const request = event(jar.header(), {
      email: nextOwner,
      password: nextPassword,
    });
    await expect(login(request)).resolves.toMatchObject({ ok: true });
    expect(signInSpy).toHaveBeenCalledOnce();
    expect(issued.size).toBe(1);

    jar.apply(request.res.headers.getSetCookie());
    expect(issued.has(jar.get(auth.COOKIE_NAME, true) ?? "")).toBe(true);
    expect(await owner(auth, jar)).toBe(nextOwner);
  }, 15000);
});
