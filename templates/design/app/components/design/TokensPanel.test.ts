import { describe, expect, it } from "vitest";

import {
  DESIGN_TOKEN_IMPORT_MAX_FILENAME_CHARS,
  DESIGN_TOKEN_IMPORT_MAX_FILES,
  DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES,
} from "../../../shared/design-token-import-limits";
import {
  createEmptyFilesImportResult,
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
  it("reports an all-omitted file selection without a server import", () => {
    const result = createEmptyFilesImportResult("design_1", 2);

    expect(result).toEqual({
      designId: "design_1",
      importedCount: 0,
      filesAnalyzed: [],
      omittedFileCount: 2,
      readFailureCount: 0,
    });
    expect(getTokenImportStatus(result)).toEqual({
      key: "designEditor.tokens.importedWithOmissions",
      values: { count: 0, skipped: 0, omittedTokens: 0, omittedFiles: 2 },
    });
  });

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

  it("reports unreadable files separately from skipped and limited files", () => {
    expect(
      getTokenImportStatus({
        importedCount: 1,
        omittedFileCount: 1,
        rejectedCount: 2,
        readFailureCount: 2,
        skippedCount: 1,
      }),
    ).toEqual({
      key: "designEditor.tokens.importedWithReadFailuresAndOmissions",
      values: {
        count: 1,
        skipped: 3,
        omittedTokens: 0,
        omittedFiles: 1,
        readFailures: 2,
      },
    });
  });

  it("reports unreadable files when no other items were skipped", () => {
    expect(
      getTokenImportStatus({ importedCount: 1, readFailureCount: 2 }),
    ).toEqual({
      key: "designEditor.tokens.importedWithReadFailures",
      values: { count: 1, readFailures: 2 },
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
  it("skips empty selected files before submission", async () => {
    const result = await readImportFiles([
      {
        name: "empty.json",
        size: 0,
        text: async () => "",
      } as File,
      {
        name: "tokens.json",
        size: 2,
        text: async () => "{}",
      } as File,
    ]);

    expect(result).toEqual({
      files: [{ filename: "tokens.json", content: "{}" }],
      omittedFileCount: 0,
      readFailureCount: 0,
    });
  });

  it("reports selected files beyond the client-side import cap", async () => {
    const files = Array.from(
      { length: DESIGN_TOKEN_IMPORT_MAX_FILES + 1 },
      (_, index) =>
        ({
          name: `tokens-${index}.css`,
          size: 1,
          text: async () => `:root { --spacing-gap-${index}: ${index + 1}px; }`,
        }) as File,
    );

    const result = await readImportFiles(files);

    expect(result.files).toHaveLength(DESIGN_TOKEN_IMPORT_MAX_FILES);
    expect(result.omittedFileCount).toBe(1);
  });

  it("skips an oversized file and continues with later smaller files", async () => {
    let readCount = 0;
    const content = ":root { --color-accent: #2563eb; }";
    const files = [
      {
        name: "too-large.css",
        size: DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES + 1,
        text: async () => {
          readCount += 1;
          return "too large to read";
        },
      },
      {
        name: "smaller.css",
        size: content.length,
        text: async () => {
          readCount += 1;
          return content;
        },
      },
    ] as File[];

    const result = await readImportFiles(files);

    expect(readCount).toBe(1);
    expect(result).toEqual({
      files: [{ filename: "smaller.css", content }],
      omittedFileCount: 1,
      readFailureCount: 0,
    });
  });

  it("uses a short basename for long folder paths and continues", async () => {
    let readCount = 0;
    const content = ":root { --color-accent: #2563eb; }";
    const files = [
      {
        name: "n".repeat(DESIGN_TOKEN_IMPORT_MAX_FILENAME_CHARS + 1),
        size: 1,
        text: async () => {
          readCount += 1;
          return "should not be read";
        },
      },
      {
        name: "tokens.css",
        webkitRelativePath: `${"nested/".repeat(40)}tokens.css`,
        size: 1,
        text: async () => {
          readCount += 1;
          return content;
        },
      },
      {
        name: "later.css",
        size: content.length,
        text: async () => {
          readCount += 1;
          return content;
        },
      },
    ] as File[];

    const result = await readImportFiles(files);

    expect(readCount).toBe(2);
    expect(result).toEqual({
      files: [
        { filename: "tokens.css", content },
        { filename: "later.css", content },
      ],
      omittedFileCount: 1,
      readFailureCount: 0,
    });
  });

  it("counts a failed file read and continues with readable files", async () => {
    const content = ":root { --spacing-gap: 12px; }";
    const files = [
      {
        name: "unreadable.css",
        size: 8,
        text: async () => {
          throw new Error("read failed");
        },
      },
      {
        name: "readable.css",
        size: content.length,
        text: async () => content,
      },
    ] as File[];

    const result = await readImportFiles(files);

    expect(result).toEqual({
      files: [{ filename: "readable.css", content }],
      omittedFileCount: 0,
      readFailureCount: 1,
    });
  });

  it("accepts a file at the byte budget and preserves the encoded-content cap", async () => {
    const content = "x".repeat(DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES);
    const exactLimitFile = {
      name: "at-limit.css",
      size: DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES,
      text: async () => content,
    } as File;
    const oversizedDecodedFile = {
      name: "decoded-over-limit.css",
      size: DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES,
      text: async () => "�".repeat(DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES),
    } as File;

    const exactLimitResult = await readImportFiles([exactLimitFile]);
    const decodedOverLimitResult = await readImportFiles([
      oversizedDecodedFile,
    ]);

    expect(exactLimitResult.files).toEqual([
      { filename: "at-limit.css", content },
    ]);
    expect(exactLimitResult.omittedFileCount).toBe(0);
    expect(exactLimitResult.readFailureCount).toBe(0);
    expect(decodedOverLimitResult.files).toEqual([]);
    expect(decodedOverLimitResult.omittedFileCount).toBe(1);
    expect(decodedOverLimitResult.readFailureCount).toBe(0);
  });

  it("continues after decoded content exceeds the remaining byte budget", async () => {
    const prefix = "x".repeat(DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES - 64);
    const content = ":root { --color-accent: #2563eb; }";
    const files = [
      {
        name: "prefix.txt",
        size: prefix.length,
        text: async () => prefix,
      },
      {
        name: "decoded-over-budget.txt",
        size: 25,
        text: async () => "�".repeat(25),
      },
      {
        name: "later.css",
        size: 40,
        text: async () => content,
      },
    ] as File[];

    const result = await readImportFiles(files);

    expect(result).toEqual({
      files: [
        { filename: "prefix.txt", content: prefix },
        { filename: "later.css", content },
      ],
      omittedFileCount: 1,
      readFailureCount: 0,
    });
  });
});
