import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// h3 stub: defineEventHandler returns the handler as-is, getMethod reads a
// field we set on the fake event. Mirrors poll-handler.spec's h3 stub.
vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getHeader: (event: any, name: string) =>
    event.headers?.get?.(name) ??
    event.headers?.[name] ??
    event.headers?.[name.toLowerCase()] ??
    event.node?.req?.headers?.[name] ??
    event.node?.req?.headers?.[name.toLowerCase()],
  getMethod: (event: any) => event.method ?? "GET",
}));

const getSession = vi.hoisted(() => vi.fn());
const getConfiguredLoginHtml = vi.hoisted(() => vi.fn());

vi.mock("./auth.js", () => ({
  getSession: (...a: any[]) => getSession(...a),
  getConfiguredLoginHtml: (...a: any[]) => getConfiguredLoginHtml(...a),
}));

const appStatePut = vi.hoisted(() => vi.fn());
const appStateGet = vi.hoisted(() => vi.fn());

vi.mock("../application-state/store.js", () => ({
  appStatePut: (...a: any[]) => appStatePut(...a),
  appStateGet: (...a: any[]) => appStateGet(...a),
}));

const requestHasEmbedAuthMarker = vi.hoisted(() => vi.fn());

vi.mock("./embed-session.js", () => ({
  requestHasEmbedAuthMarker: (...a: any[]) => requestHasEmbedAuthMarker(...a),
}));

import { createOpenRouteHandler } from "./open-route.js";
import {
  MCP_APP_CHAT_BRIDGE_QUERY_PARAM,
  EMBED_MODE_QUERY_PARAM,
  EMBED_TOKEN_QUERY_PARAM,
} from "../shared/embed-auth.js";

/** Build a fake H3 event the open route understands. */
function fakeEvent(url: string, method = "GET") {
  return { method, node: { req: { url } }, path: url } as any;
}

describe("createOpenRouteHandler", () => {
  beforeEach(() => {
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
    getSession.mockReset();
    getConfiguredLoginHtml.mockReset();
    appStatePut.mockReset();
    appStatePut.mockResolvedValue(undefined);
    appStateGet.mockReset();
    appStateGet.mockResolvedValue(null);
    requestHasEmbedAuthMarker.mockReset();
    requestHasEmbedAuthMarker.mockReturnValue(false);
  });

  afterEach(() => {
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
    vi.restoreAllMocks();
  });

  it("authenticated GET writes the navigate key under the session email with requestSource deep-link and 302s to /<view>", async () => {
    getSession.mockResolvedValue({ email: "user@example.com" });
    const handler = createOpenRouteHandler();

    const res: Response = await handler(
      fakeEvent(
        "/_agent-native/open?app=mail&view=inbox&threadId=abc123&agentSidebar=closed",
      ),
    );

    expect(appStatePut).toHaveBeenCalledTimes(1);
    const [sessionId, key, payload, options] = appStatePut.mock.calls[0];
    expect(sessionId).toBe("user@example.com");
    expect(key).toBe("navigate");
    expect(payload).toEqual({ threadId: "abc123", view: "inbox" });
    expect(options).toEqual({ requestSource: "deep-link" });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/inbox?agentSidebar=closed");
  });

  it("unauthenticated returns the configured login HTML with status 200 and no app-state write", async () => {
    getSession.mockResolvedValue(null);
    getConfiguredLoginHtml.mockReturnValue("<html>login</html>");
    const handler = createOpenRouteHandler();

    const res: Response = await handler(
      fakeEvent("/_agent-native/open?view=inbox"),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(await res.text()).toBe("<html>login</html>");
    expect(appStatePut).not.toHaveBeenCalled();
  });

  it("rejects non-GET methods with 405", async () => {
    getSession.mockResolvedValue({ email: "user@example.com" });
    const handler = createOpenRouteHandler();

    const res: Response = await handler(
      fakeEvent("/_agent-native/open?view=inbox", "POST"),
    );

    expect(res.status).toBe(405);
    expect(appStatePut).not.toHaveBeenCalled();
  });

  it("open-redirect guard rejects scheme-relative // host in `to` and falls back to /<view>", async () => {
    getSession.mockResolvedValue({ email: "user@example.com" });
    const handler = createOpenRouteHandler();

    const res: Response = await handler(
      fakeEvent("/_agent-native/open?view=inbox&to=%2F%2Fevil.com"),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/inbox?agentSidebar=closed");
  });

  it("open-redirect guard rejects an absolute `to` URL and falls back to /<view>", async () => {
    getSession.mockResolvedValue({ email: "user@example.com" });
    const handler = createOpenRouteHandler();

    const res: Response = await handler(
      fakeEvent(
        "/_agent-native/open?view=dashboard&to=https%3A%2F%2Fevil.com%2Fx",
      ),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard?agentSidebar=closed");
  });

  it("open-redirect guard rejects a control-char `to` and, with no view, falls back to /", async () => {
    getSession.mockResolvedValue({ email: "user@example.com" });
    const handler = createOpenRouteHandler();

    // %01 is a control character (Start of Heading).
    const res: Response = await handler(
      fakeEvent("/_agent-native/open?to=%2Ffoo%01bar"),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/?agentSidebar=closed");
  });

  it("forwards f_* filter params onto the redirect Location", async () => {
    getSession.mockResolvedValue({ email: "user@example.com" });
    const handler = createOpenRouteHandler();

    const res: Response = await handler(
      fakeEvent(
        "/_agent-native/open?view=dashboard&f_range=30d&f_team=growth&dashboardId=d1",
      ),
    );

    expect(res.status).toBe(302);
    const loc = res.headers.get("Location")!;
    expect(loc.startsWith("/dashboard?")).toBe(true);
    const sp = new URL(loc, "http://x.invalid").searchParams;
    expect(sp.get("f_range")).toBe("30d");
    expect(sp.get("f_team")).toBe("growth");
    expect(sp.get("agentSidebar")).toBe("closed");
    // Non-filter record ids are NOT forwarded onto the URL (they ride the
    // navigate app-state command instead).
    expect(sp.has("dashboardId")).toBe(false);

    // The navigate payload still carries every non-reserved param.
    const [, , payload] = appStatePut.mock.calls[0];
    expect(payload).toMatchObject({
      view: "dashboard",
      dashboardId: "d1",
      f_range: "30d",
      f_team: "growth",
    });
  });

  it("preserves embed launch params through the redirect but not navigate payload", async () => {
    getSession.mockResolvedValue({ email: "user@example.com" });
    const handler = createOpenRouteHandler();

    const res: Response = await handler(
      fakeEvent(
        `/_agent-native/open?view=inbox&threadId=t1&${EMBED_MODE_QUERY_PARAM}=1&${EMBED_TOKEN_QUERY_PARAM}=tok_123&${MCP_APP_CHAT_BRIDGE_QUERY_PARAM}=1`,
      ),
    );

    expect(res.status).toBe(302);
    const loc = res.headers.get("Location")!;
    const sp = new URL(loc, "http://x.invalid").searchParams;
    expect(sp.get(EMBED_MODE_QUERY_PARAM)).toBe("1");
    expect(sp.get(EMBED_TOKEN_QUERY_PARAM)).toBe("tok_123");
    expect(sp.get(MCP_APP_CHAT_BRIDGE_QUERY_PARAM)).toBe("1");

    const [, , payload] = appStatePut.mock.calls[0];
    expect(payload).toEqual({ threadId: "t1", view: "inbox" });
  });

  it("adds MCP embed CORS headers to embed-auth open redirects", async () => {
    requestHasEmbedAuthMarker.mockReturnValue(true);
    getSession.mockResolvedValue({ email: "user@example.com" });
    const handler = createOpenRouteHandler();

    const res: Response = await handler({
      ...fakeEvent(
        `/_agent-native/open?view=inbox&threadId=t1&${EMBED_MODE_QUERY_PARAM}=1&${EMBED_TOKEN_QUERY_PARAM}=tok_123`,
      ),
      headers: new Headers({
        origin: "https://520ba469ac5783c72c33d79bea940871.claudemcpcontent.com",
      }),
    } as any);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/inbox?");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://520ba469ac5783c72c33d79bea940871.claudemcpcontent.com",
    );
    expect(res.headers.get("Access-Control-Expose-Headers")).toBe("Location");
    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe(
      "cross-origin",
    );
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("parses the original browser URL when mounted under the framework route", async () => {
    getSession.mockResolvedValue({ email: "user@example.com" });
    const handler = createOpenRouteHandler();

    const res: Response = await handler({
      method: "GET",
      path: "/",
      node: { req: { url: "/" } },
      context: { _mountedPathname: "/_agent-native/open" },
      url: {
        search: `?view=inbox&threadId=t1&${EMBED_MODE_QUERY_PARAM}=1&${EMBED_TOKEN_QUERY_PARAM}=tok_123&${MCP_APP_CHAT_BRIDGE_QUERY_PARAM}=1`,
      },
    } as any);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      `/inbox?${EMBED_MODE_QUERY_PARAM}=1&${EMBED_TOKEN_QUERY_PARAM}=tok_123&${MCP_APP_CHAT_BRIDGE_QUERY_PARAM}=1&agentSidebar=closed`,
    );

    const [, , payload] = appStatePut.mock.calls[0];
    expect(payload).toEqual({ threadId: "t1", view: "inbox" });
  });

  it("preserves APP_BASE_PATH when redirecting mounted app routes", async () => {
    process.env.APP_BASE_PATH = "/mail";
    getSession.mockResolvedValue({ email: "user@example.com" });
    const handler = createOpenRouteHandler();

    const res: Response = await handler(
      fakeEvent("/mail/_agent-native/open?view=inbox&threadId=t1"),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/mail/inbox?agentSidebar=closed");
  });

  it("does not duplicate APP_BASE_PATH when a safe to param is already mounted", async () => {
    process.env.APP_BASE_PATH = "/mail";
    getSession.mockResolvedValue({ email: "user@example.com" });
    const handler = createOpenRouteHandler();

    const res: Response = await handler(
      fakeEvent(
        "/mail/_agent-native/open?view=inbox&to=%2Fmail%2Finbox%2Fabc123",
      ),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      "/mail/inbox/abc123?agentSidebar=closed",
    );
  });

  it("honors a safe same-origin relative `to` override", async () => {
    getSession.mockResolvedValue({ email: "user@example.com" });
    const handler = createOpenRouteHandler();

    const res: Response = await handler(
      fakeEvent("/_agent-native/open?view=inbox&to=%2Finbox%2Fabc123"),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      "/inbox/abc123?agentSidebar=closed",
    );
  });

  it("uses resolveOpenPath when provided and `to` is absent", async () => {
    getSession.mockResolvedValue({ email: "user@example.com" });
    const handler = createOpenRouteHandler({
      resolveOpenPath: ({ params }) =>
        params.threadId ? `/email/${params.threadId}` : null,
    });

    const res: Response = await handler(
      fakeEvent("/_agent-native/open?view=inbox&threadId=t9"),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/email/t9?agentSidebar=closed");
  });
});
