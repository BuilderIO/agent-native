import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyA2AToken: vi.fn(),
  resolveOrgByDomain: vi.fn(),
  isOrgMember: vi.fn(),
  getSession: vi.fn(),
  getIconAsset: vi.fn(),
  listIconAssets: vi.fn(),
  putIconAsset: vi.fn(),
  readIconAssetForAuthorizedReference: vi.fn(),
}));

vi.mock("@agent-native/core/a2a", () => ({
  verifyA2AToken: mocks.verifyA2AToken,
}));
vi.mock("@agent-native/core/org", () => ({
  resolveOrgByDomain: mocks.resolveOrgByDomain,
  isOrgMember: mocks.isOrgMember,
}));
vi.mock("@agent-native/core/server", () => ({
  getSession: mocks.getSession,
  runWithRequestContext: (_context: unknown, run: () => unknown) => run(),
}));
vi.mock("@agent-native/core/icon-assets", () => ({
  getIconAsset: mocks.getIconAsset,
  listIconAssets: mocks.listIconAssets,
  putIconAsset: mocks.putIconAsset,
  readIconAssetForAuthorizedReference:
    mocks.readIconAssetForAuthorizedReference,
}));

import { createPrivateIconAssetsHandler } from "./private-icon-assets.js";

const id = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";

function event(method: string, path = `/${id}`) {
  const url = new URL(`https://dispatch.example.test${path}`);
  return {
    url,
    req: new Request(url, {
      method,
      headers: { authorization: "Bearer example-signed-token" },
    }),
  };
}

function verified(
  scope: string,
  options: { assetId?: string; orgId?: string } = {},
) {
  return {
    email: "owner@example.test",
    orgDomain: null,
    claims: {
      sub: "owner@example.test",
      iss: "https://content.example.test",
      aud: "https://dispatch.example.test/private-icon",
      scope,
      org_id: options.orgId ?? "dispatch-org",
      ...(options.assetId ? { asset_id: options.assetId } : {}),
    },
  };
}

describe("Dispatch private icon assets", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isOrgMember.mockResolvedValue(true);
    mocks.resolveOrgByDomain.mockResolvedValue(null);
    mocks.getIconAsset.mockResolvedValue({ id });
    mocks.readIconAssetForAuthorizedReference.mockResolvedValue({
      data: Uint8Array.of(137, 80, 78, 71),
      mimeType: "image/png",
    });
  });

  it("denies an unverified bearer without a session fallback", async () => {
    mocks.verifyA2AToken.mockResolvedValue({ email: null, orgDomain: null });
    const response = await createPrivateIconAssetsHandler()(event("GET"));
    expect(response.status).toBe(401);
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.readIconAssetForAuthorizedReference).not.toHaveBeenCalled();
  });

  it("denies a token issued for another scope or asset", async () => {
    mocks.verifyA2AToken.mockResolvedValue(verified("private-icon:upload"));
    expect((await createPrivateIconAssetsHandler()(event("GET"))).status).toBe(
      401,
    );
    mocks.verifyA2AToken.mockResolvedValue(
      verified("private-icon:read", { assetId: otherId }),
    );
    expect((await createPrivateIconAssetsHandler()(event("GET"))).status).toBe(
      403,
    );
    expect(mocks.readIconAssetForAuthorizedReference).not.toHaveBeenCalled();
  });

  it("denies an org ID that disagrees with the mapped domain", async () => {
    mocks.verifyA2AToken.mockResolvedValue({
      ...verified("private-icon:read", { assetId: id }),
      orgDomain: "example.test",
    });
    mocks.resolveOrgByDomain.mockResolvedValue({ orgId: "different-org" });
    const response = await createPrivateIconAssetsHandler()(event("GET"));
    expect(response.status).toBe(401);
    expect(mocks.readIconAssetForAuthorizedReference).not.toHaveBeenCalled();
  });

  it("returns 404 when an asset is absent from the verified org", async () => {
    mocks.verifyA2AToken.mockResolvedValue(
      verified("private-icon:read", { assetId: id }),
    );
    mocks.readIconAssetForAuthorizedReference.mockResolvedValue(null);
    const response = await createPrivateIconAssetsHandler()(event("GET"));
    expect(response.status).toBe(404);
    expect(mocks.readIconAssetForAuthorizedReference).toHaveBeenCalledWith(id, {
      orgId: "dispatch-org",
    });
  });

  it("serves bytes with private and SVG-safe headers", async () => {
    mocks.verifyA2AToken.mockResolvedValue(
      verified("private-icon:read", { assetId: id }),
    );
    mocks.readIconAssetForAuthorizedReference.mockResolvedValue({
      data: new TextEncoder().encode("<svg></svg>"),
      mimeType: "image/svg+xml",
    });
    const response = await createPrivateIconAssetsHandler()(event("GET"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<svg></svg>");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain(
      "sandbox",
    );
  });

  it("checks owner membership before confirming an ID", async () => {
    mocks.verifyA2AToken.mockResolvedValue(
      verified("private-icon:verify-owner"),
    );
    mocks.isOrgMember.mockResolvedValue(false);
    expect((await createPrivateIconAssetsHandler()(event("HEAD"))).status).toBe(
      401,
    );
    expect(mocks.getIconAsset).not.toHaveBeenCalled();
    mocks.isOrgMember.mockResolvedValue(true);
    mocks.getIconAsset.mockResolvedValue(null);
    expect((await createPrivateIconAssetsHandler()(event("HEAD"))).status).toBe(
      404,
    );
    mocks.getIconAsset.mockResolvedValue({ id });
    expect((await createPrivateIconAssetsHandler()(event("HEAD"))).status).toBe(
      200,
    );
    expect(mocks.getIconAsset).toHaveBeenCalledWith(id, {
      ownerEmail: "owner@example.test",
      orgId: "dispatch-org",
    });
  });

  it("uploads a bounded multipart icon for a verified member", async () => {
    mocks.verifyA2AToken.mockResolvedValue(verified("private-icon:upload"));
    mocks.putIconAsset.mockResolvedValue({
      id,
      filename: "mark.png",
      mimeType: "image/png",
      size: 4,
    });
    const url = new URL("https://dispatch.example.test/");
    const form = new FormData();
    form.set(
      "file",
      new File([Uint8Array.of(137, 80, 78, 71)], "mark.png", {
        type: "image/png",
      }),
    );
    const encoded = new Request(url, { method: "POST", body: form });
    const body = await encoded.arrayBuffer();
    const headers = new Headers(encoded.headers);
    headers.set("authorization", "Bearer example-signed-token");
    headers.set("content-length", String(body.byteLength));
    const response = await createPrivateIconAssetsHandler()({
      url,
      req: new Request(url, { method: "POST", headers, body }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      id,
      filename: "mark.png",
      contentType: "image/png",
      byteLength: 4,
    });
    expect(mocks.putIconAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "owner@example.test",
        orgId: "dispatch-org",
        filename: "mark.png",
      }),
    );
  });

  it("limits the owner library to safe metadata", async () => {
    mocks.verifyA2AToken.mockResolvedValue(verified("private-icon:list"));
    mocks.listIconAssets.mockResolvedValue([
      {
        id,
        mimeType: "image/png",
        size: 4,
        createdAt: 123,
        blobHandleJson: "private-handle",
        ownerEmail: "owner@example.test",
      },
    ]);
    const response = await createPrivateIconAssetsHandler()(event("GET", "/"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      assets: [{ id, mimeType: "image/png", size: 4, createdAt: 123 }],
    });
    expect(mocks.listIconAssets).toHaveBeenCalledWith({
      ownerEmail: "owner@example.test",
      orgId: "dispatch-org",
      limit: 100,
    });
  });

  it("accepts a signed service JWT only for the private-icon audience", async () => {
    vi.stubEnv("A2A_SECRET", "example-dispatch-shared-secret");
    vi.stubEnv("APP_URL", "https://dispatch.example.test");
    const { verifyA2AToken } = await vi.importActual<
      typeof import("@agent-native/core/a2a")
    >("@agent-native/core/a2a");
    mocks.verifyA2AToken.mockImplementation(verifyA2AToken);

    const token = (aud: string) => {
      const now = Math.floor(Date.now() / 1000);
      const head = Buffer.from(
        JSON.stringify({ alg: "HS256", typ: "JWT" }),
      ).toString("base64url");
      const body = Buffer.from(
        JSON.stringify({
          sub: "owner@example.test",
          iss: "https://content.example.test",
          aud,
          scope: "private-icon:read",
          org_id: "dispatch-org",
          asset_id: id,
          iat: now,
          exp: now + 60,
        }),
      ).toString("base64url");
      const unsigned = `${head}.${body}`;
      const signature = createHmac("sha256", "example-dispatch-shared-secret")
        .update(unsigned)
        .digest("base64url");
      return `${unsigned}.${signature}`;
    };

    const withToken = (value: string) => {
      const requestEvent = event("GET");
      requestEvent.req = new Request(requestEvent.url, {
        headers: { authorization: `Bearer ${value}` },
      });
      return requestEvent;
    };

    try {
      const handler = createPrivateIconAssetsHandler();
      expect(
        (
          await handler(
            withToken(token("https://other.example.test/private-icon")),
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await handler(
            withToken(token("https://dispatch.example.test/private-icon")),
          )
        ).status,
      ).toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }
  }, 20_000);
});
