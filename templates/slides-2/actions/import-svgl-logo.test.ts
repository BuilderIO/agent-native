import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ssrfSafeFetch: vi.fn(),
  uploadImageAsset: vi.fn(),
  assertDeckAssetUploadScope: vi.fn(),
  storageReady: true,
  getRequestUserEmail: vi.fn(() => "user@example.com"),
  getRequestOrgId: vi.fn(() => "org-1"),
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: (...args: unknown[]) => mocks.ssrfSafeFetch(...args),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
  getRequestOrgId: mocks.getRequestOrgId,
}));
vi.mock("../server/handlers/assets.js", () => ({
  uploadImageAsset: mocks.uploadImageAsset,
}));
vi.mock("../server/lib/deck-asset-scope.js", () => ({
  assertDeckAssetUploadScope: mocks.assertDeckAssetUploadScope,
}));
vi.mock("../server/lib/upload-storage-status.js", () => ({
  isSlides2UploadStorageReady: async () => mocks.storageReady,
}));

import importSvglLogo from "./import-svgl-logo.js";

describe("import-svgl-logo action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storageReady = true;
    mocks.getRequestUserEmail.mockReturnValue("user@example.com");
    mocks.getRequestOrgId.mockReturnValue("org-1");
    mocks.ssrfSafeFetch.mockResolvedValue(
      new Response(
        '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0" /></svg>',
        {
          headers: { "content-type": "image/svg+xml" },
        },
      ),
    );
    mocks.uploadImageAsset.mockResolvedValue({
      id: "asset-1",
      url: "https://storage.example.com/asset-1.svg",
      filename: "acme-inc.svg",
      type: "image/svg+xml",
      size: 72,
    });
  });

  it("preflights deck access, validates the remote route, and stores the sanitized SVG asset", async () => {
    const result = await importSvglLogo.run({
      route: "https://svgl.app/acme.svg",
      title: "Ácme, Inc.",
      deckId: "deck-1",
    });

    expect(mocks.assertDeckAssetUploadScope).toHaveBeenCalledWith({
      deckId: "deck-1",
      email: "user@example.com",
      orgId: "org-1",
    });
    expect(mocks.ssrfSafeFetch).toHaveBeenCalledWith(
      "https://svgl.app/acme.svg",
      expect.objectContaining({
        headers: { Accept: "image/svg+xml" },
      }),
      expect.objectContaining({ httpsOnly: true, maxRedirects: 2 }),
    );
    const fetchOptions = mocks.ssrfSafeFetch.mock.calls[0]?.[2] as {
      assertUrlAllowed: (candidate: string) => void;
    };
    expect(() =>
      fetchOptions.assertUrlAllowed("https://outside.example/logo.svg"),
    ).toThrow();
    expect(mocks.uploadImageAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "user@example.com",
        orgId: "org-1",
        deckId: "deck-1",
        originalName: "acme-inc.svg",
        data: expect.any(Buffer),
        type: "image/svg+xml",
      }),
    );
    expect(result).toMatchObject({
      id: "asset-1",
      assetId: "asset-1",
      filename: "acme-inc.svg",
      type: "image/svg+xml",
      source: "svgl",
    });
  });

  it("rejects a non-SVGL route before any fetch or storage write", async () => {
    await expect(
      importSvglLogo.run({
        route: "https://outside.example/logo.svg",
        title: "Logo",
      }),
    ).rejects.toMatchObject({ errorCode: "svgl_invalid_url" });

    expect(mocks.ssrfSafeFetch).not.toHaveBeenCalled();
    expect(mocks.uploadImageAsset).not.toHaveBeenCalled();
  });

  it("returns the typed storage setup failure before downloading a logo", async () => {
    mocks.storageReady = false;

    await expect(
      importSvglLogo.run({
        route: "https://svgl.app/acme.svg",
        title: "Acme",
      }),
    ).rejects.toMatchObject({
      errorCode: "image_upload_storage_unavailable",
      statusCode: 503,
    });

    expect(mocks.ssrfSafeFetch).not.toHaveBeenCalled();
    expect(mocks.uploadImageAsset).not.toHaveBeenCalled();
  });

  it("checks deck access before downloading or storing the remote logo", async () => {
    mocks.assertDeckAssetUploadScope.mockRejectedValueOnce(
      Object.assign(new Error("Deck access denied."), {
        statusCode: 403,
        errorCode: "asset_deck_scope_forbidden",
      }),
    );

    await expect(
      importSvglLogo.run({
        route: "https://svgl.app/acme.svg",
        title: "Acme",
        deckId: "other-deck",
      }),
    ).rejects.toMatchObject({ errorCode: "asset_deck_scope_forbidden" });

    expect(mocks.ssrfSafeFetch).not.toHaveBeenCalled();
    expect(mocks.uploadImageAsset).not.toHaveBeenCalled();
  });

  it("requires an authenticated user before fetching the logo", async () => {
    mocks.getRequestUserEmail.mockReturnValue(null as never);

    await expect(
      importSvglLogo.run({
        route: "https://svgl.app/acme.svg",
        title: "Acme",
      }),
    ).rejects.toMatchObject({ errorCode: "svgl_import_auth_required" });
    expect(mocks.ssrfSafeFetch).not.toHaveBeenCalled();
  });
});
