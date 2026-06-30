import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.fn();
const mockResolveAccess = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockWhere = vi.fn();

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: () => "agent-native://design/editor?designId=design_1",
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
  resolveAccess: (...args: unknown[]) => mockResolveAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({ kind: "eq" })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: mockSelect,
    update: mockUpdate,
  }),
  schema: {
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
  },
}));

import action from "./import-design-tokens.js";

describe("import-design-tokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertAccess.mockResolvedValue(undefined);
    mockResolveAccess.mockResolvedValue({
      role: "editor",
      resource: {
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
      },
    });
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  it("imports pasted CSS and design.md tokens into tweak selections", async () => {
    const result = await action.run({
      designId: "design_1",
      source: "paste",
      text: `
:root {
  --color-accent: #2563eb;
  --radius-lg: 16px;
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

    const persisted = JSON.parse(
      (mockSet.mock.calls[0]?.[0] as { data: string }).data,
    ) as {
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

    const persisted = JSON.parse(
      (mockSet.mock.calls[0]?.[0] as { data: string }).data,
    ) as {
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
});
