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
    designData: {} as Record<string, unknown>,
    mutateDesignData: vi.fn(),
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
  sql: vi.fn((strings, ...values) => ({ strings, values })),
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

vi.mock("../server/lib/design-data-mutation.js", () => ({
  mutateDesignData: mocks.mutateDesignData,
}));

import action from "./present-design-variants.js";

describe("present-design-variants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.designData = {};
    mocks.mutateDesignData.mockImplementation(
      async (options: {
        mutate: (
          current: Record<string, unknown>,
          context: { updatedAt: string },
        ) => Record<string, unknown>;
        isApplied: (current: Record<string, unknown>) => boolean;
      }) => {
        const updatedAt = "2026-07-09T00:00:00.000Z";
        mocks.designData = options.mutate(mocks.designData, { updatedAt });
        expect(options.isApplied(mocks.designData)).toBe(true);
        return { data: mocks.designData, updatedAt };
      },
    );
    mocks.filesSelectChain.where.mockResolvedValue([]);
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
    mocks.db.select.mockReturnValue(mocks.filesSelectChain);
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
        submitMessage: expect.stringContaining("selected screen"),
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
    const guidedQuestions = mocks.writeAppStateForCurrentTab.mock
      .calls[0]?.[1] as {
      submitMessage: string;
      questions: Array<{
        options: Array<{ label: string; value: string }>;
      }>;
    };
    expect(guidedQuestions.submitMessage).toContain("selected screen");
    expect(guidedQuestions.submitMessage).toContain("same screen");
    expect(guidedQuestions.submitMessage).toContain(
      "clean up each other variant screen at most once",
    );
    expect(guidedQuestions.submitMessage).toContain(
      "exact file ids and tool instructions in the selected answer",
    );
    expect(guidedQuestions.submitMessage).toContain("requested app/product UI");
    expect(guidedQuestions.submitMessage).toContain("complete but compact");
    expect(guidedQuestions.submitMessage).toContain("primary workflow");
    expect(guidedQuestions.submitMessage).toContain(
      "must not be a direction board",
    );
    expect(guidedQuestions.submitMessage).toContain(
      "Do not repeat cleanup/read cycles",
    );
    expect(guidedQuestions.submitMessage).not.toContain("delete-file");
    expect(guidedQuestions.submitMessage).toContain(
      "stop after the first successful screen update",
    );
    const firstOption = guidedQuestions.questions[0]?.options[0];
    expect(firstOption?.value).toContain("get-design-snapshot");
    expect(firstOption?.value).toContain(
      "Delete each other variant screen at most once",
    );
    expect(firstOption?.value).toContain("get-design-snapshot exactly once");
    expect(firstOption?.value).toContain("fileId file-a");
    expect(firstOption?.value).toContain("edit-design with fileId file-a");
    expect(firstOption?.value).toContain('mode "replace-file"');
    expect(firstOption?.value).toContain(
      "replace the representative direction screen",
    );
    expect(firstOption?.value).toContain("complete but compact");
    expect(firstOption?.value).toContain("primary workflow");
    expect(firstOption?.value).toContain("actual usable UI requested");
    expect(firstOption?.value).toContain("not a direction board");
    expect(firstOption?.value).toContain("bounded single-file pass");
    expect(firstOption?.value).toContain(
      "do not repeat delete/snapshot cycles",
    );
    expect(firstOption?.value).toContain(
      "Do not call generate-design after this variant pick",
    );
    expect(firstOption?.value).toContain(
      "Stop after the first successful edit-design save",
    );
    expect(mocks.deleteAppState).toHaveBeenCalledWith("design-variants");

    const data = mocks.designData;
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
    expect(result.nextRequiredAction).toContain("get-design-snapshot");
    expect(result.nextRequiredAction).toContain(
      "delete each unchosen variant screen with delete-file at most once",
    );
    expect(result.nextRequiredAction).toContain(
      "call get-design-snapshot exactly once",
    );
    expect(result.nextRequiredAction).toContain("fileId");
    expect(result.nextRequiredAction).toContain("edit-design");
    expect(result.nextRequiredAction).toContain('mode "replace-file"');
    expect(result.nextRequiredAction).toContain("complete but compact");
    expect(result.nextRequiredAction).toContain("primary workflow");
    expect(result.nextRequiredAction).toContain(
      "Do not leave a direction board",
    );
    expect(result.nextRequiredAction).toContain(
      "Do not repeat delete/snapshot cycles",
    );
    expect(result.nextRequiredAction).toContain(
      "Do not call generate-design after a variant pick",
    );
    expect(result.nextRequiredAction).toContain("bounded pass");
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

  it("can render compact variants from direction summaries without inline HTML", async () => {
    await action.run({
      designId: "design_123",
      prompt: "Dark todo app with board, list, calendar, and keyboard flow",
      variants: [
        {
          id: "glass",
          label: "Glass Command Center",
          description: "Frosted panels, cyan accents, and airy kanban density.",
          accentColor: "#06b6d4",
          features: ["Board view", "Priority chips", "Keyboard hints"],
        },
        {
          id: "terminal",
          label: "Terminal Focus",
          description:
            "Dense monospace workflow with high-contrast focus cues.",
          accentColor: "#22c55e",
        },
      ],
    });

    expect(mocks.insertChain.values).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        filename: "variant-glass-command-center.html",
        content: expect.stringContaining("Glass Command Center"),
      }),
    );
    expect(mocks.insertChain.values).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        filename: "variant-terminal-focus.html",
        content: expect.stringContaining("Terminal Focus"),
      }),
    );
    expect(mocks.seedFromText).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("Keyboard hints"),
    );
  });

  it("renders compact fallback variants from non-todo mobile direction data", async () => {
    await action.run({
      designId: "design_123",
      prompt:
        "Mobile recipe planner with pantry scanning, meal prep, shopping lists, and nutrition summaries",
      variants: [
        {
          id: "pantry",
          label: "Pantry Scanner",
          description:
            "A handheld-first recipe flow centered on scanning ingredients.",
          width: 390,
          height: 844,
          features: ["Pantry scanning", "Meal prep", "Shopping lists"],
        },
        {
          id: "nutrition",
          label: "Nutrition Coach",
          description: "A coaching direction for macros and weekly planning.",
          width: 390,
          height: 844,
          features: ["Macro summary", "Weekly plan", "Grocery sync"],
        },
      ],
    });

    const firstContent = (
      mocks.insertChain.values.mock.calls[0]?.[0] as {
        content: string;
      }
    ).content;
    expect(firstContent).toContain("Pantry Scanner");
    expect(firstContent).toContain("Pantry scanning");
    expect(firstContent).toContain("Mobile recipe planner");
    expect(firstContent).toContain("width: 390px");
    expect(firstContent).not.toContain("Finalize launch checklist");

    const data = mocks.designData;
    expect(Object.values(data.canvasFrames)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ width: 390, height: 844 }),
        expect.objectContaining({ width: 390, height: 844 }),
      ]),
    );
  });

  it("does not let prompt text resize provided desktop HTML variants", async () => {
    const result = await action.run({
      designId: "design_123",
      prompt:
        "Mobile analytics companion with a compact summary view and push alerts",
      variants: [
        {
          id: "desktop-command",
          label: "Desktop Command Center",
          content:
            "<!doctype html><style>.app{width:1280px;min-height:900px}</style><div class='app'>Desktop analytics</div>",
        },
        {
          id: "mobile-summary",
          label: "Mobile Summary",
          description: "Phone-first glanceable KPI cards.",
          features: ["KPI cards", "Push alerts"],
        },
      ],
    });

    expect(
      result.screens.find(
        (screen) => screen.label === "Desktop Command Center",
      ),
    ).toMatchObject({ width: 1280, height: 900 });
    expect(
      result.screens.find((screen) => screen.label === "Mobile Summary"),
    ).toMatchObject({ width: 390, height: 844 });
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

  it("stamps missing data-agent-native-node-id attributes on every persisted variant", async () => {
    await action.run({
      designId: "design_123",
      prompt: "Explore two directions",
      variants: [
        {
          id: "provided-html",
          label: "Provided HTML",
          content: "<main><button>Buy</button></main>",
        },
        {
          id: "generated-fallback",
          label: "Generated Fallback",
          description: "A fallback representative screen.",
        },
      ],
    });

    expect(mocks.insertChain.values).toHaveBeenCalledTimes(2);
    const providedInsert = mocks.insertChain.values.mock.calls[0]![0] as {
      content: string;
    };
    const fallbackInsert = mocks.insertChain.values.mock.calls[1]![0] as {
      content: string;
    };

    expect(providedInsert.content).toContain("data-agent-native-node-id");
    expect(providedInsert.content).toContain("<button");
    // The provided-HTML path preserves text content verbatim alongside the
    // injected ids.
    expect(providedInsert.content).toContain(">Buy<");

    // The generated fallbackVariantContent() path is also annotated, since it
    // persists just as any other AI-authored screen would.
    expect(fallbackInsert.content).toContain("data-agent-native-node-id");
  });
});
