import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signA2AToken: vi.fn(),
  verifyA2AToken: vi.fn(),
  execute: vi.fn(),
  getIconAsset: vi.fn(),
  listIconAssets: vi.fn(),
  putIconAsset: vi.fn(),
  readIconAssetForAuthorizedReference: vi.fn(),
  resolveOrgDirectoryOrigin: vi.fn(),
  getOrgDomain: vi.fn(),
  resolveOrgByDomain: vi.fn(),
  isOrgMember: vi.fn(),
  getSession: vi.fn(),
  resolveVercelDeploymentProtectionHeaders: vi.fn(),
}));

vi.mock("@agent-native/core/a2a", () => ({
  signA2AToken: mocks.signA2AToken,
  verifyA2AToken: mocks.verifyA2AToken,
  canonicalA2AAudience: (base: string, path: string) => `${base}${path}`,
}));
vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute: mocks.execute }),
}));
vi.mock("@agent-native/core/icon-assets", () => ({
  getIconAsset: mocks.getIconAsset,
  listIconAssets: mocks.listIconAssets,
  putIconAsset: mocks.putIconAsset,
  readIconAssetForAuthorizedReference:
    mocks.readIconAssetForAuthorizedReference,
}));
vi.mock("@agent-native/core/mcp", () => ({
  resolveOrgDirectoryOrigin: mocks.resolveOrgDirectoryOrigin,
}));
vi.mock("@agent-native/core/org", () => ({
  getOrgDomain: mocks.getOrgDomain,
  resolveOrgByDomain: mocks.resolveOrgByDomain,
  isOrgMember: mocks.isOrgMember,
}));
vi.mock("@agent-native/core/server", () => ({
  getSession: mocks.getSession,
  runWithRequestContext: (_context: unknown, run: () => unknown) => run(),
  resolveVercelDeploymentProtectionHeaders:
    mocks.resolveVercelDeploymentProtectionHeaders,
}));

import { createPrivateIconAssetsHandler } from "../../../../packages/dispatch/src/server/lib/private-icon-assets.js";
import {
  listOwnedPrivateIcons,
  ownsPrivateIcon,
  readPrivateIcon,
  uploadPrivateIcon,
} from "./private-icon-authority.js";

const assetId = "00000000-0000-4000-8000-000000000001";
const ownerEmail = "owner@example.test";
const data = Uint8Array.of(137, 80, 78, 71);
const dispatchOrigin = "https://dispatch.example.test";

describe("Content private icon authority", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveOrgDirectoryOrigin.mockReturnValue(dispatchOrigin);
    mocks.getOrgDomain.mockResolvedValue(null);
    mocks.execute.mockResolvedValue({
      rows: [{ identityAuthority: dispatchOrigin, identityId: "dispatch-org" }],
    });
    mocks.putIconAsset.mockResolvedValue({ id: assetId });
    mocks.getIconAsset.mockResolvedValue({ id: assetId });
    mocks.listIconAssets.mockResolvedValue([
      { id: assetId, filename: "mark.png", alt: "Mark" },
    ]);
    mocks.readIconAssetForAuthorizedReference.mockResolvedValue({
      data,
      mimeType: "image/png",
    });
    mocks.resolveVercelDeploymentProtectionHeaders.mockReturnValue({});
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it("uploads personal icons locally when Dispatch is configured", async () => {
    const input = { data, mimeType: "image/png", ownerEmail, orgId: null };
    await expect(uploadPrivateIcon(input)).resolves.toBe(assetId);
    expect(mocks.putIconAsset).toHaveBeenCalledWith(input);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.signA2AToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps personal ownership checks scoped to the requested owner and null org", async () => {
    await expect(
      ownsPrivateIcon({ assetId, ownerEmail, orgId: null }),
    ).resolves.toBe(true);
    expect(mocks.getIconAsset).toHaveBeenCalledWith(assetId, {
      ownerEmail,
      orgId: null,
    });
    mocks.getIconAsset.mockResolvedValue(null);
    await expect(
      ownsPrivateIcon({
        assetId,
        ownerEmail: "other@example.test",
        orgId: null,
      }),
    ).resolves.toBe(false);
    expect(mocks.getIconAsset).toHaveBeenLastCalledWith(assetId, {
      ownerEmail: "other@example.test",
      orgId: null,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lists only the local personal owner's metadata", async () => {
    await expect(
      listOwnedPrivateIcons({ ownerEmail, orgId: null }),
    ).resolves.toEqual([{ id: assetId, filename: "mark.png", alt: "Mark" }]);
    expect(mocks.listIconAssets).toHaveBeenCalledWith({
      ownerEmail,
      orgId: null,
      limit: 100,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads authorized personal references from the null-org local scope", async () => {
    await expect(readPrivateIcon({ assetId, orgId: null })).resolves.toEqual({
      data,
      mimeType: "image/png",
    });
    expect(mocks.readIconAssetForAuthorizedReference).toHaveBeenCalledWith(
      assetId,
      { orgId: null },
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an unverified workspace instead of falling back to local storage", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    await expect(
      uploadPrivateIcon({
        data,
        mimeType: "image/png",
        ownerEmail,
        orgId: "content-org",
      }),
    ).rejects.toThrow("no verified Dispatch organization identity");
    expect(mocks.putIconAsset).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the owner's identity for federated ownership checks", async () => {
    mocks.signA2AToken.mockResolvedValue("example-signed-token");
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
    await expect(
      ownsPrivateIcon({ assetId, ownerEmail, orgId: "content-org" }),
    ).resolves.toBe(true);
    expect(mocks.signA2AToken).toHaveBeenCalledWith(
      ownerEmail,
      undefined,
      undefined,
      expect.objectContaining({
        audience: `${dispatchOrigin}/private-icon`,
        preferGlobalSecret: true,
        extraClaims: {
          scope: "private-icon:verify-owner",
          asset_id: assetId,
          org_id: "dispatch-org",
        },
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      `${dispatchOrigin}/_agent-native/private-icons/${assetId}`,
      expect.objectContaining({ method: "HEAD", redirect: "manual" }),
    );
  });

  it("serves an asset-bound Content service read through Dispatch without workspace membership", async () => {
    mocks.isOrgMember.mockResolvedValue(false);
    mocks.signA2AToken.mockImplementation(
      async (email, orgDomain, _orgId, options) => {
        mocks.verifyA2AToken.mockResolvedValue({
          email,
          orgDomain,
          claims: {
            sub: email,
            iss: "https://content.example.test",
            aud: options.audience,
            ...options.extraClaims,
          },
        });
        return "example-signed-token";
      },
    );
    const handler = createPrivateIconAssetsHandler();
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const request = new Request(url, init);
      return handler({
        url: new URL(`/${assetId}`, dispatchOrigin),
        req: request,
      });
    });

    await expect(
      readPrivateIcon({ assetId, orgId: "content-org" }),
    ).resolves.toEqual({ data, mimeType: "image/png" });
    expect(mocks.signA2AToken).toHaveBeenCalledWith(
      "content-private-icon-reader",
      undefined,
      undefined,
      expect.objectContaining({
        audience: `${dispatchOrigin}/private-icon`,
        preferGlobalSecret: true,
        expiresIn: "1m",
        extraClaims: {
          scope: "private-icon:read",
          asset_id: assetId,
          org_id: "dispatch-org",
        },
      }),
    );
    expect(mocks.verifyA2AToken).toHaveBeenCalledWith(
      "example-signed-token",
      expect.anything(),
      {
        routePrefix: "private-icon",
        globalSecretOnly: true,
        includeClaims: true,
      },
    );
    expect(mocks.readIconAssetForAuthorizedReference).toHaveBeenCalledWith(
      assetId,
      { orgId: "dispatch-org" },
    );
    expect(mocks.isOrgMember).not.toHaveBeenCalled();
    expect(mocks.getSession).not.toHaveBeenCalled();
  });
});
