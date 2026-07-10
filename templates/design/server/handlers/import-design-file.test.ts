import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  getQuery: vi.fn(),
  getRequestHeader: vi.fn(),
  getSession: vi.fn(),
  importFigFileToEditableHtml: vi.fn(),
  readMultipartFormData: vi.fn(),
  runWithRequestContext: vi.fn(),
  saveImportedDesignFiles: vi.fn(),
  setResponseStatus: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: mocks.getSession,
  runWithRequestContext: mocks.runWithRequestContext,
}));

vi.mock("@agent-native/core/sharing", async (loadOriginal) => {
  const original =
    await loadOriginal<typeof import("@agent-native/core/sharing")>();
  return { ...original, assertAccess: mocks.assertAccess };
});

vi.mock("h3", () => ({
  defineEventHandler: <T>(handler: T) => handler,
  getQuery: mocks.getQuery,
  getRequestHeader: mocks.getRequestHeader,
  readMultipartFormData: mocks.readMultipartFormData,
  setResponseStatus: mocks.setResponseStatus,
}));

vi.mock("../lib/fig-file-import.js", () => ({
  importFigFileToEditableHtml: mocks.importFigFileToEditableHtml,
}));

vi.mock("../lib/import-design-files.js", () => ({
  normalizeImportedHtmlDocument: (content: string) => content,
  saveImportedDesignFiles: mocks.saveImportedDesignFiles,
}));

import { importDesignFile } from "./import-design-file.js";

describe("import-design-file .fig uploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ email: "designer@example.com" });
    mocks.runWithRequestContext.mockImplementation(
      (_context: unknown, fn: () => unknown) => fn(),
    );
    mocks.getQuery.mockReturnValue({ designId: "design-1" });
    mocks.getRequestHeader.mockReturnValue("1024");
    mocks.readMultipartFormData.mockResolvedValue([
      {
        name: "file",
        filename: "checkout.fig",
        data: Buffer.from("fig-kiwi-placeholder"),
      },
    ]);
    mocks.importFigFileToEditableHtml.mockResolvedValue({
      files: [
        {
          filename: "Page-Checkout.html",
          fileType: "html",
          content: "<!doctype html><main>Checkout</main>",
        },
      ],
      warnings: [],
      stats: {
        sourceKind: "fig-upload",
        format: "kiwi",
        pageCount: 1,
        frameCount: 1,
        nodeCount: 4,
        imageCount: 0,
        uploadedImageCount: 0,
        omittedImageCount: 0,
      },
    });
    mocks.saveImportedDesignFiles.mockResolvedValue({
      designId: "design-1",
      files: [{ id: "file-1", filename: "Page-Checkout.html" }],
      warnings: [],
    });
  });

  it("converts .fig bytes and persists only generated editable HTML", async () => {
    const result = await importDesignFile({} as never);

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design-1",
      "editor",
    );
    expect(mocks.runWithRequestContext).toHaveBeenCalledWith(
      { userEmail: "designer@example.com", orgId: undefined },
      expect.any(Function),
    );
    expect(mocks.importFigFileToEditableHtml).toHaveBeenCalledWith({
      data: Buffer.from("fig-kiwi-placeholder"),
      originalName: "checkout.fig",
      ownerEmail: "designer@example.com",
    });
    expect(mocks.saveImportedDesignFiles).toHaveBeenCalledWith({
      designId: "design-1",
      sourceType: "fig-upload",
      files: [
        expect.objectContaining({
          fileType: "html",
          content: expect.stringContaining("Checkout"),
        }),
      ],
      warnings: [],
    });
    expect(result).toMatchObject({
      importKind: "fig",
      designId: "design-1",
      stats: { sourceKind: "fig-upload", frameCount: 1 },
    });
  });

  it("keeps authentication and editor access checks in front of decoding", async () => {
    mocks.getSession.mockResolvedValue(null);

    const result = await importDesignFile({} as never);

    expect(result).toEqual({ error: "Unauthorized" });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(
      expect.anything(),
      401,
    );
    expect(mocks.importFigFileToEditableHtml).not.toHaveBeenCalled();
  });

  it("rejects unknown formats with the complete supported-type guidance", async () => {
    mocks.readMultipartFormData.mockResolvedValue([
      {
        name: "file",
        filename: "archive.zip",
        data: Buffer.from("PK"),
      },
    ]);

    const result = await importDesignFile({} as never);

    expect(result).toEqual({
      error: "Unsupported file type. Upload .html, .htm, or .fig.",
    });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(
      expect.anything(),
      400,
    );
  });
});
