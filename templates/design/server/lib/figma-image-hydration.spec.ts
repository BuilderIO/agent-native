/**
 * figma-image-hydration.spec.ts
 *
 * Covers the token-free `.fig` hydration path:
 *  - resolveFigImageHashes: only requested hashes present in the .fig are
 *    uploaded and mapped; absent hashes are skipped.
 *  - hydrateFileImagesFromFig: end-to-end load → collect → match → persist.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decodeFig: vi.fn(),
  uploadFile: vi.fn(),
  assertAccess: vi.fn(),
  accessFilter: vi.fn(() => "access-filter-sentinel"),
  readLiveSourceFile: vi.fn(),
  writeInlineSourceFile: vi.fn(),
  agentEnterDocument: vi.fn(),
  agentLeaveDocument: vi.fn(),
  mutateDesignData: vi.fn(),
}));

vi.mock("./fig-file-decoder.js", () => ({ decodeFig: mocks.decodeFig }));
vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: mocks.uploadFile,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
  accessFilter: mocks.accessFilter,
}));
vi.mock("@agent-native/core/collab", () => ({
  agentEnterDocument: mocks.agentEnterDocument,
  agentLeaveDocument: mocks.agentLeaveDocument,
}));
vi.mock("../source-workspace.js", () => ({
  readLiveSourceFile: mocks.readLiveSourceFile,
  writeInlineSourceFile: mocks.writeInlineSourceFile,
}));
vi.mock("./design-data-mutation.js", () => ({
  mutateDesignData: mocks.mutateDesignData,
}));

let dbRows: unknown[] = [];
vi.mock("../db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: () => Promise.resolve(dbRows) }),
        }),
      }),
    }),
  }),
  schema: {
    designFiles: {
      id: "id",
      designId: "designId",
      filename: "filename",
      fileType: "fileType",
      content: "content",
    },
    designs: { id: "id", data: "data" },
    designShares: {},
  },
}));

import {
  hydrateFileImagesFromFig,
  indexFigImages,
  resolveFigImageHashes,
} from "./figma-image-hydration.js";

const FIG_BYTES = Buffer.from("fake-fig-bytes");

function figWithImages(images: Array<{ hash: string; ext: string }>): {
  document: unknown;
  images: Array<{ hash: string; ext: string; bytes: Buffer }>;
} {
  return {
    document: {},
    images: images.map((i) => ({ ...i, bytes: Buffer.from(i.hash) })),
  };
}

// The decode-once index the handler now builds and hands to the resolvers.
function figImageMap(
  images: Array<{ hash: string; ext: string }>,
): Map<string, { hash: string; ext: string; bytes: Buffer }> {
  const map = new Map<string, { hash: string; ext: string; bytes: Buffer }>();
  for (const i of images) map.set(i.hash, { ...i, bytes: Buffer.from(i.hash) });
  return map;
}

describe("indexFigImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("decodes the .fig once and indexes its images by SHA-1 hash", () => {
    mocks.decodeFig.mockReturnValue(
      figWithImages([
        { hash: "aaa", ext: "png" },
        { hash: "bbb", ext: "jpg" },
      ]),
    );

    const index = indexFigImages(FIG_BYTES);

    expect(mocks.decodeFig).toHaveBeenCalledTimes(1);
    expect(index.size).toBe(2);
    expect(index.get("aaa")).toMatchObject({ hash: "aaa", ext: "png" });
    expect(index.get("bbb")).toMatchObject({ hash: "bbb", ext: "jpg" });
  });
});

describe("resolveFigImageHashes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.uploadFile.mockImplementation(
      async ({ filename }: { filename: string }) => ({
        url: `https://cdn.example.com/${filename}`,
      }),
    );
  });

  it("uploads only requested hashes present in the .fig and maps them", async () => {
    const resolved = await resolveFigImageHashes({
      figImages: figImageMap([
        { hash: "aaa", ext: "png" },
        { hash: "bbb", ext: "jpg" },
      ]),
      hashes: ["aaa", "ccc"], // ccc is not embedded
      ownerEmail: "user@example.com",
    });

    expect(resolved.get("aaa")).toBe("https://cdn.example.com/figma-aaa.png");
    expect(resolved.has("ccc")).toBe(false);
    expect(resolved.has("bbb")).toBe(false); // not requested
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1);
    expect(mocks.uploadFile.mock.calls[0]![0].mimeType).toBe("image/png");
  });

  it("returns an empty map when no requested hash is embedded", async () => {
    const resolved = await resolveFigImageHashes({
      figImages: figImageMap([{ hash: "zzz", ext: "png" }]),
      hashes: ["aaa"],
      ownerEmail: "user@example.com",
    });
    expect(resolved.size).toBe(0);
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it("skips an image whose upload fails without failing the batch", async () => {
    mocks.uploadFile.mockImplementation(
      async ({ filename }: { filename: string }) => {
        if (filename.includes("bad")) throw new Error("storage down");
        return { url: `https://cdn.example.com/${filename}` };
      },
    );
    const resolved = await resolveFigImageHashes({
      figImages: figImageMap([
        { hash: "ok1", ext: "png" },
        { hash: "bad", ext: "png" },
      ]),
      hashes: ["ok1", "bad"],
      ownerEmail: "user@example.com",
    });
    expect(resolved.get("ok1")).toContain("figma-ok1.png");
    expect(resolved.has("bad")).toBe(false);
  });
});

describe("hydrateFileImagesFromFig", () => {
  const HTML_WITH_REF =
    '<div data-figma-image-ref="aaa" style="background-image: url(\'about:blank\');">x</div>';

  const ROW = {
    id: "file-1",
    designId: "design-1",
    filename: "Screen.html",
    fileType: "html",
    content: HTML_WITH_REF,
    designData: JSON.stringify({
      screenMetadata: { "file-1": { unresolvedImageRefs: ["aaa"] } },
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    dbRows = [ROW];
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.readLiveSourceFile.mockResolvedValue({
      content: HTML_WITH_REF,
      versionHash: "v1",
    });
    mocks.writeInlineSourceFile.mockResolvedValue({
      versionHash: "v2",
      changed: true,
      updatedAt: "",
    });
    mocks.mutateDesignData.mockResolvedValue({ data: {}, updatedAt: "" });
    mocks.uploadFile.mockImplementation(
      async ({ filename }: { filename: string }) => ({
        url: `https://cdn.example.com/${filename}`,
      }),
    );
  });

  it("fills a placeholder from the .fig and persists the hydrated HTML", async () => {
    const result = await hydrateFileImagesFromFig({
      fileId: "file-1",
      figImages: figImageMap([{ hash: "aaa", ext: "png" }]),
      ownerEmail: "user@example.com",
    });

    expect(result).toMatchObject({ fileId: "file-1", resolved: 1, missing: 0 });
    const written = mocks.writeInlineSourceFile.mock.calls[0]![0]
      .content as string;
    expect(written).toContain("cdn.example.com/figma-aaa.png");
    expect(written).not.toContain("about:blank");
    expect(written).not.toContain("data-figma-image-ref");
    expect(mocks.agentEnterDocument).toHaveBeenCalledWith("file-1");
    expect(mocks.agentLeaveDocument).toHaveBeenCalledWith("file-1");
  });

  it("does not write when the .fig has none of the referenced images", async () => {
    const result = await hydrateFileImagesFromFig({
      fileId: "file-1",
      figImages: figImageMap([{ hash: "zzz", ext: "png" }]),
      ownerEmail: "user@example.com",
    });

    expect(result).toMatchObject({ resolved: 0, missing: 1 });
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
    expect(mocks.mutateDesignData).not.toHaveBeenCalled();
  });

  it("returns early with no refs when the screen has no placeholders", async () => {
    dbRows = [{ ...ROW, content: "<div>clean</div>" }];
    mocks.readLiveSourceFile.mockResolvedValue({
      content: "<div>clean</div>",
      versionHash: "v1",
    });

    const result = await hydrateFileImagesFromFig({
      fileId: "file-1",
      figImages: figImageMap([{ hash: "aaa", ext: "png" }]),
      ownerEmail: "user@example.com",
    });

    expect(result).toMatchObject({ resolved: 0, missing: 0, skipped: 0 });
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
  });

  it("throws File not found for a missing row", async () => {
    dbRows = [];
    await expect(
      hydrateFileImagesFromFig({
        fileId: "nope",
        figImages: figImageMap([{ hash: "aaa", ext: "png" }]),
        ownerEmail: "user@example.com",
      }),
    ).rejects.toThrow("File not found");
  });
});
