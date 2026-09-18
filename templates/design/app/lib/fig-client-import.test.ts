import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertEmbeddedImageBudget: vi.fn(),
  callAction: vi.fn(),
  convertDecodedFigToEditableHtml: vi.fn(),
  decodeFig: vi.fn(),
  convertedInput: undefined as
    | { images: Array<{ bytes: Uint8Array }> }
    | undefined,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
}));
vi.mock("../../server/lib/fig-file-decoder.js", () => ({
  decodeFig: mocks.decodeFig,
}));
vi.mock("../../shared/fig-to-frames.js", () => ({
  assertEmbeddedImageBudget: mocks.assertEmbeddedImageBudget,
  convertDecodedFigToEditableHtml: mocks.convertDecodedFigToEditableHtml,
  MAX_FIG_FRAME_HTML_BYTES: 2 * 1024 * 1024,
}));

import {
  FigClientImportError,
  importFigInBrowser,
  MAX_CLIENT_FIG_BYTES,
  MAX_CLIENT_IMAGE_BYTES,
} from "./fig-client-import";

const file = {
  name: "large.fig",
  size: 0,
  arrayBuffer: async () => new ArrayBuffer(0),
} as unknown as File;

function decoded(images: Array<{ bytes: Uint8Array }> = []) {
  return {
    format: "kiwi" as const,
    version: 124,
    document: { nodeChanges: [] },
    images,
    thumbnail: null,
  };
}

function converted(files: Array<Record<string, unknown>> = []) {
  return {
    files,
    warnings: [],
    stats: {
      sourceKind: "fig-upload" as const,
      format: "kiwi" as const,
      version: 124,
      pageCount: 1,
      frameCount: files.length,
      nodeCount: 0,
      imageCount: 0,
      uploadedImageCount: 0,
      omittedImageCount: 0,
      approximatedNodeCount: 0,
      unresolvedImageRefCount: 0,
    },
  };
}

describe("importFigInBrowser", () => {
  beforeEach(() => {
    mocks.assertEmbeddedImageBudget.mockReset();
    mocks.callAction.mockReset();
    mocks.convertDecodedFigToEditableHtml.mockReset();
    mocks.decodeFig.mockReset().mockReturnValue(decoded());
    mocks.convertedInput = undefined;
  });

  it("keeps oversized embedded images out of action payloads and warns", async () => {
    mocks.decodeFig.mockReturnValue(
      decoded([
        { bytes: new Uint8Array(MAX_CLIENT_IMAGE_BYTES) },
        { bytes: new Uint8Array(MAX_CLIENT_IMAGE_BYTES + 1) },
      ]),
    );
    mocks.convertDecodedFigToEditableHtml.mockImplementation(
      async (input: { images: Array<{ bytes: Uint8Array }> }) => {
        mocks.convertedInput = input;
        return converted();
      },
    );

    const result = await importFigInBrowser({ designId: "design-1", file });

    expect(mocks.convertedInput?.images).toHaveLength(1);
    expect(result.warnings).toEqual([]);
    expect(result.skippedEmbeddedImageCount).toBe(1);
    expect(mocks.callAction).not.toHaveBeenCalled();
    expect(mocks.convertDecodedFigToEditableHtml).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxFrameHtmlBytes: 2 * 1024 * 1024 }),
    );
  });

  it("rejects a file above the browser allocation ceiling before reading it", async () => {
    const arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(0));
    const oversizedFile = {
      name: "too-large.fig",
      size: MAX_CLIENT_FIG_BYTES + 1,
      arrayBuffer,
    } as unknown as File;

    await expect(
      importFigInBrowser({ designId: "design-1", file: oversizedFile }),
    ).rejects.toThrow(/512 MB/);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(mocks.decodeFig).not.toHaveBeenCalled();
  });

  it("checks the full embedded-image budget before transport filtering", async () => {
    const images = [{ bytes: new Uint8Array(1) }];
    mocks.decodeFig.mockReturnValue(decoded(images));
    mocks.assertEmbeddedImageBudget.mockImplementation(() => {
      throw new Error(".fig document has too much embedded image data");
    });

    await expect(
      importFigInBrowser({ designId: "design-1", file }),
    ).rejects.toThrow(/too much embedded image data/);
    expect(mocks.assertEmbeddedImageBudget).toHaveBeenCalledWith(images);
    expect(mocks.convertDecodedFigToEditableHtml).not.toHaveBeenCalled();
  });

  it("passes the preview frame selection to browser conversion", async () => {
    mocks.convertDecodedFigToEditableHtml.mockResolvedValue(converted());
    const selection = new Set(["frame-1"]);

    await importFigInBrowser({ designId: "design-1", file, selection });

    expect(mocks.convertDecodedFigToEditableHtml).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ selection }),
    );
  });

  it("cleans saved frames and marks the error before fallback can retry", async () => {
    mocks.convertDecodedFigToEditableHtml.mockResolvedValue(
      converted([
        { filename: "one.html", content: "<html>one</html>" },
        { filename: "two.html", content: "<html>two</html>" },
      ]),
    );
    mocks.callAction.mockImplementation(async (action: string) => {
      if (action === "import-design-source") {
        if (
          mocks.callAction.mock.calls.filter(
            ([name]) => name === "import-design-source",
          ).length === 1
        ) {
          return { designId: "design-1", files: [{ id: "file-1" }] };
        }
        throw new Error("second frame failed");
      }
      if (action === "delete-file") return { deleted: true };
      throw new Error(`Unexpected action: ${action}`);
    });

    const result = importFigInBrowser({ designId: "design-1", file });

    await expect(result).rejects.toBeInstanceOf(FigClientImportError);
    await expect(result).rejects.toMatchObject({
      message: "second frame failed",
      remoteMutationStarted: true,
    });
    expect(mocks.callAction).toHaveBeenCalledWith("delete-file", {
      id: "file-1",
      allowLockedLayers: true,
    });
  });
});
