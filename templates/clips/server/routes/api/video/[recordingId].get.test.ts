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

import handler from "./[recordingId].get";

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
});
