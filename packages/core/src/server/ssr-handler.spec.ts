import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createH3SSRHandler,
  DEFAULT_SSR_CACHE_HEADERS,
  DEFAULT_SPECULATION_RULES_HEADER,
} from "./ssr-handler.js";
import {
  DEFAULT_SSR_CACHE_CONTROL,
  DEFAULT_SSR_CDN_CACHE_CONTROL,
  DEFAULT_SSR_NETLIFY_CDN_CACHE_CONTROL,
} from "../shared/cache-control.js";
import {
  AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER,
  AGENT_NATIVE_SOCIAL_IMAGE_PATH,
} from "../shared/social-meta.js";
import { getRequestUserEmail } from "./request-context.js";

const mocks = vi.hoisted(() => {
  const requestHandler = vi.fn(async (request: Request) => {
    const url = new URL(request.url);
    return new Response(`${request.method} ${url.pathname}${url.search}`, {
      headers: { "x-rr-path": url.pathname },
    });
  });
  const getSession = vi.fn(async () => null);
  const getOrgContext = vi.fn(async () => ({
    email: "",
    orgId: null,
    orgName: null,
    role: null,
  }));
  const requestHasEmbedAuthMarker = vi.fn(() => false);
  return {
    getSession,
    getOrgContext,
    requestHandler,
    requestHasEmbedAuthMarker,
  };
});

vi.mock("react-router", () => ({
  createRequestHandler: vi.fn(() => mocks.requestHandler),
}));

vi.mock("./auth.js", () => ({
  BETTER_AUTH_COOKIE_PREFIX: "an",
  COOKIE_NAME: "an_session",
  getSession: mocks.getSession,
}));

vi.mock("../org/context.js", () => ({
  getOrgContext: mocks.getOrgContext,
}));

vi.mock("./embed-session.js", () => ({
  requestHasEmbedAuthMarker: mocks.requestHasEmbedAuthMarker,
}));

function createEvent(pathname: string, method = "GET", init: RequestInit = {}) {
  const url = `http://example.test${pathname}`;
  return {
    url: new URL(url),
    req: new Request(url, { method, ...init }),
  };
}

function expectDefaultSsrCacheHeaders(response: Response) {
  for (const [name, value] of Object.entries(DEFAULT_SSR_CACHE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value);
  }
}

function expectNoDefaultCdnCacheHeaders(response: Response) {
  expect(response.headers.get("cdn-cache-control")).toBeNull();
  expect(response.headers.get("netlify-cdn-cache-control")).toBeNull();
}

describe("createH3SSRHandler", () => {
  afterEach(() => {
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
    delete process.env.SENTRY_CLIENT_DSN;
    delete process.env.SENTRY_DSN;
    delete process.env.SENTRY_ENVIRONMENT;
    mocks.requestHandler.mockClear();
    mocks.getSession.mockClear();
    mocks.getOrgContext.mockClear();
    mocks.requestHasEmbedAuthMarker.mockClear();
    mocks.requestHasEmbedAuthMarker.mockReturnValue(false);
  });

  it("strips APP_BASE_PATH before handing requests to React Router", async () => {
    process.env.APP_BASE_PATH = "/mail";
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(createEvent("/mail/inbox?view=unread"));

    await expect(response.text()).resolves.toBe("GET /inbox?view=unread");
    expect(mocks.requestHandler).toHaveBeenCalledTimes(1);
  });

  it("strips APP_BASE_PATH from React Router lazy route manifest paths", async () => {
    process.env.APP_BASE_PATH = "/dispatch";
    const handler = createH3SSRHandler(() => ({})) as any;

    await handler(
      createEvent(
        "/dispatch/__manifest?paths=/dispatch/apps,/dispatch/overview,/starter/home",
      ),
    );

    const request = mocks.requestHandler.mock.calls[0]?.[0] as Request;
    const url = new URL(request.url);
    expect(url.pathname).toBe("/__manifest");
    expect(url.searchParams.get("paths")).toBe("/apps,/overview,/starter/home");
  });

  it("preserves request bodies when rewriting mounted non-GET requests", async () => {
    process.env.APP_BASE_PATH = "/dispatch";
    mocks.requestHandler.mockImplementationOnce(async (request: Request) => {
      const url = new URL(request.url);
      const body = await request.text();
      return new Response(`${request.method} ${url.pathname} ${body}`);
    });
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(
      createEvent("/dispatch/apps", "POST", { body: "create=1" }),
    );

    await expect(response.text()).resolves.toBe("POST /apps create=1");
    expect(mocks.requestHandler).toHaveBeenCalledTimes(1);
  });

  it("preserves HEAD semantics under APP_BASE_PATH", async () => {
    process.env.APP_BASE_PATH = "/calendar";
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(createEvent("/calendar/settings", "HEAD"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-rr-path")).toBe("/settings");
    await expect(response.text()).resolves.toBe("");
    expect(mocks.requestHandler).toHaveBeenCalledTimes(1);
  });

  it("applies the default public SSR cache policy to anonymous HTML responses", async () => {
    mocks.requestHandler.mockResolvedValueOnce(
      new Response("<html><head></head><body>ok</body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(createEvent("/"));

    expectDefaultSsrCacheHeaders(response);
    expect(response.headers.get("speculation-rules")).toBe(
      DEFAULT_SPECULATION_RULES_HEADER,
    );
  });

  it("prefixes the default Speculation-Rules header under APP_BASE_PATH", async () => {
    process.env.APP_BASE_PATH = "/docs";
    mocks.requestHandler.mockResolvedValueOnce(
      new Response("<html><head></head><body>ok</body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(createEvent("/docs"));

    expect(response.headers.get("speculation-rules")).toBe(
      '"/docs/_agent-native/speculation-rules.json"',
    );
  });

  it("overwrites explicit no-store cache policies on SSR HTML responses", async () => {
    mocks.requestHandler.mockResolvedValueOnce(
      new Response("<html><head></head><body>ok</body></html>", {
        headers: {
          "cache-control": "private, no-store",
          "content-type": "text/html; charset=utf-8",
        },
      }),
    );
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(createEvent("/private-html"));

    expectDefaultSsrCacheHeaders(response);
  });

  it("replaces React Router's default no-cache policy on .data responses", async () => {
    mocks.requestHandler.mockResolvedValueOnce(
      new Response('[{"_1":2},"routes/docs.$slug"]', {
        headers: {
          "cache-control": "no-cache",
          "content-type": "text/x-script",
          "x-remix-response": "yes",
        },
      }),
    );
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(createEvent("/docs/template-calendar.data"));

    expectDefaultSsrCacheHeaders(response);
  });

  it("serves public SWR on .data even when the request carries a session cookie", async () => {
    mocks.requestHandler.mockResolvedValueOnce(
      new Response('[{"_1":2},"routes/account"]', {
        headers: {
          "cache-control": "no-cache",
          "content-type": "text/x-script",
          "x-remix-response": "yes",
        },
      }),
    );
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(
      createEvent("/account.data", "GET", {
        headers: { cookie: "an_session=active" },
      }),
    );

    // Auth makes no difference: SSR .data is hard-cached for everyone, so an
    // authenticated request gets the exact same public SWR headers as anonymous.
    expectDefaultSsrCacheHeaders(response);
    expect(response.headers.get("cache-control")).toBe(
      DEFAULT_SSR_CACHE_CONTROL,
    );
    expect(response.headers.get("cdn-cache-control")).toBe(
      DEFAULT_SSR_CDN_CACHE_CONTROL,
    );
    expect(response.headers.get("netlify-cdn-cache-control")).toBe(
      DEFAULT_SSR_NETLIFY_CDN_CACHE_CONTROL,
    );
  });

  it("overrides a route-provided private/no-store on .data with the public SWR policy when authenticated", async () => {
    mocks.requestHandler.mockResolvedValueOnce(
      new Response('[{"_1":2},"routes/private"]', {
        headers: {
          "cache-control": "private, no-store",
          "content-type": "text/x-script",
          "x-remix-response": "yes",
        },
      }),
    );
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(
      createEvent("/private.data", "GET", {
        headers: { cookie: "an_session=active" },
      }),
    );

    // The framework hard-caches SSR .data for everyone: a route can no longer
    // opt .data into private/no-store, even when the request is authenticated.
    expectDefaultSsrCacheHeaders(response);
    expect(response.headers.get("cache-control")).toBe(
      DEFAULT_SSR_CACHE_CONTROL,
    );
  });

  it("does not replace no-cache on non-React Router .data responses", async () => {
    mocks.requestHandler.mockResolvedValueOnce(
      new Response('{"ok":true}', {
        headers: {
          "cache-control": "no-cache",
          "content-type": "application/json",
        },
      }),
    );
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(createEvent("/custom.data"));

    expect(response.headers.get("cache-control")).toBe("no-cache");
    expectNoDefaultCdnCacheHeaders(response);
  });

  it("injects the default social image into SSR HTML without one", async () => {
    mocks.requestHandler.mockResolvedValueOnce(
      new Response(
        "<html><head><title>Calendar</title></head><body>ok</body></html>",
        {
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      ),
    );
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(createEvent("/"));
    const html = await response.text();
    const expectedImageUrl = `http://example.test${AGENT_NATIVE_SOCIAL_IMAGE_PATH}?v=${AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER}`;

    expect(html).toContain(
      `<meta property="og:image" content="${expectedImageUrl}">`,
    );
    expect(html).toContain(
      `<meta name="twitter:image" content="${expectedImageUrl}">`,
    );
    expect(html).toContain(
      '<meta name="twitter:card" content="summary_large_image">',
    );
  });

  it("does not inject the default social image when a route provides one", async () => {
    mocks.requestHandler.mockResolvedValueOnce(
      new Response(
        '<html><head><meta property="og:image" content="https://example.test/custom.png"></head><body>ok</body></html>',
        {
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      ),
    );
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(createEvent("/book/steve/meeting"));
    const html = await response.text();

    expect(html).toContain("https://example.test/custom.png");
    expect(html).not.toContain(AGENT_NATIVE_SOCIAL_IMAGE_PATH);
    expect(html).toContain(
      '<meta name="twitter:card" content="summary_large_image">',
    );
  });

  it("serves public SWR on SSR HTML even when the request carries a session cookie", async () => {
    mocks.requestHandler.mockResolvedValueOnce(
      new Response("<html><head></head><body>ok</body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(
      createEvent("/slides/private", "GET", {
        headers: { cookie: "an_session=1" },
      }),
    );

    // Auth makes no difference: SSR HTML is hard-cached for everyone, so a
    // request with a session cookie gets the same public SWR headers as anonymous.
    expectDefaultSsrCacheHeaders(response);
    expect(response.headers.get("cache-control")).toBe(
      DEFAULT_SSR_CACHE_CONTROL,
    );
    expect(response.headers.get("cdn-cache-control")).toBe(
      DEFAULT_SSR_CDN_CACHE_CONTROL,
    );
    expect(response.headers.get("netlify-cdn-cache-control")).toBe(
      DEFAULT_SSR_NETLIFY_CDN_CACHE_CONTROL,
    );
  });

  it("ignores a request session cookie and renders SSR HTML impersonally", async () => {
    mocks.getSession.mockResolvedValueOnce({ email: "alice@example.com" });
    mocks.requestHandler.mockImplementationOnce(async () => {
      const email = getRequestUserEmail();
      return new Response(
        `<html><head></head><body>${email ?? "anonymous"}</body></html>`,
        {
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
    });
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(
      createEvent("/app/private", "GET", {
        headers: { cookie: "an_session=active" },
      }),
    );

    // The SSR handler does not read the request session, so a loader that calls
    // getRequestUserEmail() sees undefined — the HTML is impersonal and safe to
    // hard-cache for everyone.
    expect(await response.text()).toContain("anonymous");
    expect(mocks.getSession).not.toHaveBeenCalled();
    expectDefaultSsrCacheHeaders(response);
    expect(response.headers.get("cache-control")).toBe(
      DEFAULT_SSR_CACHE_CONTROL,
    );
  });

  it("ignores a request session cookie and renders SSR .data impersonally", async () => {
    mocks.getSession.mockResolvedValueOnce({ email: "alice@example.com" });
    mocks.requestHandler.mockImplementationOnce(async () => {
      const email = getRequestUserEmail();
      return new Response(`[{"email":${JSON.stringify(email ?? null)}}]`, {
        headers: {
          "cache-control": "no-cache",
          "content-type": "text/x-script",
          "x-remix-response": "yes",
        },
      });
    });
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(
      createEvent("/app/private.data", "GET", {
        headers: { cookie: "an_session=active" },
      }),
    );

    // No per-user data is baked into the .data response — getRequestUserEmail()
    // returns undefined even with a session cookie — so it is publicly cached.
    expect(await response.text()).toContain('"email":null');
    expect(mocks.getSession).not.toHaveBeenCalled();
    expectDefaultSsrCacheHeaders(response);
    expect(response.headers.get("cache-control")).toBe(
      DEFAULT_SSR_CACHE_CONTROL,
    );
  });

  it("keeps public SSR caching for docs anonymous session cookies", async () => {
    mocks.requestHandler.mockResolvedValueOnce(
      new Response("<html><head></head><body>ok</body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(
      createEvent("/docs", "GET", {
        headers: { cookie: "an_docs_session=anonymous-session" },
      }),
    );

    expect(response.headers.get("cache-control")).toBe(
      DEFAULT_SSR_CACHE_CONTROL,
    );
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("keeps public SSR caching for anonymous preference cookies", async () => {
    mocks.requestHandler.mockResolvedValueOnce(
      new Response("<html><head></head><body>ok</body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(
      createEvent("/docs", "GET", {
        headers: { cookie: "sidebar:state=collapsed" },
      }),
    );

    expect(response.headers.get("cache-control")).toBe(
      DEFAULT_SSR_CACHE_CONTROL,
    );
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("serves public SWR regardless of which cookies are present", async () => {
    mocks.requestHandler.mockResolvedValueOnce(
      new Response("<html><head></head><body>ok</body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(
      createEvent("/docs", "GET", {
        // Even with an auth cookie alongside anonymous ones, SSR is still the
        // impersonal public shell — no cookie combination changes the policy.
        headers: { cookie: "an_docs_session=anon; an_session=1" },
      }),
    );

    expectDefaultSsrCacheHeaders(response);
    expect(response.headers.get("cache-control")).toBe(
      DEFAULT_SSR_CACHE_CONTROL,
    );
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("overwrites explicit SSR cache policies from routes on anonymous requests", async () => {
    mocks.requestHandler.mockResolvedValueOnce(
      new Response("<html><head></head><body>ok</body></html>", {
        headers: {
          "cache-control": "private, no-store",
          "content-type": "text/html; charset=utf-8",
        },
      }),
    );
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(createEvent("/"));

    // Anonymous: enforce the public SWR default even if the route said private.
    expect(response.headers.get("cache-control")).toBe(
      DEFAULT_SSR_CACHE_CONTROL,
    );
  });

  it("overrides a route-provided Cache-Control on authenticated HTML with the public SWR policy", async () => {
    // A route may try to set its own Cache-Control even when the request carries
    // an auth cookie, but the framework hard-caches SSR HTML for everyone, so
    // the route-provided policy is overridden with the public SWR default.
    mocks.requestHandler.mockResolvedValueOnce(
      new Response("<html><head></head><body>shared</body></html>", {
        headers: {
          "cache-control": "private, no-store",
          "content-type": "text/html; charset=utf-8",
        },
      }),
    );
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(
      createEvent("/share/abc", "GET", {
        headers: { cookie: "an_session=active" },
      }),
    );

    // Route tried to opt out; the framework still enforces the public SWR policy.
    expectDefaultSsrCacheHeaders(response);
    expect(response.headers.get("cache-control")).toBe(
      DEFAULT_SSR_CACHE_CONTROL,
    );
  });

  it("does not resolve auth for anonymous SSR page requests", async () => {
    mocks.requestHandler.mockResolvedValueOnce(
      new Response("<html><head></head><body>ok</body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    const handler = createH3SSRHandler(() => ({})) as any;

    await handler(createEvent("/"));

    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("ignores a request session cookie and renders SSR impersonally", async () => {
    mocks.getSession.mockResolvedValueOnce({ email: "alice@example.com" });
    mocks.requestHandler.mockImplementationOnce(async () => {
      const email = getRequestUserEmail();
      return new Response(
        `<html><head></head><body>${email ?? "anonymous"}</body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    });
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(
      createEvent("/", "GET", { headers: { cookie: "an_session=1" } }),
    );

    // SSR never reads the request session: getSession is not called and a loader
    // that reads getRequestUserEmail() sees undefined despite the auth cookie.
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(await response.text()).toContain("anonymous");
  });

  it("ignores an embed-token credential and renders SSR impersonally", async () => {
    mocks.requestHasEmbedAuthMarker.mockReturnValue(true);
    mocks.getSession.mockResolvedValueOnce({ email: "alice@example.com" });
    mocks.requestHandler.mockImplementationOnce(async () => {
      const email = getRequestUserEmail();
      return new Response(
        `<html><head></head><body>${email ?? "anonymous"}</body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    });
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(
      createEvent("/inbox?embedded=1&__an_embed_token=signed"),
    );

    // An embed token in the request does not pin a session for SSR.
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(await response.text()).toContain("anonymous");
  });

  it("ignores an Authorization header credential and renders SSR impersonally", async () => {
    mocks.getSession.mockResolvedValueOnce({ email: "alice@example.com" });
    mocks.requestHandler.mockImplementationOnce(async () => {
      const email = getRequestUserEmail();
      return new Response(
        `<html><head></head><body>${email ?? "anonymous"}</body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    });
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(
      createEvent("/inbox", "GET", {
        headers: { authorization: "Bearer signed-token" },
      }),
    );

    // An Authorization header in the request does not pin a session for SSR.
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(await response.text()).toContain("anonymous");
  });

  it("ignores a mobile-session credential and renders SSR impersonally", async () => {
    mocks.getSession.mockResolvedValueOnce({ email: "alice@example.com" });
    mocks.requestHandler.mockImplementationOnce(async () => {
      const email = getRequestUserEmail();
      return new Response(
        `<html><head></head><body>${email ?? "anonymous"}</body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    });
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(createEvent("/inbox?_session=mobile-token"));

    // A mobile session query credential does not pin a session for SSR.
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(await response.text()).toContain("anonymous");
  });

  it("does not SSR framework routes under APP_BASE_PATH", async () => {
    process.env.APP_BASE_PATH = "/mail";
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(
      createEvent("/mail/_agent-native/env-status"),
    );

    expect(response.status).toBe(404);
    expect(mocks.requestHandler).not.toHaveBeenCalled();
  });

  it("prefixes root-relative links in mounted SSR HTML", async () => {
    process.env.APP_BASE_PATH = "/docs";
    mocks.requestHandler.mockResolvedValueOnce(
      new Response(
        '<a href="/templates/mail">Mail</a><img src="/logo.svg"><form action="/api/search"></form><script src="/docs/app.js"></script>',
        { headers: { "content-type": "text/html; charset=utf-8" } },
      ),
    );
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(createEvent("/docs/"));
    const html = await response.text();

    expect(html).toContain('href="/docs/templates/mail"');
    expect(html).toContain('src="/docs/logo.svg"');
    expect(html).toContain('action="/docs/api/search"');
    expect(html).toContain('src="/docs/app.js"');
  });

  it("injects runtime browser Sentry config into SSR HTML", async () => {
    process.env.SENTRY_DSN = "https://public@example/4511270423822336";
    process.env.SENTRY_ENVIRONMENT = "production";
    mocks.requestHandler.mockResolvedValueOnce(
      new Response("<html><head></head><body>ok</body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(createEvent("/"));
    const html = await response.text();

    expect(html).toContain("data-agent-native-sentry-config");
    expect(html).toContain("https://public@example/4511270423822336");
    expect(html).toContain('"sentryEnvironment":"production"');
  });

  it("prefixes mounted SSR redirects", async () => {
    process.env.APP_BASE_PATH = "/docs";
    mocks.requestHandler.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "/login" },
      }),
    );
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(createEvent("/docs/private"));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/docs/login");
  });

  describe("document CSP", () => {
    it("sets object-src/base-uri enforcement CSP on HTML responses in production", async () => {
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        mocks.requestHandler.mockResolvedValueOnce(
          new Response("<html><head></head><body>ok</body></html>", {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
        );
        const handler = createH3SSRHandler(() => ({})) as any;

        const response = await handler(createEvent("/"));

        expect(response.headers.get("content-security-policy")).toBe(
          "object-src 'none'; base-uri 'self'",
        );
      } finally {
        if (previousNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = previousNodeEnv;
        }
      }
    });

    it("emits a script-src Report-Only CSP on HTML responses in production", async () => {
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        mocks.requestHandler.mockResolvedValueOnce(
          new Response("<html><head></head><body>ok</body></html>", {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
        );
        const handler = createH3SSRHandler(() => ({})) as any;

        const response = await handler(createEvent("/"));

        const ro = response.headers.get("content-security-policy-report-only");
        expect(ro).not.toBeNull();
        expect(ro).toContain("script-src");
        expect(ro).toContain("'self'");
      } finally {
        if (previousNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = previousNodeEnv;
        }
      }
    });

    it("includes the Sentry script hash in the Report-Only script-src when Sentry is configured", async () => {
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      process.env.SENTRY_DSN = "https://public@example/4511270423822336";
      process.env.SENTRY_ENVIRONMENT = "production";
      try {
        mocks.requestHandler.mockResolvedValueOnce(
          new Response("<html><head></head><body>ok</body></html>", {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
        );
        const handler = createH3SSRHandler(() => ({})) as any;

        const response = await handler(createEvent("/"));

        const ro = response.headers.get("content-security-policy-report-only");
        // Must contain a sha256 hash token for the Sentry config script.
        expect(ro).toMatch(/'sha256-[A-Za-z0-9+/]+=*'/);
      } finally {
        if (previousNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = previousNodeEnv;
        }
        delete process.env.SENTRY_DSN;
        delete process.env.SENTRY_ENVIRONMENT;
      }
    });

    it("does not set CSP on HTML responses in development", async () => {
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      try {
        mocks.requestHandler.mockResolvedValueOnce(
          new Response("<html><head></head><body>ok</body></html>", {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
        );
        const handler = createH3SSRHandler(() => ({})) as any;

        const response = await handler(createEvent("/"));

        expect(response.headers.get("content-security-policy")).toBeNull();
        expect(
          response.headers.get("content-security-policy-report-only"),
        ).toBeNull();
      } finally {
        if (previousNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = previousNodeEnv;
        }
      }
    });

    it("does not set CSP when AGENT_NATIVE_DISABLE_DOC_CSP=1", async () => {
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      process.env.AGENT_NATIVE_DISABLE_DOC_CSP = "1";
      try {
        mocks.requestHandler.mockResolvedValueOnce(
          new Response("<html><head></head><body>ok</body></html>", {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
        );
        const handler = createH3SSRHandler(() => ({})) as any;

        const response = await handler(createEvent("/"));

        expect(response.headers.get("content-security-policy")).toBeNull();
        expect(
          response.headers.get("content-security-policy-report-only"),
        ).toBeNull();
      } finally {
        if (previousNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = previousNodeEnv;
        }
        delete process.env.AGENT_NATIVE_DISABLE_DOC_CSP;
      }
    });

    it("does not set CSP on non-HTML responses in production", async () => {
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        mocks.requestHandler.mockResolvedValueOnce(
          new Response('{"ok":true}', {
            headers: { "content-type": "application/json" },
          }),
        );
        const handler = createH3SSRHandler(() => ({})) as any;

        // Use a non-framework path so the handler is called and the mock is
        // consumed; /api/* paths are filtered early before calling the handler,
        // which would leave this mockResolvedValueOnce unconsumed and corrupt
        // the next test's mock queue (vi.mockClear does not flush pending values).
        const response = await handler(createEvent("/graphql"));

        expect(response.headers.get("content-security-policy")).toBeNull();
        expect(
          response.headers.get("content-security-policy-report-only"),
        ).toBeNull();
      } finally {
        if (previousNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = previousNodeEnv;
        }
      }
    });

    it("respects a route-provided Content-Security-Policy and does not overwrite it", async () => {
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        mocks.requestHandler.mockResolvedValueOnce(
          new Response("<html><head></head><body>ok</body></html>", {
            headers: {
              "content-type": "text/html; charset=utf-8",
              "content-security-policy": "frame-ancestors *",
            },
          }),
        );
        const handler = createH3SSRHandler(() => ({})) as any;

        const response = await handler(createEvent("/embed/public"));

        // The route's explicit CSP must be preserved.
        expect(response.headers.get("content-security-policy")).toBe(
          "frame-ancestors *",
        );
      } finally {
        if (previousNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = previousNodeEnv;
        }
      }
    });
  });
});
