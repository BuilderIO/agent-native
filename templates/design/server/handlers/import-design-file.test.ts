import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  deleteAppState: vi.fn(),
  deletePrivateBlob: vi.fn(),
  getQuery: vi.fn(),
  getRequestHeader: vi.fn(),
  getSession: vi.fn(),
  importFigFileToEditableHtml: vi.fn(),
  putPrivateBlob: vi.fn(),
  readAppState: vi.fn(),
  readMultipartFormData: vi.fn(),
  readPrivateBlob: vi.fn(),
  readRawBody: vi.fn(),
  runWithRequestContext: vi.fn(),
  saveImportedDesignFiles: vi.fn(),
  setResponseStatus: vi.fn(),
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  deleteAppState: mocks.deleteAppState,
  readAppState: mocks.readAppState,
  writeAppState: mocks.writeAppState,
}));

vi.mock("@agent-native/core/private-blob", () => ({
  deletePrivateBlob: mocks.deletePrivateBlob,
  putPrivateBlob: mocks.putPrivateBlob,
  readPrivateBlob: mocks.readPrivateBlob,
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
  readRawBody: mocks.readRawBody,
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
    mocks.readAppState.mockResolvedValue(null);
    mocks.putPrivateBlob.mockImplementation(async ({ filename }) => ({
      id: filename,
      provider: "test",
    }));
    mocks.deletePrivateBlob.mockResolvedValue({ deleted: true });
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

describe("import-design-file chunked .fig uploads", () => {
  const sessions = new Map<string, Record<string, unknown>>();
  const blobs = new Map<string, Buffer>();

  beforeEach(() => {
    vi.clearAllMocks();
    sessions.clear();
    blobs.clear();
    mocks.getSession.mockResolvedValue({ email: "designer@example.com" });
    mocks.runWithRequestContext.mockImplementation(
      (_context: unknown, fn: () => unknown) => fn(),
    );
    mocks.readAppState.mockImplementation(
      async (key: string) => sessions.get(key) ?? null,
    );
    mocks.writeAppState.mockImplementation(
      async (key: string, value: Record<string, unknown>) => {
        sessions.set(key, JSON.parse(JSON.stringify(value)));
      },
    );
    mocks.deleteAppState.mockImplementation(async (key: string) => {
      sessions.delete(key);
    });
    mocks.putPrivateBlob.mockImplementation(
      async ({ data, filename }: { data: Buffer; filename: string }) => {
        blobs.set(filename, Buffer.from(data));
        return { id: filename, provider: "test" };
      },
    );
    mocks.readPrivateBlob.mockImplementation(
      async ({ id }: { id: string }) => ({ data: blobs.get(id)! }),
    );
    mocks.deletePrivateBlob.mockResolvedValue({ deleted: true });
    mocks.importFigFileToEditableHtml.mockResolvedValue({
      files: [
        {
          filename: "Page-Checkout.html",
          fileType: "html",
          content: "<!doctype html><main>Checkout</main>",
        },
      ],
      warnings: [],
      stats: { sourceKind: "fig-upload", frameCount: 1 },
    });
    mocks.saveImportedDesignFiles.mockResolvedValue({
      designId: "design-1",
      files: [{ id: "file-1", filename: "Page-Checkout.html" }],
      warnings: [],
    });
  });

  async function postChunk(
    query: Record<string, string>,
    body: Buffer,
  ): Promise<any> {
    mocks.getQuery.mockReturnValue({ designId: "design-1", ...query });
    mocks.getRequestHeader.mockReturnValue(String(body.byteLength));
    mocks.readRawBody.mockResolvedValue(body);
    return importDesignFile({} as never);
  }

  const UPLOAD_ID = "abcdef0123456789";

  it("reassembles chunks into one .fig import", async () => {
    const first = Buffer.from("fig-kiwi-");
    const second = Buffer.from("placeholder");

    const ack = await postChunk(
      {
        uploadId: UPLOAD_ID,
        index: "0",
        isFinal: "0",
        declaredSize: String(first.length + second.length),
        filename: "checkout.fig",
      },
      first,
    );
    expect(ack).toMatchObject({ uploadId: UPLOAD_ID });
    expect(mocks.importFigFileToEditableHtml).not.toHaveBeenCalled();

    const result = await postChunk(
      { uploadId: UPLOAD_ID, index: "1", isFinal: "1" },
      second,
    );

    expect(mocks.importFigFileToEditableHtml).toHaveBeenCalledWith({
      data: Buffer.from("fig-kiwi-placeholder"),
      originalName: "checkout.fig",
      ownerEmail: "designer@example.com",
    });
    expect(result).toMatchObject({ importKind: "fig", designId: "design-1" });
    // Session and parked chunks are cleaned up after a committed import.
    expect(sessions.size).toBe(0);
  });

  it("accepts a total far past the single-request wire cap", async () => {
    const size = 20 * 1024 * 1024;
    const result = await postChunk(
      {
        uploadId: UPLOAD_ID,
        index: "0",
        isFinal: "0",
        declaredSize: String(size),
        filename: "big.fig",
      },
      Buffer.alloc(1024),
    );
    expect(result).not.toHaveProperty("error");
  });

  it("refuses a declared size past the decoder cap", async () => {
    const result = await postChunk(
      {
        uploadId: UPLOAD_ID,
        index: "0",
        isFinal: "0",
        declaredSize: String(51 * 1024 * 1024),
        filename: "huge.fig",
      },
      Buffer.alloc(16),
    );
    expect(result.error).toContain("too large");
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(
      expect.anything(),
      413,
    );
  });

  it("rejects a chunk appended by a different account", async () => {
    await postChunk(
      {
        uploadId: UPLOAD_ID,
        index: "0",
        isFinal: "0",
        declaredSize: "100",
        filename: "checkout.fig",
      },
      Buffer.alloc(10),
    );
    mocks.getSession.mockResolvedValue({ email: "someone-else@example.com" });

    const result = await postChunk(
      { uploadId: UPLOAD_ID, index: "1", isFinal: "1" },
      Buffer.alloc(90),
    );

    expect(result).toEqual({
      error: "This upload belongs to a different account.",
    });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(
      expect.anything(),
      403,
    );
  });

  it("reports missing blob storage instead of returning an empty success", async () => {
    mocks.putPrivateBlob.mockResolvedValue(null);

    const result = await postChunk(
      {
        uploadId: UPLOAD_ID,
        index: "0",
        isFinal: "0",
        declaredSize: "100",
        filename: "checkout.fig",
      },
      Buffer.alloc(10),
    );

    expect(result).toMatchObject({ storageUnavailable: true });
    expect(result.error).toContain("file storage");
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(
      expect.anything(),
      503,
    );
  });

  it("fails an incomplete upload rather than importing a truncated file", async () => {
    await postChunk(
      {
        uploadId: UPLOAD_ID,
        index: "0",
        isFinal: "0",
        declaredSize: "100",
        filename: "checkout.fig",
      },
      Buffer.alloc(10),
    );

    const result = await postChunk(
      { uploadId: UPLOAD_ID, index: "1", isFinal: "1" },
      Buffer.alloc(10),
    );

    expect(result).toEqual({
      error: "Upload is incomplete or has an invalid size",
    });
    expect(mocks.importFigFileToEditableHtml).not.toHaveBeenCalled();
  });
});
