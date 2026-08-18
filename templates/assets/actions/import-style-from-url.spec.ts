import { beforeEach, describe, expect, it, vi } from "vitest";

const assertAccessMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());
const extractRenderedDesignSystemFromUrlMock = vi.hoisted(() => vi.fn());
const styleBriefFromRenderedDesignMock = vi.hoisted(() => vi.fn());
const updateSetCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);

const schemaMock = vi.hoisted(() => ({
  assetLibraries: {
    id: "assetLibraries.id",
  },
  assetCollections: {
    id: "assetCollections.id",
  },
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (entry: unknown) => entry,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: assertAccessMock,
}));

vi.mock("@agent-native/creative-context/server", () => ({
  extractRenderedDesignSystemFromUrl: extractRenderedDesignSystemFromUrlMock,
  styleBriefFromRenderedDesign: styleBriefFromRenderedDesignMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column, value) => ({ op: "eq", column, value })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: schemaMock,
}));

vi.mock("../server/lib/json.js", () => ({
  nowIso: vi.fn(() => "2026-08-05T12:00:00.000Z"),
  parseJson: vi.fn((value: string | null | undefined, fallback: unknown) => {
    if (!value) return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }),
  stringifyJson: vi.fn((value: unknown) => JSON.stringify(value ?? {})),
}));

import action from "./import-style-from-url.js";

function createDb({
  library,
  collection,
}: {
  library: Record<string, unknown>;
  collection?: Record<string, unknown>;
}) {
  const rowsForTable = (table: unknown) =>
    table === schemaMock.assetLibraries
      ? [library]
      : collection
        ? [collection]
        : [];
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => ({
          limit: vi.fn(async (count: number) =>
            rowsForTable(table).slice(0, count),
          ),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          updateSetCalls.push(values);
        }),
      })),
    })),
  };
}

describe("import-style-from-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSetCalls.length = 0;
    assertAccessMock.mockResolvedValue(undefined);
    extractRenderedDesignSystemFromUrlMock.mockResolvedValue({
      status: "complete",
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      rendered: true,
      method: "local-playwright",
      warnings: [],
      diagnostics: [],
      designMd: "# Example design system",
    });
    styleBriefFromRenderedDesignMock.mockReturnValue({
      sourceUrl: "https://example.com/",
      rendered: true,
      designMd: "# Example design system",
      palette: ["#123456"],
    });
  });

  it("merges rendered website style into the library and records provenance", async () => {
    getDbMock.mockReturnValue(
      createDb({
        library: {
          id: "library-1",
          styleBrief: JSON.stringify({ mood: "calm" }),
          settings: JSON.stringify({ defaultModel: "model" }),
        },
      }),
    );

    const result = await action.run({
      libraryId: "library-1",
      url: "https://example.com",
    });
    const saved = updateSetCalls[0];
    const savedBrief = JSON.parse(String(saved.styleBrief));
    const savedSettings = JSON.parse(String(saved.settings));

    expect(extractRenderedDesignSystemFromUrlMock).toHaveBeenCalledWith(
      "https://example.com",
    );
    expect(result).toMatchObject({
      status: "complete",
      rendered: true,
      sourceUrl: "https://example.com/",
    });
    expect(savedBrief).toEqual(
      expect.objectContaining({
        mood: "calm",
        designMd: "# Example design system",
        palette: ["#123456"],
      }),
    );
    expect(savedSettings.brandAnalysis).toEqual(
      expect.objectContaining({
        sourceUrl: "https://example.com/",
        mode: "rendered-browser",
        status: "complete",
      }),
    );
  });

  it("fails loudly when the shared renderer cannot extract the page", async () => {
    extractRenderedDesignSystemFromUrlMock.mockResolvedValue({
      status: "failed",
      url: "https://example.com/",
      rendered: false,
      warnings: [],
      diagnostics: [],
      error: "browser unavailable",
    });
    getDbMock.mockReturnValue(
      createDb({
        library: { id: "library-1", styleBrief: "{}", settings: "{}" },
      }),
    );

    await expect(
      action.run({ libraryId: "library-1", url: "https://example.com" }),
    ).rejects.toThrow("browser unavailable");
    expect(updateSetCalls).toHaveLength(0);
  });
});
