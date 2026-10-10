import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  readLiveSourceFile: vi.fn(),
  resolveAccess: vi.fn(),
  readAppState: vi.fn(),
  saveExportFile: vi.fn(),
  readDesignNativeTextureAsset: vi.fn(),
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: vi.fn(),
}));
vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
}));
vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
}));
vi.mock("@agent-native/core/tracking", () => ({ track: vi.fn() }));
vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: { designFiles: { designId: "designFiles.designId" } },
}));
vi.mock("../server/source-workspace.js", () => ({
  readLiveSourceFile: mocks.readLiveSourceFile,
  SourceWorkspaceEditConflictError: class extends Error {},
}));
vi.mock("../server/lib/design-export.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/lib/design-export.js")>()),
  trySaveExportFile: mocks.saveExportFile,
}));
vi.mock(
  "../server/lib/design-native-texture-assets.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../server/lib/design-native-texture-assets.js")
    >()),
    readDesignNativeTextureAsset: mocks.readDesignNativeTextureAsset,
  }),
);
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  readFile: vi.fn().mockResolvedValue("/* bundled runtime library */"),
}));

import {
  GRAIN_GRADIENT_EFFECT,
  HALFTONE_EFFECT,
} from "../shared/native-effect-presets.js";
import { applyNativeEffectToHtml } from "../shared/native-effects.js";
import exportHtml from "./export-html.js";
import exportSvg from "./export-svg.js";
import exportZip from "./export-zip.js";

const storedScreen =
  '<html><body><div data-agent-native-node-id="hero">Stale SQL text</div></body></html>';
const storedBoard = "<html><body></body></html>";
const files = [
  {
    id: "screen-1",
    designId: "design-1",
    filename: "index.html",
    fileType: "html",
    content: storedScreen,
  },
  {
    id: "board-1",
    designId: "design-1",
    filename: "__board__.html",
    fileType: "html",
    content: storedBoard,
  },
];

describe("export-html live source", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.resolveAccess.mockResolvedValue({
      resource: { id: "design-1", title: "Live Design" },
      role: "owner",
    });
    const query = { from: vi.fn(), where: vi.fn().mockResolvedValue(files) };
    query.from.mockReturnValue(query);
    mocks.getDb.mockReturnValue({ select: vi.fn().mockReturnValue(query) });
    mocks.readAppState.mockResolvedValue(null);
    mocks.saveExportFile.mockResolvedValue({});
  });

  it("exports live collaborative text, native effects, and board artwork instead of stale SQL", async () => {
    const applied = applyNativeEffectToHtml(
      '<html><body><div data-agent-native-node-id="hero">Live collaborative text</div></body></html>',
      {
        nodeId: "hero",
        definition: GRAIN_GRADIENT_EFFECT,
        placement: "fill",
      },
    );
    expect(applied.errors).toEqual([]);
    mocks.readLiveSourceFile.mockImplementation(async (file) => ({
      content:
        file.id === "screen-1"
          ? applied.html
          : '<html><body><div data-agent-native-node-id="board-node">Live board artwork</div></body></html>',
      versionHash: `live-${file.id}`,
      source: "collab",
      language: "html",
    }));

    const result = await exportHtml.run({ id: "design-1" });
    expect(result.html).toContain("Live collaborative text");
    expect(result.html).toContain("Live board artwork");
    expect(result.html).toContain("application/x-agent-native-effects");
    expect(result.html).toContain("data-agent-native-native-shader-runtime");
    expect(result.html).not.toContain("Stale SQL text");
    expect(result.fileCount).toBe(2);
    expect(result.nativeStaticFallback).toBe("not-captured");
    expect(mocks.readLiveSourceFile).toHaveBeenCalledWith(files[0]);
    expect(mocks.readLiveSourceFile).toHaveBeenCalledWith(files[1]);
  });

  it("reports unsupported native input assets as typed export failures", async () => {
    const applied = applyNativeEffectToHtml(
      '<html><body><div data-agent-native-node-id="hero">Live collaborative text</div></body></html>',
      {
        nodeId: "hero",
        definition: HALFTONE_EFFECT,
        placement: "layer",
        bindings: { source: { kind: "asset", url: "/shaders/gate-image.svg" } },
      },
    );
    expect(applied.errors).toEqual([]);
    mocks.readLiveSourceFile.mockImplementation(async (file) => ({
      content: file.id === "screen-1" ? applied.html : storedBoard,
      versionHash: `live-${file.id}`,
      source: "collab",
      language: "html",
    }));
    await expect(exportHtml.run({ id: "design-1" })).rejects.toMatchObject({
      errorCode: "design_export_native_asset_unsupported",
      statusCode: 422,
    });
    expect(mocks.saveExportFile).not.toHaveBeenCalled();
  });

  it("does not export stale SQL if the live collaborative source cannot be verified", async () => {
    const { SourceWorkspaceEditConflictError } =
      await import("../server/source-workspace.js");
    mocks.readLiveSourceFile.mockRejectedValue(
      new SourceWorkspaceEditConflictError("Collaboration unavailable"),
    );

    await expect(exportHtml.run({ id: "design-1" })).rejects.toMatchObject({
      errorCode: "design_export_source_conflict",
      statusCode: 409,
    });
    expect(mocks.saveExportFile).not.toHaveBeenCalled();
  });

  it("reports unreadable live HTML instead of silently substituting stale SQL", async () => {
    mocks.readLiveSourceFile.mockResolvedValue({
      content: "https://example.invalid/other-source",
      versionHash: "live-broken",
      source: "collab",
      language: "html",
    });

    await expect(exportHtml.run({ id: "design-1" })).rejects.toMatchObject({
      errorCode: "design_export_live_source_unreadable",
      statusCode: 422,
    });
    expect(mocks.saveExportFile).not.toHaveBeenCalled();
  });

  it("archives the live native source in ZIP instead of stale SQL", async () => {
    const applied = applyNativeEffectToHtml(
      '<html><body><div data-agent-native-node-id="hero">Live ZIP text</div></body></html>',
      {
        nodeId: "hero",
        definition: GRAIN_GRADIENT_EFFECT,
        placement: "fill",
      },
    );
    expect(applied.errors).toEqual([]);
    mocks.readLiveSourceFile.mockImplementation(async (file) => ({
      content: file.id === "screen-1" ? applied.html : storedBoard,
      versionHash: `live-${file.id}`,
      source: "collab",
      language: "html",
    }));

    const result = await exportZip.run({ id: "design-1" });
    const JSZip = (await import("jszip")).default;
    const archive = await JSZip.loadAsync(
      Buffer.from(result.zipBase64, "base64"),
    );
    const html = await archive.file("index.html")?.async("string");
    expect(html).toContain("Live ZIP text");
    expect(html).toContain("application/x-agent-native-effects");
    expect(html).not.toContain("Stale SQL text");
    expect(archive.file("__board__.html")).toBeNull();
  });

  it("archives exact scoped native texture bytes with the rewritten live HTML", async () => {
    const path =
      "/api/design-native-texture/12345678-1234-4123-8123-123456789abc.png";
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/hpoAAAAASUVORK5CYII=",
      "base64",
    );
    mocks.readDesignNativeTextureAsset.mockResolvedValue({
      mimeType: "image/png",
      bytes,
    });
    const applied = applyNativeEffectToHtml(
      '<html><body><div data-agent-native-node-id="hero">Live image</div></body></html>',
      {
        nodeId: "hero",
        definition: HALFTONE_EFFECT,
        placement: "layer",
        bindings: { source: { kind: "asset", url: path } },
      },
    );
    expect(applied.errors).toEqual([]);
    mocks.readLiveSourceFile.mockImplementation(async (file) => ({
      content: file.id === "screen-1" ? applied.html : storedBoard,
      versionHash: `live-${file.id}`,
      source: "collab",
      language: "html",
    }));

    const result = await exportZip.run({ id: "design-1" });
    const JSZip = (await import("jszip")).default;
    const archive = await JSZip.loadAsync(
      Buffer.from(result.zipBase64, "base64"),
    );
    expect(
      await archive
        .file("native-textures/12345678-1234-4123-8123-123456789abc.png")
        ?.async("nodebuffer"),
    ).toEqual(bytes);
    const html = await archive.file("index.html")?.async("string");
    expect(html).toContain("data-agent-native-export-assets");
    expect(html).toContain(bytes.toString("base64"));
    const metadata = await archive
      .file("agent-native-metadata/native-textures.json")
      ?.async("string");
    expect(JSON.parse(metadata ?? "null")).toMatchObject([
      {
        sourceUrl: path,
        archivePath: "native-textures/12345678-1234-4123-8123-123456789abc.png",
      },
    ]);
    expect(mocks.readDesignNativeTextureAsset).toHaveBeenCalledWith(
      path,
      1_000_000,
    );
  });

  it("places live source in the source-based SVG foreignObject", async () => {
    mocks.readLiveSourceFile.mockImplementation(async (file) => ({
      content:
        file.id === "screen-1"
          ? '<html><body><div data-agent-native-node-id="hero">Live SVG text</div></body></html>'
          : storedBoard,
      versionHash: `live-${file.id}`,
      source: "collab",
      language: "html",
    }));

    const result = await exportSvg.run({ id: "design-1" });
    expect(result.svg).toContain("Live SVG text");
    expect(result.svg).not.toContain("Stale SQL text");
    expect(result.svg).toContain("<foreignObject");
  });

  it("rejects unverifiable collaboration content in ZIP and SVG too", async () => {
    const { SourceWorkspaceEditConflictError } =
      await import("../server/source-workspace.js");
    mocks.readLiveSourceFile.mockRejectedValue(
      new SourceWorkspaceEditConflictError("Collaboration unavailable"),
    );

    await expect(exportZip.run({ id: "design-1" })).rejects.toMatchObject({
      errorCode: "design_export_source_conflict",
      statusCode: 409,
    });
    await expect(exportSvg.run({ id: "design-1" })).rejects.toMatchObject({
      errorCode: "design_export_source_conflict",
      statusCode: 409,
    });
    expect(mocks.saveExportFile).not.toHaveBeenCalled();
  });
});
