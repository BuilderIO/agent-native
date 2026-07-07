import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetRouterParam = vi.hoisted(() => vi.fn());
const mockGetCookie = vi.hoisted(() => vi.fn());
const mockGetRequestHeader = vi.hoisted(() => vi.fn());
const mockGetQuery = vi.hoisted(() => vi.fn());
const mockSetResponseHeader = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockSetCookie = vi.hoisted(() => vi.fn());
const mockReadAppState = vi.hoisted(() => vi.fn());
const mockCreateSsrfSafeDispatcher = vi.hoisted(() => vi.fn());
const mockIsBlockedExtensionUrlWithDns = vi.hoisted(() => vi.fn());
const mockGetOrgContext = vi.hoisted(() => vi.fn());
const mockResolveAccess = vi.hoisted(() => vi.fn());
const mockGetSession = vi.hoisted(() => vi.fn());
const mockRunWithRequestContext = vi.hoisted(() => vi.fn());
const mockSignShortLivedToken = vi.hoisted(() => vi.fn());
const mockVerifyShortLivedToken = vi.hoisted(() => vi.fn());
const mockGetDb = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getCookie: (...args: unknown[]) => mockGetCookie(...args),
  getRouterParam: (...args: unknown[]) => mockGetRouterParam(...args),
  getRequestHeader: (...args: unknown[]) => mockGetRequestHeader(...args),
  getQuery: (...args: unknown[]) => mockGetQuery(...args),
  setResponseHeader: (...args: unknown[]) => mockSetResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
  setCookie: (...args: unknown[]) => mockSetCookie(...args),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: (...args: unknown[]) => mockReadAppState(...args),
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  createSsrfSafeDispatcher: (...args: unknown[]) =>
    mockCreateSsrfSafeDispatcher(...args),
  isBlockedExtensionUrlWithDns: (...args: unknown[]) =>
    mockIsBlockedExtensionUrlWithDns(...args),
}));

vi.mock("@agent-native/core/org", () => ({
  getOrgContext: (...args: unknown[]) => mockGetOrgContext(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mockResolveAccess(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  captureRouteError: vi.fn(),
  getRequestOrgId: vi.fn(() => undefined),
  resolveSecret: vi.fn(async () => null),
  resolveBuilderPrivateKey: vi.fn(async () => null),
  getSession: (...args: unknown[]) => mockGetSession(...args),
  runWithRequestContext: (...args: unknown[]) =>
    mockRunWithRequestContext(...args),
  signShortLivedToken: (...args: unknown[]) => mockSignShortLivedToken(...args),
  verifyShortLivedToken: (...args: unknown[]) =>
    mockVerifyShortLivedToken(...args),
}));

vi.mock("../../../../shared/loom.js", () => ({
  LOOM_START_MS_QUERY_PARAM: "loomStartMs",
  isLoomEmbedBackedRecording: vi.fn(() => false),
  loomEmbedUrlWithTimestamp: vi.fn(),
  loomEmbedUrlForRecording: vi.fn(),
}));

vi.mock("../../../lib/share-password.js", () => ({
  verifySharePassword: vi.fn(() => false),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

vi.mock("../../../db/index.js", () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args),
  schema: {
    recordings: { id: "recordings.id", visibility: "recordings.visibility" },
  },
}));

import {
  isLoomEmbedBackedRecording,
  loomEmbedUrlForRecording,
} from "../../../../shared/loom.js";
import handler from "./[recordingId].get";

function createDbWithSelectResult(rows: unknown[]) {
  return {
    select: vi.fn(() => {
      const builder = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        limit: vi.fn(async () => rows),
      };
      return builder;
    }),
  };
}

function makeEvent() {
  return {
    cookies: new Map<string, string>(),
    headers: new Map<string, string>(),
    query: {},
    routerParams: { recordingId: "rec-1" },
    setCookies: [] as unknown[],
    status: 200,
  };
}

describe("/api/video/:recordingId route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    mockGetRouterParam.mockImplementation((event, name) => {
      return event.routerParams?.[String(name)];
    });
    mockGetCookie.mockImplementation((event, name) => {
      return event.cookies.get(String(name));
    });
    mockGetRequestHeader.mockImplementation((event, name) => {
      return event.headers.get(String(name).toLowerCase()) ?? undefined;
    });
    mockGetQuery.mockImplementation((event) => event.query);
    mockSetResponseHeader.mockImplementation((event, name, value) => {
      event.headers.set(String(name).toLowerCase(), String(value));
    });
    mockSetResponseStatus.mockImplementation((event, status) => {
      event.status = status;
    });
    mockSetCookie.mockImplementation((event, name, value, options) => {
      event.cookies.set(String(name), String(value));
      event.setCookies.push({ name, value, options });
    });
    mockReadAppState.mockResolvedValue(null);
    mockCreateSsrfSafeDispatcher.mockResolvedValue(null);
    mockIsBlockedExtensionUrlWithDns.mockResolvedValue(false);
    mockGetSession.mockResolvedValue(null);
    mockGetOrgContext.mockResolvedValue(null);
    mockRunWithRequestContext.mockImplementation((_context, callback) =>
      callback(),
    );
    mockSignShortLivedToken.mockReturnValue("renewed-token");
    mockVerifyShortLivedToken.mockReturnValue({ ok: false, reason: "expired" });
    mockResolveAccess.mockResolvedValue({
      role: "viewer",
      resource: {
        visibility: "public",
        password: null,
        expiresAt: null,
        videoUrl: "https://cdn.example.com/clip.mp4",
      },
    });
    mockGetDb.mockReturnValue(createDbWithSelectResult([]));
  });

  it("returns a controlled media fetch error when upstream fetch throws", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("fetch failed"));

    const event = makeEvent();
    const result = await handler(event as any);

    expect(event.status).toBe(502);
    expect(result).toEqual({
      error: "Recording media could not be fetched.",
    });
  });

  it("maps provider fetch aborts to timeout errors", async () => {
    vi.mocked(fetch).mockImplementation((_url, init) => {
      expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
      const err = new Error("aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });

    const event = makeEvent();
    const result = await handler(event as any);

    expect(event.status).toBe(504);
    expect(result).toEqual({ error: "Recording media fetch timed out." });
  });

  it("tries the compressed Builder media URL before the original asset URL", async () => {
    mockResolveAccess.mockResolvedValue({
      role: "viewer",
      resource: {
        visibility: "public",
        password: null,
        expiresAt: null,
        videoUrl:
          "https://cdn.builder.io/o/assets%2Forg-probe%2Fasset-ready?apiKey=org-probe&token=asset-ready&alt=media",
      },
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response("compressed media", {
        status: 206,
        headers: { "content-type": "video/webm" },
      }),
    );

    const event = makeEvent();
    const result = await handler(event as any);

    expect(result).toBeInstanceOf(Response);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [requestUrl] = vi.mocked(fetch).mock.calls[0];
    const url = new URL(requestUrl.toString());
    expect(url.pathname).toBe(
      "/o/assets%2Forg-probe%2Fasset-ready%2Fcompressed",
    );
    expect(url.searchParams.get("apiKey")).toBe("org-probe");
    expect(url.searchParams.get("token")).toBe("asset-ready");
    expect(url.searchParams.get("optimized")).toBe("true");
  });

  it("briefly suppresses repeated compressed Builder probes after a miss", async () => {
    const originalUrl =
      "https://cdn.builder.io/o/assets%2Forg-probe%2Fasset-missing?apiKey=org-probe&token=asset-missing&alt=media";
    mockResolveAccess.mockResolvedValue({
      role: "viewer",
      resource: {
        visibility: "public",
        password: null,
        expiresAt: null,
        videoUrl: originalUrl,
      },
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(
        new Response("original media", {
          status: 206,
          headers: { "content-type": "video/webm" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("original media again", {
          status: 206,
          headers: { "content-type": "video/webm" },
        }),
      );

    const firstResult = await handler(makeEvent() as any);
    const secondResult = await handler(makeEvent() as any);

    expect(firstResult).toBeInstanceOf(Response);
    expect(secondResult).toBeInstanceOf(Response);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(new URL(vi.mocked(fetch).mock.calls[0][0].toString()).pathname).toBe(
      "/o/assets%2Forg-probe%2Fasset-missing%2Fcompressed",
    );
    expect(vi.mocked(fetch).mock.calls[1][0].toString()).toBe(originalUrl);
    expect(vi.mocked(fetch).mock.calls[2][0].toString()).toBe(originalUrl);
  });

  it("falls back to original media when the compressed Builder probe returns 500", async () => {
    const originalUrl =
      "https://cdn.builder.io/o/assets%2Forg-probe%2Fasset-compressed-500?apiKey=org-probe&token=asset-compressed-500&alt=media";
    mockResolveAccess.mockResolvedValue({
      role: "viewer",
      resource: {
        visibility: "public",
        password: null,
        expiresAt: null,
        videoUrl: originalUrl,
      },
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(
        new Response("original media", {
          status: 206,
          headers: { "content-type": "video/webm" },
        }),
      );

    const result = await handler(makeEvent() as any);

    expect(result).toBeInstanceOf(Response);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new URL(vi.mocked(fetch).mock.calls[0][0].toString()).pathname).toBe(
      "/o/assets%2Forg-probe%2Fasset-compressed-500%2Fcompressed",
    );
    expect(vi.mocked(fetch).mock.calls[1][0].toString()).toBe(originalUrl);
  });

  it("falls back to original media when the compressed Builder probe throws", async () => {
    const originalUrl =
      "https://cdn.builder.io/o/assets%2Forg-probe%2Fasset-compressed-throw?apiKey=org-probe&token=asset-compressed-throw&alt=media";
    mockResolveAccess.mockResolvedValue({
      role: "viewer",
      resource: {
        visibility: "public",
        password: null,
        expiresAt: null,
        videoUrl: originalUrl,
      },
    });
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(
        new Response("original media", {
          status: 206,
          headers: { "content-type": "video/webm" },
        }),
      );

    const result = await handler(makeEvent() as any);

    expect(result).toBeInstanceOf(Response);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new URL(vi.mocked(fetch).mock.calls[0][0].toString()).pathname).toBe(
      "/o/assets%2Forg-probe%2Fasset-compressed-throw%2Fcompressed",
    );
    expect(vi.mocked(fetch).mock.calls[1][0].toString()).toBe(originalUrl);
  });

  it("briefly suppresses repeated compressed Builder probes after a 500 miss", async () => {
    const originalUrl =
      "https://cdn.builder.io/o/assets%2Forg-probe%2Fasset-compressed-500-cache?apiKey=org-probe&token=asset-compressed-500-cache&alt=media";
    mockResolveAccess.mockResolvedValue({
      role: "viewer",
      resource: {
        visibility: "public",
        password: null,
        expiresAt: null,
        videoUrl: originalUrl,
      },
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(
        new Response("original media", {
          status: 206,
          headers: { "content-type": "video/webm" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("original media again", {
          status: 206,
          headers: { "content-type": "video/webm" },
        }),
      );

    const firstResult = await handler(makeEvent() as any);
    const secondResult = await handler(makeEvent() as any);

    expect(firstResult).toBeInstanceOf(Response);
    expect(secondResult).toBeInstanceOf(Response);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(new URL(vi.mocked(fetch).mock.calls[0][0].toString()).pathname).toBe(
      "/o/assets%2Forg-probe%2Fasset-compressed-500-cache%2Fcompressed",
    );
    expect(vi.mocked(fetch).mock.calls[1][0].toString()).toBe(originalUrl);
    expect(vi.mocked(fetch).mock.calls[2][0].toString()).toBe(originalUrl);
  });

  it("accepts a protected media cookie when the query token is expired", async () => {
    mockResolveAccess.mockResolvedValue({
      role: "viewer",
      resource: {
        visibility: "public",
        password: "encrypted-password",
        expiresAt: null,
        videoUrl: "https://cdn.example.com/clip.mp4",
      },
    });
    mockVerifyShortLivedToken.mockImplementation((token: string) =>
      token === "cookie-token"
        ? { ok: true }
        : { ok: false, reason: "expired" },
    );
    vi.mocked(fetch).mockResolvedValue(
      new Response("media", {
        status: 206,
        headers: { "content-type": "video/mp4" },
      }),
    );

    const event = makeEvent();
    event.query = { t: "expired-token" };
    event.cookies.set("clips_media_rec-1", "cookie-token");

    const result = await handler(event as any);

    expect(result).toBeInstanceOf(Response);
    expect(fetch).toHaveBeenCalled();
    expect(mockVerifyShortLivedToken).toHaveBeenCalledWith(
      "expired-token",
      "rec-1",
    );
    expect(mockVerifyShortLivedToken).toHaveBeenCalledWith(
      "cookie-token",
      "rec-1",
    );
    expect(mockSignShortLivedToken).toHaveBeenCalledWith({
      resourceId: "rec-1",
      ttlSeconds: 21_600,
    });
    expect(mockSetCookie).toHaveBeenCalledWith(
      event,
      "clips_media_rec-1",
      "renewed-token",
      expect.objectContaining({
        httpOnly: true,
        maxAge: 21_600,
        path: "/api/video/rec-1",
        sameSite: "lax",
        secure: false,
      }),
    );
  });

  it("serves a public recording to anonymous viewers without a share grant", async () => {
    // Anonymous viewer on a public share page: no session, no grant.
    mockGetSession.mockResolvedValue(null);
    mockResolveAccess.mockResolvedValue(null);
    mockGetDb.mockReturnValue(
      createDbWithSelectResult([
        {
          visibility: "public",
          password: null,
          expiresAt: null,
          videoUrl: "https://cdn.example.com/clip.mp4",
          ownerEmail: "owner@example.com",
        },
      ]),
    );
    vi.mocked(fetch).mockResolvedValue(
      new Response("media", {
        status: 200,
        headers: { "content-type": "video/mp4" },
      }),
    );

    const event = makeEvent();
    const result = await handler(event as any);

    expect(result).toBeInstanceOf(Response);
    expect(event.status).not.toBe(403);
    expect(fetch).toHaveBeenCalled();
  });

  it("does not emit a CSP header on Loom embed HTML responses", async () => {
    vi.mocked(isLoomEmbedBackedRecording).mockReturnValueOnce(true);
    vi.mocked(loomEmbedUrlForRecording).mockReturnValueOnce(
      "https://www.loom.com/embed/recording",
    );
    mockResolveAccess.mockResolvedValue({
      role: "viewer",
      resource: {
        visibility: "public",
        password: null,
        expiresAt: null,
        videoUrl: "loom:recording",
      },
    });

    const result = await handler(makeEvent() as any);

    expect(result).toBeInstanceOf(Response);
    expect(
      (result as Response).headers.get("content-security-policy"),
    ).toBeNull();
    expect((result as Response).headers.get("content-type")).toContain(
      "text/html",
    );
  });

  it("forbids anonymous viewers on a non-public recording with no grant", async () => {
    mockGetSession.mockResolvedValue(null);
    mockResolveAccess.mockResolvedValue(null);
    mockGetDb.mockReturnValue(
      createDbWithSelectResult([
        {
          visibility: "private",
          password: null,
          expiresAt: null,
          videoUrl: "https://cdn.example.com/clip.mp4",
          ownerEmail: "owner@example.com",
        },
      ]),
    );

    const event = makeEvent();
    const result = await handler(event as any);

    expect(event.status).toBe(403);
    expect(result).toEqual({ error: "Forbidden" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 404 when no grant and the recording does not exist", async () => {
    mockGetSession.mockResolvedValue(null);
    mockResolveAccess.mockResolvedValue(null);
    mockGetDb.mockReturnValue(createDbWithSelectResult([]));

    const event = makeEvent();
    const result = await handler(event as any);

    expect(event.status).toBe(404);
    expect(result).toEqual({ error: "Not found" });
  });

  it("still enforces the password gate for anonymous viewers of public clips", async () => {
    mockGetSession.mockResolvedValue(null);
    mockResolveAccess.mockResolvedValue(null);
    mockGetDb.mockReturnValue(
      createDbWithSelectResult([
        {
          visibility: "public",
          password: "encrypted-password",
          expiresAt: null,
          videoUrl: "https://cdn.example.com/clip.mp4",
          ownerEmail: "owner@example.com",
        },
      ]),
    );

    const event = makeEvent();
    const result = await handler(event as any);

    expect(event.status).toBe(401);
    expect(result).toEqual({
      error: "Password required",
      passwordRequired: true,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not 500 when application-state is unavailable for anonymous viewers", async () => {
    // Reproduces the production bug: `resolveAccess` grants public clips to
    // anonymous viewers, but `readAppState` throws without an authenticated
    // identity ("Application state access requires an authenticated request
    // context"). The route must swallow that and fall through to the provider
    // media URL instead of surfacing an unhandled 500.
    mockGetSession.mockResolvedValue(null);
    mockResolveAccess.mockResolvedValue({
      role: "viewer",
      resource: {
        visibility: "public",
        password: null,
        expiresAt: null,
        videoUrl: "https://cdn.example.com/clip.mp4",
      },
    });
    mockReadAppState.mockRejectedValue(
      new Error(
        "Application state access requires an authenticated request context or AGENT_USER_EMAIL env var",
      ),
    );
    vi.mocked(fetch).mockResolvedValue(
      new Response("media", {
        status: 206,
        headers: { "content-type": "video/mp4" },
      }),
    );

    const event = makeEvent();
    event.headers.set("range", "bytes=0-2047");
    const result = await handler(event as any);

    expect(result).toBeInstanceOf(Response);
    expect(event.status).not.toBe(500);
    expect(fetch).toHaveBeenCalled();
  });
});
