import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createLocalImportAssetUploadProvider,
  isLocalImportAssetUploadEnabled,
  localImportAssetAssetMimeType,
  localImportAssetAssetPath,
} from "./local-import-asset-upload.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createProvider() {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "design-import-assets-security-"),
  );
  roots.push(rootDir);
  return {
    rootDir,
    provider: createLocalImportAssetUploadProvider({
      rootDir,
      enabled: () => true,
    }),
  };
}

describe("local import-asset upload security contract", () => {
  it("cannot be enabled in production", () => {
    expect(
      isLocalImportAssetUploadEnabled({
        NODE_ENV: "production",
        AGENT_NATIVE_DESIGN_QA_LOCAL_UPLOADS: "true",
      }),
    ).toBe(false);
  });

  it("returns only an HTTP route reference, never a data or blob URL", async () => {
    const { provider } = await createProvider();
    const result = await provider.upload({
      data: new Uint8Array([137, 80, 78, 71]),
      mimeType: "image/png",
      ownerEmail: "qa-owner@example.test",
    });

    expect(result.url).toMatch(
      /^\/api\/qa-import-assets\/[a-f0-9-]{36}\.png$/,
    );
    expect(result.url).not.toMatch(/^(?:data|blob):/i);
    expect(result).not.toHaveProperty("data");
  });

  it("isolates identical opaque ids by owner and rejects traversal", () => {
    const assetId = "0f0f0f0f-1111-4222-8333-444444444444.png";
    const rootDir = path.join(os.tmpdir(), "design-import-assets-owner-test");
    const first = localImportAssetAssetPath(
      "first-owner@example.test",
      assetId,
      rootDir,
    );
    const second = localImportAssetAssetPath(
      "second-owner@example.test",
      assetId,
      rootDir,
    );

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).not.toBe(second);
    expect(
      localImportAssetAssetPath(
        "first-owner@example.test",
        "0f0f0f0f-1111-4222-8333-444444444444.svg",
        rootDir,
      ),
    ).not.toBeNull();
    expect(
      localImportAssetAssetPath("first-owner@example.test", "../x.png", rootDir),
    ).toBeNull();
    expect(localImportAssetAssetMimeType(assetId)).toBe("image/png");
    expect(
      localImportAssetAssetMimeType("0f0f0f0f-1111-4222-8333-444444444444.svg"),
    ).toBe("image/svg+xml");
  });

  it("accepts only bounded image MIME types", async () => {
    const { provider } = await createProvider();
    const common = { ownerEmail: "qa-owner@example.test" };

    await expect(
      provider.upload({
        ...common,
        data: new Uint8Array([1]),
        mimeType: "text/html",
      }),
    ).rejects.toThrow(/image assets only/i);
    await expect(
      provider.upload({
        ...common,
        data: new Uint8Array(16 * 1024 * 1024 + 1),
        mimeType: "image/png",
      }),
    ).rejects.toThrow(/safe limit/i);
  });
});
