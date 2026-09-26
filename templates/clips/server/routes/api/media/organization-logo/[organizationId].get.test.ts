import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  organizationId: "org-1",
  rows: [] as Array<{ brandLogoUrl: string | null }>,
  readPrivateBlob: vi.fn(),
  fetchLegacyLogo: vi.fn(),
  runWithRequestContext: vi.fn(),
  setResponseHeader: vi.fn(),
  setResponseStatus: vi.fn(),
}));

vi.mock("@agent-native/core/private-blob", () => ({
  readPrivateBlob: (...args: unknown[]) => mocks.readPrivateBlob(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (...args: [unknown, () => unknown]) =>
    mocks.runWithRequestContext(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => args,
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: () => mocks.organizationId,
  setResponseHeader: (...args: unknown[]) => mocks.setResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => mocks.setResponseStatus(...args),
}));

vi.mock("../../../../db/index.js", () => {
  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    limit: vi.fn(async () => mocks.rows),
  };
  return {
    getDb: () => ({ select: () => builder }),
    schema: {
      organizationSettings: {
        brandLogoUrl: "organization_settings.brandLogoUrl",
        organizationId: "organization_settings.organizationId",
      },
    },
  };
});

vi.mock("../../../../lib/s3-upload-provider.js", () => ({
  fetchS3OrganizationLogoByLegacyUrl: (...args: unknown[]) =>
    mocks.fetchLegacyLogo(...args),
}));

import { encodeOrganizationLogoReference } from "../../../../lib/organization-logo.js";
import handler from "./[organizationId].get";

const handle = {
  id: "clips/organization-branding/b3JnLTE/00000000-0000-4000-8000-000000000001.png",
  provider: "clips-s3-organization-logos",
  opaque: true as const,
  encrypted: false,
  mimeType: "image/png",
  metadata: {
    organizationId: "org-1",
    purpose: "organization-brand-logo",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.organizationId = "org-1";
  mocks.rows = [];
  mocks.runWithRequestContext.mockImplementation(
    (_context: unknown, operation: () => unknown) => operation(),
  );
});

describe("/api/media/organization-logo/:organizationId", () => {
  it("serves only the saved opaque logo handle with public image headers", async () => {
    mocks.rows = [{ brandLogoUrl: encodeOrganizationLogoReference(handle) }];
    mocks.readPrivateBlob.mockResolvedValue({
      data: new TextEncoder().encode("png"),
      mimeType: "image/png",
      handle,
    });

    await expect(handler({} as any)).resolves.toEqual(
      new TextEncoder().encode("png"),
    );
    expect(mocks.runWithRequestContext).toHaveBeenCalledWith(
      { orgId: "org-1" },
      expect.any(Function),
    );
    expect(mocks.readPrivateBlob).toHaveBeenCalledWith(handle);
    expect(mocks.setResponseHeader).toHaveBeenCalledWith(
      {},
      "Content-Type",
      "image/png",
    );
    expect(mocks.setResponseHeader).toHaveBeenCalledWith(
      {},
      "X-Content-Type-Options",
      "nosniff",
    );
    expect(mocks.setResponseHeader).toHaveBeenCalledWith(
      {},
      "Cache-Control",
      "public, max-age=300",
    );
  });

  it("returns 404 for missing logos instead of an empty successful response", async () => {
    await expect(handler({} as any)).resolves.toEqual({
      error: "Organization logo not found",
    });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith({}, 404);
    expect(mocks.readPrivateBlob).not.toHaveBeenCalled();
  });

  it("keeps legacy S3 object misses visible through the stable endpoint", async () => {
    const legacyUrl =
      "https://old-storage.example/clips/logo-abc123/1722720000000-abcd1234.png";
    mocks.rows = [{ brandLogoUrl: legacyUrl }];
    mocks.fetchLegacyLogo.mockResolvedValue(
      new Response(null, { status: 404 }),
    );

    await expect(handler({} as any)).resolves.toEqual({
      error: "Stored organization logo is unavailable",
    });
    expect(mocks.fetchLegacyLogo).toHaveBeenCalledWith(legacyUrl, "org-1");
    expect(mocks.setResponseStatus).toHaveBeenCalledWith({}, 404);
  });

  it("serves legacy logos with unknown content length when within the limit", async () => {
    const legacyUrl =
      "https://old-storage.example/clips/logo-abc123/1722720000000-abcd1234.png";
    mocks.rows = [{ brandLogoUrl: legacyUrl }];
    mocks.fetchLegacyLogo.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("png"));
            controller.close();
          },
        }),
        { headers: { "content-type": "image/png" } },
      ),
    );

    await expect(handler({} as any)).resolves.toEqual(
      new TextEncoder().encode("png"),
    );
    expect(mocks.setResponseHeader).toHaveBeenCalledWith(
      {},
      "Content-Type",
      "image/png",
    );
  });

  it("cancels legacy logo streams once their unknown-length body exceeds the limit", async () => {
    const legacyUrl =
      "https://old-storage.example/clips/logo-abc123/1722720000000-abcd1234.png";
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(5 * 1024 * 1024));
          controller.enqueue(new Uint8Array(1));
        },
        cancel,
      }),
      { headers: { "content-type": "image/png" } },
    );
    const arrayBuffer = vi.spyOn(response, "arrayBuffer");
    mocks.rows = [{ brandLogoUrl: legacyUrl }];
    mocks.fetchLegacyLogo.mockResolvedValue(response);

    await expect(handler({} as any)).resolves.toEqual({
      error: "Stored organization logo exceeds the size limit",
    });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith({}, 502);
    expect(cancel).toHaveBeenCalledOnce();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("returns 503 when current storage configuration is unavailable", async () => {
    mocks.rows = [
      {
        brandLogoUrl:
          "https://old-storage.example/clips/logo-abc123/1722720000000-abcd1234.png",
      },
    ];
    mocks.fetchLegacyLogo.mockRejectedValue(
      Object.assign(new Error("S3 credentials are not configured"), {
        statusCode: 503,
      }),
    );

    await expect(handler({} as any)).resolves.toEqual({
      error: "Organization logo storage is unavailable",
    });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith({}, 503);
  });
});
