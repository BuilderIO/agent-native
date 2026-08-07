import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCallAction = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => mockCallAction(...args),
}));

import { importUploadedDeckIntoDeck } from "./import-uploaded-deck";

const pptxFile = {
  path: "/uploads/source.pptx",
  originalName: "source.pptx",
  filename: "source.pptx",
  type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  size: 1024,
};

const pdfFile = {
  path: "/uploads/source.pdf",
  originalName: "source.pdf",
  filename: "source.pdf",
  type: "application/pdf",
  size: 1024,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("importUploadedDeckIntoDeck", () => {
  it("imports one PPTX into the target before generation", async () => {
    mockCallAction.mockResolvedValue({
      imported: true,
      deckId: "deck-1",
      slideCount: 8,
    });

    await expect(
      importUploadedDeckIntoDeck([pptxFile], "deck-1"),
    ).resolves.toMatchObject({
      format: "pptx",
      slideCount: 8,
      file: pptxFile,
    });
    expect(mockCallAction).toHaveBeenCalledWith("import-pptx", {
      filePath: pptxFile.path,
      deckId: "deck-1",
    });
  });

  it("uses source-faithful page import for PDFs", async () => {
    mockCallAction.mockResolvedValue({
      imported: true,
      deckId: "deck-1",
      slideCount: 8,
    });

    await importUploadedDeckIntoDeck([pdfFile], "deck-1");

    expect(mockCallAction).toHaveBeenCalledWith("import-file", {
      filePath: pdfFile.path,
      format: "pdf",
      deckId: "deck-1",
      importIntoDeck: true,
    });
  });

  it("refuses ambiguous multi-deck uploads", async () => {
    await expect(
      importUploadedDeckIntoDeck([pptxFile, pdfFile], "deck-1"),
    ).rejects.toThrow("Upload one presentation at a time");
    expect(mockCallAction).not.toHaveBeenCalled();
  });

  it("stops when an import reports skipped images", async () => {
    mockCallAction.mockResolvedValue({
      imported: true,
      deckId: "deck-1",
      slideCount: 8,
      imagesSkipped: 2,
    });

    await expect(
      importUploadedDeckIntoDeck([pptxFile], "deck-1"),
    ).rejects.toThrow("could not preserve 2 image(s)");
  });
});
