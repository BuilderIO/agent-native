import { beforeEach, describe, expect, it, vi } from "vitest";

const assertAccessMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());
const getObjectMock = vi.hoisted(() => vi.fn());
const extractDominantColorsMock = vi.hoisted(() => vi.fn());
const analyzeStyleWithGeminiMock = vi.hoisted(() => vi.fn());
const isGeminiConfiguredMock = vi.hoisted(() => vi.fn());
const updateSetCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);

const schemaMock = vi.hoisted(() => ({
  assetLibraries: {
    id: "assetLibraries.id",
    settings: "assetLibraries.settings",
  },
  assetCollections: {
    id: "assetCollections.id",
  },
  assets: {
    libraryId: "assets.libraryId",
  },
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (entry: unknown) => entry,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: assertAccessMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column, value) => ({ op: "eq", column, value })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: schemaMock,
}));

vi.mock("../server/lib/image-processing.js", () => ({
  extractDominantColors: extractDominantColorsMock,
}));

vi.mock("../server/lib/generation.js", () => ({
  analyzeStyleWithGemini: analyzeStyleWithGeminiMock,
  isGeminiImageGenerationConfigured: isGeminiConfiguredMock,
}));

vi.mock("../server/lib/storage.js", () => ({
  getObject: getObjectMock,
}));

vi.mock("../server/lib/json.js", () => ({
  nowIso: vi.fn(() => "2026-05-28T12:00:00.000Z"),
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

vi.mock("./_helpers.js", () => ({
  serializeLibrary: vi.fn((row) => ({
    id: row.id,
    styleBrief: JSON.parse(row.styleBrief || "{}"),
    settings: JSON.parse(row.settings || "{}"),
  })),
}));

import action from "./analyze-collection-style.js";

function createDb({
  library,
  assets,
}: {
  library: Record<string, unknown>;
  assets: Array<Record<string, unknown>>;
}) {
  const rowsForTable = (table: unknown) => {
    if (table === schemaMock.assetLibraries) return [library];
    if (table === schemaMock.assets) return assets;
    return [];
  };
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => {
          const rowsPromise = Promise.resolve(rowsForTable(table)) as Promise<
            Array<Record<string, unknown>>
          > & {
            limit: (count: number) => Promise<Array<Record<string, unknown>>>;
          };
          rowsPromise.limit = vi.fn(async (count: number) =>
            rowsForTable(table).slice(0, count),
          );
          return rowsPromise;
        }),
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

describe("analyze-collection-style", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSetCalls.length = 0;
    assertAccessMock.mockResolvedValue(undefined);
    getObjectMock.mockResolvedValue(Buffer.from([1, 2, 3]));
    extractDominantColorsMock.mockResolvedValue(["#111111", "#222222"]);
    isGeminiConfiguredMock.mockResolvedValue(true);
    analyzeStyleWithGeminiMock.mockResolvedValue({
      model: "gemini-2.5-flash",
      styleBrief: {
        description: "Dimensional product scenes with calm contrast.",
        medium: "photo-real 3D",
        doNot: ["busy backgrounds"],
      },
    });
  });

  it("merges vision analysis with extracted palette and writes provenance", async () => {
    getDbMock.mockReturnValue(
      createDb({
        library: {
          id: "library-1",
          styleBrief: JSON.stringify({ description: "Old", mood: "focused" }),
          settings: "{}",
        },
        assets: [
          {
            id: "ref-1",
            role: "style_reference",
            status: "reference",
            mimeType: "image/png",
            objectKey: "ref-1.png",
            metadata: JSON.stringify({ category: "hero" }),
          },
        ],
      }),
    );

    const result = await action.run({ libraryId: "library-1" });
    const saved = updateSetCalls[0];
    const savedBrief = JSON.parse(String(saved.styleBrief));
    const savedSettings = JSON.parse(String(saved.settings));

    expect(result.mode).toBe("vision");
    expect(savedBrief).toEqual(
      expect.objectContaining({
        description: "Dimensional product scenes with calm contrast.",
        mood: "focused",
        medium: "photo-real 3D",
        palette: ["#111111", "#222222"],
      }),
    );
    expect(savedSettings.brandAnalysis).toEqual(
      expect.objectContaining({
        analyzedAt: "2026-05-28T12:00:00.000Z",
        analyzedImageCount: 1,
        mode: "vision",
        model: "gemini-2.5-flash",
      }),
    );
  });

  it("falls back to color-only analysis without Gemini", async () => {
    isGeminiConfiguredMock.mockResolvedValue(false);
    getDbMock.mockReturnValue(
      createDb({
        library: {
          id: "library-1",
          styleBrief: JSON.stringify({ description: "Keep this" }),
          settings: "{}",
        },
        assets: [
          {
            id: "ref-1",
            role: "style_reference",
            status: "reference",
            mimeType: "image/png",
            objectKey: "ref-1.png",
            metadata: "{}",
          },
        ],
      }),
    );

    await action.run({ libraryId: "library-1" });
    const saved = updateSetCalls[0];
    const savedBrief = JSON.parse(String(saved.styleBrief));
    const savedSettings = JSON.parse(String(saved.settings));

    expect(analyzeStyleWithGeminiMock).not.toHaveBeenCalled();
    expect(savedBrief).toEqual(
      expect.objectContaining({
        description: "Keep this",
        palette: ["#111111", "#222222"],
      }),
    );
    expect(savedSettings.brandAnalysis.mode).toBe("palette");
  });
});
