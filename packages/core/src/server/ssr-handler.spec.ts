import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createH3SSRHandler,
  DEFAULT_SSR_CACHE_HEADERS,
  DEFAULT_SPECULATION_RULES_HEADER,
  DEFAULT_SSR_CACHE_CONTROL,
} from "./ssr-handler.js";
import { AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE } from "../shared/social-meta.js";
import { getRequestUserEmail } from "./request-context.js";

const mocks = vi.hoisted(() => {
  const requestHandler = vi.fn(async (request: Request) => {
    const url = new URL(request.url);
    return new Response(`${request.method} ${url.pathname}${url.search}`, {
      headers: { "x-rr-path": url.pathname },
    });
  });
  const getSession = vi.fn(async () => null);
  const requestHasEmbedAuthMarker = vi.fn(() => false);
  return { getSession, requestHandler, requestHasEmbedAuthMarker };
});

vi.mock("react-router", () => ({
  createRequestHandler: vi.fn(() => mocks.requestHandler),
}));

vi.mock("./auth.js", () => ({
  BETTER_AUTH_COOKIE_PREFIX: "an",
  COOKIE_NAME: "an_session",
  getSession: mocks.getSession,
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

  it("applies the default public SSR cache policy to HTML responses", async () => {
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

  it("replaces React Router's default no-cache policy on authenticated .data responses", async () => {
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

    expectDefaultSsrCacheHeaders(response);
  });

  it("overwrites explicit private cache policies on React Router .data responses", async () => {
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

    expectDefaultSsrCacheHeaders(response);
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

    expect(html).toContain(
      `<meta property="og:image" content="${AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE}">`,
    );
    expect(html).toContain(
      `<meta name="twitter:image" content="${AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE}">`,
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
    expect(html).not.toContain(AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE);
    expect(html).toContain(
      '<meta name="twitter:card" content="summary_large_image">',
    );
  });

  it("adds public SSR caching when a page request carries a framework session cookie", async () => {
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

    expect(response.headers.get("cache-control")).toBe(
      DEFAULT_SSR_CACHE_CONTROL,
    );
  });

  it("withholds public SSR caching when authenticated HTML reads user context", async () => {
    mocks.getSession.mockResolvedValueOnce({ email: "alice@example.com" });
    mocks.requestHandler.mockImplementationOnce(async () => {
      const email = getRequestUserEmail();
      return new Response(`<html><head></head><body>${email}</body></html>`, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    });
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(
      createEvent("/app/private", "GET", {
        headers: { cookie: "an_session=active" },
      }),
    );

    expect(await response.text()).toContain("alice@example.com");
    expect(response.headers.get("cache-control")).toBeNull();
  });

  it("withholds public .data caching when authenticated loader reads user context", async () => {
    mocks.getSession.mockResolvedValueOnce({ email: "alice@example.com" });
    mocks.requestHandler.mockImplementationOnce(async () => {
      const email = getRequestUserEmail();
      return new Response(`[{"email":${JSON.stringify(email)}}]`, {
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

    expect(await response.text()).toContain("alice@example.com");
    expect(response.headers.get("cache-control")).toBe("no-cache");
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

  it("adds public SSR caching when anonymous and authenticated cookies coexist", async () => {
    mocks.requestHandler.mockResolvedValueOnce(
      new Response("<html><head></head><body>ok</body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    const handler = createH3SSRHandler(() => ({})) as any;

    const response = await handler(
      createEvent("/docs", "GET", {
        headers: { cookie: "an_docs_session=anon; an_session=1" },
      }),
    );

    expect(response.headers.get("cache-control")).toBe(
      DEFAULT_SSR_CACHE_CONTROL,
    );
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
  });

  it("overwrites explicit SSR cache policies from routes", async () => {
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

  it("resolves auth context when an SSR page request carries credentials", async () => {
    mocks.requestHandler.mockResolvedValueOnce(
      new Response("<html><head></head><body>ok</body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    const handler = createH3SSRHandler(() => ({})) as any;

    await handler(
      createEvent("/", "GET", { headers: { cookie: "an_session=1" } }),
    );

    expect(mocks.getSession).toHaveBeenCalledTimes(1);
  });

  it("resolves auth context when an SSR page request carries an embed token", async () => {
    mocks.requestHasEmbedAuthMarker.mockReturnValue(true);
    mocks.requestHandler.mockResolvedValueOnce(
      new Response("<html><head></head><body>ok</body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    const handler = createH3SSRHandler(() => ({})) as any;

    await handler(createEvent("/inbox?embedded=1&__an_embed_token=signed"));

    expect(mocks.getSession).toHaveBeenCalledTimes(1);
  });

  it("resolves auth context when an SSR page request carries embed token auth", async () => {
    mocks.requestHandler.mockResolvedValueOnce(
      new Response("<html><head></head><body>ok</body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    const handler = createH3SSRHandler(() => ({})) as any;

    await handler(createEvent("/inbox?__an_embed_token=signed-token"));

    expect(mocks.getSession).toHaveBeenCalledTimes(1);
  });

  it("resolves auth context when an SSR page request carries mobile session auth", async () => {
    mocks.requestHandler.mockResolvedValueOnce(
      new Response("<html><head></head><body>ok</body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    const handler = createH3SSRHandler(() => ({})) as any;

    await handler(createEvent("/inbox?_session=mobile-token"));

    expect(mocks.getSession).toHaveBeenCalledTimes(1);
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
});
