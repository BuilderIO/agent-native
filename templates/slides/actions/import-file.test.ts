import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadFile = vi.hoisted(() => vi.fn());
const mockPdfText = vi.hoisted(() => vi.fn());

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
});
