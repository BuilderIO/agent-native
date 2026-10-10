import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLocalFigmaQaPrivateBlobProvider,
  createLocalFigmaQaUploadProvider,
  isLocalFigmaQaUploadEnabled,
  localFigmaQaAssetMimeType,
  localFigmaQaAssetPath,
  readLocalFigmaQaAssetForExport,
} from "./local-figma-qa-upload.js";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
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

  it("reads only valid owner bytes and separates missing, escape, and unreadable storage", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AGENT_NATIVE_DESIGN_QA_LOCAL_UPLOADS", "1");
    const rootDir = await mkdtemp(
      path.join(os.tmpdir(), "design-figma-qa-read-"),
    );
    roots.push(rootDir);
    const owner = "qa@example.test";
    const otherOwner = "other@example.test";
    const provider = createLocalFigmaQaUploadProvider({
      rootDir,
      enabled: () => true,
    });
    const bytes = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Xq8AAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const stored = await provider.upload({
      data: bytes,
      mimeType: "image/png",
      ownerEmail: owner,
    });
    expect(
      await readLocalFigmaQaAssetForExport(stored.url!, owner, { rootDir }),
    ).toEqual({ mimeType: "image/png", bytes });
    await expect(
      readLocalFigmaQaAssetForExport(stored.url!, otherOwner, { rootDir }),
    ).rejects.toMatchObject({ code: "unavailable" });

    const escapedId = "12345678-1234-4123-8123-123456789abc.png";
    const escapedPath = localFigmaQaAssetPath(owner, escapedId, rootDir)!;
    const outside = path.join(rootDir, "outside.png");
    await writeFile(outside, bytes);
    await symlink(outside, escapedPath);
    await expect(
      readLocalFigmaQaAssetForExport(
        `/api/qa-figma-import-assets/${escapedId}`,
        owner,
        { rootDir },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });

    const loopId = "12345678-1234-4123-8123-123456789abd.png";
    const loopPath = localFigmaQaAssetPath(owner, loopId, rootDir)!;
    await symlink(loopPath, loopPath);
    await expect(
      readLocalFigmaQaAssetForExport(
        `/api/qa-figma-import-assets/${loopId}`,
        owner,
        { rootDir },
      ),
    ).rejects.toMatchObject({ code: "unreadable" });
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
    await expect(provider.read(handle)).rejects.toMatchObject({
      kind: "not_found",
    });
    await mkdir(path.join(rootDir, "private", handle.id));
    await expect(provider.read(handle)).rejects.toMatchObject({
      kind: "unavailable",
    });
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
