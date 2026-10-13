import { describe, expect, it } from "vitest";

import {
  getTokenImportStatus,
  isColorValue,
  normalizeCssVarName,
  readImportFiles,
  snapshotImportFiles,
} from "./TokensPanel";

describe("isColorValue", () => {
  it("accepts valid hex color lengths (#rgb, #rgba, #rrggbb, #rrggbbaa)", () => {
    expect(isColorValue("#fff")).toBe(true);
    expect(isColorValue("#ffff")).toBe(true);
    expect(isColorValue("#3B82F6")).toBe(true);
    expect(isColorValue("#3B82F6FF")).toBe(true);
  });

  it("rejects malformed hex lengths instead of matching them as colors", () => {
    expect(isColorValue("#12345")).toBe(false);
    expect(isColorValue("#1234567")).toBe(false);
  });

  it("still accepts rgba/hsla/oklch/color() functional forms", () => {
    expect(isColorValue("rgba(59, 130, 246, 1)")).toBe(true);
    expect(isColorValue("hsl(217 91% 60%)")).toBe(true);
    expect(isColorValue("oklch(0.6 0.15 240)")).toBe(true);
    expect(isColorValue("color(display-p3 0.1 0.2 0.3)")).toBe(true);
  });

  it("rejects non-color token values", () => {
    expect(isColorValue("0.75rem")).toBe(false);
    expect(isColorValue("Inter, sans-serif")).toBe(false);
  });
});

describe("normalizeCssVarName", () => {
  it("adds a -- prefix when missing", () => {
    expect(normalizeCssVarName("my-token")).toBe("--my-token");
  });

  it("leaves an already-prefixed name untouched", () => {
    expect(normalizeCssVarName("--my-token")).toBe("--my-token");
  });

  it("trims surrounding whitespace before checking the prefix", () => {
    expect(normalizeCssVarName("  --foo  ")).toBe("--foo");
    expect(normalizeCssVarName("  foo  ")).toBe("--foo");
  });
});

describe("snapshotImportFiles", () => {
  it("copies selected files before clearing the input", () => {
    const selectedFile = { name: "tokens.css" } as File;
    const liveFiles = [selectedFile];
    const input = {
      get files() {
        return liveFiles as unknown as FileList;
      },
      set value(_value: string) {
        liveFiles.length = 0;
      },
    } as Pick<HTMLInputElement, "files" | "value">;

    expect(snapshotImportFiles(input)).toEqual([selectedFile]);
    expect(input.files).toHaveLength(0);
  });
});

describe("getTokenImportStatus", () => {
  it("shows skipped counts when no tokens were imported", () => {
    expect(
      getTokenImportStatus({
        importedCount: 0,
        rejectedCount: 2,
        skippedCount: 1,
      }),
    ).toEqual({
      key: "designEditor.tokens.importedWithSkipped",
      values: { count: 0, skipped: 3 },
    });
  });

  it("shows token and file counts omitted at import limits", () => {
    expect(
      getTokenImportStatus({
        importedCount: 120,
        omittedTokenCount: 3,
        omittedFileCount: 2,
      }),
    ).toEqual({
      key: "designEditor.tokens.importedWithOmissions",
      values: { count: 120, skipped: 0, omittedTokens: 3, omittedFiles: 2 },
    });
  });
});

describe("readImportFiles", () => {
  it("reports selected files beyond the client-side import cap", async () => {
    const files = Array.from(
      { length: 21 },
      (_, index) =>
        ({
          name: `tokens-${index}.css`,
          text: async () => `:root { --spacing-gap-${index}: ${index + 1}px; }`,
        }) as File,
    );

    const result = await readImportFiles(files);

    expect(result.files).toHaveLength(20);
    expect(result.omittedFileCount).toBe(1);
  });
});
