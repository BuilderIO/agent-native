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
  notInArray: vi.fn((column, values) => ({
    kind: "notInArray",
    column,
    values,
  })),
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
      { length: DESIGN_TOKEN_IMPORT_MAX_FILES },
      (_, index) => ({
        id: `file-${index}`,
        filename: `tokens-${index}.css`,
        contentBytes: new TextEncoder().encode(contents[index] ?? "").length,
      }),
    );
    mockWhere
      .mockResolvedValueOnce([{ fileCount: DESIGN_TOKEN_IMPORT_MAX_FILES + 5 }])
      .mockResolvedValueOnce([])
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

    expect(mockLimit).toHaveBeenCalledWith(DESIGN_TOKEN_IMPORT_MAX_FILES);
    expect(mockOrderBy).toHaveBeenCalledTimes(2);
    expect(mockWhere.mock.calls[3]?.[0]).toMatchObject({
      kind: "inArray",
      values: candidates
        .slice(0, DESIGN_TOKEN_IMPORT_MAX_FILES)
        .map(({ id }) => id),
    });
    expect(result.filesAnalyzed).toHaveLength(DESIGN_TOKEN_IMPORT_MAX_FILES);
    expect(result.omittedFileCount).toBe(5);

    const metadataSelection = mockSelect.mock.calls[2]?.[0] as
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
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "file-1",
          filename: "tokens.css",
          contentBytes: 10,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "file-1", content: ":root { --spacing-gap: 8px; }" },
      ]);

    const result = await action.run({
      designId: "design_1",
      source: "current-design",
    });

    const metadataSelection = mockSelect.mock.calls[2]?.[0] as
      | Record<string, { strings?: string[] }>
      | undefined;
    const candidateFilter = mockWhere.mock.calls[2]?.[0] as {
      conditions?: { strings?: string[]; values?: { strings?: string[] }[] }[];
    };
    expect(metadataSelection?.filename?.strings?.join("")).toContain("left(");
    expect(
      candidateFilter.conditions?.[1]?.values?.[0]?.strings?.join(""),
    ).toContain("left(");
    expect(
      candidateFilter.conditions?.[2]?.values?.[0]?.strings?.join(""),
    ).toContain("octet_length(left(");
    expect(candidateFilter.conditions?.[3]?.strings?.join("")).toContain("~*");
    expect(candidateFilter.conditions?.[3]?.strings?.join("")).toContain(
      "css|scss|less|json|md|mdx|txt",
    );
    const fileOrder = mockOrderBy.mock.calls[1] as
      | { kind?: string; column?: { strings?: string[] } }[]
      | undefined;
    expect(fileOrder?.[0]?.column?.strings?.join("")).toContain("case");
    expect(fileOrder?.[0]?.column?.strings?.join("")).toContain(
      "css|scss|less",
    );
    expect(fileOrder?.[0]?.column?.strings?.join("")).toContain("json");
    expect(fileOrder?.[0]?.column?.strings?.join("")).toContain("token|theme");
    expect(fileOrder?.[1]?.kind).toBe("asc");
    expect(fileOrder?.[1]?.column?.strings?.join("")).toContain(
      "octet_length(left(",
    );
    expect(result.filesAnalyzed).toEqual(["tokens.css"]);
    expect(result.omittedFileCount).toBe(1);
  });

  it("does not count unsupported design assets as import omissions", async () => {
    mockWhere
      .mockResolvedValueOnce([{ fileCount: 2 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "tokens",
          filename: "tokens.css",
          contentBytes: 10,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "tokens", content: ":root { --spacing-gap: 8px; }" },
      ]);

    const result = await action.run({
      designId: "design_1",
      source: "current-design",
    });

    const countFilter = mockWhere.mock.calls[0]?.[0] as {
      conditions?: { strings?: string[] }[];
    };
    expect(countFilter.conditions?.[1]?.strings?.join("")).toContain(
      "css|scss|less|json|md|mdx|txt|html?|tsx?",
    );
    const fallbackFilter = mockWhere.mock.calls[3]?.[0] as {
      conditions?: { strings?: string[] }[];
    };
    expect(fallbackFilter.conditions?.[2]?.strings?.join("")).toContain("tsx?");
    expect(result.filesAnalyzed).toEqual(["tokens.css"]);
    expect(result.omittedFileCount).toBe(1);
  });

  it("prioritizes token stylesheets over small notes before the file cap", async () => {
    const stylesheet = {
      id: "tokens-css",
      filename: "tokens.css",
      content: ":root { --spacing-priority: 8px; }",
    };
    const notes = Array.from(
      { length: DESIGN_TOKEN_IMPORT_MAX_FILES + 1 },
      (_, index) => ({
        id: `note-${index}`,
        filename: `note-${index}.md`,
        content: `Design note ${index}`,
      }),
    );
    const rankedCandidates = [
      stylesheet,
      ...notes.slice(0, DESIGN_TOKEN_IMPORT_MAX_FILES - 1),
    ];
    mockWhere
      .mockResolvedValueOnce([{ fileCount: notes.length + 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(
        rankedCandidates.map(({ id, filename, content }) => ({
          id,
          filename,
          contentBytes: new TextEncoder().encode(content).length,
        })),
      )
      .mockResolvedValueOnce(
        rankedCandidates.map(({ id, content }) => ({ id, content })),
      );

    const result = await action.run({
      designId: "design_1",
      source: "current-design",
    });

    const preferredOrder = mockOrderBy.mock.calls[1] as
      | { kind?: string; column?: { strings?: string[] } }[]
      | undefined;
    expect(preferredOrder?.[0]?.column?.strings?.join("")).toContain(
      "css|scss|less",
    );
    expect(preferredOrder?.[1]?.kind).toBe("asc");
    expect(preferredOrder?.[1]?.column?.strings?.join("")).toContain(
      "octet_length(left(",
    );
    expect(result.filesAnalyzed).toHaveLength(DESIGN_TOKEN_IMPORT_MAX_FILES);
    expect(result.filesAnalyzed).toContain("tokens.css");
    expect(result.tokens).toContainEqual(
      expect.objectContaining({
        cssVar: "--spacing-priority",
        value: "8px",
      }),
    );
    expect(result.omittedFileCount).toBe(2);
  });

  it("keeps a named token stylesheet and HTML screen under the file cap", async () => {
    const primaryContent = `:root { --spacing-primary: 8px; }${" ".repeat(80)}`;
    const primaryStylesheet = {
      id: "primary",
      filename: "tokens.css",
      content: primaryContent,
    };
    const smallStylesheets = Array.from(
      { length: DESIGN_TOKEN_IMPORT_MAX_FILES - 1 },
      (_, index) => ({
        id: `component-${index}`,
        filename: `component-${index}.css`,
        content: `:root { --spacing-component-${index}: 1px; }`,
      }),
    );
    const screen = {
      id: "screen",
      filename: "screen.html",
      content: "<main>Screen</main>",
    };
    const rankedCandidates = [primaryStylesheet, ...smallStylesheets];
    mockWhere
      .mockResolvedValueOnce([{ fileCount: rankedCandidates.length + 1 }])
      .mockResolvedValueOnce([
        {
          id: screen.id,
          filename: screen.filename,
          contentBytes: new TextEncoder().encode(screen.content).length,
        },
      ])
      .mockResolvedValueOnce(
        rankedCandidates.map(({ id, filename, content }) => ({
          id,
          filename,
          contentBytes: new TextEncoder().encode(content).length,
        })),
      )
      .mockResolvedValueOnce(
        [...rankedCandidates, screen].map(({ id, content }) => ({
          id,
          content,
        })),
      );

    const result = await action.run({
      designId: "design_1",
      source: "current-design",
    });

    const preferredOrder = mockOrderBy.mock.calls[1] as
      | { kind?: string; column?: { strings?: string[] } }[]
      | undefined;
    expect(preferredOrder?.[0]?.column?.strings?.join("")).toContain(
      "token|theme|global|variable",
    );
    expect(preferredOrder?.[1]?.kind).toBe("asc");
    expect(preferredOrder?.[1]?.column?.strings?.join("")).toContain(
      "octet_length(left(",
    );
    expect(result.filesAnalyzed).toHaveLength(DESIGN_TOKEN_IMPORT_MAX_FILES);
    expect(result.filesAnalyzed).toContain("tokens.css");
    expect(result.filesAnalyzed).toContain("screen.html");
    expect(result.tokens).toContainEqual(
      expect.objectContaining({
        cssVar: "--spacing-primary",
        value: "8px",
      }),
    );
    expect(result.omittedFileCount).toBe(1);
  });

  it("filters oversized current-design candidates before the row limit", async () => {
    mockWhere
      .mockResolvedValueOnce([{ fileCount: 22 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "small", filename: "tokens.md", contentBytes: 24 },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "small", content: "Primary color: #2563eb" },
      ]);

    const result = await action.run({
      designId: "design_1",
      source: "current-design",
    });

    const candidateFilter = mockWhere.mock.calls[2]?.[0] as {
      conditions?: { strings?: string[] }[];
    };
    expect(
      candidateFilter.conditions?.[2]?.values?.[0]?.strings?.join(""),
    ).toContain("octet_length(left(");
    expect(candidateFilter.conditions?.[2]?.strings?.join("")).toContain(
      " <= ",
    );
    expect(result.filesAnalyzed).toEqual(["tokens.md"]);
    expect(result.omittedFileCount).toBe(21);
  });

  it("keeps current-design contents under the aggregate byte limit", async () => {
    mockWhere
      .mockResolvedValueOnce([{ fileCount: 2 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "second",
          filename: "second.css",
          contentBytes: 20,
        },
        {
          id: "first",
          filename: "first.css",
          contentBytes: DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES - 10,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "second", content: ":root { --spacing-gap: 8px; }" },
      ]);

    const result = await action.run({
      designId: "design_1",
      source: "current-design",
    });

    expect(mockWhere.mock.calls[4]?.[0]).toMatchObject({
      kind: "inArray",
      values: ["second"],
    });
    expect(result.filesAnalyzed).toEqual(["second.css"]);
    expect(result.omittedFileCount).toBe(1);
  });

  it("continues with eligible candidates after oversized current-design files", async () => {
    mockWhere
      .mockResolvedValueOnce([{ fileCount: 2 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "small",
          filename: "z-tokens.scss",
          contentBytes: 10,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "small", content: "$gap: 8px; :root { --spacing-gap: $gap; }" },
      ]);

    const result = await action.run({
      designId: "design_1",
      source: "current-design",
    });

    expect(mockWhere.mock.calls[4]?.[0]).toMatchObject({
      kind: "inArray",
      values: ["small"],
    });
    expect(result.filesAnalyzed).toEqual(["z-tokens.scss"]);
    expect(result.omittedFileCount).toBe(1);
  });

  it("falls back to smaller files when preferred candidates exceed remaining bytes", async () => {
    const makeCss = (name: string, bytes: number) => {
      const declaration = `:root { --spacing-${name}: 1px; }`;
      return declaration + " ".repeat(bytes - declaration.length);
    };
    const preferred = Array.from(
      { length: DESIGN_TOKEN_IMPORT_MAX_FILES },
      (_, index) => {
        const bytes =
          index === DESIGN_TOKEN_IMPORT_MAX_FILES - 1 ? 40_000 : 25_000;
        const content = makeCss(`preferred-${index}`, bytes);
        return {
          id: `preferred-${index}`,
          filename: `tokens-${index}.css`,
          content,
          contentBytes: new TextEncoder().encode(content).length,
        };
      },
    );
    const selectedPreferred = preferred.slice(0, -1);
    const fallback = {
      id: "small",
      filename: "tokens.md",
      content: "Primary color: #2563eb",
    };
    mockWhere
      .mockResolvedValueOnce([{ fileCount: DESIGN_TOKEN_IMPORT_MAX_FILES + 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(
        preferred.map(({ id, filename, contentBytes }) => ({
          id,
          filename,
          contentBytes,
        })),
      )
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: fallback.id,
          filename: fallback.filename,
          contentBytes: new TextEncoder().encode(fallback.content).length,
        },
      ])
      .mockResolvedValueOnce([
        ...selectedPreferred.map(({ id, content }) => ({ id, content })),
        { id: fallback.id, content: fallback.content },
      ]);

    const result = await action.run({
      designId: "design_1",
      source: "current-design",
    });

    const preferredFilter = mockWhere.mock.calls[2]?.[0] as {
      conditions?: { strings?: string[]; values?: { strings?: string[] }[] }[];
    };
    const fallbackFilter = mockWhere.mock.calls[4]?.[0] as {
      conditions?: { strings?: string[] }[];
    };
    expect(
      preferredFilter.conditions?.[2]?.values?.[0]?.strings?.join(""),
    ).toContain("octet_length(left(");
    expect(fallbackFilter.conditions?.[4]?.strings?.join("")).toContain("!~*");
    expect(mockWhere.mock.calls[5]?.[0]).toMatchObject({
      kind: "inArray",
      values: [...selectedPreferred.map(({ id }) => id), fallback.id],
    });
    expect(result.filesAnalyzed).toHaveLength(DESIGN_TOKEN_IMPORT_MAX_FILES);
    expect(result.filesAnalyzed).toContain("tokens.md");
    expect(result.omittedFileCount).toBe(1);
    expect(result.tokens).toContainEqual(
      expect.objectContaining({
        cssVar: "--color-primary",
        value: "#2563eb",
      }),
    );
  });

  it("continues preferred selection past the initial file cap", async () => {
    const makeCss = (name: string, bytes: number) => {
      const declaration = `:root { --spacing-${name}: 1px; }`;
      return declaration + " ".repeat(bytes - declaration.length);
    };
    const primary = Array.from(
      { length: DESIGN_TOKEN_IMPORT_MAX_FILES },
      (_, index) => ({
        id: `primary-${index}`,
        filename: `tokens-${index}.css`,
        content: makeCss(`primary-${index}`, 26_000),
      }),
    );
    const later = {
      id: "later",
      filename: "app.css",
      content: makeCss("later", 10_000),
    };
    const firstPage = primary.map(({ id, filename, content }) => ({
      id,
      filename,
      contentBytes: new TextEncoder().encode(content).length,
    }));
    const selectedBeforeContinuation = primary.slice(
      0,
      Math.floor(DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES / 26_000),
    );
    const selected = [...selectedBeforeContinuation, later];

    mockWhere
      .mockResolvedValueOnce([{ fileCount: primary.length + 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([
        {
          id: later.id,
          filename: later.filename,
          contentBytes: new TextEncoder().encode(later.content).length,
        },
      ])
      .mockResolvedValueOnce(
        selected.map(({ id, content }) => ({ id, content })),
      );

    const result = await action.run({
      designId: "design_1",
      source: "current-design",
    });

    expect(mockWhere.mock.calls[3]?.[0]).toMatchObject({
      kind: "and",
      conditions: expect.arrayContaining([
        expect.objectContaining({ kind: "notInArray" }),
      ]),
    });
    expect(result.filesAnalyzed).toContain("app.css");
    expect(result.tokens).toContainEqual(
      expect.objectContaining({
        cssVar: "--spacing-later",
        value: "1px",
      }),
    );
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

  it("does not strip an incomplete CSS line that resembles a prose label", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: "Primary color: #2563eb {\n  --color-accent: #2563eb;",
    });

    expect(result.filesAnalyzed).toEqual([]);
    expect(result.tokens).toEqual([]);
    expect(result.skippedCount).toBe(1);
    expect(JSON.parse(designStore.row.data).tweakSelections).toEqual({});
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

  it.each([
    ["a CSS file", "files"],
    ["pasted CSS", "paste"],
  ] as const)(
    "preserves multiline custom-property values in %s",
    async (_label, source) => {
      const css = [
        ":root {",
        "  --spacing-multiline: calc(",
        "    8px +",
        "    4px",
        "  );",
        "}",
      ].join("\n");
      const result = await action.run(
        source === "files"
          ? {
              designId: "design_1",
              source,
              files: [{ filename: "theme.css", content: css }],
            }
          : { designId: "design_1", source, text: css },
      );

      expect(result.tokens).toContainEqual(
        expect.objectContaining({
          cssVar: "--spacing-multiline",
          value: "calc( 8px + 4px )",
          type: "spacing",
        }),
      );
    },
  );

  it("preserves multiline CSS inside HTML screen style blocks", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "files",
      files: [
        {
          filename: "screen.html",
          content: `<style>
.card {
  background: linear-gradient(
    #ffffff,
    #000000
  );
}
</style>`,
        },
      ],
    });

    expect(result.rejectedCount).toBe(0);
    expect(result.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "#ffffff", type: "color" }),
        expect.objectContaining({ value: "#000000", type: "color" }),
      ]),
    );
  });

  it("scans HTML stylesheets but ignores CSS-like prose and script text", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "files",
      files: [
        {
          filename: "screen.html",
          content: `<style>:root { --color-from-style: #123456; }</style>
<p>--color-from-prose: #234567</p>
<script>const note = "--color-from-script: #345678";</script>`,
        },
      ],
    });

    expect(result.tokens).toContainEqual(
      expect.objectContaining({
        cssVar: "--color-from-style",
        value: "#123456",
      }),
    );
    expect(result.tokens).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cssVar: "--color-from-prose" }),
        expect.objectContaining({ cssVar: "--color-from-script" }),
      ]),
    );
  });

  it("does not extract custom properties from a malformed HTML style block", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "files",
      files: [
        {
          filename: "screen.html",
          content: `<style>
:root {
  font-family: "Inter;
  --color-panel: #020617;
}
</style>`,
        },
      ],
    });

    expect(result.rejectedCount).toBe(1);
    expect(result.tokens).not.toContainEqual(
      expect.objectContaining({ cssVar: "--color-panel" }),
    );
  });

  it("extracts valid declarations from HTML style attributes", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "files",
      files: [
        {
          filename: "screen.html",
          content:
            '<div style="--color-inline-panel: #020617; color: #ffffff"></div>',
        },
      ],
    });

    expect(result.rejectedCount).toBe(0);
    expect(result.tokens).toContainEqual(
      expect.objectContaining({
        cssVar: "--color-inline-panel",
        value: "#020617",
      }),
    );
  });

  it("does not extract custom properties from a malformed HTML style attribute", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "files",
      files: [
        {
          filename: "screen.html",
          content: `<div style="
font-family: 'Inter;
--color-inline-panel: #020617;
"></div>`,
        },
      ],
    });

    expect(result.rejectedCount).toBe(1);
    expect(result.tokens).not.toContainEqual(
      expect.objectContaining({ cssVar: "--color-inline-panel" }),
    );
  });

  it("does not scan duplicate HTML style attributes as prose", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "files",
      files: [
        {
          filename: "screen.html",
          content:
            '<div style="color: #000" style="font-family: \'Inter; --color-inline-panel: #020617;"></div>',
        },
      ],
    });

    expect(result.rejectedCount).toBe(1);
    expect(result.tokens).not.toContainEqual(
      expect.objectContaining({ cssVar: "--color-inline-panel" }),
    );
  });

  it("does not re-expose rejected style content from overlapping HTML ranges", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "files",
      files: [
        {
          filename: "screen.html",
          content:
            '<style style="first" style="second">:root { --color-leaked: #123456; font-family: "Inter; }</style>',
        },
      ],
    });

    expect(result.rejectedCount).toBe(2);
    expect(result.tokens).not.toContainEqual(
      expect.objectContaining({ cssVar: "--color-leaked" }),
    );
  });

  it("does not overflow while parsing deeply nested HTML screens", async () => {
    const nestingDepth = 12_000;
    const html = `${"<div>".repeat(nestingDepth)}${"</div>".repeat(nestingDepth)}`;
    const result = await action.run({
      designId: "design_1",
      source: "files",
      files: [
        { filename: "screen.html", content: html },
        {
          filename: "tokens.css",
          content: ":root { --color-from-css: #123456; }",
        },
      ],
    });

    expect(result.tokens).toContainEqual(
      expect.objectContaining({
        cssVar: "--color-from-css",
        value: "#123456",
      }),
    );
  });

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
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
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

  it("keeps an HTML screen when preferred files fill the current-design limit", async () => {
    const htmlContent =
      "<style>:root { --color-html-screen: #123456; }</style>";
    const htmlCandidate = {
      id: "screen",
      filename: "screen.html",
      contentBytes: new TextEncoder().encode(htmlContent).length,
    };
    const preferredCandidates = Array.from(
      { length: DESIGN_TOKEN_IMPORT_MAX_FILES },
      (_, index) => ({
        id: `preferred-${index}`,
        filename: `tokens-${index}.css`,
        contentBytes: 10,
      }),
    );
    const selectedPreferred = preferredCandidates.slice(
      0,
      DESIGN_TOKEN_IMPORT_MAX_FILES - 1,
    );
    mockWhere
      .mockResolvedValueOnce([{ fileCount: DESIGN_TOKEN_IMPORT_MAX_FILES + 1 }])
      .mockResolvedValueOnce([htmlCandidate])
      .mockResolvedValueOnce(selectedPreferred)
      .mockResolvedValueOnce([
        { id: "screen", content: htmlContent },
        ...selectedPreferred.map(({ id }, index) => ({
          id,
          content: `:root { --spacing-gap-${index}: ${index + 1}px; }`,
        })),
      ]);

    const result = await action.run({
      designId: "design_1",
      source: "current-design",
    });

    expect(result.filesAnalyzed).toHaveLength(DESIGN_TOKEN_IMPORT_MAX_FILES);
    expect(result.filesAnalyzed).toContain("screen.html");
    expect(result.tokens).toContainEqual(
      expect.objectContaining({
        cssVar: "--color-html-screen",
        value: "#123456",
      }),
    );
    expect(result.omittedFileCount).toBe(1);
    const htmlFilter = mockWhere.mock.calls[1]?.[0] as {
      conditions?: { strings?: string[] }[];
    };
    expect(htmlFilter.conditions?.[3]?.strings?.join("")).toContain("html?");
  });

  it("selects multiple HTML screens when preferred files leave room", async () => {
    const htmlFiles = [
      {
        id: "screen-one",
        filename: "screen-one.html",
        content: "<style>:root { --color-screen-one: #123456; }</style>",
      },
      {
        id: "screen-two",
        filename: "screen-two.htm",
        content: "<style>:root { --color-screen-two: #abcdef; }</style>",
      },
    ];
    const cssFile = {
      id: "tokens",
      filename: "tokens.css",
      content: ":root { --spacing-gap: 8px; }",
    };
    mockWhere
      .mockResolvedValueOnce([{ fileCount: 3 }])
      .mockResolvedValueOnce(
        htmlFiles.map(({ id, filename, content }) => ({
          id,
          filename,
          contentBytes: new TextEncoder().encode(content).length,
        })),
      )
      .mockResolvedValueOnce([
        {
          id: cssFile.id,
          filename: cssFile.filename,
          contentBytes: new TextEncoder().encode(cssFile.content).length,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        ...htmlFiles.map(({ id, content }) => ({ id, content })),
        { id: cssFile.id, content: cssFile.content },
      ]);

    const result = await action.run({
      designId: "design_1",
      source: "current-design",
    });

    expect(result.filesAnalyzed).toHaveLength(3);
    expect(result.filesAnalyzed).toEqual(
      expect.arrayContaining([
        "screen-one.html",
        "screen-two.htm",
        "tokens.css",
      ]),
    );
    expect(result.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cssVar: "--color-screen-one" }),
        expect.objectContaining({ cssVar: "--color-screen-two" }),
        expect.objectContaining({ cssVar: "--spacing-gap" }),
      ]),
    );
    expect(result.omittedFileCount).toBe(0);
  });

  it("selects preferred files before a near-limit HTML screen", async () => {
    const cssContent = ":root { --spacing-gap: 8px; }";
    mockWhere
      .mockResolvedValueOnce([{ fileCount: 2 }])
      .mockResolvedValueOnce([
        {
          id: "large-screen",
          filename: "large-screen.html",
          contentBytes: DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES - 1,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "tokens",
          filename: "tokens.css",
          contentBytes: new TextEncoder().encode(cssContent).length,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "tokens", content: cssContent }]);

    const result = await action.run({
      designId: "design_1",
      source: "current-design",
    });

    expect(result.filesAnalyzed).toEqual(["tokens.css"]);
    expect(result.tokens).toContainEqual(
      expect.objectContaining({ cssVar: "--spacing-gap", value: "8px" }),
    );
    expect(result.omittedFileCount).toBe(1);
    expect(mockWhere.mock.calls[4]?.[0]).toMatchObject({
      kind: "inArray",
      values: ["tokens"],
    });
  });

  it("fills the reserved HTML slot with a preferred file when HTML is too large", async () => {
    const preferredCandidates = Array.from(
      { length: DESIGN_TOKEN_IMPORT_MAX_FILES },
      (_, index) => ({
        id: `tokens-${index}`,
        filename: `tokens-${index}.css`,
        contentBytes: 10,
      }),
    );
    mockWhere
      .mockResolvedValueOnce([{ fileCount: DESIGN_TOKEN_IMPORT_MAX_FILES + 1 }])
      .mockResolvedValueOnce([
        {
          id: "large-screen",
          filename: "large-screen.html",
          contentBytes: DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES - 1,
        },
      ])
      .mockResolvedValueOnce(preferredCandidates)
      .mockResolvedValueOnce(
        preferredCandidates.map(({ id, filename }) => ({
          id,
          content: `/* ${filename} */ :root { --spacing-${id}: 8px; }`,
        })),
      );

    const result = await action.run({
      designId: "design_1",
      source: "current-design",
    });

    expect(result.filesAnalyzed).toHaveLength(DESIGN_TOKEN_IMPORT_MAX_FILES);
    expect(result.filesAnalyzed).not.toContain("large-screen.html");
    expect(result.omittedFileCount).toBe(1);
    expect(mockWhere.mock.calls[3]?.[0]).toMatchObject({
      kind: "inArray",
      values: preferredCandidates.map(({ id }) => id),
    });
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

  it("ignores config object and array openers when counting rejected tokens", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "files",
      files: [
        {
          filename: "tailwind.config.ts",
          content: `const theme = {
  colors: {
  },
  fontFamily: [
  ],
};`,
        },
      ],
    });

    expect(result.filesAnalyzed).toEqual(["tailwind.config.ts"]);
    expect(result.importedCount).toBe(0);
    expect(result.rejectedCount).toBe(0);
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

  it("rejects malformed CSS math expressions in non-color token values", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: [
        "Spacing malformed: calc(12px +)",
        "Spacing min malformed: min(12px,)",
        "Spacing clamp malformed: clamp(1px, 2px)",
        "Spacing clamp middle none: clamp(1px, none, 3px)",
        "Spacing clamp mismatch: calc(clamp(1px, 2s, 3px) + 1px)",
        "Spacing fallback malformed: var(--spacing, calc(1px +))",
        "Spacing math fallback malformed: calc(var(--spacing, 1px + ) + 1px)",
        "Spacing var name malformed: calc(var(not-a-custom-property, 2px) + 1px)",
        "Spacing env malformed: calc(env() + 2px)",
        "Spacing attr malformed: calc(attr(, 2px) + 1px)",
        "Spacing attr missing declaration syntax: calc(attr(data-gap, 2px) + 1px)",
        "Spacing dimension mismatch: calc(12px + 2)",
        "Spacing addition whitespace before: calc(12px+ 2px)",
        "Spacing addition whitespace after: calc(12px +2px)",
        "Spacing addition whitespace missing: calc(12px+2px)",
        "Spacing multiply mismatch: calc(12px * 2px)",
        "Spacing min mismatch: min(12px, 2)",
        "Spacing min unit mismatch: min(12px, 2s)",
        "Spacing atan mismatch: calc(atan(1) + 1)",
        "Spacing sqrt mismatch: sqrt(1px)",
        "Spacing sqrt dimension mismatch: sqrt(1px * 1px)",
        "Spacing unknown identifier: calc(foo + 1px)",
        "Spacing unknown unit: calc(1foo + 1px)",
        "Spacing attr syntax malformed: calc(attr(data-gap <length> nonsense) + 1px)",
        "Spacing attr syntax malformed words: calc(attr(data-gap length nonsense) + 1px)",
        "Spacing round malformed: round(1px,)",
        "Spacing round length missing step: round(2px)",
        "Spacing round length missing step strategy: round(down, 2px)",
        "Spacing nested round mismatch: calc(round(2px, 1s) + 1px)",
        "Spacing sqrt number dimension mismatch: sqrt(4)",
        "Spacing round number dimension mismatch: round(2)",
        "Spacing var valid: calc(var(--spacing-gap, 2px) + 1px)",
        "Spacing var empty fallback: calc(var(--spacing-gap,) + 1px)",
        "Spacing env valid: calc(env(safe-area-inset-top, 2px) + 1px)",
        "Spacing env none: calc(env(none, 2px) + 1px)",
        "Spacing attr syntax valid: calc(attr(data-gap length, 2px) + 1px)",
        'Spacing attr quoted syntax valid: calc(attr(data-gap "length", 2px) + 1px)',
        "Spacing valid: calc((12px + 2px) * 2)",
        "Spacing compatible units: calc(1px + 1em)",
        "Spacing dimension cancellation: calc(1px * 1s / 1s)",
        "Spacing length-percentage division: calc((100% - 32px) / 2)",
        "Spacing length-percentage multiplication: calc((100% - 32px) * 2)",
        "Spacing LP scalar-first multiplication: calc(2 * (100% - 32px))",
        "Spacing hypot valid: hypot(3px, 4px)",
        "Spacing min valid: min(12px, 24px)",
        "Spacing round valid: round(down, 5px, 2px)",
        "Spacing clamp none: clamp(none, 5px, none)",
        "Spacing nested clamp: calc(clamp(1px, 2px, 3px) + 1px)",
        "Spacing nested clamp none: calc(clamp(none, 2px, none) + 1px)",
        "Spacing nested round: calc(round(2px, 1px) + 1px)",
        "Spacing nested mod: calc(mod(5px, 2px) + 1px)",
        "Spacing nested rem: calc(rem(5px, 2px) + 1px)",
      ].join("\n"),
    });
    expect(result.importedCount).toBe(21);
    expect(result.rejectedCount).toBe(31);
    expect(result.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cssVar: "--spacing-var-valid",
          value: "calc(var(--spacing-gap, 2px) + 1px)",
        }),
        expect.objectContaining({
          cssVar: "--spacing-var-empty-fallback",
          value: "calc(var(--spacing-gap,) + 1px)",
        }),
        expect.objectContaining({
          cssVar: "--spacing-env-valid",
          value: "calc(env(safe-area-inset-top, 2px) + 1px)",
        }),
        expect.objectContaining({
          cssVar: "--spacing-env-none",
          value: "calc(env(none, 2px) + 1px)",
        }),
        expect.objectContaining({
          cssVar: "--spacing-attr-syntax-valid",
          value: "calc(attr(data-gap length, 2px) + 1px)",
        }),
        expect.objectContaining({
          cssVar: "--spacing-attr-quoted-syntax-valid",
          value: 'calc(attr(data-gap "length", 2px) + 1px)',
        }),
        expect.objectContaining({
          cssVar: "--spacing-valid",
          value: "calc((12px + 2px) * 2)",
        }),
        expect.objectContaining({
          cssVar: "--spacing-compatible-units",
          value: "calc(1px + 1em)",
        }),
        expect.objectContaining({
          cssVar: "--spacing-dimension-cancellation",
          value: "calc(1px * 1s / 1s)",
        }),
        expect.objectContaining({
          cssVar: "--spacing-length-percentage-division",
          value: "calc((100% - 32px) / 2)",
        }),
        expect.objectContaining({
          cssVar: "--spacing-length-percentage-multiplication",
          value: "calc((100% - 32px) * 2)",
        }),
        expect.objectContaining({
          cssVar: "--spacing-lp-scalar-first-multiplication",
          value: "calc(2 * (100% - 32px))",
        }),
        expect.objectContaining({
          cssVar: "--spacing-hypot-valid",
          value: "hypot(3px, 4px)",
        }),
        expect.objectContaining({
          cssVar: "--spacing-min-valid",
          value: "min(12px, 24px)",
        }),
        expect.objectContaining({
          cssVar: "--spacing-round-valid",
          value: "round(down, 5px, 2px)",
        }),
        expect.objectContaining({
          cssVar: "--spacing-clamp-none",
          value: "clamp(none, 5px, none)",
        }),
        expect.objectContaining({
          cssVar: "--spacing-nested-clamp",
          value: "calc(clamp(1px, 2px, 3px) + 1px)",
        }),
        expect.objectContaining({
          cssVar: "--spacing-nested-clamp-none",
          value: "calc(clamp(none, 2px, none) + 1px)",
        }),
        expect.objectContaining({
          cssVar: "--spacing-nested-round",
          value: "calc(round(2px, 1px) + 1px)",
        }),
        expect.objectContaining({
          cssVar: "--spacing-nested-mod",
          value: "calc(mod(5px, 2px) + 1px)",
        }),
        expect.objectContaining({
          cssVar: "--spacing-nested-rem",
          value: "calc(rem(5px, 2px) + 1px)",
        }),
      ]),
    );
    expect(result.tokens).not.toContainEqual(
      expect.objectContaining({
        cssVar: "--spacing-math-fallback-malformed",
      }),
    );
    expect(JSON.parse(designStore.row.data).tweakSelections).not.toHaveProperty(
      "--spacing-math-fallback-malformed",
    );
  });

  it("matches typed math and attr substitutions to token dimensions", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "files",
      files: [
        {
          filename: "tokens.css",
          content: `:root {\n${[
            "--font-weight-invalid: calc(12px)",
            "--font-weight-valid: calc(400)",
            "--duration-invalid: calc(12px)",
            "--duration-valid: calc(1s)",
            "--font-weight-fallback-invalid: var(--weight, calc(12px))",
            "--font-weight-fallback-valid: var(--weight, calc(400))",
            "--duration-fallback-invalid: var(--duration, calc(12px))",
            "--duration-fallback-valid: var(--duration, calc(1s))",
            "--spacing-attr-no-syntax: calc(attr(data-gap, 2px) + 1px)",
            "--spacing-attr-explicit-syntax: calc(attr(data-gap length, 2px) + 1px)",
            "--spacing-attr-union: calc(attr(data-gap length | percentage, 2px) + 1px)",
            "--spacing-attr-typed-union: calc(attr(data-gap type(<length> | <percentage>), 2px) + 1px)",
            "--spacing-attr-number-product: calc(attr(data-scale number, 2) * 1px)",
            "--spacing-attr-number-addition: calc(attr(data-scale number, 2) + 1px)",
            "--spacing-attr-px-unit: calc(attr(data-scale px, 2px) + 1px)",
            "--spacing-margin-auto-fallback: attr(data-gap type(<length>), auto)",
            "--spacing-margin-invalid-fallback: attr(data-gap type(<length>), not-a-margin-value)",
            "--font-family-valid: attr(data-font custom-ident, Inter)",
            "--font-family-no-type: attr(data-font)",
            "--font-family-invalid: attr(data-gap length, serif)",
            "--custom-css-image: attr(data-image type(<image>))",
            "--custom-css-image-plus: attr(data-image type(<image>+))",
            "--custom-css-image-hash: attr(data-image type(<image>#))",
            "--custom-css-url-plus: attr(data-url type(<url>+))",
            "--custom-css-url-hash: attr(data-url type(<url>#))",
            "--type-scale-invalid: attr(data-color color, serif)",
            "--motion-invalid: attr(data-gap length, ease)",
            "--motion-transition-invalid: calc(12px) slide 1s ease",
          ].join(";\n")}\n}`,
        },
      ],
    });

    expect(result.importedCount).toBe(13);
    expect(result.rejectedCount).toBe(16);
    expect(result.tokens.map((token) => token.cssVar)).toEqual(
      expect.arrayContaining([
        "--font-weight-valid",
        "--duration-valid",
        "--font-weight-fallback-valid",
        "--duration-fallback-valid",
        "--spacing-attr-explicit-syntax",
        "--spacing-attr-union",
        "--spacing-attr-typed-union",
        "--spacing-attr-number-product",
        "--spacing-attr-px-unit",
        "--spacing-margin-auto-fallback",
        "--font-family-valid",
        "--font-family-no-type",
      ]),
    );
    expect(result.tokens.map((token) => token.cssVar)).not.toEqual(
      expect.arrayContaining([
        "--font-weight-invalid",
        "--duration-invalid",
        "--font-weight-fallback-invalid",
        "--duration-fallback-invalid",
        "--spacing-attr-no-syntax",
        "--spacing-attr-number-addition",
        "--spacing-margin-invalid-fallback",
        "--font-family-invalid",
        "--custom-css-image",
        "--custom-css-image-plus",
        "--custom-css-image-hash",
        "--custom-css-url-plus",
        "--custom-css-url-hash",
        "--type-scale-invalid",
        "--motion-invalid",
        "--motion-transition-invalid",
      ]),
    );
  });

  it("keeps an earlier valid token when a later duplicate is invalid", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: `:root {
  --color-accent: #2563eb;
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

  it.each([
    [
      "important beats a later normal declaration",
      "#2563eb !important; --color-accent: #ef4444",
      "#2563eb",
    ],
    [
      "later important beats an earlier normal declaration",
      "#2563eb; --color-accent: #ef4444 !important",
      "#ef4444",
    ],
    [
      "later normal declaration wins at equal priority",
      "#2563eb; --color-accent: #ef4444",
      "#ef4444",
    ],
    [
      "later important declaration wins at equal priority",
      "#2563eb !important; --color-accent: #ef4444 !important",
      "#ef4444",
    ],
  ])(
    "honors CSS declaration importance: %s",
    async (_label, declarations, expected) => {
      const first = declarations.startsWith("#2563eb !important")
        ? "--color-accent: #2563eb !important"
        : "--color-accent: #2563eb";
      const second = declarations.includes("--color-accent: #ef4444")
        ? declarations.slice(declarations.indexOf("--color-accent: #ef4444"))
        : "--color-accent: #ef4444";
      const result = await action.run({
        designId: "design_1",
        source: "paste",
        text: `:root { ${first}; ${second}; }`,
      });

      expect(result.tokens).toContainEqual(
        expect.objectContaining({ cssVar: "--color-accent", value: expected }),
      );
    },
  );

  it("rejects spacing values with trailing tokens while keeping valid CSS math", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: `:root {
  --spacing-invalid: calc(12px) red;
  --spacing-invalid-fallback: calc(var(--spacing-gap, 2px red) + 1px);
  --spacing-valid: calc(var(--spacing-gap, 2px) + 1px);
}`,
    });

    expect(result.tokens).not.toContainEqual(
      expect.objectContaining({ cssVar: "--spacing-invalid" }),
    );
    expect(result.tokens).not.toContainEqual(
      expect.objectContaining({ cssVar: "--spacing-invalid-fallback" }),
    );
    expect(result.tokens).toContainEqual(
      expect.objectContaining({
        cssVar: "--spacing-valid",
        value: "calc(var(--spacing-gap, 2px) + 1px)",
      }),
    );
    expect(result.rejectedCount).toBeGreaterThan(0);
  });

  it("rejects trailing tokens in named spacing values", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: "Spacing: calc(12px) red",
    });

    expect(result.tokens).not.toContainEqual(
      expect.objectContaining({ cssVar: "--spacing-spacing" }),
    );
    expect(result.rejectedCount).toBe(1);
  });

  it("keeps an earlier valid custom property when loose text has an invalid duplicate", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "files",
      files: [
        {
          filename: "tokens.md",
          content:
            "--color-accent: #2563eb\n--color-accent: url(javascript:alert(1))",
        },
      ],
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

  it("imports valid relative CSS colors and channel math", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: `:root {
  --color-oklch-relative: oklch(from red l c h);
  --color-rgb-relative: rgb(from #2563eb r g b / 50%);
  --color-oklch-relative-math: oklch(from var(--color-base) l calc(c * 0.9) h);
  --color-alpha-relative: alpha(from rgb(0 0 0 / 50%));
  --color-alpha-relative-math: alpha(from red / calc(alpha * 0.5));
  --color-xyz-relative: color(from red xyz-d65 x y z);
  --color-p3-relative: color(from red display-p3 r g b);
}`,
    });

    expect(result.rejectedCount).toBe(0);
    expect(result.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cssVar: "--color-oklch-relative" }),
        expect.objectContaining({ cssVar: "--color-rgb-relative" }),
        expect.objectContaining({ cssVar: "--color-oklch-relative-math" }),
        expect.objectContaining({ cssVar: "--color-alpha-relative" }),
        expect.objectContaining({ cssVar: "--color-alpha-relative-math" }),
        expect.objectContaining({ cssVar: "--color-xyz-relative" }),
        expect.objectContaining({ cssVar: "--color-p3-relative" }),
      ]),
    );
  });

  it("accepts valid color functions containing substitutions", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: `:root {
  --color-rgb-channels: rgb(var(--channels));
  --color-rgb-fallback: rgb(var(--channels, 0 0 0));
  --color-rgb-nested-fallback: rgb(var(--channels, var(--inner, 0 0 0)));
  --color-hsl-channel: hsl(var(--hue) 50% 50%);
  --color-mix-substitution: color-mix(in srgb, var(--color-base), red);
  --color-invalid-rgb-substitution: rgb(var(--channels) nope);
  --color-invalid-rgb-fallback: rgb(var(--channels, nope));
  --color-invalid-rgb-nested-fallback: rgb(var(--channels, var(--inner, nope)));
  --color-invalid-rgb-word: rgb(not-a-color);
}`,
    });

    expect(result.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cssVar: "--color-rgb-channels" }),
        expect.objectContaining({ cssVar: "--color-rgb-fallback" }),
        expect.objectContaining({ cssVar: "--color-rgb-nested-fallback" }),
        expect.objectContaining({ cssVar: "--color-hsl-channel" }),
        expect.objectContaining({ cssVar: "--color-mix-substitution" }),
      ]),
    );
    expect(result.tokens).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cssVar: "--color-invalid-rgb-substitution" }),
        expect.objectContaining({ cssVar: "--color-invalid-rgb-fallback" }),
        expect.objectContaining({
          cssVar: "--color-invalid-rgb-nested-fallback",
        }),
        expect.objectContaining({ cssVar: "--color-invalid-rgb-word" }),
      ]),
    );
    expect(result.rejectedCount).toBe(4);
  });

  it("accepts local image fragments, MIME descriptors, and gradient substitutions", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: `:root {
  --custom-image-fragment: image("#icon");
  --custom-image-set-fragment: image-set("#icon" 1x type("image/png"));
  --custom-gradient-image-set: image-set(linear-gradient(var(--color-from), red) 2x type("image/png"));
}`,
    });

    expect(result.rejectedCount).toBe(0);
    expect(result.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cssVar: "--custom-image-fragment" }),
        expect.objectContaining({ cssVar: "--custom-image-set-fragment" }),
        expect.objectContaining({ cssVar: "--custom-gradient-image-set" }),
      ]),
    );
  });

  it("rejects malformed colors, markup, URL payloads, and oversized values", async () => {
    const longValue = "a".repeat(301);
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: `:root {
  --color-invalid-hex: #GGGGGG;
  --color-invalid-relative-unit: oklch(from var(--color-base) 2px c h);
  --color-invalid-rgb-unit: rgb(from var(--color-base) 1px 2px 3px);
  --color-invalid-relative-math-unit: oklch(from var(--color-base) l calc(c + 1px) h);
  --color-invalid-relative-identifier: oklch(from var(--color-base) l calc(foo + 1) h);
  --color-invalid-xyz-channels: color(from var(--color-base) xyz-d65 r g b);
  --color-invalid-rgb-channels: color(from var(--color-base) display-p3 x y z);
  --color-invalid-alpha-unit: alpha(from var(--color-base) / 1px);
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
  --custom-root-relative-image: image("/api/action");
  --custom-root-relative-image-set: image-set("/api/action" 1x);
  --custom-relative-image-set: image-set("../image.png" 1x);
  --custom-filename-image-set: image-set("theme.png" 2x);
  --custom-image-var: image(var(--image-source));
  --custom-image-set-var: image-set(var(--image-source) 1x);
  --custom-image-attr-url: attr(data-image url);
}`,
    });

    expect(result.importedCount).toBe(0);
    expect(result.rejectedCount).toBe(14);
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

  it("strips trailing line comments from named token values", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: "Spacing: 12px // designer's spacing\nRadius: 8px // design note",
    });

    expect(result.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cssVar: "--spacing", value: "12px" }),
        expect.objectContaining({ cssVar: "--radius", value: "8px" }),
      ]),
    );
  });

  it("keeps quoted config tokens before apostrophes in trailing comments", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "files",
      files: [
        {
          filename: "tailwind.config.ts",
          content: `const theme = {
  Accent: "#2563eb", // brand's primary color
};`,
        },
      ],
    });

    expect(result.rejectedCount).toBe(0);
    expect(result.tokens).toContainEqual(
      expect.objectContaining({ cssVar: "--color-accent", value: "#2563eb" }),
    );
  });

  it.each([
    ["Radius: '8px',", "--radius", "8px"],
    ["Heading font: 'Inter',", "--font-heading-font", "Inter"],
  ])(
    "normalizes trailing commas after quoted named token values: %s",
    async (content, cssVar, value) => {
      const result = await action.run({
        designId: "design_1",
        source: "files",
        files: [{ filename: "tokens.md", content }],
      });

      expect(result.tokens).toContainEqual(
        expect.objectContaining({ cssVar, value }),
      );
    },
  );

  it("preserves quoted multi-family font stacks", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "files",
      files: [
        {
          filename: "tokens.md",
          content: "Font: 'Inter', 'Helvetica',",
        },
      ],
    });

    expect(result.tokens).toContainEqual(
      expect.objectContaining({
        cssVar: "--font",
        value: "'Inter', 'Helvetica'",
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
      .mockResolvedValueOnce([])
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
