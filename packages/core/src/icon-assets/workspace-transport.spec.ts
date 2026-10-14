import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signA2AToken: vi.fn(),
  resolveIdentityHubUrl: vi.fn(),
  resolveVercelDeploymentProtectionHeaders: vi.fn(),
}));

vi.mock("../a2a/index.js", () => ({
  signA2AToken: mocks.signA2AToken,
  canonicalA2AAudience: (_base: string, path: string) =>
    `https://dispatch.example.test${path}`,
}));
vi.mock("../server/identity-sso.js", () => ({
  resolveIdentityHubUrl: mocks.resolveIdentityHubUrl,
}));
vi.mock("../server/identity-sso-store.js", () => ({
  CANONICAL_IDENTITY_SSO_HUB_URL: "https://dispatch.example.test",
  NETLIFY_PREVIEW_IDENTITY_SSO_HUB_URL: "https://preview.example.test",
  getIdentityHubUrl: () => undefined,
}));
vi.mock("../server/credential-provider.js", () => ({
  resolveVercelDeploymentProtectionHeaders:
    mocks.resolveVercelDeploymentProtectionHeaders,
}));

import {
  readFederatedWorkspaceIcon,
  verifyFederatedWorkspaceIconOwner,
} from "./workspace-transport.js";

const authority = {
  identityAuthority: "https://dispatch.example.test",
  identityId: "canonical-org",
  allowedDomain: null,
};
const assetId = "12345678-1234-4234-8234-123456789abc";

afterEach(() => vi.unstubAllGlobals());

it("signs an exact asset-bound Dispatch read and sends preview protection headers", async () => {
  mocks.resolveIdentityHubUrl.mockReturnValue("https://dispatch.example.test");
  mocks.signA2AToken.mockResolvedValue("signed-token");
  mocks.resolveVercelDeploymentProtectionHeaders.mockReturnValue({
    "x-vercel-protection-bypass": "test-bypass",
  });
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(new Uint8Array([1, 2]), {
      headers: { "content-type": "image/png" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  await expect(
    readFederatedWorkspaceIcon(
      {} as never,
      authority,
      "member@example.test",
      assetId,
    ),
  ).resolves.toEqual({ data: new Uint8Array([1, 2]), mimeType: "image/png" });
  expect(mocks.signA2AToken).toHaveBeenCalledWith(
    "member@example.test",
    undefined,
    undefined,
    expect.objectContaining({
      audience: "https://dispatch.example.test/private-icon",
      preferGlobalSecret: true,
      extraClaims: {
        scope: "private-icon:read",
        org_id: "canonical-org",
        asset_id: assetId,
      },
    }),
  );
  expect(fetchMock).toHaveBeenCalledWith(
    `https://dispatch.example.test/_agent-native/private-icons/${assetId}`,
    expect.objectContaining({
      headers: {
        Authorization: "Bearer signed-token",
        "x-vercel-protection-bypass": "test-bypass",
      },
      redirect: "manual",
    }),
  );
});

it("fails closed when the linked identity authority differs from Dispatch", async () => {
  mocks.resolveIdentityHubUrl.mockReturnValue("https://dispatch.example.test");
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    verifyFederatedWorkspaceIconOwner(
      {} as never,
      { ...authority, identityAuthority: "https://other.example.test" },
      "owner@example.test",
      assetId,
    ),
  ).rejects.toThrow("does not match");
  expect(fetchMock).not.toHaveBeenCalled();
});
