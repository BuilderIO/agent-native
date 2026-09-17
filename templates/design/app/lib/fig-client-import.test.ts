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
}));

import {
  FigClientImportError,
  importFigInBrowser,
  MAX_CLIENT_IMAGE_BYTES,
} from "./fig-client-import";

const file = {
  name: "large.fig",
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
