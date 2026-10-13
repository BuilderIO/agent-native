import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockWhere = vi.fn();
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
  eq: vi.fn(() => ({ kind: "eq" })),
  isNull: vi.fn(() => ({ kind: "isNull" })),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("../server/db/index.js", () => {
  const schema = {
    designFiles: {
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
      return {
        from: (table: unknown) => {
          mockFrom(table);
          return {
            where: async (...whereArgs: unknown[]) => {
              if (table === schema.designFiles) {
                return mockWhere(...whereArgs);
              }
              return [{ ...designStore.row }];
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

import { DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES } from "../shared/design-token-import-limits.js";
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
    mockWhere.mockResolvedValueOnce([
      {
        filename: "screen.html",
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

  it("omits oversized paste input before stylesheet classification", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: `${"a".repeat(DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES + 1)}{ --color-accent: #fff; }`,
    });

    expect(result.importedCount).toBe(0);
    expect(result.omittedFileCount).toBe(1);
    expect(result.filesAnalyzed).toEqual([]);
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
      text: "Spacing:" + " ".repeat(16_000) + "12px",
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
      filename: `tokens-${index}.css`,
      content: `:root { --spacing-gap-${index}: ${index + 1}px; }`,
    }));
    const result = await action.run({
      designId: "design_1",
      source: "files",
      files,
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
