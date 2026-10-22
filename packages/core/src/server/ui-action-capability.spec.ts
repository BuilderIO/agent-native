import { createApp, defineEventHandler } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSession, mockGetBrowserCookieSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetBrowserCookieSession: vi.fn(),
}));

vi.mock("./auth.js", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  getBrowserCookieSession: (...args: unknown[]) =>
    mockGetBrowserCookieSession(...args),
}));

const { mockCreateEmbedSessionTicket, mockConsumeEmbedSessionTicket } =
  vi.hoisted(() => ({
    mockCreateEmbedSessionTicket: vi.fn(),
    mockConsumeEmbedSessionTicket: vi.fn(),
  }));

vi.mock("./embed-session.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createEmbedSessionTicket: (...args: unknown[]) =>
    mockCreateEmbedSessionTicket(...args),
  consumeEmbedSessionTicket: (...args: unknown[]) =>
    mockConsumeEmbedSessionTicket(...args),
}));

vi.mock("./framework-request-handler.js", () => ({
  getH3App: (app: any) => app,
}));

import { getBuiltinCrossAppTools } from "../mcp/builtin-tools.js";
import {
  EMBED_SESSION_COOKIE,
  EMBED_START_PATH,
  EMBED_TOKEN_QUERY_PARAM,
} from "../shared/embed-auth.js";
import { createEmbedStartRouteHandler } from "./embed-route.js";
import {
  signEmbedSessionToken,
  verifyEmbedSessionToken,
  type EmbedSessionTicketInput,
} from "./embed-session.js";
import { runWithRequestContext } from "./request-context.js";
import {
  hasUiActionCapability,
  mountUiActionCapabilityRoute,
} from "./ui-action-capability.js";

describe("UI action capability", () => {
  beforeEach(() => {
    vi.stubEnv("BETTER_AUTH_SECRET", "test-ui-capability-secret");
    vi.stubEnv("OAUTH_STATE_SECRET", "test-ui-capability-secret");
    mockGetSession.mockResolvedValue({ email: "general@example.com" });
    mockGetBrowserCookieSession.mockResolvedValue({
      email: "Alice@example.com",
    });
  });

  afterEach(() => {
    mockCreateEmbedSessionTicket.mockReset();
    mockConsumeEmbedSessionTicket.mockReset();
    mockGetSession.mockReset();
    mockGetBrowserCookieSession.mockReset();
    vi.unstubAllEnvs();
  });

  it("mints an owner-bound HttpOnly capability and rejects tampering", async () => {
    const app = createApp();
    mountUiActionCapabilityRoute(app);

    const mint = await app.fetch(
      new Request("https://example.test/_agent-native/ui-capability", {
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );

    expect(mint.status).toBe(200);
    expect(mint.headers.get("cache-control")).toBe("no-store");
    const setCookie = mint.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=None");
    expect(setCookie).toContain("Path=/_agent-native/actions");
    const cookie = setCookie.split(";", 1)[0];
    expect(cookie).toMatch(/^agent-native-ui-capability=\S+$/);

    app.use(
      "/verify",
      defineEventHandler((event) => ({
        exact: hasUiActionCapability(event, "alice@example.com"),
        mismatch: hasUiActionCapability(event, "other@example.com"),
        tampered: hasUiActionCapability(
          {
            ...event,
            req: {
              ...event.req,
              headers: new Headers({
                cookie: `${cookie}tampered`,
              }),
            },
          } as typeof event,
          "alice@example.com",
        ),
      })),
    );

    const verify = await app.fetch(
      new Request("https://example.test/verify", {
        headers: { cookie },
      }),
    );

    expect(await verify.json()).toEqual({
      exact: true,
      mismatch: false,
      tampered: false,
    });
  });

  it("uses the built app base path for the capability cookie", async () => {
    const app = createApp();
    mountUiActionCapabilityRoute(app, "/_agent-native", "/docs");

    const response = await app.fetch(
      new Request("https://example.test/_agent-native/ui-capability", {
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(
      "Path=/docs/_agent-native/actions",
    );
  });

  it.each([
    { name: "no browser headers", headers: {} },
    { name: "cross-site fetch", headers: { "sec-fetch-site": "cross-site" } },
    { name: "same-site fetch", headers: { "sec-fetch-site": "same-site" } },
    { name: "different origin", headers: { origin: "https://other.test" } },
    { name: "opaque iframe origin", headers: { origin: "null" } },
  ])(
    "does not mint for $name even with a cookie session",
    async ({ headers }) => {
      const app = createApp();
      mountUiActionCapabilityRoute(app);

      const response = await app.fetch(
        new Request("https://example.test/_agent-native/ui-capability", {
          headers: { host: "example.test", ...headers },
        }),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "Same-origin request required",
      });
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );

  it("mints for a matching Origin without fetch metadata", async () => {
    const app = createApp();
    mountUiActionCapabilityRoute(app);

    const response = await app.fetch(
      new Request("https://example.test/_agent-native/ui-capability", {
        headers: { host: "example.test", origin: "https://example.test" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("set-cookie")).toContain(
      "agent-native-ui-capability=",
    );
  });

  it.each([
    {
      name: "bearer",
      headers: { authorization: "Bearer general-login" },
      query: "",
    },
    { name: "query", headers: {}, query: "?_session=query-login" },
    { name: "custom resolver", headers: {}, query: "" },
  ])(
    "does not mint from a general $name session with same-origin metadata",
    async ({ headers, query }) => {
      mockGetBrowserCookieSession.mockResolvedValue(null);
      const app = createApp();
      mountUiActionCapabilityRoute(app);

      const response = await app.fetch(
        new Request(
          `https://example.test/_agent-native/ui-capability${query}`,
          {
            headers: { ...headers, "sec-fetch-site": "same-origin" },
          },
        ),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: "Authentication required",
      });
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );

  it.each([
    {
      name: "embed query",
      headers: { cookie: "an_session=browser-login" },
      query: "?__an_embed_token=embed-login",
    },
    {
      name: "embed bearer and target",
      headers: {
        cookie: "an_session=browser-login",
        authorization: "Bearer embed-login",
        "x-agent-native-embed-target": "/documents/doc-1",
      },
      query: "",
    },
  ])(
    "does not mint for an explicit $name alongside a browser session",
    async ({ headers, query }) => {
      const app = createApp();
      mountUiActionCapabilityRoute(app);

      const response = await app.fetch(
        new Request(
          `https://example.test/_agent-native/ui-capability${query}`,
          {
            headers: { ...headers, "sec-fetch-site": "same-origin" },
          },
        ),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "Browser cookie session required",
      });
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );

  it.each([
    { ownerEmail: "alice@example.com", source: "cookie" },
    { ownerEmail: "other@example.com", source: "cookie" },
    { ownerEmail: "alice@example.com", source: "bearer" },
    { ownerEmail: "other@example.com", source: "bearer" },
  ])(
    "does not mint for a signed embed $source owned by $ownerEmail alongside a browser session",
    async ({ ownerEmail, source }) => {
      const embedToken = signEmbedSessionToken({
        ownerEmail,
        targetPath: "/documents/doc-1",
        audienceHost: "example.test",
      });
      const app = createApp();
      mountUiActionCapabilityRoute(app);

      const response = await app.fetch(
        new Request("https://example.test/_agent-native/ui-capability", {
          headers: {
            "sec-fetch-site": "same-origin",
            ...(source === "cookie"
              ? {
                  cookie: `an_embed_session=${embedToken}; an_session=browser-login`,
                }
              : {
                  cookie: "an_session=browser-login",
                  authorization: `Bearer ${embedToken}`,
                }),
          },
        }),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "Browser cookie session required",
      });
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );

  it("mints for a browser session with an invalid leftover embed cookie", async () => {
    const app = createApp();
    mountUiActionCapabilityRoute(app);

    const response = await app.fetch(
      new Request("https://example.test/_agent-native/ui-capability", {
        headers: {
          "sec-fetch-site": "same-origin",
          cookie: "an_embed_session=invalid; an_session=browser-login",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("set-cookie")).toContain(
      "agent-native-ui-capability=",
    );
  });

  it("does not mint a UI capability from an inline-enabled MCP embed session", async () => {
    const origin = "https://example.test";
    const ownerEmail = "alice@example.com";
    const createdAt = Date.now();
    const expiresAt = createdAt + 60_000;
    let issued: EmbedSessionTicketInput | undefined;
    mockCreateEmbedSessionTicket.mockImplementation(
      async (input: EmbedSessionTicketInput) => {
        issued = { ...input };
        return {
          ticket: "inline-test-ticket",
          ticketHash: "inline-test-ticket-hash",
          expiresAt,
        };
      },
    );
    mockConsumeEmbedSessionTicket.mockImplementation(async (ticket: string) => {
      if (ticket !== "inline-test-ticket" || !issued) return null;
      const input = issued;
      issued = undefined;
      return {
        ownerEmail: input.ownerEmail,
        orgId: input.orgId ?? undefined,
        targetPath: input.targetPath,
        scope: input.scope ?? undefined,
        expiresAt,
        ticketCreatedAtMs: createdAt,
      };
    });
    const tools = getBuiltinCrossAppTools(
      {
        name: "Documents",
        appId: "content",
        description: "Test app",
        actions: {},
      },
      { inlineMcpApps: true, origin },
    );
    expect(tools.create_embed_session).toBeDefined();
    const result = (await runWithRequestContext(
      { userEmail: ownerEmail, orgId: "org-inline", requestOrigin: origin },
      () =>
        tools.create_embed_session!.run({
          path: "/documents/doc-1",
          chrome: "minimal",
        }),
    )) as { startUrl: string; targetPath: string };
    expect(result.targetPath).toBe("/documents/doc-1");
    expect(new URL(result.startUrl).pathname).toBe(EMBED_START_PATH);

    const app = createApp();
    app.use(EMBED_START_PATH, createEmbedStartRouteHandler());
    mountUiActionCapabilityRoute(app);
    const start = await app.fetch(new Request(result.startUrl));
    expect(start.status).toBe(302);
    const target = new URL(start.headers.get("location")!, origin);
    expect(target.pathname).toBe("/documents/doc-1");
    const token = target.searchParams.get(EMBED_TOKEN_QUERY_PARAM);
    expect(token).toEqual(expect.any(String));
    expect(verifyEmbedSessionToken(token)).toMatchObject({
      ok: true,
      claims: {
        ownerEmail,
        orgId: "org-inline",
        targetPath: "/documents/doc-1",
        scope: "minimal",
        audienceHost: "example.test",
      },
    });
    expect(start.headers.get("set-cookie")).toContain(
      `${EMBED_SESSION_COOKIE}=`,
    );

    const response = await app.fetch(
      new Request(`${origin}/_agent-native/ui-capability`, {
        headers: {
          origin,
          "sec-fetch-site": "same-origin",
          cookie: `${EMBED_SESSION_COOKIE}=${token}; an_session=browser-login`,
        },
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Browser cookie session required",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("does not mint a capability without an authenticated session", async () => {
    mockGetSession.mockResolvedValue(null);
    mockGetBrowserCookieSession.mockResolvedValue(null);
    const app = createApp();
    mountUiActionCapabilityRoute(app);

    const response = await app.fetch(
      new Request("https://example.test/_agent-native/ui-capability", {
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
  });
});
