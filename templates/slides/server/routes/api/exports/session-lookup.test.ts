import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockGetGoogleDocsAccessToken = vi.hoisted(() => vi.fn());
const mockReadMultipartFormData = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  runWithRequestContext: async (_ctx: unknown, fn: () => unknown) => fn(),
  readBody: vi.fn(async () => ({ deckId: "deck-1" })),
  streamFile: vi.fn(),
}));

vi.mock("@agent-native/core/org", () => ({
  getOrgContext: vi.fn(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
  readMultipartFormData: (...args: unknown[]) =>
    mockReadMultipartFormData(...args),
  getRouterParam: vi.fn(() => "deck.pptx"),
}));

vi.mock("../../../../actions/export-html.js", () => ({
  default: { run: vi.fn() },
}));

vi.mock("../../../../actions/export-pptx.js", () => ({
  default: { run: vi.fn() },
}));

vi.mock("../../../lib/google-docs-oauth.js", () => ({
  getGoogleDocsAccessToken: mockGetGoogleDocsAccessToken,
}));

vi.mock("../../../lib/tenant-files.js", () => ({
  tenantExportDir: vi.fn(() => "/tmp/exports"),
}));

const [
  { default: exportHtml },
  { default: exportPptx },
  { default: exportGoogleSlides },
  { default: exportByFilename },
] = await Promise.all([
  import("./html.post"),
  import("./pptx.post"),
  import("./google-slides.post"),
  import("./[filename].get"),
]);

// Regression for the same session-lookup bug fixed in
// request-auth-context.ts: `getSession(event).catch(() => null)` used to
// collapse a DB blip / cookie race into the same shape a genuine anonymous
// visitor gets, so every export route returned 401 "Unauthorized" for what
// was actually a server failure.
describe.each([
  ["html.post", exportHtml],
  ["pptx.post", exportPptx],
  ["google-slides.post", exportGoogleSlides],
  ["[filename].get", exportByFilename],
])("%s session-lookup regression", (_name, handler) => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockSetResponseStatus.mockReset();
    mockGetGoogleDocsAccessToken.mockReset();
    mockReadMultipartFormData.mockResolvedValue([]);
    mockFetch.mockReset();
  });

  it("reports a 503 service error, not 401 Unauthorized, when the session lookup fails", async () => {
    mockGetSession.mockRejectedValue(new Error("db unavailable"));

    const result = (await handler({ node: { res: {} } } as any)) as {
      error?: string;
    };

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 503);
    expect(mockSetResponseStatus).not.toHaveBeenCalledWith(
      expect.anything(),
      401,
    );
    expect(result?.error).not.toMatch(/unauthorized/i);
  });

  it("still reports 401 Unauthorized for a genuine anonymous visitor", async () => {
    mockGetSession.mockResolvedValue(null);

    const result = (await handler({ node: { res: {} } } as any)) as {
      error?: string;
    };

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 401);
    expect(result?.error).toBe("Unauthorized");
  });
});

describe("google-slides connection failures", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockGetSession.mockResolvedValue({
      email: "owner@example.com",
      orgId: "org-1",
    });
    mockReadMultipartFormData.mockResolvedValue([
      { name: "file", data: new Uint8Array([1, 2, 3]) },
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("turns an expired Google connection into a reconnect response", async () => {
    mockGetGoogleDocsAccessToken.mockRejectedValue(new Error("invalid_grant"));

    const result = (await exportGoogleSlides({ node: { res: {} } } as any)) as {
      code?: string;
      error?: string;
    };

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 409);
    expect(mockGetGoogleDocsAccessToken).toHaveBeenCalledWith(
      "owner@example.com",
      { requireDriveUploadScope: true },
    );
    expect(result).toEqual({
      error:
        "Google Drive connection expired. Connect Google again, then retry.",
      code: "google-not-connected",
    });
  });

  it("turns a Drive insufficient-permissions response into a reconnect response", async () => {
    mockGetGoogleDocsAccessToken.mockResolvedValue({
      accessToken: "access-token",
      accountEmail: "owner@example.com",
    });
    mockFetch.mockResolvedValue({
      status: 403,
      ok: false,
      json: vi.fn().mockResolvedValue({
        error: {
          message: "The caller does not have permission",
          errors: [{ reason: "insufficientPermissions" }],
        },
      }),
    });

    const result = (await exportGoogleSlides({ node: { res: {} } } as any)) as {
      code?: string;
      error?: string;
    };

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 409);
    expect(result).toEqual({
      error:
        "Google Drive connection expired. Connect Google again, then retry.",
      code: "google-not-connected",
    });
  });

  it("keeps invalid OAuth client configuration out of the reconnect flow", async () => {
    mockGetGoogleDocsAccessToken.mockRejectedValue(new Error("invalid_client"));

    const result = (await exportGoogleSlides({ node: { res: {} } } as any)) as {
      code?: string;
      error?: string;
    };

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 502);
    expect(result).toEqual({
      error: "Could not use the Google Drive connection. Try again.",
    });
  });
});
