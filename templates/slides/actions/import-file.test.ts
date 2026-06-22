import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadFile = vi.hoisted(() => vi.fn());
const mockPdfText = vi.hoisted(() => vi.fn());
const mockParseSlidesFigDesignSystem = vi.hoisted(() => vi.fn());

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      promises: {
        ...actual.default.promises,
        readFile: (...args: unknown[]) => mockReadFile(...args),
      },
    },
  };
});

vi.mock("pdf-parse", () => ({
  PDFParse: class {
    async getText() {
      return mockPdfText();
    }
  },
}));

vi.mock("./_uploaded-files.js", () => ({
  resolveUserUploadedFile: (filePath: string) => `/uploads/${filePath}`,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: vi.fn(),
  schema: { decks: {} },
}));

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: vi.fn(),
}));

vi.mock("../server/lib/fig-design-system.js", () => ({
  parseSlidesFigDesignSystem: (...args: unknown[]) =>
    mockParseSlidesFigDesignSystem(...args),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(),
}));

import action from "./import-file";

beforeEach(() => {
  vi.clearAllMocks();
  mockReadFile.mockResolvedValue(Buffer.from("%PDF-1.7\n"));
  mockParseSlidesFigDesignSystem.mockReset();
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

  it("parses .fig files into slide design-system data", async () => {
    const figBuffer = Buffer.from("fig-kiwi\0\0\0\0");
    const designSystem = {
      colors: { accent: "#ff00aa" },
      typography: {},
      spacing: {},
      borders: {},
      slideDefaults: {},
      logos: [],
    };
    mockReadFile.mockResolvedValue(figBuffer);
    mockParseSlidesFigDesignSystem.mockReturnValue({
      ok: true,
      suggestedTitle: "Brand Kit",
      data: designSystem,
      customInstructions: "Use the brand gradient.",
      preview: { gradients: [], palette: [], namedColors: {} },
    });

    const result = (await action.run({
      filePath: "brand.fig",
      format: "auto",
    })) as any;

    expect(mockParseSlidesFigDesignSystem).toHaveBeenCalledWith({
      data: figBuffer,
      filename: "brand.fig",
    });
    expect(result).toMatchObject({
      format: "fig",
      title: "Brand Kit",
      designSystem,
      customInstructions: "Use the brand gradient.",
    });
  });
});
