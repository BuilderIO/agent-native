import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SSR_CACHE_CONTROL,
  DEFAULT_SSR_CDN_CACHE_CONTROL,
  DEFAULT_SSR_NETLIFY_CDN_CACHE_CONTROL,
  DISABLED_SSR_CACHE_HEADERS,
} from "../shared/cache-control.js";
import type { AuthOptions } from "./auth.js";
import { AUTH_FALLBACK_ATTRIBUTE } from "./onboarding-html.js";

// The sign-in page's cache headers, kept apart from auth.spec.ts (which
// reaches into the Design template, so cannot run in the mutation sandbox) so
// that the lines they cover are mutation-tested.

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExistsConcurrently: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./better-auth-instance.js", () => ({
  getBetterAuth: vi.fn(async () => ({
    handler: vi.fn(async () => new Response("{}")),
    api: {
      getSession: vi.fn(async () => null),
      signInEmail: vi.fn(),
      signUpEmail: vi.fn(),
      signOut: vi.fn(),
    },
  })),
  getBetterAuthSync: vi.fn(() => undefined),
}));

type Guard = (event: unknown) => Promise<unknown>;

function loginEvent() {
  const url = "/demo/login";
  const headers = new Headers({ host: "localhost" });
  return {
    req: { method: "GET", url: `http://localhost${url}`, headers },
    url: new URL(`http://localhost${url}`),
    res: { headers: new Headers(), status: 200 },
    node: {
      req: { headers: { host: "localhost" }, url, method: "GET" },
      res: { setHeader: vi.fn(), getHeader: vi.fn(), appendHeader: vi.fn() },
    },
    headers,
    context: {},
    path: url,
    _cookies: {},
  };
}

async function mountGuard(options: AuthOptions): Promise<Guard> {
  const { autoMountAuth } = await import("./auth.js");
  const use = vi.fn<(...args: unknown[]) => void>();
  await autoMountAuth(
    { use } as unknown as Parameters<typeof autoMountAuth>[0],
    options,
  );
  const guard = use.mock.calls
    .map((call) => call[0])
    .find((arg): arg is Guard => typeof arg === "function");
  if (!guard) throw new Error("autoMountAuth registered no auth guard");
  return guard;
}

async function getLoginPage(guard: Guard): Promise<Response> {
  const response = await guard(loginEvent());
  if (!(response instanceof Response)) {
    throw new Error("the auth guard did not serve the sign-in page");
  }
  return response;
}

function expectShared(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe(DEFAULT_SSR_CACHE_CONTROL);
  expect(response.headers.get("CDN-Cache-Control")).toBe(
    DEFAULT_SSR_CDN_CACHE_CONTROL,
  );
  expect(response.headers.get("Netlify-CDN-Cache-Control")).toBe(
    DEFAULT_SSR_NETLIFY_CDN_CACHE_CONTROL,
  );
}

function expectUncached(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe(
    DISABLED_SSR_CACHE_HEADERS["cache-control"],
  );
  expect(response.headers.get("CDN-Cache-Control")).toBe(
    DISABLED_SSR_CACHE_HEADERS["cdn-cache-control"],
  );
  expect(response.headers.get("Netlify-CDN-Cache-Control")).toBe(
    DISABLED_SSR_CACHE_HEADERS["netlify-cdn-cache-control"],
  );
}

describe("sign-in page cache headers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_SECRET", "login-page-secret");
    vi.stubEnv("APP_BASE_PATH", "/demo");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps the fallback out of shared caches until the app's renderer renders", async () => {
    let markup: string | undefined;
    const guard = await mountGuard({ renderSignInPage: () => markup });

    const deferred = await getLoginPage(guard);
    expect(await deferred.clone().text()).toContain(AUTH_FALLBACK_ATTRIBUTE);
    expectUncached(deferred);

    markup = '<main id="login-form"></main>';
    const rendered = await getLoginPage(guard);
    expectShared(rendered);
    const html = await rendered.text();
    expect(html).toContain('id="login-form"');
    expect(html).not.toContain(AUTH_FALLBACK_ATTRIBUTE);
  });

  it("shares core's own markup when the app has no renderer", async () => {
    const guard = await mountGuard({});

    const page = await getLoginPage(guard);
    expect(await page.clone().text()).toContain(AUTH_FALLBACK_ATTRIBUTE);
    expectShared(page);
  });
});
