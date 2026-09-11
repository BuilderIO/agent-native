import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExportPptxRun } = vi.hoisted(() => ({
  mockExportPptxRun: vi.fn(),
}));

vi.mock("./export-pptx.js", () => ({
  default: {
    run: mockExportPptxRun,
  },
}));

import action from "./export-google-slides";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mockExportPptxRun.mockResolvedValue({
    filePath: "/tmp/deck.pptx",
    filename: "deck.pptx",
    slideCount: 3,
  });
});

describe("export-google-slides", () => {
  it("returns the import dialog URL instead of a direct openurl link", async () => {
    vi.stubEnv("APP_URL", "https://workspace.example.test/slides/");
    vi.stubEnv("APP_BASE_PATH", "/slides");

    const result = await action.run({
      deckId: "deck-1",
      includeNotes: true,
    });

    expect(mockExportPptxRun).toHaveBeenCalledWith({
      deckId: "deck-1",
      includeNotes: true,
    });
    expect(result.downloadUrl).toBe(
      "https://workspace.example.test/slides/api/exports/deck.pptx",
    );
    expect(result.googleSlidesImportDialogUrl).toBe(
      "https://docs.google.com/presentation/u/0/?usp=import",
    );
    expect(result.googleSlidesImportUrl).toBe(
      result.googleSlidesImportDialogUrl,
    );
    expect(result.googleSlidesImportUrl).not.toContain("openurl");
    expect(result.googleSlidesImportUrl).not.toContain("url=");
    expect(result.note).toContain("private export URL");
  });
});
