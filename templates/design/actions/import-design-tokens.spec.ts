import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const designStore = vi.hoisted(() => ({
  row: {
    id: "design_1",
    data: "{}",
    updatedAt: "2026-07-09T00:00:00.000Z",
  },
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: () => "agent-native://design/editor?designId=design_1",
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ kind: "and", conditions })),
  asc: vi.fn((column) => ({ kind: "asc", column })),
  eq: vi.fn(() => ({ kind: "eq" })),
  inArray: vi.fn((column, values) => ({ kind: "inArray", column, values })),
  isNull: vi.fn(() => ({ kind: "isNull" })),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("../server/db/index.js", () => {
  const schema = {
    designFiles: {
      id: "id",
      designId: "designId",
      filename: "filename",
      content: "content",
    },
    designs: {
      id: "id",
      data: "data",
      updatedAt: "updatedAt",
    },
  };
  const db = {
    select: (...args: unknown[]) => {
      mockSelect(...args);
      const selection = args[0] as Record<string, unknown> | undefined;
      const needsCandidatePaging = Boolean(
        selection && Object.hasOwn(selection, "contentBytes"),
      );
      return {
        from: (table: unknown) => {
          mockFrom(table);
          return {
            where: (...whereArgs: unknown[]) => {
              if (table === schema.designFiles) {
                const rows = mockWhere(...whereArgs);
                if (
                  whereArgs.some(
                    (condition) =>
                      (condition as { kind?: string } | undefined)?.kind ===
                      "inArray",
                  )
                ) {
                  return rows;
                }
                if (!needsCandidatePaging) return rows;
                return {
                  orderBy: (...orderByArgs: unknown[]) => {
                    mockOrderBy(...orderByArgs);
                    return {
                      limit: async (limit: number) => {
                        mockLimit(limit);
                        return rows;
                      },
                    };
                  },
                };
              }
              return Promise.resolve([{ ...designStore.row }]);
            },
          };
        },
      };
    },
    update: (...args: unknown[]) => {
      mockUpdate(...args);
      return {
        set: (values: { data: string; updatedAt: string }) => {
          mockSet(values);
          return {
            where: async () => {
              designStore.row = { ...designStore.row, ...values };
            },
          };
        },
      };
    },
  };
  return {
    getDb: () => ({
      ...db,
      transaction: <T>(callback: (tx: typeof db) => Promise<T>) => callback(db),
    }),
    schema,
  };
});

import {
  DESIGN_TOKEN_IMPORT_MAX_BODY_BYTES,
  DESIGN_TOKEN_IMPORT_MAX_FILES,
  DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES,
} from "../shared/design-token-import-limits.js";
import action from "./import-design-tokens.js";

describe("import-design-tokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertAccess.mockResolvedValue(undefined);
    mockWhere.mockResolvedValue([]);
    designStore.row = {
      id: "design_1",
      data: JSON.stringify({
        tweaks: [
          {
            id: "accent",
            label: "Accent",
            type: "color-swatch",
            defaultValue: "#0ea5e9",
            cssVar: "--color-accent",
          },
        ],
        tweakSelections: {},
      }),
      updatedAt: "2026-07-09T00:00:00.000Z",
    };
  });

  it("bounds file count, raw names, and content before action execution", () => {
    const tooManyFiles = action.schema.safeParse({
      designId: "design_1",
      source: "files",
      files: Array.from(
        { length: DESIGN_TOKEN_IMPORT_MAX_FILES + 1 },
        (_, index) => ({ filename: `tokens-${index}.css`, content: "" }),
      ),
    });
    const oversizedFile = action.schema.safeParse({
      designId: "design_1",
      source: "files",
      files: [
        {
          filename: "tokens.css",
          content: "x".repeat(DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES + 1),
        },
      ],
    });
    const oversizedFilename = action.schema.safeParse({
      designId: "design_1",
      source: "files",
      files: [{ filename: `a${" ".repeat(256)}`, content: "" }],
    });
    const oversizedBatch = action.schema.safeParse({
      designId: "design_1",
      source: "files",
      files: [
        {
          filename: "tokens-a.css",
          content: "x".repeat(
            Math.floor(DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES / 2) + 1,
          ),
        },
        {
          filename: "tokens-b.css",
          content: "x".repeat(
            Math.floor(DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES / 2) + 1,
          ),
        },
      ],
    });

    expect(tooManyFiles.success).toBe(false);
    expect(oversizedFile.success).toBe(false);
    expect(oversizedFilename.success).toBe(false);
    expect(oversizedBatch.success).toBe(false);
  });

  it("sets an HTTP body cap before action request parsing", () => {
    expect(action.maxBodyBytes).toBe(DESIGN_TOKEN_IMPORT_MAX_BODY_BYTES);
  });

  it("bounds current-design file contents in the database query", async () => {
    const contents = Array.from(
      { length: DESIGN_TOKEN_IMPORT_MAX_FILES },
      (_, index) => `:root { --spacing-gap-${index}: ${index + 1}px; }`,
    );
    const candidates = Array.from(
      { length: DESIGN_TOKEN_IMPORT_MAX_FILES + 1 },
      (_, index) => ({
        id: `file-${index}`,
        filename: `tokens-${index}.css`,
        contentBytes: new TextEncoder().encode(contents[index] ?? "").length,
      }),
    );
    mockWhere
      .mockResolvedValueOnce([{ fileCount: DESIGN_TOKEN_IMPORT_MAX_FILES + 5 }])
      .mockResolvedValueOnce(candidates)
      .mockResolvedValueOnce(
        candidates
          .slice(0, DESIGN_TOKEN_IMPORT_MAX_FILES)
          .map((file, index) => ({
            id: file.id,
            content: contents[index],
          })),
      );

    const result = await action.run({
      designId: "design_1",
      source: "current-design",
    });

    expect(mockLimit).toHaveBeenCalledWith(DESIGN_TOKEN_IMPORT_MAX_FILES + 1);
    expect(mockOrderBy).toHaveBeenCalledOnce();
    expect(mockWhere.mock.calls[2]?.[0]).toMatchObject({
      kind: "inArray",
      values: candidates
        .slice(0, DESIGN_TOKEN_IMPORT_MAX_FILES)
        .map(({ id }) => id),
    });
    expect(result.filesAnalyzed).toHaveLength(DESIGN_TOKEN_IMPORT_MAX_FILES);
    expect(result.omittedFileCount).toBe(5);

    const metadataSelection = mockSelect.mock.calls[1]?.[0] as
      | Record<string, { strings?: string[] }>
      | undefined;
    expect(metadataSelection).not.toHaveProperty("content");
    expect(metadataSelection).toHaveProperty("contentBytes");
    expect(metadataSelection?.contentBytes?.strings?.join("")).toContain(
      "octet_length(",
    );
    expect(metadataSelection?.contentBytes?.strings?.join("")).toContain(
      "left(",
    );
  });

  it("bounds current-design filenames in the database query", async () => {
    mockWhere
      .mockResolvedValueOnce([{ fileCount: 2 }])
      .mockResolvedValueOnce([
        {
          id: "file-1",
          filename: "tokens.css",
          contentBytes: 10,
        },
      ])
      .mockResolvedValueOnce([
        { id: "file-1", content: ":root { --spacing-gap: 8px; }" },
      ]);

    const result = await action.run({
      designId: "design_1",
      source: "current-design",
    });

    const metadataSelection = mockSelect.mock.calls[1]?.[0] as
      | Record<string, { strings?: string[] }>
      | undefined;
    const candidateFilter = mockWhere.mock.calls[1]?.[0] as {
      conditions?: { strings?: string[] }[];
    };
    const filePriority = mockOrderBy.mock.calls[0]?.[0] as {
      strings?: string[];
    };
    expect(metadataSelection?.filename?.strings?.join("")).toContain("left(");
    expect(candidateFilter.conditions?.[1]?.strings?.join("")).toContain(
      "char_length(left(",
    );
    expect(filePriority.strings?.join("")).toContain("~*");
    expect(filePriority.strings?.join("")).toContain(
      "css|scss|less|json|md|mdx|txt",
    );
    expect(result.filesAnalyzed).toEqual(["tokens.css"]);
    expect(result.omittedFileCount).toBe(1);
  });

  it("filters oversized current-design candidates before the row limit", async () => {
    mockWhere
      .mockResolvedValueOnce([{ fileCount: 22 }])
      .mockResolvedValueOnce([
        { id: "small", filename: "tokens.md", contentBytes: 24 },
      ])
      .mockResolvedValueOnce([
        { id: "small", content: "Primary color: #2563eb" },
      ]);

    const result = await action.run({
      designId: "design_1",
      source: "current-design",
    });

    const candidateFilter = mockWhere.mock.calls[1]?.[0] as {
      conditions?: { strings?: string[] }[];
    };
    const candidateByteFilter =
      candidateFilter.conditions?.[2]?.strings?.join("") ?? "";
    expect(candidateByteFilter).toContain("octet_length(left(");
    expect(candidateByteFilter).toContain(" <= ");
    expect(result.filesAnalyzed).toEqual(["tokens.md"]);
    expect(result.omittedFileCount).toBe(21);
  });

  it("keeps current-design contents under the aggregate byte limit", async () => {
    mockWhere
      .mockResolvedValueOnce([{ fileCount: 2 }])
      .mockResolvedValueOnce([
        {
          id: "first",
          filename: "first.css",
          contentBytes: DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES - 10,
        },
        {
          id: "second",
          filename: "second.css",
          contentBytes: 20,
        },
      ])
      .mockResolvedValueOnce([
        { id: "first", content: ":root { --spacing-gap: 8px; }" },
      ]);

    const result = await action.run({
      designId: "design_1",
      source: "current-design",
    });

    expect(mockWhere.mock.calls[2]?.[0]).toMatchObject({
      kind: "inArray",
      values: ["first"],
    });
    expect(result.filesAnalyzed).toEqual(["first.css"]);
    expect(result.omittedFileCount).toBe(1);
  });

  it("continues past an oversized current-design file", async () => {
    mockWhere
      .mockResolvedValueOnce([{ fileCount: 2 }])
      .mockResolvedValueOnce([
        {
          id: "large",
          filename: "a-large.css",
          contentBytes: DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES + 1,
        },
        {
          id: "small",
          filename: "z-tokens.scss",
          contentBytes: 10,
        },
      ])
      .mockResolvedValueOnce([
        { id: "small", content: "$gap: 8px; :root { --spacing-gap: $gap; }" },
      ]);

    const result = await action.run({
      designId: "design_1",
      source: "current-design",
    });

    expect(mockWhere.mock.calls[2]?.[0]).toMatchObject({
      kind: "inArray",
      values: ["small"],
    });
    expect(result.filesAnalyzed).toEqual(["z-tokens.scss"]);
    expect(result.omittedFileCount).toBe(1);
  });

  it("bounds pasted text by UTF-8 bytes before action execution", () => {
    const atLimit = action.schema.safeParse({
      designId: "design_1",
      source: "paste",
      text: "é".repeat(DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES / 2),
    });
    const overLimit = action.schema.safeParse({
      designId: "design_1",
      source: "paste",
      text: "é".repeat(DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES / 2 + 1),
    });

    expect(atLimit.success).toBe(true);
    expect(overLimit.success).toBe(false);
  });

  it("imports pasted CSS and design.md tokens into tweak selections", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: `
:root {
  --color-accent: #2563eb;
  --radius-lg: 16px;
  --text-body-size-medium: 1rem;
}
Heading font: Inter
Primary color: #f97316
`,
    });

    expect(result.importedCount).toBeGreaterThanOrEqual(4);
    expect(result.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cssVar: "--color-accent",
          value: "#2563eb",
        }),
        expect.objectContaining({
          cssVar: "--radius-lg",
          value: "16px",
          type: "radius",
        }),
        expect.objectContaining({
          cssVar: "--font-heading-font",
          value: "Inter",
          type: "typography",
        }),
        expect.objectContaining({
          cssVar: "--text-body-size-medium",
          value: "1rem",
          type: "typography",
        }),
      ]),
    );
    expect(result.tokens).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cssVar: "--color-heading-font",
          value: "Inter",
        }),
      ]),
    );

    const persisted = JSON.parse(designStore.row.data) as {
      tweakSelections: Record<string, string>;
      tokenImportSources: Record<string, string>;
    };

    expect(persisted.tweakSelections.accent).toBe("#2563eb");
    expect(persisted.tweakSelections["--radius-lg"]).toBe("16px");
    expect(persisted.tweakSelections["--font-heading-font"]).toBe("Inter");
    expect(persisted.tokenImportSources["--color-accent"]).toBe(
      "Pasted tokens",
    );
    expect(result.resolvedCssVars["--color-accent"]).toBe("#2563eb");
    expect(result.resolvedCssVars["--radius-lg"]).toBe("16px");
  });

  it("validates pasted CSS without stripping pseudo-class selectors", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: `:root {
  --color-accent: #2563eb;
}
button:focus-visible {
  outline-color: var(--color-accent);
}`,
    });

    expect(result.filesAnalyzed).toEqual(["pasted-tokens.txt"]);
    expect(result.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cssVar: "--color-accent",
          value: "#2563eb",
        }),
      ]),
    );
  });

  it("imports token files with filenames preserved", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "files",
      files: [
        {
          filename: "tokens.css",
          content: ":root { --spacing-card-gap: 24px; --color-ink: #111827; }",
        },
      ],
    });

    expect(result.filesAnalyzed).toEqual(["tokens.css"]);
    expect(result.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cssVar: "--spacing-card-gap",
          value: "24px",
          type: "spacing",
        }),
        expect.objectContaining({
          cssVar: "--color-ink",
          value: "#111827",
          type: "color",
        }),
      ]),
    );
  });

  it.each([
    ["a CSS file", "files"],
    ["pasted CSS", "paste"],
  ] as const)(
    "preserves multiline declarations in %s",
    async (_label, source) => {
      const css = `.card {
  background: linear-gradient(
    #ffffff,
    #000000
  );
}`;
      const result = await action.run(
        source === "files"
          ? {
              designId: "design_1",
              source,
              files: [{ filename: "theme.css", content: css }],
            }
          : { designId: "design_1", source, text: css },
      );

      expect(result.rejectedCount).toBe(0);
      expect(result.tokens).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: "#ffffff", type: "color" }),
          expect.objectContaining({ value: "#000000", type: "color" }),
        ]),
      );
    },
  );

  it("keeps motion and elevation tokens instead of dropping them", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "files",
      files: [
        {
          filename: "tokens.css",
          content:
            ":root { --duration-fast: 120ms; --ease-out-soft: cubic-bezier(0.2, 0, 0, 1); --elevation-card: 0 1px 2px rgba(0,0,0,0.2); }",
        },
        {
          filename: "design.md",
          content:
            "Transition duration: 200ms\nElevation raised: 0 4px 12px\nRelease notes: v2 shipped",
        },
      ],
    });

    const byVar = new Map(result.tokens.map((t) => [t.cssVar, t.type]));
    expect(byVar.get("--duration-fast")).toBe("motion");
    expect(byVar.get("--ease-out-soft")).toBe("motion");
    expect(byVar.get("--elevation-card")).toBe("shadow");
    expect(byVar.get("--motion-transition-duration")).toBe("motion");
    expect(byVar.get("--shadow-elevation-raised")).toBe("shadow");
    expect(result.tokens.filter((t) => /release/i.test(t.cssVar))).toEqual([]);
  });

  it("can extract tokens from the current design files", async () => {
    mockWhere
      .mockResolvedValueOnce([{ fileCount: 1 }])
      .mockResolvedValueOnce([
        {
          id: "file-1",
          filename: "screen.html",
          contentBytes: new TextEncoder().encode(
            "<style>:root { --color-panel: #020617; }</style>",
          ).length,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "file-1",
          content: "<style>:root { --color-panel: #020617; }</style>",
        },
      ]);

    const result = await action.run({
      designId: "design_1",
      source: "current-design",
    });

    expect(result.filesAnalyzed).toEqual(["screen.html"]);
    expect(result.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cssVar: "--color-panel",
          value: "#020617",
        }),
      ]),
    );
  });

  it("skips unsafe token values while importing safe ones", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: `
:root {
  --color-safe: #123456;
}
Bad color: red; color: black
Bad radius: 12px} body { color: red
`,
    });

    expect(result.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cssVar: "--color-safe",
          value: "#123456",
        }),
      ]),
    );
    expect(result.tokens).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: expect.stringContaining("color: black"),
        }),
        expect.objectContaining({
          value: expect.stringContaining("body"),
        }),
      ]),
    );

    const persisted = JSON.parse(designStore.row.data) as {
      tweakSelections: Record<string, string>;
    };
    expect(persisted.tweakSelections["--color-safe"]).toBe("#123456");
    expect(Object.values(persisted.tweakSelections)).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("color: black"),
        expect.stringContaining("body"),
      ]),
    );
  });

  it("does not import CSS from a syntactically incomplete paste", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: ":root { --color-accent: #2563eb;",
    });

    expect(result.importedCount).toBe(0);
    expect(JSON.parse(designStore.row.data).tweakSelections).toEqual({});
  });

  it("does not scrape colors from an incomplete pasted stylesheet", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: "button { color: #2563eb;",
    });

    expect(result.filesAnalyzed).toEqual([]);
    expect(result.importedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.tokens).toEqual([]);
    expect(JSON.parse(designStore.row.data).tweakSelections).toEqual({});
  });

  it("classifies long hyphenated pasted text without backtracking regexes", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: `Header\n${"\n".repeat(20_000)}{${"a-".repeat(40_000)}}`,
    });

    expect(result.importedCount).toBe(0);
    expect(result.tokens).toEqual([]);
  });

  it("rejects oversized paste input at the action boundary", async () => {
    await expect(
      action.run({
        designId: "design_1",
        source: "paste",
        text: `${"a".repeat(DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES + 1)}{ --color-accent: #fff; }`,
      }),
    ).rejects.toThrow(/Token import content must total at most/);
  });

  it("rejects invalid color functions but keeps CSS variable references", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: `:root {
  --color-invalid: rgb(not-a-color);
  --color-reference: var(--color-base);
}`,
    });

    expect(result.importedCount).toBe(1);
    expect(result.rejectedCount).toBe(1);
    expect(result.tokens).toEqual([
      expect.objectContaining({
        cssVar: "--color-reference",
        value: "var(--color-base)",
        type: "color",
      }),
    ]);
    expect(JSON.parse(designStore.row.data).tweakSelections).toEqual({
      "--color-reference": "var(--color-base)",
    });
  });

  it("accepts SCSS and LESS files with line comments", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "files",
      files: [
        {
          filename: "tokens.scss",
          content: ":root { --color-scss: #2563eb // primary color\n}",
        },
        {
          filename: "tokens.less",
          content: ":root { --color-less: rgb(255, 0, 0) // primary color\n}",
        },
      ],
    });

    expect(result.filesAnalyzed).toEqual(["tokens.scss", "tokens.less"]);
    expect(result.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cssVar: "--color-scss", value: "#2563eb" }),
        expect.objectContaining({
          cssVar: "--color-less",
          value: "rgb(255, 0, 0)",
        }),
      ]),
    );
    expect(
      result.tokens.some((token) =>
        token.cssVar.startsWith("--color-imported-"),
      ),
    ).toBe(false);
  });

  it("imports tokens from Less files with mixin definitions and calls", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "files",
      files: [
        {
          filename: "theme.less",
          content: [
            ".rounded() { border-radius: 8px; }",
            ".theme-colors(@accent) { color: @accent; }",
            ":root { --color-less-accent: #2563eb; .rounded(); .theme-colors(#2563eb); }",
            "",
          ].join("\n"),
        },
        {
          filename: "invalid.less",
          content: ":root { --color-invalid: #ef4444;",
        },
      ],
    });

    expect(result.filesAnalyzed).toEqual(["theme.less"]);
    expect(result.tokens).toContainEqual(
      expect.objectContaining({
        cssVar: "--color-less-accent",
        value: "#2563eb",
      }),
    );
    expect(result.skippedCount).toBe(1);
  });

  it("imports tokens from SCSS files with interpolated property names", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "files",
      files: [
        {
          filename: "theme.scss",
          content: [
            "$property: margin;",
            ":root {",
            "  #{$property}: 1px;",
            "  --color-scss-accent: #2563eb;",
            "}",
          ].join("\n"),
        },
        {
          filename: "invalid.scss",
          content: ":root { --color-invalid: #ef4444;",
        },
      ],
    });

    expect(result.filesAnalyzed).toEqual(["theme.scss"]);
    expect(result.tokens).toContainEqual(
      expect.objectContaining({
        cssVar: "--color-scss-accent",
        value: "#2563eb",
      }),
    );
    expect(result.skippedCount).toBe(1);
  });

  it("imports single-word labels alongside pasted token declarations", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: "Accent: #2563eb\n--color-x: #000;",
    });

    expect(result.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cssVar: "--color-accent",
          value: "#2563eb",
        }),
        expect.objectContaining({
          cssVar: "--color-x",
          value: "#000",
        }),
      ]),
    );
    expect(result.filesAnalyzed).toEqual(["pasted-tokens.txt"]);
  });

  it("counts unsafe named-line values as rejected", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: [
        "Accent: #2563eb",
        "Accent hover: url(javascript:alert(1))",
        "--color-x: #000;",
      ].join("\n"),
    });

    expect(result.tokens).toContainEqual(
      expect.objectContaining({
        cssVar: "--color-accent",
        value: "#2563eb",
      }),
    );
    expect(result.importedCount).toBe(2);
    expect(result.rejectedCount).toBe(1);
  });

  it("skips long whitespace-heavy labels before matching them", async () => {
    const startedAt = performance.now();
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: "Spacing: 1" + " ".repeat(16_000) + "x",
    });

    expect(result.importedCount).toBe(0);
    expect(result.tokens).toEqual([]);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it("rejects unbalanced syntax in non-color token values", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: ["Spacing: calc(12px", "Spacing valid: 12px"].join("\n"),
    });

    expect(result.importedCount).toBe(1);
    expect(result.rejectedCount).toBe(1);
    expect(result.tokens).toEqual([
      expect.objectContaining({
        cssVar: "--spacing-valid",
        value: "12px",
      }),
    ]);
    expect(JSON.parse(designStore.row.data).tweakSelections).toEqual({
      "--spacing-valid": "12px",
    });
  });

  it("keeps an earlier valid token when a later duplicate is invalid", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: `Accent color: #2563eb
:root {
  --color-accent: #GGGGGG;
}`,
    });

    expect(result.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cssVar: "--color-accent",
          value: "#2563eb",
        }),
      ]),
    );
    expect(result.rejectedCount).toBeGreaterThan(0);
  });

  it("rejects malformed colors, markup, URL payloads, and oversized values", async () => {
    const longValue = "a".repeat(301);
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: `:root {
  --color-invalid-hex: #GGGGGG;
  --color-html: "</style><script>alert(1)</script>";
  --color-url: url(javascript:alert(1));
  --spacing-too-long: ${longValue};
}`,
    });

    expect(result.importedCount).toBe(0);
    expect(result.rejectedCount).toBeGreaterThanOrEqual(4);
    expect(JSON.parse(designStore.row.data).tweakSelections).toEqual({});
  });

  it("rejects escaped URL and expression functions in custom token values", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: `:root {
  --custom-escaped-url: u\\72 l("https://example.com/x");
  --custom-nested-escaped-url: var(--missing, u\\72 l("https://example.com/y"));
  --custom-escaped-expression: e\\78 pression(alert(1));
  --custom-image: image("https://example.com/image.png");
  --custom-image-set: image-set("https://example.com/image.png" 1x);
  --custom-prefixed-image-set: -webkit-image-set("https://example.com/image.png" 1x);
  --custom-escaped-image-set: image-set("https\\3a //example.com/image.png" 1x);
}`,
    });

    expect(result.importedCount).toBe(0);
    expect(result.rejectedCount).toBe(7);
    expect(result.tokens).toEqual([]);
  });

  it("rejects malformed hex values even when the variable name is not color-like", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: ":root { --custom-token: #GGGGGG; }",
    });

    expect(result.importedCount).toBe(0);
    expect(JSON.parse(designStore.row.data).tweakSelections).toEqual({});
  });

  it("ignores malformed JSON token files instead of scraping values from them", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "files",
      files: [
        {
          filename: "tokens.json",
          content: 'Primary color: #2563eb\n{"colors":{"accent":"#2563eb"',
        },
      ],
    });

    expect(result.importedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(JSON.parse(designStore.row.data).tweakSelections).toEqual({});
  });

  it.each(['font family: "Inter;', "font family: 'Inter\""])(
    "rejects malformed quoted values without dropping valid siblings: %s",
    async (invalidLine) => {
      const result = await action.run({
        designId: "design_1",
        source: "files",
        files: [
          {
            filename: "tokens.md",
            content: `${invalidLine}\nPrimary color: #2563eb`,
          },
        ],
      });

      expect(result.filesAnalyzed).toEqual(["tokens.md"]);
      expect(result.importedCount).toBeGreaterThan(0);
      expect(result.rejectedCount).toBe(1);
      expect(result.tokens).toContainEqual(
        expect.objectContaining({
          cssVar: "--color-primary",
          value: "#2563eb",
        }),
      );
      expect(result.tokens).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: expect.stringContaining("Inter") }),
        ]),
      );
    },
  );

  it("normalizes balanced quotes around named token values", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "files",
      files: [{ filename: "tokens.md", content: 'Body font: "Inter"' }],
    });

    expect(result.tokens).toContainEqual(
      expect.objectContaining({
        cssVar: "--font-body-font",
        value: "Inter",
      }),
    );
  });

  it("skips malformed LESS while continuing to import other files", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "files",
      files: [
        { filename: "broken.less", content: "@import" },
        {
          filename: "tokens.css",
          content: ":root { --color-accent: #2563eb; }",
        },
      ],
    });

    expect(result.filesAnalyzed).toEqual(["tokens.css"]);
    expect(result.skippedCount).toBe(1);
    expect(result.tokens).toContainEqual(
      expect.objectContaining({
        cssVar: "--color-accent",
        value: "#2563eb",
      }),
    );
  });

  it("does not mine named lines from malformed pasted CSS", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: `Primary color: #2563eb
:root {
  --color-broken: #GGGGGG;`,
    });

    expect(result.importedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.tokens).toEqual([]);
    expect(JSON.parse(designStore.row.data).tweakSelections).toEqual({});
  });

  it("imports pasted token lists that include prose headings", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: `Brand colors from the design review
--color-accent: #2563eb;
--spacing-card-gap: 24px;`,
    });

    expect(result.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cssVar: "--color-accent",
          value: "#2563eb",
        }),
        expect.objectContaining({
          cssVar: "--spacing-card-gap",
          value: "24px",
        }),
      ]),
    );
    expect(JSON.parse(designStore.row.data).tweakSelections).toEqual({
      accent: "#2563eb",
      "--spacing-card-gap": "24px",
    });
  });

  it("imports brace-wrapped pasted token notes as prose", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: "{ Primary color: #2563eb }",
    });

    expect(result.tokens).toContainEqual(
      expect.objectContaining({
        cssVar: "--color-primary",
        value: "#2563eb",
      }),
    );
  });

  it("imports pasted token labels with parentheses and apostrophes", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: `Accent (primary): #2563eb
Brand's accent: #f97316
 - **Brand’s accent (dark)**: #ec4899
--color-neutral: #111827;`,
    });

    expect(result.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cssVar: "--color-accent-primary",
          value: "#2563eb",
        }),
        expect.objectContaining({
          cssVar: "--color-brand-s-accent",
          value: "#f97316",
        }),
        expect.objectContaining({
          cssVar: "--color-brand-s-accent-dark",
          value: "#ec4899",
        }),
        expect.objectContaining({
          cssVar: "--color-neutral",
          value: "#111827",
        }),
      ]),
    );
  });

  it.each(['font family: "Inter;', "font family: red; /* unclosed"])(
    "does not strip invalid CSS declarations while removing prose labels: %s",
    async (invalidLine) => {
      const result = await action.run({
        designId: "design_1",
        source: "paste",
        text: `:root {
  --color-accent: #2563eb;
}
${invalidLine}`,
      });

      expect(result.filesAnalyzed).toEqual([]);
      expect(result.importedCount).toBe(0);
      expect(result.skippedCount).toBe(1);
      expect(result.tokens).toEqual([]);
      expect(JSON.parse(designStore.row.data).tweakSelections).toEqual({});
    },
  );

  it("does not strip malformed CSS properties from pasted token lists", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: `Primary color: #2563eb
font family: "Inter;
--color-accent: #2563eb;`,
    });

    expect(result.filesAnalyzed).toEqual([]);
    expect(result.importedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.tokens).toEqual([]);
    expect(JSON.parse(designStore.row.data).tweakSelections).toEqual({});
  });

  it("imports token lists with a bracketed note prefix", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: `[1]
Primary color: #2563eb
--color-accent: #2563eb;`,
    });

    expect(result.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cssVar: "--color-accent",
          value: "#2563eb",
        }),
      ]),
    );
  });

  it("imports pasted token notes after a numbered prose heading", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: `[1] Brand palette
Primary color: #2563eb`,
    });

    expect(result.tokens).toContainEqual(
      expect.objectContaining({
        cssVar: "--color-primary",
        value: "#2563eb",
      }),
    );
  });

  it("imports pasted CSS declarations after a numbered prose heading", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: "[1] Brand palette\n--color-accent: #60a5fa;",
    });

    expect(result.tokens).toContainEqual(
      expect.objectContaining({
        cssVar: "--color-accent",
        value: "#60a5fa",
      }),
    );
    expect(result.skippedCount).toBe(0);
  });

  it("does not count theme config structure lines as invalid tokens", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "files",
      files: [
        {
          filename: "theme.md",
          content: `colors: {
  accent: "#2563eb"
}
fontFamily: [
  "Inter"
]`,
        },
      ],
    });

    expect(result.importedCount).toBeGreaterThan(0);
    expect(result.rejectedCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(result.tokens).toContainEqual(
      expect.objectContaining({
        cssVar: "--color-accent",
        value: "#2563eb",
      }),
    );
  });

  it("imports tokens from pasted CSS with an attribute selector", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: '[data-theme="dark"] { --color-accent: #60a5fa; }',
    });

    expect(result.filesAnalyzed).toEqual(["pasted-tokens.txt"]);
    expect(result.tokens).toContainEqual(
      expect.objectContaining({
        cssVar: "--color-accent",
        value: "#60a5fa",
      }),
    );
    expect(result.skippedCount).toBe(0);
  });

  it("does not mine tokens from malformed pasted JSON arrays", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: '[{"colors": }]\n--color-accent: #60a5fa;',
    });

    expect(result.filesAnalyzed).toEqual([]);
    expect(result.importedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.tokens).toEqual([]);
  });

  it("reports valid tokens omitted by the import limit", async () => {
    const declarations = Array.from(
      { length: 121 },
      (_, index) => `  --spacing-gap-${index}: ${index + 1}px;`,
    ).join("\n");
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: `:root {\n${declarations}\n}`,
    });

    expect(result.importedCount).toBe(120);
    expect(result.tokens).toHaveLength(120);
    expect(result.omittedTokenCount).toBe(1);
  });

  it("reports files omitted by the import limit", async () => {
    const files = Array.from({ length: 21 }, (_, index) => ({
      id: `file-${index}`,
      filename: `tokens-${index}.css`,
      contentBytes: new TextEncoder().encode(
        `:root { --spacing-gap-${index}: ${index + 1}px; }`,
      ).length,
    }));
    mockWhere
      .mockResolvedValueOnce([{ fileCount: files.length }])
      .mockResolvedValueOnce(files)
      .mockResolvedValueOnce(
        files.slice(0, 20).map((file, index) => ({
          id: file.id,
          content: `:root { --spacing-gap-${index}: ${index + 1}px; }`,
        })),
      );
    const result = await action.run({
      designId: "design_1",
      source: "current-design",
    });

    expect(result.filesAnalyzed).toHaveLength(20);
    expect(result.omittedFileCount).toBe(1);
  });

  it("reports unsupported indented Sass files as skipped", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "files",
      files: [
        {
          filename: "tokens.sass",
          content: "$accent: #2563eb\n:root\n  --color-accent: $accent",
        },
      ],
    });

    expect(result.filesAnalyzed).toEqual([]);
    expect(result.importedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
  });
});
