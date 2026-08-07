import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadUserUploadedFile = vi.hoisted(() => vi.fn());
const mockPdfText = vi.hoisted(() => vi.fn());
const mockPdfScreenshot = vi.hoisted(() => vi.fn());
const mockUploadFile = vi.hoisted(() => vi.fn());
const mockStartBuilderDesignSystemIndex = vi.hoisted(() => vi.fn());
const mockGetRequestUserEmail = vi.hoisted(() => vi.fn());
const mockGetRequestOrgId = vi.hoisted(() => vi.fn());
const mockUpsertBuilderProxyDesignSystem = vi.hoisted(() => vi.fn());
const mockPdfParseOptions = vi.hoisted(() => vi.fn());
const mockPdfSetWorker = vi.hoisted(() => vi.fn());
const mockPdfDestroy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetPdfWorkerData = vi.hoisted(() =>
  vi.fn(() => "data:text/javascript;base64,d29ya2Vy"),
);
const mockCanvasFactory = vi.hoisted(() => ({
  create: vi.fn(),
  reset: vi.fn(),
  destroy: vi.fn(),
}));
const mockGetDb = vi.hoisted(() => vi.fn());
const mockEq = vi.hoisted(() => vi.fn(() => "where"));

vi.mock("pdf-parse/worker", () => ({
  CanvasFactory: mockCanvasFactory,
  getData: mockGetPdfWorkerData,
}));

vi.mock("pdf-parse", () => ({
  PDFParse: class {
    static setWorker(worker: string) {
      mockPdfSetWorker(worker);
    }

    constructor(options: unknown) {
      mockPdfParseOptions(options);
    }

    async getText() {
      return mockPdfText();
    }

    async getScreenshot(...args: unknown[]) {
      return mockPdfScreenshot(...args);
    }

    async destroy() {
      return mockPdfDestroy();
    }
  },
}));

vi.mock("./_uploaded-files.js", () => ({
  readUserUploadedFile: (...args: unknown[]) =>
    mockReadUserUploadedFile(...args),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args),
  schema: { decks: {} },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (...args: unknown[]) => mockEq(...args),
  };
});

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  startBuilderDesignSystemIndex: (...args: unknown[]) =>
    mockStartBuilderDesignSystemIndex(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: (...args: unknown[]) => mockGetRequestUserEmail(...args),
  getRequestOrgId: (...args: unknown[]) => mockGetRequestOrgId(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(),
}));

vi.mock("../server/lib/builder-design-system-proxy.js", () => ({
  upsertBuilderProxyDesignSystem: (...args: unknown[]) =>
    mockUpsertBuilderProxyDesignSystem(...args),
}));

vi.mock("./patch-deck.js", () => ({
  withDeckLock: (_deckId: string, fn: () => unknown) => fn(),
}));

import action from "./import-file";

beforeEach(() => {
  vi.clearAllMocks();
  mockPdfParseOptions.mockReset();
  mockPdfSetWorker.mockReset();
  mockPdfDestroy.mockClear();
  mockPdfScreenshot.mockReset();
  mockGetPdfWorkerData.mockClear();
  mockGetDb.mockReset();
  mockUploadFile.mockReset();
  mockReadUserUploadedFile.mockImplementation(async (filePath: string) => ({
    data: Buffer.from("%PDF-1.7\n"),
    filename: filePath,
  }));
  mockStartBuilderDesignSystemIndex.mockResolvedValue({
    ok: true,
    source: "builder",
    projectId: "project-1",
    jobId: "job-1",
    designSystemId: "ds-1",
    suggestedTitle: "brand",
    builderUrl: "https://builder.io/app/design-system-intelligence/ds-1",
    status: "in-progress",
  });
  mockGetRequestUserEmail.mockReturnValue("owner@example.com");
  mockGetRequestOrgId.mockReturnValue("org-1");
  mockUpsertBuilderProxyDesignSystem.mockResolvedValue({
    localDesignSystemId: "builder-ds-1",
    instructions: "Builder design-system indexing has started.",
  });
  mockUploadFile.mockResolvedValue({
    url: "https://files.example/source-page.png",
  });
});

describe("import-file PDF source extraction", () => {
  it("returns full page text, not only previews", async () => {
    const fullText = "A".repeat(650);
    mockPdfText.mockResolvedValue({
      pages: [{ num: 3, text: fullText }],
    });

    const result = (await action.run({
      filePath: "deck.pdf",
      format: "pdf",
    })) as any;

    expect(result).toMatchObject({
      format: "pdf",
      pageCount: 1,
      textPageCount: 1,
    });
    expect(result.pages[0].pageNum).toBe(3);
    expect(result.pages[0].text).toBe(fullText);
    expect(result.pages[0].textPreview).toBe(fullText.slice(0, 500));
    expect(result.truncated).toBe(false);
    expect(mockPdfParseOptions).toHaveBeenCalledWith({
      data: expect.any(Uint8Array),
      CanvasFactory: mockCanvasFactory,
    });
    expect(mockGetPdfWorkerData).toHaveBeenCalledOnce();
    expect(mockPdfSetWorker).toHaveBeenCalledWith(
      "data:text/javascript;base64,d29ya2Vy",
    );
    expect(mockPdfDestroy).toHaveBeenCalledOnce();
  });

  it("caps large PDF extraction output by default", async () => {
    const firstPage = "A".repeat(40_000);
    const secondPage = "B".repeat(40_000);
    mockPdfText.mockResolvedValue({
      pages: [
        { num: 1, text: firstPage },
        { num: 2, text: secondPage },
      ],
    });

    const result = (await action.run({
      filePath: "large-deck.pdf",
      format: "pdf",
    })) as any;

    expect(result.totalTextLength).toBe(80_000);
    expect(result.truncated).toBe(true);
    expect(result.note).toContain("first 60000 extracted characters");
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].text).toHaveLength(40_000);
    expect(result.pages[0].truncated).toBe(false);
    expect(result.pages[1].text).toHaveLength(20_000);
    expect(result.pages[1].truncated).toBe(true);
  });

  it("fails clearly when no PDF text can be extracted", async () => {
    mockPdfText.mockResolvedValue({
      pages: [{ num: 1, text: "   " }],
    });

    await expect(
      action.run({
        filePath: "scanned.pdf",
        format: "pdf",
      }),
    ).rejects.toThrow("No importable text found in this PDF");
  });

  it("imports complete PDF page screenshots without flattening their layout", async () => {
    mockPdfText.mockResolvedValue({
      pages: [{ num: 1, text: "Source title\nSource body" }],
    });
    mockPdfScreenshot.mockResolvedValue({
      pages: [
        {
          pageNumber: 1,
          width: 1600,
          height: 900,
          data: new Uint8Array([1, 2, 3]),
        },
      ],
    });
    const updateWhere = vi.fn().mockResolvedValue([]);
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([
              {
                id: "deck-1",
                title: "Imported deck",
                data: JSON.stringify({ slides: [] }),
              },
            ]),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: updateWhere })),
      })),
    };
    mockGetDb.mockReturnValue(db);

    const result = (await action.run({
      filePath: "source.pdf",
      format: "pdf",
      deckId: "deck-1",
      importIntoDeck: true,
    })) as any;

    expect(mockPdfScreenshot).toHaveBeenCalledWith({
      desiredWidth: 1600,
      imageBuffer: true,
      imageDataUrl: false,
    });
    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        data: Buffer.from([1, 2, 3]),
        mimeType: "image/png",
      }),
    );
    expect(result).toMatchObject({
      imported: true,
      slideCount: 1,
      aspectRatio: "16:9",
    });
    const updateCall = db.update.mock.results[0]?.value.set.mock.calls[0][0];
    const updatedDeck = JSON.parse(updateCall.data);
    const importedSlide = updatedDeck.slides[0];
    expect(importedSlide.content).toContain("object-fit: contain");
    expect(importedSlide.content).toContain(
      "https://files.example/source-page.png",
    );
    expect(importedSlide.content).not.toContain("Source title");
    expect(importedSlide.notes).toBe("Source title\nSource body");
    expect(updatedDeck.sourceImport).toMatchObject({
      mode: "source-preserving",
      format: "pdf",
      fidelity: "source-faithful",
      slideCount: 1,
      slideIds: [importedSlide.id],
    });
    expect(updatedDeck.sourceImport.slides[0].imageUrls).toEqual([
      "https://files.example/source-page.png",
    ]);
  });

  it("keeps scanned or image-only PDF pages instead of dropping them", async () => {
    mockPdfText.mockResolvedValue({ pages: [] });
    mockPdfScreenshot.mockResolvedValue({
      pages: [
        {
          pageNumber: 1,
          width: 1200,
          height: 1600,
          data: new Uint8Array([4, 5, 6]),
        },
      ],
    });
    const updateWhere = vi.fn().mockResolvedValue([]);
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([
              {
                id: "deck-1",
                title: "Scanned deck",
                data: JSON.stringify({ slides: [] }),
              },
            ]),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: updateWhere })),
      })),
    };
    mockGetDb.mockReturnValue(db);

    const result = (await action.run({
      filePath: "scanned.pdf",
      format: "pdf",
      deckId: "deck-1",
      importIntoDeck: true,
    })) as any;

    expect(result).toMatchObject({
      imported: true,
      slideCount: 1,
      aspectRatio: "4:5",
    });
    const updateCall = db.update.mock.results[0]?.value.set.mock.calls[0][0];
    const updatedDeck = JSON.parse(updateCall.data);
    expect(updatedDeck.slides).toHaveLength(1);
    expect(updatedDeck.slides[0].notes).toBe("");
    expect(updatedDeck.sourceImport.fidelity).toBe("source-faithful");
  });

  it("retains source provenance when appending to a nonempty deck", async () => {
    mockPdfText.mockResolvedValue({
      pages: [{ num: 1, text: "Appended source page" }],
    });
    mockPdfScreenshot.mockResolvedValue({
      pages: [
        {
          pageNumber: 1,
          width: 1600,
          height: 900,
          data: new Uint8Array([7, 8, 9]),
        },
      ],
    });
    const updateWhere = vi.fn().mockResolvedValue([]);
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([
              {
                id: "deck-1",
                title: "Existing deck",
                data: JSON.stringify({
                  slides: [{ id: "existing", content: "Existing" }],
                }),
              },
            ]),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: updateWhere })),
      })),
    };
    mockGetDb.mockReturnValue(db);

    await action.run({
      filePath: "append.pdf",
      format: "pdf",
      deckId: "deck-1",
      importIntoDeck: true,
    });

    const updateCall = db.update.mock.results[0]?.value.set.mock.calls[0][0];
    const updatedDeck = JSON.parse(updateCall.data);
    expect(updatedDeck.slides).toHaveLength(2);
    expect(updatedDeck.sourceImport).toMatchObject({
      format: "pdf",
      slideCount: 1,
      slideIds: [updatedDeck.slides[1].id],
    });
  });

  it("starts Builder indexing for .fig files", async () => {
    const figBuffer = Buffer.from([
      0x66, 0x69, 0x67, 0x2d, 0x6b, 0x69, 0x77, 0x69, 0, 0, 0, 0,
    ]);
    mockReadUserUploadedFile.mockResolvedValue({
      data: figBuffer,
      filename: "brand.fig",
    });

    const result = (await action.run({
      filePath: "brand.fig",
      format: "auto",
    })) as any;

    expect(mockStartBuilderDesignSystemIndex).toHaveBeenCalledWith({
      projectName: "brand",
      files: [
        {
          name: "brand.fig",
          data: figBuffer,
          mimeType: "application/octet-stream",
        },
      ],
    });
    expect(result).toMatchObject({
      format: "fig",
      title: "brand",
      source: "builder",
      projectId: "project-1",
      jobId: "job-1",
      designSystemId: "ds-1",
      localDesignSystemId: "builder-ds-1",
      builderUrl: "https://builder.io/app/design-system-intelligence/ds-1",
      status: "in-progress",
    });
    expect(result.instructions).toContain(
      "Builder design-system indexing has started",
    );
    expect(mockUpsertBuilderProxyDesignSystem).toHaveBeenCalledWith({
      result: expect.objectContaining({
        designSystemId: "ds-1",
        jobId: "job-1",
      }),
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      projectName: "brand",
      sourceKind: "figma",
    });
  });
});
