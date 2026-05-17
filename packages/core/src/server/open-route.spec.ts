import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// h3 stub: defineEventHandler returns the handler as-is, getMethod reads a
// field we set on the fake event. Mirrors poll-handler.spec's h3 stub.
vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getMethod: (event: any) => event.method ?? "GET",
}));

const getSession = vi.hoisted(() => vi.fn());
const getConfiguredLoginHtml = vi.hoisted(() => vi.fn());

vi.mock("./auth.js", () => ({
  getSession: (...a: any[]) => getSession(...a),
  getConfiguredLoginHtml: (...a: any[]) => getConfiguredLoginHtml(...a),
}));

const appStatePut = vi.hoisted(() => vi.fn());

vi.mock("../application-state/store.js", () => ({
  appStatePut: (...a: any[]) => appStatePut(...a),
}));

import { createOpenRouteHandler } from "./open-route.js";

/** Build a fake H3 event the open route understands. */
function fakeEvent(url: string, method = "GET") {
  return { method, node: { req: { url } }, path: url } as any;
}

describe("createOpenRouteHandler", () => {
  beforeEach(() => {
    getSession.mockReset();
    getConfiguredLoginHtml.mockReset();
    appStatePut.mockReset();
    appStatePut.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("authenticated GET writes the navigate key under the session email with requestSource deep-link and 302s to /<view>", async () => {
    getSession.mockResolvedValue({ email: "user@example.com" });
    const handler = createOpenRouteHandler();

    const res: Response = await handler(
      fakeEvent("/_agent-native/open?app=mail&view=inbox&threadId=abc123"),
    );

    expect(appStatePut).toHaveBeenCalledTimes(1);
    const [sessionId, key, payload, options] = appStatePut.mock.calls[0];
    expect(sessionId).toBe("user@example.com");
    expect(key).toBe("navigate");
    expect(payload).toEqual({ threadId: "abc123", view: "inbox" });
    expect(options).toEqual({ requestSource: "deep-link" });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/inbox");
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
    expect(res.headers.get("Location")).toBe("/inbox");
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
    expect(res.headers.get("Location")).toBe("/dashboard");
  });

  it("open-redirect guard rejects a control-char `to` and, with no view, falls back to /", async () => {
    getSession.mockResolvedValue({ email: "user@example.com" });
    const handler = createOpenRouteHandler();

    // %01 is a control character (Start of Heading).
    const res: Response = await handler(
      fakeEvent("/_agent-native/open?to=%2Ffoo%01bar"),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
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

  it("honors a safe same-origin relative `to` override", async () => {
    getSession.mockResolvedValue({ email: "user@example.com" });
    const handler = createOpenRouteHandler();

    const res: Response = await handler(
      fakeEvent("/_agent-native/open?view=inbox&to=%2Finbox%2Fabc123"),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/inbox/abc123");
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
    expect(res.headers.get("Location")).toBe("/email/t9");
  });
});
