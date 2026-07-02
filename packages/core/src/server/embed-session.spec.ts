import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EMBED_SESSION_COOKIE,
  EMBED_TARGET_HEADER,
} from "../shared/embed-auth.js";
import {
  requestMatchesEmbedTarget,
  normalizeEmbedTargetPath,
  requestHasEmbedAuthMarker,
  resolveEmbedSessionFromRequest,
  signEmbedSessionToken,
  verifyEmbedSessionToken,
} from "./embed-session.js";

const ORIGINAL_ENV = { ...process.env };

describe("embed session tokens", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T12:00:00Z"));
    process.env = { ...ORIGINAL_ENV, OAUTH_STATE_SECRET: "embed-test-secret" };
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = ORIGINAL_ENV;
  });

  it("round-trips signed owner/org claims", () => {
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      orgId: "org_123",
      targetPath: "/_agent-native/open?view=inbox",
      ttlSeconds: 60,
    });

    const verified = verifyEmbedSessionToken(token);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.claims.ownerEmail).toBe("owner@example.com");
      expect(verified.claims.orgId).toBe("org_123");
      expect(verified.claims.targetPath).toBe("/_agent-native/open?view=inbox");
    }
  });

  it("rejects tampered and expired tokens", () => {
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      targetPath: "/dashboard",
      ttlSeconds: 1,
    });
    const tampered = `${token.slice(0, -1)}x`;
    expect(verifyEmbedSessionToken(tampered).ok).toBe(false);

    vi.advanceTimersByTime(2000);
    expect(verifyEmbedSessionToken(token)).toMatchObject({
      ok: false,
      reason: "expired",
    });
  });
});

describe("normalizeEmbedTargetPath", () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("accepts same-origin absolute URLs and strips APP_BASE_PATH", () => {
    process.env.APP_BASE_PATH = "/mail";
    expect(
      normalizeEmbedTargetPath(
        "https://app.example.com/mail/inbox?threadId=t1",
        "https://app.example.com",
      ),
    ).toBe("/inbox?threadId=t1");
  });

  it("rejects same-origin absolute URLs outside the current APP_BASE_PATH", () => {
    process.env.APP_BASE_PATH = "/dispatch";
    expect(
      normalizeEmbedTargetPath(
        "https://app.example.com/analytics/dashboards/q2",
        "https://app.example.com",
      ),
    ).toBeNull();
  });

  it("rejects cross-origin and unsafe relative paths", () => {
    expect(
      normalizeEmbedTargetPath(
        "https://evil.example.com/inbox",
        "https://app.example.com",
      ),
    ).toBeNull();
    expect(normalizeEmbedTargetPath("//evil.example.com")).toBeNull();
    expect(normalizeEmbedTargetPath("/http://evil.example.com")).toBeNull();
    expect(normalizeEmbedTargetPath("/foo\u0001bar")).toBeNull();
  });
});

describe("requestMatchesEmbedTarget", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  function fakeEvent(path: string, headers: Record<string, string> = {}) {
    return {
      path,
      req: { url: `http://mail.test${path}`, headers: new Headers(headers) },
      request: { headers: new Headers(headers) },
      headers: new Headers(headers),
      node: { req: { url: path, headers } },
    } as any;
  }

  it("allows the route produced by an embedded open deep link", () => {
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/inbox?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=mail&view=inbox&threadId=t1",
      ),
    ).toBe(true);
  });

  it("allows record routes produced by template open-route resolvers", () => {
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/adhoc/q2-traffic?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=analytics&view=adhoc&dashboardId=q2-traffic",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/analyses/analysis-1?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=analytics&view=analyses&analysisId=analysis-1",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/design/design-1?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=design&view=editor&designId=design-1",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/page/doc-1?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=content&view=editor&documentId=doc-1",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/deck/deck-1?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=slides&view=editor&deckId=deck-1",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/deck/deck-1/present?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=slides&view=present&deckId=deck-1",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=slides&view=list",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/search?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=brain&view=capture&captureId=capture-1",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=calendar&view=calendar&eventId=event-1",
      ),
    ).toBe(true);
  });

  it("allows resolved open routes when the app is deployed under APP_BASE_PATH", () => {
    process.env.APP_BASE_PATH = "/mail";

    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/mail/inbox?embedded=1&__an_embed_token=tok"),
        "/mail/_agent-native/open?app=mail&view=inbox",
      ),
    ).toBe(true);
  });

  it("allows known dashboard alias redirects used by app embeds", () => {
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/overview?embedded=1&__an_embed_token=tok"),
        "/",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent(
          "/adhoc/agent-native-templates-first-party?embedded=1&__an_embed_token=tok",
        ),
        "/dashboards",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent(
          "/adhoc/agent-native-templates-first-party?embedded=1&__an_embed_token=tok",
        ),
        "/traffic-dashboard",
      ),
    ).toBe(true);
  });

  it("allows app runtime requests from the embedded target referrer", () => {
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/_agent-native/application-state/compose", {
          host: "mail.agent-native.com",
          referer: "https://mail.agent-native.com/inbox?embedded=1",
        }),
        "/_agent-native/open?app=mail&view=inbox&composeDraftId=d1",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/api/emails?view=inbox", {
          host: "mail.agent-native.com",
          referer: "https://evil.example/inbox?embedded=1",
        }),
        "/_agent-native/open?app=mail&view=inbox&composeDraftId=d1",
      ),
    ).toBe(false);
  });

  it("does not build thread record paths from unsafe view paths", () => {
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/evil/t1?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=mail&view=//evil&threadId=t1",
      ),
    ).toBe(false);
  });

  it("rejects dot-segment record ids before route matching", () => {
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/deck?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=slides&view=editor&deckId=..",
      ),
    ).toBe(false);
  });

  it("uses the browser URL, not the mounted handler path, for framework routes", () => {
    const event = fakeEvent("/");
    event.context = { _mountedPathname: "/_agent-native/open" };
    event.url = {
      search: "?app=mail&view=inbox&embedded=1&__an_embed_token=tok",
    };

    expect(
      requestMatchesEmbedTarget(
        event,
        "/_agent-native/open?app=mail&view=inbox",
      ),
    ).toBe(true);
  });

  it("rejects unrelated page routes for the same token", () => {
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/settings?embedded=1"),
        "/_agent-native/open?app=mail&view=inbox",
      ),
    ).toBe(false);
  });

  it("allows same-origin fetches only when the embed target header matches", () => {
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/_agent-native/actions/list-emails", {
          [EMBED_TARGET_HEADER]: "/inbox?embedded=1",
        }),
        "/_agent-native/open?app=mail&view=inbox",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/api/emails?view=inbox&limit=25", {
          [EMBED_TARGET_HEADER]: "/inbox?embedded=1",
        }),
        "/_agent-native/open?app=mail&view=inbox",
      ),
    ).toBe(true);

    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/_agent-native/actions/list-emails", {
          [EMBED_TARGET_HEADER]: "/settings?embedded=1",
        }),
        "/_agent-native/open?app=mail&view=inbox",
      ),
    ).toBe(false);
  });

  it("treats bearer embed tokens as embed auth markers for CORS headers", () => {
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      targetPath: "/picker?embedded=1",
      ttlSeconds: 60,
    });

    expect(
      requestHasEmbedAuthMarker(
        fakeEvent("/_agent-native/actions/list-libraries", {
          authorization: `Bearer ${token}`,
          [EMBED_TARGET_HEADER]: "/picker?embedded=1",
        }),
      ),
    ).toBe(true);
    expect(
      requestHasEmbedAuthMarker(
        fakeEvent("/_agent-native/actions/list-libraries", {
          authorization: `Bearer ${token}`,
          [EMBED_TARGET_HEADER]: "/settings?embedded=1",
        }),
      ),
    ).toBe(false);
  });

  it("allows app runtime requests with the embed cookie when referrer headers are unavailable", async () => {
    process.env.OAUTH_STATE_SECRET = "embed-test-secret";
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      orgId: "org_123",
      targetPath: "/inbox?__an_mcp_chat_bridge=1",
      ttlSeconds: 60,
    });

    const runtimeSession = await resolveEmbedSessionFromRequest(
      fakeEvent("/api/emails?view=inbox&limit=25", {
        cookie: `${EMBED_SESSION_COOKIE}=${token}`,
      }),
    );

    expect(runtimeSession).toMatchObject({
      email: "owner@example.com",
      orgId: "org_123",
      targetPath: "/inbox?__an_mcp_chat_bridge=1",
    });

    await expect(
      resolveEmbedSessionFromRequest(
        fakeEvent("/settings", {
          cookie: `${EMBED_SESSION_COOKIE}=${token}`,
        }),
      ),
    ).resolves.toBeNull();
  });

  it("allows Vite module runtime requests with the embed query token", async () => {
    process.env.OAUTH_STATE_SECRET = "embed-test-secret";
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      orgId: "org_123",
      targetPath: "/picker?mediaType=image",
      ttlSeconds: 60,
    });
    const event = fakeEvent(`/@vite/client?__an_embed_token=${token}`);

    await expect(resolveEmbedSessionFromRequest(event)).resolves.toMatchObject({
      email: "owner@example.com",
      orgId: "org_123",
      targetPath: "/picker?mediaType=image",
    });
    expect(requestHasEmbedAuthMarker(event)).toBe(true);
  });
});
