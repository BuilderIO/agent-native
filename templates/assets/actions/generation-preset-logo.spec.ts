import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const assertAccessMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core", () => ({
  defineAction: (entry: unknown) => entry,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: assertAccessMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column, value) => ({ op: "eq", column, value })),
  inArray: vi.fn((column, values) => ({ op: "inArray", column, values })),
}));

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "preset-new"),
}));

vi.mock("../server/lib/json.js", () => ({
  nowIso: vi.fn(() => "2026-07-01T00:00:00.000Z"),
  stringifyJson: vi.fn((value: unknown) => JSON.stringify(value)),
  parseJson: vi.fn((value: unknown, fallback: unknown) => {
    if (typeof value !== "string") return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }),
}));

// Echo the row back so we can inspect what each action persisted/returned.
vi.mock("./_helpers.js", () => ({
  serializeGenerationPreset: vi.fn((row: unknown) => row),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: {
    assets: {
      id: "assets.id",
      libraryId: "assets.libraryId",
      width: "assets.width",
      height: "assets.height",
    },
    assetCollections: { id: "collections.id" },
    assetGenerationPresets: { id: "presets.id" },
  },
}));

import { generationPresetSettingsSchema } from "./_generation-preset-settings.js";
import createPresetAction from "./create-generation-preset.js";
import updatePresetAction from "./update-generation-preset.js";

describe("generation preset includeLogo option", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertAccessMock.mockResolvedValue(undefined);
  });

  it("stores includeLogo in preset settings on create", async () => {
    const insertValues = vi.fn(async () => undefined);
    getDbMock.mockReturnValue({
      insert: vi.fn(() => ({ values: insertValues })),
    });

    await createPresetAction.run({
      libraryId: "lib-1",
      title: "Branded hero",
      category: "hero",
      aspectRatio: "16:9",
      imageSize: "2K",
      model: "gemini-3.1-flash-image",
      textPolicy: "",
      referencePolicy: "auto",
      includeLogo: true,
    } as any);

    expect(insertValues).toHaveBeenCalledTimes(1);
    const row = insertValues.mock.calls[0][0] as { settings: string };
    expect(JSON.parse(row.settings)).toEqual({ includeLogo: true });
  });

  it("merges includeLogo into existing settings on update without clobbering", async () => {
    const setMock = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [
              {
                id: "preset-1",
                libraryId: "lib-1",
                settings: JSON.stringify({ tier: "best" }),
              },
            ]),
          })),
        })),
      })),
      update: vi.fn(() => ({ set: setMock })),
    });

    await updatePresetAction.run({ id: "preset-1", includeLogo: true } as any);

    expect(setMock).toHaveBeenCalledTimes(1);
    const updates = setMock.mock.calls[0][0] as { settings: string };
    expect(JSON.parse(updates.settings)).toEqual({
      tier: "best",
      includeLogo: true,
    });
  });

  it("validates skeletonSpec settings patches", () => {
    expect(() =>
      generationPresetSettingsSchema.parse({
        skeletonSpec: {
          background: { type: "asset", assetId: "plate-asset-1" },
          mask: { type: "asset", assetId: "mask-asset-1" },
          contentMode: "cutout",
          dropShadow: true,
          foreground: [{ source: "canonicalLogo", x: 0.78, y: 0.06, w: 0.16 }],
        },
      }),
    ).not.toThrow();
    expect(() =>
      generationPresetSettingsSchema.parse({
        skeletonSpec: {
          background: { type: "gradient", from: "#F7F2E8", to: "#D8E6E0" },
          contentMode: "cutout",
        },
      }),
    ).toThrow();
  });

  it("rejects skeleton masks that do not match the plate dimensions on update", async () => {
    const setMock = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
    const selectMock = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [
              {
                id: "preset-1",
                libraryId: "lib-1",
                settings: "{}",
              },
            ]),
          })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(async () => [
            {
              id: "plate-asset-1",
              libraryId: "lib-1",
              width: 1200,
              height: 1200,
            },
            {
              id: "mask-asset-1",
              libraryId: "lib-1",
              width: 800,
              height: 1200,
            },
          ]),
        })),
      });
    getDbMock.mockReturnValue({
      select: selectMock,
      update: vi.fn(() => ({ set: setMock })),
    });

    await expect(
      updatePresetAction.run({
        id: "preset-1",
        settings: {
          skeletonSpec: {
            background: { type: "asset", assetId: "plate-asset-1" },
            mask: { type: "asset", assetId: "mask-asset-1" },
            contentMode: "cutout",
          },
        },
      } as any),
    ).rejects.toThrow("same pixel size as the background plate");
    expect(setMock).not.toHaveBeenCalled();
  });
});
