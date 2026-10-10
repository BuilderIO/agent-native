import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const mockRegisterPrivateBlobProvider = vi.hoisted(() => vi.fn());
const mockRegisterFileUploadProvider = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/private-blob", () => ({
  registerPrivateBlobProvider: mockRegisterPrivateBlobProvider,
}));

vi.mock("@agent-native/core/server", () => ({
  registerFileUploadProvider: mockRegisterFileUploadProvider,
}));

import {
  createLocalImportAssetPrivateBlobProvider,
  createLocalImportAssetUploadProvider,
  createPreviousLocalImportAssetPrivateBlobProvider,
  isLocalImportAssetUploadEnabled,
  localImportAssetAssetMimeType,
  localImportAssetAssetPath,
  localImportAssetAssetPaths,
  registerLocalImportAssetUploadProvider,
} from "./local-import-asset-upload.js";

const roots: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("local import-asset upload provider", () => {
  it("is opt-in and can never be enabled in production", () => {
    expect(isLocalImportAssetUploadEnabled({ NODE_ENV: "development" })).toBe(
      false,
    );
    expect(
      isLocalImportAssetUploadEnabled({
        NODE_ENV: "development",
        AGENT_NATIVE_DESIGN_QA_LOCAL_UPLOADS: "1",
      }),
    ).toBe(true);
    expect(
      isLocalImportAssetUploadEnabled({
        NODE_ENV: "production",
        AGENT_NATIVE_DESIGN_QA_LOCAL_UPLOADS: "1",
      }),
    ).toBe(false);
  });

  it("stores bounded images in an owner-isolated opaque path", async () => {
    const rootDir = await mkdtemp(
      path.join(os.tmpdir(), "design-import-assets-"),
    );
    roots.push(rootDir);
    const provider = createLocalImportAssetUploadProvider({
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
    const filepath = localImportAssetAssetPath(
      "qa@example.test",
      assetId,
      rootDir,
    );

    expect(result.url).toBe(`/api/qa-import-assets/${assetId}`);
    expect(filepath).not.toBeNull();
    expect(await readFile(filepath!)).toEqual(Buffer.from(bytes));
    expect(
      localImportAssetAssetPath("other@example.test", assetId, rootDir),
    ).not.toBe(filepath);
    expect(localImportAssetAssetMimeType(assetId)).toBe("image/png");
  });

  it("stores SVG images in the same owner-isolated QA route", async () => {
    const rootDir = await mkdtemp(
      path.join(os.tmpdir(), "design-import-assets-"),
    );
    roots.push(rootDir);
    const provider = createLocalImportAssetUploadProvider({
      rootDir,
      enabled: () => true,
    });
    const bytes = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
    );

    const result = await provider.upload({
      data: bytes,
      mimeType: "image/svg+xml",
      filename: "play-button-icon.svg",
      ownerEmail: "qa@example.test",
    });
    const assetId = result.id!;
    const filepath = localImportAssetAssetPath(
      "qa@example.test",
      assetId,
      rootDir,
    );

    expect(result.url).toBe(`/api/qa-import-assets/${assetId}`);
    expect(assetId).toMatch(/\.svg$/);
    expect(filepath).not.toBeNull();
    expect(await readFile(filepath!)).toEqual(Buffer.from(bytes));
    expect(localImportAssetAssetMimeType(assetId)).toBe("image/svg+xml");
  });

  it("keeps the previous local cache path available for saved assets", async () => {
    const rootDir = await mkdtemp(
      path.join(os.tmpdir(), "design-import-assets-compatibility-"),
    );
    roots.push(rootDir);
    const assetId = "0f0f0f0f-1111-4222-8333-444444444444.png";
    const currentPath = localImportAssetAssetPath(
      "qa@example.test",
      assetId,
      path.join(rootDir, "current"),
    );
    const previousPath = localImportAssetAssetPath(
      "qa@example.test",
      assetId,
      path.join(rootDir, "previous"),
    );

    expect(
      localImportAssetAssetPaths("qa@example.test", assetId, {
        rootDir: path.join(rootDir, "current"),
        legacyRootDir: path.join(rootDir, "previous"),
      }),
    ).toEqual([currentPath, previousPath]);
  });

  it("rejects missing owners, unsupported types, oversized data, and path traversal", async () => {
    const provider = createLocalImportAssetUploadProvider({
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
      localImportAssetAssetPath("qa@example.test", "../private.png"),
    ).toBeNull();
  });

  it("round-trips private blobs and refuses ids outside its store", async () => {
    const rootDir = await mkdtemp(
      path.join(os.tmpdir(), "design-import-assets-"),
    );
    roots.push(rootDir);
    const provider = createLocalImportAssetPrivateBlobProvider({
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
      createLocalImportAssetPrivateBlobProvider({
        enabled: () => false,
      }).isConfigured(),
    ).toBe(false);
  });

  it("reads private blobs saved by the previous local provider without enabling new writes", async () => {
    const rootDir = await mkdtemp(
      path.join(os.tmpdir(), "design-import-assets-compatibility-"),
    );
    roots.push(rootDir);
    const provider = createPreviousLocalImportAssetPrivateBlobProvider({
      rootDir,
      enabled: () => false,
    });
    const handle = {
      id: "0f0f0f0f-1111-4222-8333-444444444444.blob",
      provider: "design-local-figma-qa-private",
      opaque: true,
      encrypted: false,
      mimeType: "application/json",
    } as const;
    const data = new TextEncoder().encode('{"files":[]}');
    const privateDir = path.join(rootDir, "private");
    await mkdir(privateDir, { recursive: true });
    await writeFile(path.join(privateDir, handle.id), data);

    expect(provider.isConfigured()).toBe(false);
    expect((await provider.read(handle)).data).toEqual(data);
  });

  it("registers the previous provider as an inactive read fallback", () => {
    registerLocalImportAssetUploadProvider();

    const providers = mockRegisterPrivateBlobProvider.mock.calls.map(
      ([provider]) => provider as { id: string; isConfigured: () => boolean },
    );
    const previousProvider = providers.find(
      ({ id }) => id === "design-local-figma-qa-private",
    );

    expect(previousProvider).toBeDefined();
    expect(previousProvider?.isConfigured()).toBe(false);
  });
});
