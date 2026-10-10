import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  registerFileUploadProvider,
  unregisterFileUploadProvider,
} from "@agent-native/core/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HALFTONE_EFFECT } from "../../shared/native-effect-presets";
import { applyNativeEffectToHtml } from "../../shared/native-effects";
import {
  ExportAssetError,
  loadPublicExportAssets,
  processExportAssetReferences,
} from "./design-export-assets";
import {
  createLocalFigmaQaUploadProvider,
  localFigmaQaAssetPath,
} from "./local-figma-qa-upload";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("standalone export assets", () => {
  it("embeds an exact hosted uploaded image URL while rejecting unowned and mismatched bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "design-export-hosted-"));
    temporaryDirectories.push(directory);
    const publicDirectory = join(directory, "public");
    await mkdir(publicDirectory);
    const url = "https://assets.example.test/uploads/one.png";
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const read = vi.fn(async () => ({ data: bytes, mimeType: "image/png" }));
    registerFileUploadProvider({
      id: "design-export-hosted-test",
      name: "Test hosted assets",
      isConfigured: () => true,
      isOwnedUrl: (candidate) => candidate === url,
      upload: vi.fn(),
      read,
    });
    try {
      const file = {
        filename: "index.html",
        fileType: "html",
        content: `<html><body><img src="${url}"></body></html>`,
      };
      const scanned = processExportAssetReferences([file]);
      expect(scanned.references.externalUrls).toEqual([url]);
      const assets = await loadPublicExportAssets(
        publicDirectory,
        scanned.references.externalUrls,
        { ownerEmail: "owner@example.test" },
      );
      expect(read).toHaveBeenCalledWith({
        url,
        ownerEmail: "owner@example.test",
        maxBytes: 1_000_000,
        signal: expect.any(AbortSignal),
      });
      expect(
        processExportAssetReferences([file], assets).files[0].content,
      ).toContain(
        `src="data:image/png;base64,${Buffer.from(bytes).toString("base64")}"`,
      );
      read.mockResolvedValueOnce({
        data: new Uint8Array([1, 2]),
        mimeType: "image/png",
      });
      await expect(
        loadPublicExportAssets(publicDirectory, [url], {
          ownerEmail: "owner@example.test",
        }),
      ).rejects.toMatchObject({ code: "unsupported" });
      await expect(
        loadPublicExportAssets(
          publicDirectory,
          ["https://elsewhere.example.test/a.png"],
          {
            ownerEmail: "owner@example.test",
          },
        ),
      ).rejects.toMatchObject({ code: "unsupported" });
    } finally {
      unregisterFileUploadProvider("design-export-hosted-test");
    }
  });

  it("bundles the owner-scoped QA upload URL for DOM and native inputs without a network fetch", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AGENT_NATIVE_DESIGN_QA_LOCAL_UPLOADS", "true");
    const directory = await mkdtemp(join(tmpdir(), "design-export-qa-"));
    temporaryDirectories.push(directory);
    const publicDirectory = join(directory, "public");
    await mkdir(publicDirectory);
    const bytes = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1,
      0, 0, 0, 1,
    ]);
    const provider = createLocalFigmaQaUploadProvider({
      rootDir: directory,
      enabled: () => true,
    });
    const uploaded = await provider.upload({
      data: bytes,
      mimeType: "image/png",
      ownerEmail: "owner@example.test",
    });
    const source = applyNativeEffectToHtml(
      `<html><body><img src="${uploaded.url}" data-agent-native-node-id="hero"></body></html>`,
      {
        nodeId: "hero",
        definition: HALFTONE_EFFECT,
        placement: "layer",
        bindings: { source: { kind: "asset", url: uploaded.url } },
      },
    );
    expect(source.errors).toEqual([]);
    const file = {
      filename: "index.html",
      fileType: "html",
      content: source.html,
    };
    const scanned = processExportAssetReferences([file]);
    expect(scanned.references.localPaths).toEqual([uploaded.url]);
    const assets = await loadPublicExportAssets(
      publicDirectory,
      scanned.references.localPaths,
      {
        ownerEmail: "owner@example.test",
        qaRootDir: directory,
      },
    );
    expect(assets[uploaded.url].bytes).toEqual(bytes);
    const bundled = processExportAssetReferences([file], assets).files[0]
      .content!;
    expect(bundled).toContain(
      `src="data:image/png;base64,${Buffer.from(bytes).toString("base64")}"`,
    );
    expect(bundled.match(/data-agent-native-export-assets/g)).toHaveLength(1);
    expect(bundled).toContain(`"path":"${uploaded.url}"`);
    await expect(
      loadPublicExportAssets(publicDirectory, [uploaded.url], {
        ownerEmail: "other@example.test",
        qaRootDir: directory,
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
    await expect(
      loadPublicExportAssets(publicDirectory, [uploaded.url], {
        qaRootDir: directory,
      }),
    ).rejects.toMatchObject({ code: "invalid-reference" });
  });

  it("rejects forged local QA image signatures and symlinks leaving the owner directory", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AGENT_NATIVE_DESIGN_QA_LOCAL_UPLOADS", "true");
    const directory = await mkdtemp(join(tmpdir(), "design-export-qa-"));
    temporaryDirectories.push(directory);
    const publicDirectory = join(directory, "public");
    await mkdir(publicDirectory);
    const provider = createLocalFigmaQaUploadProvider({
      rootDir: directory,
      enabled: () => true,
    });
    const uploaded = await provider.upload({
      data: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
      ownerEmail: "owner@example.test",
    });
    await expect(
      loadPublicExportAssets(publicDirectory, [uploaded.url], {
        ownerEmail: "owner@example.test",
        qaRootDir: directory,
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
    const path = localFigmaQaAssetPath(
      "owner@example.test",
      uploaded.id!,
      directory,
    )!;
    await rm(path);
    const outside = join(directory, "outside.png");
    await writeFile(
      outside,
      new Uint8Array([
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0,
        1, 0, 0, 0, 1,
      ]),
    );
    await symlink(outside, path);
    await expect(
      loadPublicExportAssets(publicDirectory, [uploaded.url], {
        ownerEmail: "owner@example.test",
        qaRootDir: directory,
      }),
    ).rejects.toMatchObject({ code: "invalid-reference" });
  });
  it("finds and bundles actual image and CSS font references without rewriting text or scripts", () => {
    const source = `<html><head><style>
      @font-face { src: url('/fonts/display.woff2'); }
      .card { background: url(../art/hero.svg); }
    </style></head><body>
      <img src="/art/hero.svg" alt="Hero">
      <p>/art/hero.svg remains prose</p>
      <script>const original = '/art/hero.svg'</script>
    </body></html>`;
    const file = {
      filename: "screens/index.html",
      fileType: "html",
      content: source,
    };
    const scanned = processExportAssetReferences([file]);
    expect(scanned.references.localPaths).toEqual([
      "/fonts/display.woff2",
      "/art/hero.svg",
    ]);
    const bundled = processExportAssetReferences([file], {
      "/fonts/display.woff2": {
        mimeType: "font/woff2",
        bytes: new Uint8Array([1, 2, 3]),
      },
      "/art/hero.svg": {
        mimeType: "image/svg+xml",
        bytes: new TextEncoder().encode("<svg></svg>"),
      },
    }).files[0].content!;
    expect(bundled).toContain("data:font/woff2;base64,AQID");
    expect(bundled).toContain("data:image/svg+xml;base64,");
    expect(bundled).toContain("<p>/art/hero.svg remains prose</p>");
    expect(bundled).toContain("const original = '/art/hero.svg'");
  });

  it("rejects path traversal, malformed escapes, and executable URL schemes", () => {
    for (const reference of [
      "../secret.svg",
      "/%2e%2e/secret.svg",
      "/%XX.svg",
      "javascript:alert(1)",
    ]) {
      expect(() =>
        processExportAssetReferences([
          {
            filename: "index.html",
            fileType: "html",
            content: `<img src="${reference}">`,
          },
        ]),
      ).toThrow(ExportAssetError);
    }
  });

  it("reads bounded local assets and blocks a symlink outside public", async () => {
    const directory = await mkdtemp(join(tmpdir(), "design-export-assets-"));
    temporaryDirectories.push(directory);
    const publicDirectory = join(directory, "public");
    await mkdir(join(publicDirectory, "fonts"), { recursive: true });
    await writeFile(
      join(publicDirectory, "fonts", "display.woff2"),
      new Uint8Array([1, 2, 3]),
    );
    await writeFile(
      join(publicDirectory, "fonts", "LICENSE_FONT"),
      "Example font copyright and license",
    );
    await writeFile(
      join(publicDirectory, "fonts", "LICENSE_OTHER"),
      "Second adjacent font notice",
    );
    const assets = await loadPublicExportAssets(publicDirectory, [
      "/fonts/display.woff2",
    ]);
    expect(assets["/fonts/display.woff2"].mimeType).toBe("font/woff2");
    expect([...assets["/fonts/display.woff2"].bytes]).toEqual([1, 2, 3]);
    expect(assets["/fonts/display.woff2"].licenseText).toContain(
      "Example font copyright and license",
    );
    expect(assets["/fonts/display.woff2"].licenseText).toContain(
      "Second adjacent font notice",
    );
    await writeFile(join(directory, "outside.svg"), "<svg></svg>");
    await symlink(
      join(directory, "outside.svg"),
      join(publicDirectory, "fonts", "LICENSE_ESCAPE"),
    );
    await expect(
      loadPublicExportAssets(publicDirectory, ["/fonts/display.woff2"]),
    ).rejects.toThrow("escapes public root");
    await symlink(
      join(directory, "outside.svg"),
      join(publicDirectory, "outside.svg"),
    );
    await expect(
      loadPublicExportAssets(publicDirectory, ["/outside.svg"]),
    ).rejects.toThrow("escapes public root");
  });
});
