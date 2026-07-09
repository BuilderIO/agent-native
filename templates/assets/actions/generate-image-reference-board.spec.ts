import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const assertAccessMock = vi.hoisted(() => vi.fn());
const selectReferencesMock = vi.hoisted(() => vi.fn());
const loadReferenceDataMock = vi.hoisted(() => vi.fn());
const generateProviderMock = vi.hoisted(() => vi.fn());
const createAssetFromBufferMock = vi.hoisted(() => vi.fn());
const getObjectMock = vi.hoisted(() => vi.fn());
const prepareInpaintMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core", () => ({
  defineAction: (entry: unknown) => entry,
}));

vi.mock("@agent-native/core/action", () => ({}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(async () => undefined),
  deleteAppState: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: vi.fn(() => "designer@example.com"),
  getRequestOrgId: vi.fn(() => "org-1"),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: assertAccessMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column, value) => ({ op: "eq", column, value })),
  inArray: vi.fn((column, values) => ({ op: "inArray", column, values })),
}));

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "run-1"),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: {
    assetLibraries: { id: "libraries.id" },
    assetCollections: { id: "collections.id" },
    assetGenerationPresets: { id: "presets.id" },
    assetGenerationRuns: { id: "runs.id" },
    assetGenerationSessions: { id: "sessions.id" },
    assetGenerationSessionItems: {},
    assets: {
      id: "assets.id",
      libraryId: "assets.library_id",
      mimeType: "assets.mime_type",
      status: "assets.status",
    },
  },
}));

vi.mock("../server/lib/assets.js", () => ({
  createAssetFromBuffer: createAssetFromBufferMock,
}));

vi.mock("../server/lib/generation-presets.js", () => ({
  applyPromptTemplate: vi.fn((_template, prompt) => prompt),
}));

vi.mock("../server/lib/generation.js", () => ({
  DEFAULT_GENERATION_REFERENCE_LIMIT: 6,
  compilePrompt: vi.fn(() => "compiled prompt"),
  generateWithManagedImageProvider: generateProviderMock,
  isImageGenerationSetupError: vi.fn(() => false),
  loadReferenceData: loadReferenceDataMock,
  resolveImageModelForRequest: vi.fn(
    ({ presetModel, explicitModel }) =>
      explicitModel ?? presetModel ?? "gemini-3.1-flash-image",
  ),
  selectReferences: selectReferencesMock,
}));

vi.mock("../server/lib/image-processing.js", () => ({
  applyPresetSkeleton: vi.fn(async ({ subject }) => subject),
  compositeLogo: vi.fn(async ({ image }) => image),
  maskFromManualMaskAlpha: vi.fn(async () => Buffer.from("mask")),
  maskFromPlateAlpha: vi.fn(async () => Buffer.from("mask")),
  prepareGptImage2SkeletonInpaintImages: prepareInpaintMock,
}));

vi.mock("../server/lib/json.js", () => ({
  nowIso: vi.fn(() => "2026-07-09T00:00:00.000Z"),
  parseJson: vi.fn((value: string | null | undefined, fallback: unknown) => {
    if (!value) return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }),
  stringifyJson: vi.fn((value: unknown) => JSON.stringify(value)),
}));

vi.mock("../server/lib/storage.js", () => ({
  getObject: getObjectMock,
}));

vi.mock("./_helpers.js", () => ({
  requireGenerationSessionInLibrary: vi.fn(),
  serializeAsset: vi.fn((asset) => asset),
}));

vi.mock("./_image-model-default.js", () => ({
  readImageModelDefault: vi.fn(async () => "gemini-3.1-flash-image"),
}));

vi.mock("./_tool-activity.js", () => ({
  withToolActivity: vi.fn(async (_context, _activity, fn) => fn()),
}));

vi.mock("./variant-slots.js", () => ({
  upsertVariantSlot: vi.fn(async () => undefined),
  wasVariantSlotDismissed: vi.fn(async () => false),
}));

import generateImage from "./generate-image.js";

function createWhereResult(rows: unknown[]) {
  return {
    limit: vi.fn(async () => rows),
    then: (
      resolve: (value: unknown[]) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
}

function createDb(selectRows: unknown[][]) {
  const inserted: unknown[] = [];
  const updates: unknown[] = [];
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => createWhereResult(selectRows.shift() ?? [])),
    })),
  }));
  return {
    inserted,
    updates,
    select,
    insert: vi.fn(() => ({
      values: vi.fn(async (row: unknown) => {
        inserted.push(row);
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((value: unknown) => {
        updates.push(value);
        return { where: vi.fn(async () => undefined) };
      }),
    })),
  };
}

const library = {
  id: "lib-1",
  title: "Acme",
  customInstructions: "",
  styleBrief: "{}",
  settings: "{}",
  canonicalLogoAssetId: null,
};

function preset(
  settings: Record<string, unknown>,
  model = "gemini-3.1-flash-image",
) {
  return {
    id: "preset-1",
    libraryId: "lib-1",
    collectionId: null,
    title: "Livestream",
    description: null,
    category: "social",
    aspectRatio: "16:9",
    imageSize: "2K",
    model,
    textPolicy: "",
    referencePolicy: "auto",
    promptTemplate: null,
    settings: JSON.stringify(settings),
  };
}

function asset(id: string, libraryId = "lib-1") {
  return {
    id,
    libraryId,
    role: "style_reference",
    mimeType: "image/png",
    status: "reference",
    objectKey: `${id}.png`,
    metadata: "{}",
  };
}

describe("generate-image preset reference board", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertAccessMock.mockResolvedValue(undefined);
    selectReferencesMock.mockResolvedValue([
      {
        id: "auto-1",
        role: "style_reference",
        mimeType: "image/png",
        data: "auto",
        selectionReason: "scored",
      },
    ]);
    loadReferenceDataMock.mockImplementation(
      async (rows, roleForAsset, reasonForAsset) =>
        rows.map((row: any) => ({
          id: row.id,
          role: roleForAsset?.(row) ?? row.role,
          mimeType: row.mimeType,
          data: row.objectKey,
          selectionReason: reasonForAsset?.(row),
        })),
    );
    generateProviderMock.mockResolvedValue({
      image: Buffer.from("image"),
      mimeType: "image/png",
      model: "gemini-3.1-flash-image",
      provider: "gemini",
    });
    createAssetFromBufferMock.mockResolvedValue({
      id: "asset-out",
      url: "https://cdn.test/out.png",
    });
    getObjectMock.mockResolvedValue(Buffer.from("plate"));
    prepareInpaintMock.mockResolvedValue({
      size: { width: 1024, height: 1024 },
      plate: Buffer.from("plate"),
      mask: Buffer.from("mask"),
      resized: false,
    });
  });

  it("rejects required variable entries without a fill", async () => {
    getDbMock.mockReturnValue(
      createDb([
        [library],
        [
          preset({
            presetReferences: [
              {
                id: "guest",
                label: "Guest speaker",
                role: "subject",
                assetIds: [],
                variable: true,
                required: true,
              },
            ],
          }),
        ],
      ]),
    );

    await expect(
      generateImage.run({
        libraryId: "lib-1",
        presetId: "preset-1",
        prompt: "Post",
      }),
    ).rejects.toThrow(
      'Preset "Livestream" requires image(s) for reference entry "Guest speaker" (guest). Pass them via presetReferenceFills (up to 4).',
    );
  });

  it("rejects per-run model overrides without character consistency for subject entries", async () => {
    getDbMock.mockReturnValue(
      createDb([
        [library],
        [
          preset({
            presetReferences: [
              {
                id: "steve",
                label: "Steve",
                role: "subject",
                assetIds: ["ref-steve"],
                variable: false,
                required: false,
              },
            ],
          }),
        ],
      ]),
    );

    await expect(
      generateImage.run({
        libraryId: "lib-1",
        presetId: "preset-1",
        prompt: "Post",
        model: "gemini-2.5-flash-image",
      }),
    ).rejects.toThrow(
      "Subject reference entries need a model with character consistency.",
    );
    expect(generateProviderMock).not.toHaveBeenCalled();
  });

  it("attaches fixed board refs and records board assignments", async () => {
    const db = createDb([
      [library],
      [
        preset({
          presetReferences: [
            {
              id: "steve",
              label: "Steve",
              role: "subject",
              assetIds: ["steve-1"],
              variable: false,
              required: false,
            },
          ],
        }),
      ],
      [asset("steve-1")],
    ]);
    getDbMock.mockReturnValue(db);

    await generateImage.run({
      libraryId: "lib-1",
      presetId: "preset-1",
      prompt: "Post",
    });

    expect(generateProviderMock.mock.calls[0][0].references).toEqual([
      expect.objectContaining({
        id: "steve-1",
        role: "subject_reference",
        selectionReason: "preset-ref:steve",
      }),
      expect.objectContaining({ id: "auto-1" }),
    ]);
    expect(selectReferencesMock.mock.calls[0][0]).toMatchObject({
      excludeAssetIds: ["steve-1"],
      limit: 5,
    });
    const metadata = JSON.parse((db.inserted[0] as any).metadata);
    expect(metadata.referenceSelection.boardAssignments).toEqual({
      steve: ["steve-1"],
    });
    expect(metadata.settingsUsed.boardAssignments).toEqual({
      steve: ["steve-1"],
    });
  });

  it("fills replace pinned board images and explicit policy still attaches board refs", async () => {
    getDbMock.mockReturnValue(
      createDb([
        [library],
        [
          {
            ...preset({
              presetReferences: [
                {
                  id: "guest",
                  label: "Guest",
                  role: "subject",
                  assetIds: ["old"],
                  variable: true,
                  required: true,
                },
              ],
            }),
            referencePolicy: "explicit",
          },
        ],
        [asset("new")],
      ]),
    );

    await generateImage.run({
      libraryId: "lib-1",
      presetId: "preset-1",
      prompt: "Post",
      presetReferenceFills: [{ referenceId: "guest", assetIds: ["new"] }],
    });

    expect(generateProviderMock.mock.calls[0][0].references).toEqual([
      expect.objectContaining({
        id: "new",
        selectionReason: "preset-ref:guest",
      }),
    ]);
    expect(selectReferencesMock).not.toHaveBeenCalled();
  });

  it("rejects fills without a preset and foreign-library fill assets", async () => {
    getDbMock.mockReturnValue(createDb([[library]]));
    await expect(
      generateImage.run({
        libraryId: "lib-1",
        prompt: "Post",
        presetReferenceFills: [{ referenceId: "guest", assetIds: ["new"] }],
      }),
    ).rejects.toThrow(
      "presetReferenceFills requires a presetId whose preset declares a reference board.",
    );

    getDbMock.mockReturnValue(
      createDb([
        [library],
        [
          preset({
            presetReferences: [
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
        ],
        [asset("new", "other-lib")],
      ]),
    );
    await expect(
      generateImage.run({
        libraryId: "lib-1",
        presetId: "preset-1",
        prompt: "Post",
        presetReferenceFills: [{ referenceId: "guest", assetIds: ["new"] }],
      }),
    ).rejects.toThrow(
      "Reference board images must be images in this asset library.",
    );
  });

  it("orders inpaint references as plate, board, guidance, mask and keeps only the plate as the source", async () => {
    getDbMock.mockReturnValue(
      createDb([
        [library],
        [
          preset(
            {
              skeletonSpec: {
                background: { type: "asset", assetId: "plate" },
                contentMode: "cutout",
              },
              presetReferences: [
                {
                  id: "steve",
                  label: "Steve",
                  role: "subject",
                  assetIds: ["steve-1"],
                  variable: false,
                  required: false,
                },
              ],
            },
            "gpt-image-2",
          ),
        ],
        [asset("steve-1")],
        [asset("plate")],
      ]),
    );

    await generateImage.run({
      libraryId: "lib-1",
      presetId: "preset-1",
      prompt: "Post",
    });

    expect(
      generateProviderMock.mock.calls[0][0].references.map(
        (ref: any) => ref.id,
      ),
    ).toEqual(["plate", "steve-1", "auto-1", "plate:mask"]);
    expect(
      generateProviderMock.mock.calls[0][0].references.map(
        (ref: any) => ref.role,
      ),
    ).toEqual(["edit_target", "product_reference", "style_reference", "mask"]);
  });
});
