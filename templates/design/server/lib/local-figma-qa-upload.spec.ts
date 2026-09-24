import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createLocalFigmaQaPrivateBlobProvider,
  createLocalFigmaQaUploadProvider,
  isLocalFigmaQaUploadEnabled,
  localFigmaQaAssetMimeType,
  localFigmaQaAssetPath,
} from "./local-figma-qa-upload.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("local Figma QA upload provider", () => {
  it("is opt-in and can never be enabled in production", () => {
    expect(isLocalFigmaQaUploadEnabled({ NODE_ENV: "development" })).toBe(
      false,
    );
    expect(
      isLocalFigmaQaUploadEnabled({
        NODE_ENV: "development",
        AGENT_NATIVE_DESIGN_QA_LOCAL_UPLOADS: "1",
      }),
    ).toBe(true);
    expect(
      isLocalFigmaQaUploadEnabled({
        NODE_ENV: "production",
        AGENT_NATIVE_DESIGN_QA_LOCAL_UPLOADS: "1",
      }),
    ).toBe(false);
  });

  it("stores bounded images in an owner-isolated opaque path", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "design-figma-qa-"));
    roots.push(rootDir);
    const provider = createLocalFigmaQaUploadProvider({
      rootDir,
      enabled: () => true,
    });
    const bytes = new Uint8Array([137, 80, 78, 71]);

    const result = await provider.upload({
      data: bytes,
      mimeType: "image/png",
      ownerEmail: "qa@example.test",
    });
    const assetId = result.id!;
    const filepath = localFigmaQaAssetPath("qa@example.test", assetId, rootDir);

    expect(result.url).toBe(`/api/qa-figma-import-assets/${assetId}`);
    expect(filepath).not.toBeNull();
    expect(await readFile(filepath!)).toEqual(Buffer.from(bytes));
    expect(
      localFigmaQaAssetPath("other@example.test", assetId, rootDir),
    ).not.toBe(filepath);
    expect(localFigmaQaAssetMimeType(assetId)).toBe("image/png");
  });

  it("stores SVG images in the same owner-isolated QA route", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "design-figma-qa-"));
    roots.push(rootDir);
    const provider = createLocalFigmaQaUploadProvider({
      rootDir,
      enabled: () => true,
    });
    const bytes = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
    );

    const result = await provider.upload({
      data: bytes,
      mimeType: "image/svg+xml",
      filename: "sonora-play-button.svg",
      ownerEmail: "qa@example.test",
    });
    const assetId = result.id!;
    const filepath = localFigmaQaAssetPath("qa@example.test", assetId, rootDir);

    expect(result.url).toBe(`/api/qa-figma-import-assets/${assetId}`);
    expect(assetId).toMatch(/\.svg$/);
    expect(filepath).not.toBeNull();
    expect(await readFile(filepath!)).toEqual(Buffer.from(bytes));
    expect(localFigmaQaAssetMimeType(assetId)).toBe("image/svg+xml");
  });

  it("rejects missing owners, unsupported types, oversized data, and path traversal", async () => {
    const provider = createLocalFigmaQaUploadProvider({
      enabled: () => true,
    });
    await expect(
      provider.upload({ data: new Uint8Array([1]), mimeType: "image/png" }),
    ).rejects.toThrow(/authenticated owner/);
    await expect(
      provider.upload({
        data: new Uint8Array([1]),
        mimeType: "text/html",
        ownerEmail: "qa@example.test",
      }),
    ).rejects.toThrow(/image assets only/);
    await expect(
      provider.upload({
        data: new Uint8Array(16 * 1024 * 1024 + 1),
        mimeType: "image/png",
        ownerEmail: "qa@example.test",
      }),
    ).rejects.toThrow(/safe limit/);
    expect(
      localFigmaQaAssetPath("qa@example.test", "../private.png"),
    ).toBeNull();
  });

  it("round-trips private blobs and refuses ids outside its store", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "design-figma-qa-"));
    roots.push(rootDir);
    const provider = createLocalFigmaQaPrivateBlobProvider({
      rootDir,
      enabled: () => true,
    });
    const data = new TextEncoder().encode('{"files":[]}');

    const handle = await provider.put({ data, mimeType: "application/json" });
    expect((await provider.read(handle)).data).toEqual(data);
    await provider.delete(handle);
    await expect(provider.read(handle)).rejects.toThrow();
    await expect(
      provider.read({ ...handle, id: "../../etc/passwd" }),
    ).rejects.toThrow(/invalid/i);
    expect(
      createLocalFigmaQaPrivateBlobProvider({
        enabled: () => false,
      }).isConfigured(),
    ).toBe(false);
  });
});
