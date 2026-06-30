import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const designSelectChain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  designSelectChain.from.mockReturnValue(designSelectChain);
  designSelectChain.where.mockReturnValue(designSelectChain);

  const filesSelectChain = {
    from: vi.fn(),
    where: vi.fn(),
  };
  filesSelectChain.from.mockReturnValue(filesSelectChain);

  const txSelectChain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  txSelectChain.from.mockReturnValue(txSelectChain);
  txSelectChain.where.mockReturnValue(txSelectChain);

  const insertChain = { values: vi.fn() };
  const updateChain = {
    set: vi.fn(),
    where: vi.fn(),
  };
  updateChain.set.mockReturnValue(updateChain);

  const txUpdateChain = {
    set: vi.fn(),
    where: vi.fn(),
  };
  txUpdateChain.set.mockReturnValue(txUpdateChain);

  const tx = {
    select: vi.fn(() => txSelectChain),
    update: vi.fn(() => txUpdateChain),
  };

  const db = {
    select: vi.fn(),
    insert: vi.fn(() => insertChain),
    update: vi.fn(() => updateChain),
    transaction: vi.fn(async (callback) => callback(tx)),
  };

  return {
    db,
    tx,
    designSelectChain,
    filesSelectChain,
    txSelectChain,
    insertChain,
    updateChain,
    txUpdateChain,
    writeAppState: vi.fn(),
    writeAppStateForCurrentTab: vi.fn(),
    deleteAppState: vi.fn(),
    assertAccess: vi.fn(),
    seedFromText: vi.fn(),
    hasCollabState: vi.fn(),
    applyText: vi.fn(),
    eq: vi.fn((left, right) => ({ left, right })),
    nanoid: vi.fn(),
  };
});

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
  writeAppStateForCurrentTab: mocks.writeAppStateForCurrentTab,
  deleteAppState: mocks.deleteAppState,
}));

vi.mock("@agent-native/core/collab", () => ({
  applyText: mocks.applyText,
  hasCollabState: mocks.hasCollabState,
  seedFromText: mocks.seedFromText,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
  registerShareableResource: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: (args: {
    app: string;
    view: string;
    params?: Record<string, string>;
    to?: string;
  }) =>
    `/_agent-native/open?app=${args.app}&view=${args.view}&designId=${args.params?.designId ?? ""}&to=${encodeURIComponent(args.to ?? "")}`,
}));

vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
}));

vi.mock("nanoid", () => ({
  nanoid: mocks.nanoid,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.db,
  schema: {
    designs: {
      id: "designs.id",
      data: "designs.data",
      updatedAt: "designs.updatedAt",
    },
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      content: "designFiles.content",
      fileType: "designFiles.fileType",
      createdAt: "designFiles.createdAt",
      updatedAt: "designFiles.updatedAt",
    },
  },
}));

import action from "./present-design-variants.js";

describe("present-design-variants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.designSelectChain.limit.mockResolvedValue([{ data: "{}" }]);
    mocks.filesSelectChain.where.mockResolvedValue([]);
    mocks.txSelectChain.limit.mockResolvedValue([{ data: "{}" }]);
    mocks.insertChain.values.mockResolvedValue(undefined);
    mocks.updateChain.where.mockResolvedValue(undefined);
    mocks.txUpdateChain.where.mockResolvedValue(undefined);
    mocks.hasCollabState.mockResolvedValue(false);
    mocks.seedFromText.mockResolvedValue(undefined);
    mocks.deleteAppState.mockResolvedValue(true);
    mocks.nanoid
      .mockReturnValueOnce("variant-set-1")
      .mockReturnValueOnce("file-a")
      .mockReturnValueOnce("file-b")
      .mockReturnValueOnce("file-c");
    mocks.db.select
      .mockReturnValueOnce(mocks.designSelectChain)
      .mockReturnValueOnce(mocks.filesSelectChain);
  });

  it("writes variants as overview screens and asks the user with chat buttons", async () => {
    const result = await action.run({
      designId: "design_123",
      prompt: "Pick a calmer mobile direction",
      variants: [
        {
          id: "pure-white",
          label: "Pure White",
          content:
            "<!doctype html><style>.app{max-width:390px;min-height:844px}</style><div class='app'>One</div>",
        },
        {
          id: "soft-cards",
          label: "Soft Cards",
          width: 390,
          height: 844,
          content: "<!doctype html><html><body>Two</body></html>",
        },
        {
          id: "ink-line",
          label: "Ink & Line",
          content: "<!doctype html><html><body>Three</body></html>",
        },
      ],
    });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design_123",
      "editor",
    );
    expect(mocks.insertChain.values).toHaveBeenCalledTimes(3);
    expect(mocks.insertChain.values).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: "file-a",
        filename: "variant-pure-white.html",
        content: expect.stringContaining("One"),
      }),
    );
    expect(mocks.seedFromText).toHaveBeenCalledWith(
      "file-a",
      expect.stringContaining("One"),
    );

    expect(mocks.writeAppState).toHaveBeenCalledWith("navigate", {
      view: "editor",
      designId: "design_123",
      editorView: "overview",
      path: "/design/design_123?view=overview",
    });
    expect(mocks.writeAppStateForCurrentTab).toHaveBeenCalledWith(
      "guided-questions",
      expect.objectContaining({
        title: "Pick a calmer mobile direction",
        submitMessage: "Use this design direction.",
        questions: [
          expect.objectContaining({
            id: "variant",
            submitOnSelect: true,
            allowOther: false,
            options: [
              expect.objectContaining({ label: "Pure White" }),
              expect.objectContaining({ label: "Soft Cards" }),
              expect.objectContaining({ label: "Ink & Line" }),
            ],
          }),
        ],
      }),
    );
    expect(mocks.deleteAppState).toHaveBeenCalledWith("design-variants");

    const dataUpdate = mocks.txUpdateChain.set.mock.calls[0]?.[0] as {
      data: string;
    };
    const data = JSON.parse(dataUpdate.data);
    expect(data.canvasFrames).toMatchObject({
      "file-a": { x: 0, y: 0, width: 390, height: 844 },
      "file-b": { x: 486, y: 0, width: 390, height: 844 },
      "file-c": { x: 972, y: 0, width: 1280, height: 900 },
    });
    expect(data.screenMetadata["file-a"]).toMatchObject({
      title: "Pure White",
      width: 390,
      height: 844,
      variantSetId: "variant-set-1",
    });
    expect(data.designVariantSets["variant-set-1"].screens).toHaveLength(3);

    expect(result).toMatchObject({
      designId: "design_123",
      variantSetId: "variant-set-1",
      count: 3,
      path: "/design/design_123?view=overview",
      screens: expect.arrayContaining([
        expect.objectContaining({
          id: "file-a",
          label: "Pure White",
          width: 390,
          height: 844,
        }),
      ]),
    });
  });

  it("keeps an existing screen intact when a generated filename collides", async () => {
    mocks.filesSelectChain.where.mockResolvedValue([
      {
        id: "existing-screen",
        designId: "design_123",
        filename: "variant-pure-white.html",
        content: "<!doctype html><html><body>Keep me</body></html>",
        fileType: "html",
      },
    ]);

    await action.run({
      designId: "design_123",
      variants: [
        {
          id: "pure-white",
          label: "Pure White",
          content: "<!doctype html><html><body>New one</body></html>",
        },
        {
          id: "soft-cards",
          label: "Soft Cards",
          content: "<!doctype html><html><body>Two</body></html>",
        },
      ],
    });

    expect(mocks.insertChain.values).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: "file-a",
        filename: "variant-pure-white-2.html",
        content: expect.stringContaining("New one"),
      }),
    );
    expect(mocks.insertChain.values).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: "file-b",
        filename: "variant-soft-cards.html",
        content: expect.stringContaining("Two"),
      }),
    );
    expect(mocks.updateChain.set).not.toHaveBeenCalled();
    expect(mocks.seedFromText).toHaveBeenCalledWith(
      "file-a",
      expect.stringContaining("New one"),
    );
  });

  it("accepts 2-5 variants for the board choice flow", () => {
    const variant = (n: number) => ({
      id: `v${n}`,
      label: `V${n}`,
      content: `<html>${n}</html>`,
    });
    const withVariants = (count: number) => ({
      designId: "design_123",
      variants: Array.from({ length: count }, (_, i) => variant(i + 1)),
    });

    expect(action.schema.safeParse(withVariants(2)).success).toBe(true);
    expect(action.schema.safeParse(withVariants(3)).success).toBe(true);
    expect(action.schema.safeParse(withVariants(5)).success).toBe(true);
    expect(action.schema.safeParse(withVariants(1)).success).toBe(false);
    expect(action.schema.safeParse(withVariants(6)).success).toBe(false);
  });

  it("deep-links external hosts into overview mode", () => {
    expect(
      action.link?.({
        args: {},
        result: { designId: "design_123" },
      }),
    ).toEqual({
      url: "/_agent-native/open?app=design&view=editor&designId=design_123&to=%2Fdesign%2Fdesign_123%3Fview%3Doverview",
      label: "Open screen overview",
      view: "editor",
    });
  });
});
