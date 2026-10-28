import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCallAction = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => mockCallAction(...args),
}));

import { SOURCE_IMPORT_NO_WRITE_ERROR_CODE } from "../../shared/source-import-errors";
import {
  IMPORT_ACTION_TIMEOUT_MS,
  importUploadedDeckIntoDeck,
} from "./import-uploaded-deck";

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
    const onImportStarted = vi.fn();
    const onImportCleanupSafe = vi.fn();

    await expect(
      importUploadedDeckIntoDeck([pptxFile], "deck-1", {
        onImportStarted,
        onImportCleanupSafe,
      }),
    ).resolves.toMatchObject({
      format: "pptx",
      slideCount: 8,
      file: pptxFile,
    });
    expect(onImportStarted).toHaveBeenCalledOnce();
    expect(onImportCleanupSafe).toHaveBeenCalledOnce();
    expect(mockCallAction).toHaveBeenCalledWith(
      "import-pptx",
      {
        filePath: pptxFile.path,
        deckId: "deck-1",
      },
      { timeoutMs: IMPORT_ACTION_TIMEOUT_MS },
    );
  });

  it("uses source-faithful page import for PDFs", async () => {
    mockCallAction.mockResolvedValue({
      imported: true,
      deckId: "deck-1",
      slideCount: 8,
    });

    await importUploadedDeckIntoDeck([pdfFile], "deck-1");

    expect(mockCallAction).toHaveBeenCalledWith(
      "import-file",
      {
        filePath: pdfFile.path,
        format: "pdf",
        deckId: "deck-1",
        importIntoDeck: true,
      },
      { timeoutMs: IMPORT_ACTION_TIMEOUT_MS },
    );
  });

  it("refuses ambiguous multi-deck uploads", async () => {
    const onImportStarted = vi.fn();

    await expect(
      importUploadedDeckIntoDeck([pptxFile, pdfFile], "deck-1", {
        onImportStarted,
      }),
    ).rejects.toThrow("Upload one presentation at a time");
    expect(onImportStarted).not.toHaveBeenCalled();
    expect(mockCallAction).not.toHaveBeenCalled();
  });

  it("stops when an import reports skipped images", async () => {
    mockCallAction.mockResolvedValue({
      imported: true,
      deckId: "deck-1",
      slideCount: 8,
      imagesSkipped: 2,
    });

    const onImportCleanupSafe = vi.fn();

    await expect(
      importUploadedDeckIntoDeck([pdfFile], "deck-1", { onImportCleanupSafe }),
    ).rejects.toThrow("could not preserve 2 image(s)");
    expect(onImportCleanupSafe).not.toHaveBeenCalled();
  });

  it("allows cleanup after a resolved empty import", async () => {
    mockCallAction.mockResolvedValue({
      imported: true,
      deckId: "deck-1",
      slideCount: 0,
    });
    const onImportStarted = vi.fn();
    const onImportCleanupSafe = vi.fn();

    await expect(
      importUploadedDeckIntoDeck([pptxFile], "deck-1", {
        onImportStarted,
        onImportCleanupSafe,
      }),
    ).rejects.toThrow("contained no importable slides");

    expect(onImportStarted).toHaveBeenCalledOnce();
    expect(onImportCleanupSafe).toHaveBeenCalledOnce();
  });

  it("leaves an import result unknown when the action fails", async () => {
    mockCallAction.mockRejectedValue(new Error("import failed"));
    const onImportStarted = vi.fn();
    const onImportCleanupSafe = vi.fn();

    await expect(
      importUploadedDeckIntoDeck([pptxFile], "deck-1", {
        onImportStarted,
        onImportCleanupSafe,
      }),
    ).rejects.toThrow("import failed");

    expect(onImportStarted).toHaveBeenCalledOnce();
    expect(onImportCleanupSafe).not.toHaveBeenCalled();
  });

  it("marks an explicit no-write action failure as a known empty import", async () => {
    mockCallAction.mockRejectedValue(
      Object.assign(new Error("No slides were written."), {
        errorCode: SOURCE_IMPORT_NO_WRITE_ERROR_CODE,
      }),
    );
    const onImportCleanupSafe = vi.fn();

    await expect(
      importUploadedDeckIntoDeck([pptxFile], "deck-1", {
        onImportCleanupSafe,
      }),
    ).rejects.toThrow("No slides were written.");

    expect(onImportCleanupSafe).toHaveBeenCalledOnce();
  });
});
