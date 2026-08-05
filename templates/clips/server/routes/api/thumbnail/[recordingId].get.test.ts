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
      visibility: "recordings.visibility",
    },
  },
}));

vi.mock("../../../lib/recordings.js", () => ({
  getOrganizationRoleForEmail: vi.fn(),
}));

vi.mock("../../../lib/share-password.js", () => ({
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
    visibility: "public",
    ...overrides,
  };
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

  it("serves local data-url thumbnails without a provider fetch", async () => {
    mockGetDb.mockReturnValue(
      createDbWithRow(
        makeRow({
          thumbnailUrl: "data:image/png;base64,aGVsbG8=",
        }),
      ),
    );

    const result = await handler(makeEvent() as any);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("content-type")).toBe("image/png");
    expect(await (result as Response).text()).toBe("hello");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects active image formats from data URLs", async () => {
    mockGetDb.mockReturnValue(
      createDbWithRow(
        makeRow({
          thumbnailUrl:
            "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E",
        }),
      ),
    );

    const result = await handler(makeEvent() as any);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(415);
    expect((result as Response).headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects active content returned by the provider", async () => {
    mockGetDb.mockReturnValue(createDbWithRow(makeRow()));
    vi.mocked(fetch).mockResolvedValue(
      new Response("<svg></svg>", {
        status: 200,
        headers: { "content-type": "image/svg+xml" },
      }),
    );

    const result = await handler(makeEvent() as any);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(415);
    expect((result as Response).headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
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
      "rec-1",
    );
    expect(mockSignShortLivedToken).toHaveBeenCalledWith({
      resourceId: "rec-1",
      ttlSeconds: 21_600,
    });
  });
});
