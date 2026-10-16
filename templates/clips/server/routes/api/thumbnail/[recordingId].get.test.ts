import { AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE } from "@agent-native/core/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetCookie = vi.hoisted(() => vi.fn());
const mockGetQuery = vi.hoisted(() => vi.fn());
const mockGetRequestURL = vi.hoisted(() => vi.fn());
const mockGetRouterParam = vi.hoisted(() => vi.fn());
const mockSetCookie = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockGetSession = vi.hoisted(() => vi.fn());
const mockGetOrgContext = vi.hoisted(() => vi.fn());
const mockRunWithRequestContext = vi.hoisted(() => vi.fn());
const mockResolveAccess = vi.hoisted(() => vi.fn());
const mockGetDb = vi.hoisted(() => vi.fn());
const mockVerifyShortLivedToken = vi.hoisted(() => vi.fn());
const mockSignShortLivedToken = vi.hoisted(() => vi.fn());
const mockCreateSsrfSafeDispatcher = vi.hoisted(() => vi.fn());
const mockIsBlockedExtensionUrlWithDns = vi.hoisted(() => vi.fn());
const mockFetchS3ObjectByUrl = vi.hoisted(() => vi.fn());
const mockIsUrlInS3Storage = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getCookie: (...args: unknown[]) => mockGetCookie(...args),
  getQuery: (...args: unknown[]) => mockGetQuery(...args),
  getRequestURL: (...args: unknown[]) => mockGetRequestURL(...args),
  getRouterParam: (...args: unknown[]) => mockGetRouterParam(...args),
  setCookie: (...args: unknown[]) => mockSetCookie(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
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

vi.mock("@agent-native/core/server", () => ({
  captureRouteError: vi.fn(),
  getForwardedRequestOrigin: (...args: unknown[]) =>
    mockGetRequestURL(...args).origin,
  getForwardedRequestURL: (...args: unknown[]) => mockGetRequestURL(...args),
  getSession: (...args: unknown[]) => mockGetSession(...args),
  runWithRequestContext: (...args: unknown[]) =>
    mockRunWithRequestContext(...args),
  signShortLivedToken: (...args: unknown[]) => mockSignShortLivedToken(...args),
  verifyShortLivedToken: (...args: unknown[]) =>
    mockVerifyShortLivedToken(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mockResolveAccess(...args),
}));

vi.mock("../../../db/index.js", () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args),
  schema: {
    recordings: {
      id: "recordings.id",
      thumbnailUrl: "recordings.thumbnailUrl",
      animatedThumbnailUrl: "recordings.animatedThumbnailUrl",
      expiresAt: "recordings.expiresAt",
      organizationId: "recordings.organizationId",
      ownerEmail: "recordings.ownerEmail",
      password: "recordings.password",
      sharePasswordVersion: "recordings.sharePasswordVersion",
      storageMode: "recordings.storageMode",
      trashedAt: "recordings.trashedAt",
      visibility: "recordings.visibility",
    },
    recordingContextItems: {
      recordingId: "recordingContextItems.recordingId",
      mediaRecordingId: "recordingContextItems.mediaRecordingId",
      status: "recordingContextItems.status",
    },
  },
}));

vi.mock("../../../lib/s3-upload-provider.js", () => ({
  fetchS3ObjectByUrl: (...args: unknown[]) => mockFetchS3ObjectByUrl(...args),
  isUrlInS3Storage: (...args: unknown[]) => mockIsUrlInS3Storage(...args),
}));

vi.mock("../../../lib/recordings.js", () => ({
  getOrganizationRoleForEmail: vi.fn(),
}));

vi.mock("../../../lib/share-password.js", () => ({
  getRecordingAccessTokenResourceId: (
    id: string,
    password: string | null,
    _sharePasswordVersion?: string | null,
  ) => (password ? `${id}:password-scoped` : `${id}:update-scoped`),
  verifySharePassword: vi.fn(() => true),
}));

import handler from "./[recordingId].get";

function createDbWithRow(row: Record<string, unknown> | null) {
  return {
    select: vi.fn(() => {
      const builder = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        limit: vi.fn(async () => (row ? [row] : [])),
      };
      return builder;
    }),
  };
}

// Rows are handed out per select call, in order; later calls get no rows.
function createDbWithSelectSequence(...results: Array<unknown[]>) {
  let call = 0;
  return {
    select: vi.fn(() => {
      const rows = results[call++] ?? [];
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
    query: {},
    recordingId: "rec-1",
    status: 200,
  };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-1",
    thumbnailUrl: "https://cdn.example.com/thumb.jpg",
    animatedThumbnailUrl: null,
    expiresAt: null,
    organizationId: null,
    password: null,
    sharePasswordVersion: "initial",
    visibility: "public",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function expectDefaultSocialRedirect(result: unknown) {
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).status).toBe(302);
  expect((result as Response).headers.get("location")).toBe(
    AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE,
  );
}

describe("/api/thumbnail/:recordingId route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    mockGetCookie.mockImplementation((event, name) =>
      event.cookies.get(String(name)),
    );
    mockGetQuery.mockImplementation((event) => event.query);
    mockGetRequestURL.mockReturnValue(
      new URL("https://clips.example.com/api/thumbnail/rec-1"),
    );
    mockGetRouterParam.mockImplementation((event, name) =>
      name === "recordingId" ? event.recordingId : undefined,
    );
    mockSetCookie.mockImplementation((event, name, value) => {
      event.cookies.set(String(name), String(value));
    });
    mockSetResponseStatus.mockImplementation((event, status) => {
      event.status = status;
    });
    mockGetSession.mockResolvedValue(null);
    mockGetOrgContext.mockResolvedValue(null);
    mockRunWithRequestContext.mockImplementation((_context, callback) =>
      callback(),
    );
    mockResolveAccess.mockResolvedValue(null);
    mockCreateSsrfSafeDispatcher.mockResolvedValue(null);
    mockIsBlockedExtensionUrlWithDns.mockResolvedValue(false);
    mockFetchS3ObjectByUrl.mockResolvedValue(null);
    mockIsUrlInS3Storage.mockResolvedValue(true);
    mockVerifyShortLivedToken.mockReturnValue({ ok: false });
    mockSignShortLivedToken.mockReturnValue("renewed-token");
  });

  it("proxies a public provider thumbnail", async () => {
    mockGetDb.mockReturnValue(createDbWithRow(makeRow()));
    vi.mocked(fetch).mockResolvedValue(
      new Response("thumbnail", {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );

    const result = await handler(makeEvent() as any);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("content-type")).toBe("image/jpeg");
    expect(await (result as Response).text()).toBe("thumbnail");
    expect(fetch).toHaveBeenCalledWith(
      "https://cdn.example.com/thumb.jpg",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("uses the recording-scoped signed reader for hosted public thumbnails", async () => {
    const thumbnailUrl = "https://storage.example.com/clips/rec-1/thumb.jpg";
    mockGetDb.mockReturnValue(
      createDbWithRow(makeRow({ thumbnailUrl, storageMode: "hosted" })),
    );
    mockFetchS3ObjectByUrl.mockResolvedValue(
      new Response("private thumbnail", {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );

    const result = await handler(makeEvent() as any);

    expect(result).toBeInstanceOf(Response);
    expect(await (result as Response).text()).toBe("private thumbnail");
    expect(mockFetchS3ObjectByUrl).toHaveBeenCalledWith(
      thumbnailUrl,
      expect.objectContaining({
        recordingId: "rec-1",
        storageMode: "hosted",
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("serves an external thumbnail for a hosted recording without the bucket reader", async () => {
    const thumbnailUrl = "https://cdn.loom.com/sessions/thumbnails/abc.jpg";
    mockIsUrlInS3Storage.mockResolvedValue(false);
    mockGetDb.mockReturnValue(
      createDbWithRow(makeRow({ thumbnailUrl, storageMode: "hosted" })),
    );
    vi.mocked(fetch).mockResolvedValue(
      new Response("loom thumbnail", {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );

    const result = await handler(makeEvent() as any);

    expect(await (result as Response).text()).toBe("loom thumbnail");
    expect(mockFetchS3ObjectByUrl).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      thumbnailUrl,
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("redirects to the branded image while a thumbnail is unavailable", async () => {
    mockGetDb.mockReturnValue(
      createDbWithRow(
        makeRow({ thumbnailUrl: null, animatedThumbnailUrl: null }),
      ),
    );

    const result = await handler(makeEvent() as any);

    expectDefaultSocialRedirect(result);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("redirects to the branded image when the provider object is missing", async () => {
    mockGetDb.mockReturnValue(createDbWithRow(makeRow()));
    vi.mocked(fetch).mockResolvedValue(
      new Response("Not found", {
        status: 404,
        headers: { "content-type": "text/html" },
      }),
    );

    const result = await handler(makeEvent() as any);

    expectDefaultSocialRedirect(result);
  });

  it("redirects to the branded image when the provider fetch fails", async () => {
    mockGetDb.mockReturnValue(createDbWithRow(makeRow()));
    vi.mocked(fetch).mockRejectedValue(new Error("Storage unavailable"));

    const result = await handler(makeEvent() as any);

    expectDefaultSocialRedirect(result);
  });

  it("can proxy the animated preview when requested", async () => {
    mockGetDb.mockReturnValue(
      createDbWithRow(
        makeRow({
          animatedThumbnailUrl: "https://cdn.example.com/preview.gif",
        }),
      ),
    );
    mockGetQuery.mockReturnValue({ animated: "1" });
    vi.mocked(fetch).mockResolvedValue(
      new Response("preview", {
        status: 200,
        headers: { "content-type": "image/gif" },
      }),
    );

    const result = await handler(makeEvent() as any);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("content-type")).toBe("image/gif");
    expect(fetch).toHaveBeenCalledWith(
      "https://cdn.example.com/preview.gif",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("serves local data-url thumbnails without a provider fetch", async () => {
    mockGetDb.mockReturnValue(
      createDbWithRow(
        makeRow({
          thumbnailUrl: "data:image/png;charset=binary;base64,aGVsbG8=",
        }),
      ),
    );

    const result = await handler(makeEvent() as any);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("content-type")).toBe("image/png");
    expect(await (result as Response).text()).toBe("hello");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not serve active image formats from data URLs", async () => {
    mockGetDb.mockReturnValue(
      createDbWithRow(
        makeRow({
          thumbnailUrl:
            "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E",
        }),
      ),
    );

    const result = await handler(makeEvent() as any);

    expectDefaultSocialRedirect(result);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not serve active content returned by the provider", async () => {
    mockGetDb.mockReturnValue(createDbWithRow(makeRow()));
    vi.mocked(fetch).mockResolvedValue(
      new Response("<svg></svg>", {
        status: 200,
        headers: { "content-type": "image/svg+xml" },
      }),
    );

    const result = await handler(makeEvent() as any);

    expectDefaultSocialRedirect(result);
  });

  it("cancels redirect bodies before following the next URL", async () => {
    mockGetDb.mockReturnValue(createDbWithRow(makeRow()));
    const cancel = vi.fn();
    const redirectBody = new ReadableStream({ cancel });
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(redirectBody, {
          status: 302,
          headers: { location: "https://cdn.example.com/final.jpg" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("thumbnail", {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
      );

    const result = await handler(makeEvent() as any);

    expect(result).toBeInstanceOf(Response);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://cdn.example.com/final.jpg",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("rejects private thumbnails without a share grant", async () => {
    mockGetDb.mockReturnValue(
      createDbWithRow(makeRow({ visibility: "private" })),
    );

    const result = await handler(makeEvent() as any);

    expect(result).toEqual({ error: "Not found" });
    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts the short-lived token minted after password unlock", async () => {
    mockGetDb.mockReturnValue(
      createDbWithRow(makeRow({ password: "encrypted-password" })),
    );
    mockGetQuery.mockReturnValue({ t: "media-token" });
    mockVerifyShortLivedToken.mockReturnValue({ ok: true });
    vi.mocked(fetch).mockResolvedValue(
      new Response("thumbnail", {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );

    const result = await handler(makeEvent() as any);

    expect(result).toBeInstanceOf(Response);
    expect(mockVerifyShortLivedToken).toHaveBeenCalledWith(
      "media-token",
      "rec-1:password-scoped",
    );
    expect(mockSignShortLivedToken).toHaveBeenCalledWith({
      resourceId: "rec-1:password-scoped",
      ttlSeconds: 21_600,
    });
  });

  it("rejects a protected media token minted before a password was added", async () => {
    mockGetDb.mockReturnValue(
      createDbWithRow(makeRow({ password: "encrypted-password" })),
    );
    mockGetQuery.mockReturnValue({ t: "old-media-token" });
    mockVerifyShortLivedToken.mockImplementation(
      (_token: string, resourceId: string) => ({ ok: resourceId === "rec-1" }),
    );

    const event = makeEvent();
    const result = await handler(event as any);

    expect(event.status).toBe(401);
    expect(result).toEqual({
      error: "Password required",
      passwordRequired: true,
    });
    expect(mockVerifyShortLivedToken).toHaveBeenCalledWith(
      "old-media-token",
      "rec-1:password-scoped",
    );
  });
  describe("earlier-screen-time footage", () => {
    const footageRow = {
      thumbnailUrl: "https://cdn.example.com/footage-thumb.jpg",
      animatedThumbnailUrl: null,
    };
    const imageResponse = () =>
      new Response("thumbnail", {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });

    it("is served under the access of the clip it is attached to", async () => {
      mockGetDb.mockReturnValue(
        createDbWithSelectSequence([{ recordingId: "clip-1" }], [footageRow]),
      );
      mockResolveAccess.mockImplementation(async (_type, id) =>
        id === "clip-1"
          ? {
              role: "viewer",
              resource: makeRow({ id: "clip-1", visibility: "private" }),
            }
          : null,
      );
      vi.mocked(fetch).mockResolvedValue(imageResponse());

      const result = await handler(makeEvent() as any);

      expect(mockResolveAccess).toHaveBeenCalledWith("recording", "clip-1");
      expect(mockResolveAccess).not.toHaveBeenCalledWith("recording", "rec-1");
      expect(result).toBeInstanceOf(Response);
      expect(fetch).toHaveBeenCalledWith(
        "https://cdn.example.com/footage-thumb.jpg",
        expect.objectContaining({ redirect: "manual" }),
      );
    });

    it("is refused when the footage itself is in Trash", async () => {
      mockGetDb.mockReturnValue(
        createDbWithSelectSequence(
          [{ recordingId: "clip-1" }],
          [{ ...footageRow, trashedAt: "2026-10-14T12:00:00.000Z" }],
        ),
      );
      mockResolveAccess.mockResolvedValue({
        role: "viewer",
        resource: makeRow({ id: "clip-1" }),
      });

      const event = makeEvent();
      const result = await handler(event as any);

      expect(event.status).toBe(404);
      expect(result).toEqual({ error: "Not found" });
      expect(fetch).not.toHaveBeenCalled();
    });

    it("is refused when the clip is private to the viewer", async () => {
      mockGetDb.mockReturnValue(
        createDbWithSelectSequence(
          [{ recordingId: "clip-1" }],
          [makeRow({ id: "clip-1", visibility: "private" })],
        ),
      );
      mockResolveAccess.mockResolvedValue(null);

      const event = makeEvent();
      const result = await handler(event as any);

      expect(event.status).toBe(404);
      expect(result).toEqual({ error: "Not found" });
      expect(fetch).not.toHaveBeenCalled();
    });

    it("is refused to non-owners while the clip is in Trash", async () => {
      mockGetDb.mockReturnValue(
        createDbWithSelectSequence([{ recordingId: "clip-1" }], [footageRow]),
      );
      mockResolveAccess.mockResolvedValue({
        role: "viewer",
        resource: makeRow({
          id: "clip-1",
          trashedAt: "2026-10-14T12:00:00.000Z",
        }),
      });

      const event = makeEvent();
      const result = await handler(event as any);

      expect(event.status).toBe(404);
      expect(result).toEqual({ error: "Not found" });
      expect(fetch).not.toHaveBeenCalled();
    });

    it("requires the clip's password, not the footage's", async () => {
      mockGetDb.mockReturnValue(
        createDbWithSelectSequence([{ recordingId: "clip-1" }], [footageRow]),
      );
      mockResolveAccess.mockResolvedValue({
        role: "viewer",
        resource: makeRow({ id: "clip-1", password: "encrypted-password" }),
      });

      const event = makeEvent();
      const result = await handler(event as any);

      expect(event.status).toBe(401);
      expect(result).toEqual({
        error: "Password required",
        passwordRequired: true,
      });
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
