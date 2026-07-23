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
      mimeType: "assets.mimeType",
      status: "assets.status",
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

  it("validates preset reference board settings", () => {
    expect(() =>
      generationPresetSettingsSchema.parse({
        presetReferences: [
          {
            id: "steve",
            label: "Steve",
            role: "subject",
            assetIds: ["a"],
            variable: false,
            required: false,
          },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      generationPresetSettingsSchema.parse({
        presetReferences: [
          {
            id: "dupe",
            label: "One",
            role: "style",
            assetIds: [],
            variable: true,
            required: false,
          },
          {
            id: "dupe",
            label: "Two",
            role: "style",
            assetIds: [],
            variable: true,
            required: false,
          },
        ],
      }),
    ).toThrow("Reference entry ids must be unique.");
    expect(() =>
      generationPresetSettingsSchema.parse({
        presetReferences: [
          {
            id: "fixed",
            label: "Fixed",
            role: "style",
            assetIds: [],
            variable: false,
            required: true,
          },
        ],
      }),
    ).toThrow(
      "A required fixed reference needs at least one image. Pin images or mark it as variable.",
    );
    expect(() =>
      generationPresetSettingsSchema.parse({
        presetReferences: [
          {
            id: "one",
            label: "One",
            role: "style",
            assetIds: ["a", "b", "c", "d"],
            variable: false,
            required: false,
          },
          {
            id: "two",
            label: "Two",
            role: "product",
            assetIds: ["e", "f", "g", "h"],
            variable: false,
            required: false,
          },
          {
            id: "three",
            label: "Three",
            role: "background",
            assetIds: ["i"],
            variable: false,
            required: false,
          },
        ],
      }),
    ).toThrow("The reference board may attach at most 8 images total.");
    expect(() =>
      generationPresetSettingsSchema.parse({
        presetReferences: [
          {
            id: "one",
            label: "One",
            role: "subject",
            assetIds: ["a", "b", "c", "d"],
            variable: false,
            required: false,
          },
          {
            id: "two",
            label: "Two",
            role: "subject",
            assetIds: ["e"],
            variable: false,
            required: false,
          },
        ],
      }),
    ).toThrow("Subject reference entries may attach at most 4 images total.");
  });

  it("reserves image budget for required entries with no pinned images", async () => {
    const pinned = (id: string, role: string, assetIds: string[]) => ({
      id,
      label: id,
      role,
      assetIds,
      variable: false,
      required: false,
    });
    expect(() =>
      generationPresetSettingsSchema.parse({
        presetReferences: [
          pinned("one", "style", ["a", "b", "c", "d"]),
          pinned("two", "product", ["e", "f", "g", "h"]),
          {
            id: "guest",
            label: "Guest",
            role: "background",
            assetIds: [],
            variable: true,
            required: true,
          },
        ],
      }),
    ).toThrow("The reference board may attach at most 8 images total.");
    expect(() =>
      generationPresetSettingsSchema.parse({
        presetReferences: [
          pinned("host", "subject", ["a", "b", "c", "d"]),
          {
            id: "guest",
            label: "Guest",
            role: "subject",
            assetIds: [],
            variable: true,
            required: true,
          },
        ],
      }),
    ).toThrow("Subject reference entries may attach at most 4 images total.");
  });

  it("rejects preset reference images outside this asset library on create", async () => {
    const insertValues = vi.fn(async () => undefined);
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [
            {
              id: "ref-1",
              libraryId: "other-lib",
              mimeType: "image/png",
              status: "reference",
            },
          ]),
        })),
      })),
      insert: vi.fn(() => ({ values: insertValues })),
    });

    await expect(
      createPresetAction.run({
        libraryId: "lib-1",
        title: "Board preset",
        settings: {
          presetReferences: [
            {
              id: "steve",
              label: "Steve",
              role: "subject",
              assetIds: ["ref-1"],
              variable: false,
              required: false,
            },
          ],
        },
      } as any),
    ).rejects.toThrow(
      "Reference board images must be images in this asset library.",
    );
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("rejects subject reference entries on gemini-2.5-flash-image", async () => {
    const insertValues = vi.fn(async () => undefined);
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [
            {
              id: "ref-1",
              libraryId: "lib-1",
              mimeType: "image/png",
              status: "reference",
            },
          ]),
        })),
      })),
      insert: vi.fn(() => ({ values: insertValues })),
    });

    await expect(
      createPresetAction.run({
        libraryId: "lib-1",
        title: "Board preset",
        model: "gemini-2.5-flash-image",
        settings: {
          presetReferences: [
            {
              id: "steve",
              label: "Steve",
              role: "subject",
              assetIds: ["ref-1"],
              variable: false,
              required: false,
            },
          ],
        },
      } as any),
    ).rejects.toThrow(
      "Subject reference entries need a model with character consistency.",
    );
    expect(insertValues).not.toHaveBeenCalled();
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

  it("rejects background-only skeleton plates from another library on update", async () => {
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
              libraryId: "other-lib",
              width: 1200,
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
            contentMode: "fill",
          },
        },
      } as any),
    ).rejects.toThrow("Skeleton image must belong to this asset library");
    expect(setMock).not.toHaveBeenCalled();
  });
});
