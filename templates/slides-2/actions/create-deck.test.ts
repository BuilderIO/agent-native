import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAssertAccess = vi.fn();
const mockWriteAppState = vi.fn();
const mockGetRequestRunContext = vi.fn(() => ({
  browserTabId: "slides-tab-1",
}));
const mockNotifyClients = vi.fn();
const mockGetUserEmail = vi.fn(() => "owner@example.com");
const mockGetOrgId = vi.fn(() => null);
const mockRecordGenerationCreativeContext = vi.fn();
const mockTrack = vi.hoisted(() => vi.fn());
const mockCompileSlideSource = vi.hoisted(() =>
  vi.fn((sourceTsx: string, _scope: unknown) => {
    const page = sourceTsx.includes("export default Body;") ? "Body" : "Cover";
    return {
      content: `<div>${page}</div>`,
      sourceHash: `hash-${page.toLowerCase()}`,
    };
  }),
);
const mockCreateDeckVersionSnapshot = vi.hoisted(() =>
  vi.fn(async () => ({ created: true })),
);
const mockValidateGenerationCreativeContext = vi.fn(
  async (input: {
    contextPackId?: string;
    contextModeOverride?: "off";
    reuseLabels?: Array<Record<string, unknown>>;
  }) => ({
    contextMode: input.contextModeOverride === "off" ? "off" : "auto",
    contextPackId:
      input.contextModeOverride === "off"
        ? null
        : (input.contextPackId ?? null),
    reuseLabels: input.reuseLabels ?? [],
    results: [],
  }),
);
const mockTables = vi.hoisted(() => ({
  deckTable: { id: "id_col", data: "data_col", updatedAt: "ua_col" },
  designSystemsTable: {
    id: "ds_id_col",
    ownerEmail: "owner_email_col",
    isDefault: "is_default_col",
  },
}));

let existingDeckRow:
  | {
      id: string;
      data: string;
      updatedAt: string;
      title?: string;
      designSystemId?: string | null;
      ownerEmail?: string;
      orgId?: string | null;
    }
  | undefined = undefined;
let defaultDesignSystemId: string | undefined = undefined;
let titleQueryRows: Array<{ id: string }> = [];
let insertedRow: Record<string, unknown> | undefined = undefined;
let updatedFields: Record<string, unknown> | undefined = undefined;
let pendingInsertRow: Record<string, unknown> | undefined = undefined;

const limitFn = vi.fn(async () => (existingDeckRow ? [existingDeckRow] : []));
const defaultDesignSystemLimitFn = vi.fn(async () =>
  defaultDesignSystemId ? [{ id: defaultDesignSystemId }] : [],
);
const titleWhereFn = vi.fn(async () => titleQueryRows);
const whereSelectFn = vi.fn((condition: unknown, table?: unknown) => {
  const clauses = (condition as { and?: unknown[] } | undefined)?.and;
  const isTitleQuery =
    table === mockTables.designSystemsTable &&
    Array.isArray(clauses) &&
    (clauses[0] as { __accessFilter?: boolean } | undefined)?.__accessFilter ===
      true;
  if (isTitleQuery) return titleWhereFn();
  return {
    limit:
      table === mockTables.designSystemsTable
        ? defaultDesignSystemLimitFn
        : limitFn,
  };
});
const fromFn = vi.fn((table: unknown) => ({
  where: (condition: unknown) => whereSelectFn(condition, table),
}));
const selectFn = vi.fn(() => ({ from: fromFn }));

const valuesFn = vi.fn((row: Record<string, unknown>) => {
  insertedRow = row;
  pendingInsertRow = row;
  return {
    returning: insertReturningFn,
  };
});
const insertReturningFn = vi.fn(async () => {
  if (!pendingInsertRow) return [];
  return [
    {
      id: pendingInsertRow.id,
      title: pendingInsertRow.title,
      data: pendingInsertRow.data,
      designSystemId: pendingInsertRow.designSystemId,
      ownerEmail: pendingInsertRow.ownerEmail,
      orgId: pendingInsertRow.orgId,
      updatedAt: pendingInsertRow.updatedAt,
    },
  ];
});
const insertFn = vi.fn(() => ({ values: valuesFn }));

const updateReturningFn = vi.fn(async () => {
  if (!existingDeckRow || !updatedFields) return [];
  existingDeckRow = { ...existingDeckRow, ...updatedFields };
  return [
    {
      id: existingDeckRow.id,
      title: existingDeckRow.title,
      data: existingDeckRow.data,
      designSystemId: existingDeckRow.designSystemId ?? null,
      ownerEmail: existingDeckRow.ownerEmail,
      orgId: existingDeckRow.orgId ?? null,
      updatedAt: existingDeckRow.updatedAt,
    },
  ];
});
const whereUpdateFn = vi.fn(() => ({ returning: updateReturningFn }));
const setFn = vi.fn((fields: Record<string, unknown>) => {
  updatedFields = fields;
  return { where: whereUpdateFn };
});
const updateFn = vi.fn(() => ({ set: setFn }));

const mockDb = {
  select: selectFn,
  insert: insertFn,
  update: updateFn,
  transaction: async (run: (tx: typeof mockDb) => Promise<void>) => run(mockDb),
};

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    decks: mockTables.deckTable,
    designSystems: mockTables.designSystemsTable,
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
  accessFilter: () => ({ __accessFilter: true }),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

vi.mock("@agent-native/creative-context/server", () => ({
  recordGenerationCreativeContext: (...args: unknown[]) =>
    mockRecordGenerationCreativeContext(...args),
  validateGenerationCreativeContext: (...args: unknown[]) =>
    mockValidateGenerationCreativeContext(...args),
}));

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: (...args: unknown[]) => mockNotifyClients(...args),
}));

vi.mock("../server/lib/deck-versions.js", () => ({
  createDeckVersionSnapshot: (...args: unknown[]) =>
    mockCreateDeckVersionSnapshot(...args),
}));

vi.mock("./_slide-source.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_slide-source.js")>();
  return {
    ...actual,
    compileSlideSource: (sourceTsx: string, scope: unknown) =>
      mockCompileSlideSource(sourceTsx, scope),
  };
});

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestContext: () => undefined,
  getRequestUserEmail: () => mockGetUserEmail(),
  getRequestOrgId: () => mockGetOrgId(),
  getRequestRunContext: () => mockGetRequestRunContext(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ and: conditions }),
  eq: (col: unknown, val: unknown) => ({ col, val }),
  isNull: (col: unknown) => ({ isNull: col }),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

const mockGetDesignSystemRun = vi.fn(async ({ id }: { id: string }) => ({
  id,
  title: "Acme",
  agentContext: "Use --brand-accent: #123456.",
}));

vi.mock("./get-design-system.js", () => ({
  default: {
    run: (...args: [{ id: string }]) => mockGetDesignSystemRun(...args),
  },
}));

import action from "./create-deck";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  existingDeckRow = undefined;
  defaultDesignSystemId = undefined;
  titleQueryRows = [];
  insertedRow = undefined;
  updatedFields = undefined;
  pendingInsertRow = undefined;
  mockTrack.mockClear();
  mockGetUserEmail.mockReturnValue("owner@example.com");
  mockGetOrgId.mockReturnValue(null);
});

describe("create-deck chat result", () => {
  it("documents uploaded video assets and source-backed slide updates", () => {
    expect(action.tool.description).toContain("list-assets");
    expect(action.tool.description).toContain("asset://");
    expect(action.tool.description).toContain("get-slide-source");
    expect(action.tool.description).toContain("update-slide-source");
  });

  it("marks replacement of an existing deck as destructive in MCP", () => {
    expect(action.mcpAnnotations?.destructiveHint).toBe(true);
  });

  it("projects at most three sanitized slide previews without notes or design context", () => {
    const chatUI = action.chatUI;
    const projected = chatUI?.projectResult?.(
      {},
      {
        id: "deck-1",
        title: "D".repeat(240),
        slideCount: 4,
        slides: [
          {
            id: "slide-1",
            layout: "title",
            content: "<div><h1>One</h1><script>untrusted</script></div>",
            notes: "presenter only",
          },
          { id: "slide-2", content: "<div>Two</div>" },
          { id: "slide-3", content: "<div>Three</div>" },
          { id: "slide-4", content: "<div>Four</div>" },
        ],
        designSystem: { agentContext: "private context" },
      },
    );

    expect(chatUI?.renderer).toBe("slides.deck-result");
    expect(projected).toMatchObject({
      id: "deck-1",
      title: "D".repeat(180),
      slideCount: 4,
      previews: [
        { id: "slide-1", layout: "title" },
        { id: "slide-2", layout: "content" },
        { id: "slide-3", layout: "content" },
      ],
    });
    const previewJson = JSON.stringify(projected?.previews);
    expect(projected?.previews).toHaveLength(3);
    expect(projected?.previews[0].content).toContain("<h1>One</h1>");
    expect(previewJson).not.toContain("<script");
    expect(previewJson).not.toContain("presenter only");
    expect(JSON.stringify(projected)).not.toContain("private context");
    expect(chatUI?.when?.({}, projected)).toBe(true);
    expect(chatUI?.when?.({}, { error: "Create failed" })).toBe(false);
    expect(chatUI?.projectResult?.({}, projected)).toEqual(projected);
    expect(
      chatUI?.projectResult?.({}, { id: "deck-1", title: "T", slideCount: -1 }),
    ).toBeNull();
  });

  it("skips slide previews larger than the per-slide limit", () => {
    const projected = action.chatUI?.projectResult?.(
      {},
      {
        id: "deck-1",
        title: "T",
        slideCount: 2,
        slides: [
          { id: "oversized", content: "x".repeat(12_001) },
          { id: "small", content: "<div>Small</div>" },
        ],
      },
    );

    expect(projected?.previews).toHaveLength(1);
    expect(projected?.previews[0]).toMatchObject({
      id: "small",
      layout: "content",
    });
    expect(projected?.previews[0].content).toContain("Small");
  });
});

describe("create-deck — save boundary", () => {
  const sourceBackedSlide = {
    id: "slide-source",
    sourceTsx: "export default function Slide() { return <div />; }",
    sourceHash: "stored-hash",
    revision: 3,
    content: "<div>Stored preview</div>",
  };

  const promptDraft = {
    id: "deck-prompt-attempt-1",
    designSystemId: null,
    generationContext: {
      originalPrompt: "Make a launch deck",
      files: [],
      designSystemId: null,
      referenceDeckId: null,
      mode: "new" as const,
      generationAttemptId: "attempt-1",
      generationStartedAt: 123,
      targetSlideCount: 5,
    },
  };
  const promptDraftArgs = {
    title: "Launch deck",
    slides: [],
    promptDraft,
  };

  it("creates a Home prompt draft with its stable ID and full initial context", async () => {
    const result = await action.run(promptDraftArgs);

    expect(result).toMatchObject({
      id: promptDraft.id,
      title: promptDraftArgs.title,
      slideCount: 0,
    });
    expect(insertedRow).toMatchObject({
      id: promptDraft.id,
      title: promptDraftArgs.title,
      designSystemId: null,
      ownerEmail: "owner@example.com",
      orgId: null,
    });
    expect(result.persistenceStatus).toBe("verified");
    expect(JSON.parse(insertedRow!.data as string)).toMatchObject({
      appId: "slides-2",
      title: promptDraftArgs.title,
      slides: [],
      generationContext: promptDraft.generationContext,
    });
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("declares only stable prompt-draft creation retries safe", () => {
    const retrySafe = action.retrySafe as
      | ((input: { promptDraft?: unknown }) => boolean)
      | undefined;

    expect(retrySafe?.({ promptDraft })).toBe(true);
    expect(retrySafe?.({})).toBe(false);
  });

  it("links the selected design system from a Home prompt draft", async () => {
    const selectedPromptDraft = {
      ...promptDraft,
      designSystemId: "ds-selected",
      generationContext: {
        ...promptDraft.generationContext,
        designSystemId: "ds-selected",
      },
    };

    const result = await action.run({
      ...promptDraftArgs,
      promptDraft: selectedPromptDraft,
    });

    expect(mockAssertAccess).toHaveBeenCalledWith(
      "design-system",
      "ds-selected",
      "viewer",
    );
    expect(insertedRow).toMatchObject({ designSystemId: "ds-selected" });
    expect(JSON.parse(String(insertedRow!.data))).toMatchObject({
      designSystemId: "ds-selected",
      generationContext: { designSystemId: "ds-selected" },
    });
    expect(result.designSystemId).toBe("ds-selected");
  });

  it("rejects conflicting top-level and prompt-draft design systems", async () => {
    await expect(
      action.run({
        ...promptDraftArgs,
        designSystemId: "ds-other",
      }),
    ).rejects.toMatchObject({
      errorCode: "prompt_draft_context_mismatch",
      statusCode: 400,
    });
    expect(insertFn).not.toHaveBeenCalled();
    expect(valuesFn).not.toHaveBeenCalled();
  });

  it("returns a matching prompt draft retry without writing it again", async () => {
    await action.run(promptDraftArgs);
    const persisted = insertedRow!;
    existingDeckRow = {
      id: String(persisted.id),
      title: String(persisted.title),
      data: String(persisted.data),
      designSystemId: persisted.designSystemId as string | null,
      ownerEmail: String(persisted.ownerEmail),
      orgId: persisted.orgId as string | null,
      updatedAt: String(persisted.updatedAt),
    };
    insertFn.mockClear();
    valuesFn.mockClear();
    mockNotifyClients.mockClear();
    mockRecordGenerationCreativeContext.mockClear();

    await expect(action.run(promptDraftArgs)).resolves.toMatchObject({
      id: promptDraft.id,
      postProcessStatus: "skipped",
    });
    expect(insertFn).not.toHaveBeenCalled();
    expect(valuesFn).not.toHaveBeenCalled();
    expect(mockNotifyClients).not.toHaveBeenCalled();
    expect(mockRecordGenerationCreativeContext).not.toHaveBeenCalled();
  });

  it("accepts a matching prompt draft after a concurrent ID insert", async () => {
    await action.run(promptDraftArgs);
    valuesFn.mockClear();
    const persisted = {
      id: String(insertedRow!.id),
      title: String(insertedRow!.title),
      data: String(insertedRow!.data),
      designSystemId: insertedRow!.designSystemId as string | null,
      ownerEmail: String(insertedRow!.ownerEmail),
      orgId: insertedRow!.orgId as string | null,
      updatedAt: String(insertedRow!.updatedAt),
    };
    existingDeckRow = undefined;
    limitFn
      .mockImplementationOnce(async () => [])
      .mockImplementationOnce(async () => [persisted]);
    insertReturningFn.mockRejectedValueOnce(
      Object.assign(new Error("duplicate ID"), { code: "23505" }),
    );
    insertFn.mockClear();
    mockNotifyClients.mockClear();

    await expect(action.run(promptDraftArgs)).resolves.toMatchObject({
      id: promptDraft.id,
      postProcessStatus: "skipped",
    });
    expect(insertFn).toHaveBeenCalledOnce();
    expect(valuesFn).toHaveBeenCalledOnce();
    expect(mockNotifyClients).not.toHaveBeenCalled();
  });

  it.each([
    "owner",
    "organization",
    "app",
    "generation context",
    "title",
    "design system",
    "aspect ratio",
    "slides",
  ])(
    "rejects a prompt draft ID conflict when the persisted %s differs",
    async (mismatch) => {
      await action.run(promptDraftArgs);
      const persisted = insertedRow!;
      const data = JSON.parse(String(persisted.data)) as Record<
        string,
        unknown
      >;
      if (mismatch === "generation context") {
        data.generationContext = {
          ...promptDraft.generationContext,
          originalPrompt: "Different brief",
        };
      }
      if (mismatch === "app") data.appId = "slides";
      if (mismatch === "title") data.title = "Different title";
      if (mismatch === "design system") data.designSystemId = "ds-other";
      if (mismatch === "aspect ratio") data.aspectRatio = "9:16";
      if (mismatch === "slides") {
        data.slides = [
          { id: "existing-slide", content: "<div>Existing</div>" },
        ];
      }
      existingDeckRow = {
        id: String(persisted.id),
        title:
          mismatch === "title" ? "Different title" : String(persisted.title),
        data: JSON.stringify(data),
        designSystemId:
          mismatch === "design system"
            ? "ds-other"
            : (persisted.designSystemId as string | null),
        ownerEmail:
          mismatch === "owner"
            ? "different-owner@example.com"
            : String(persisted.ownerEmail),
        orgId:
          mismatch === "organization"
            ? "org-other"
            : (persisted.orgId as string | null),
        updatedAt: String(persisted.updatedAt),
      };
      insertFn.mockClear();
      valuesFn.mockClear();

      await expect(action.run(promptDraftArgs)).rejects.toMatchObject({
        statusCode: 409,
        errorCode: "deck_create_conflict",
      });
      expect(insertFn).not.toHaveBeenCalled();
      expect(valuesFn).not.toHaveBeenCalled();
      expect(updatedFields).toBeUndefined();
      expect(whereUpdateFn).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["markerless legacy", { title: "Legacy", slides: [] }],
    ["foreign", { appId: "slides", title: "Other app", slides: [] }],
  ])("rejects replacement of a %s deck before writing", async (_kind, data) => {
    existingDeckRow = {
      id: "deck-existing",
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify(data),
    };

    await expect(
      action.run({
        title: "T",
        deckId: "deck-existing",
        slides: [{ id: "slide-1", content: "<div>New</div>" }],
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "deck_not_found",
    });
    expect(mockCreateDeckVersionSnapshot).not.toHaveBeenCalled();
    expect(updatedFields).toBeUndefined();
    expect(whereUpdateFn).not.toHaveBeenCalled();
  });

  it("rejects replacing a retained source-backed slide's source", async () => {
    existingDeckRow = {
      id: "deck-existing",
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        appId: "slides-2",
        title: "T",
        slides: [sourceBackedSlide],
      }),
    };

    await expect(
      action.run({
        title: "T",
        deckId: "deck-existing",
        slides: [
          {
            id: sourceBackedSlide.id,
            sourceTsx:
              "export default function Slide() { return <section />; }",
          },
        ],
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "slide_source_action_required",
    });
    expect(mockCreateDeckVersionSnapshot).not.toHaveBeenCalled();
    expect(updatedFields).toBeUndefined();
    expect(whereUpdateFn).not.toHaveBeenCalled();
  });

  it("rejects replacing a retained source-backed slide with legacy HTML", async () => {
    existingDeckRow = {
      id: "deck-existing",
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        appId: "slides-2",
        title: "T",
        slides: [sourceBackedSlide],
      }),
    };

    await expect(
      action.run({
        title: "T",
        deckId: "deck-existing",
        slides: [{ id: sourceBackedSlide.id, content: "<div>Legacy</div>" }],
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "slide_source_action_required",
    });
    expect(mockCreateDeckVersionSnapshot).not.toHaveBeenCalled();
    expect(updatedFields).toBeUndefined();
    expect(whereUpdateFn).not.toHaveBeenCalled();
  });

  it("allows full replacement when a source-backed slide is removed", async () => {
    existingDeckRow = {
      id: "deck-existing",
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        appId: "slides-2",
        title: "T",
        slides: [sourceBackedSlide],
      }),
    };

    await expect(
      action.run({
        title: "T",
        deckId: "deck-existing",
        slides: [{ id: "replacement-slide", content: "<div>Legacy</div>" }],
      }),
    ).resolves.toBeDefined();
    expect(mockCreateDeckVersionSnapshot).toHaveBeenCalledOnce();
    expect(updatedFields).toBeDefined();
    expect(whereUpdateFn).toHaveBeenCalledOnce();
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "deck",
      "deck-existing",
      "editor",
    );
  });

  it("does not report a replacement when its SQL readback differs from the write", async () => {
    existingDeckRow = {
      id: "deck-existing",
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({ appId: "slides-2", title: "T", slides: [] }),
    };
    updateReturningFn.mockResolvedValueOnce([
      {
        id: "deck-existing",
        title: "T2",
        data: JSON.stringify({ appId: "slides-2", title: "T2", slides: [] }),
        designSystemId: null,
        ownerEmail: undefined,
        orgId: null,
        updatedAt: "2026-01-01T00:00:00.001Z",
      },
    ] as never);

    await expect(
      action.run({
        title: "T2",
        slides: [{ id: "s1", content: "<div>Replacement</div>" }],
        deckId: "deck-existing",
      }),
    ).rejects.toMatchObject({ errorCode: "deck_persistence_unverified" });
    expect(
      mockTrack.mock.calls.some(([name]) => name === "generation_completed"),
    ).toBe(false);
  });

  it("does not report creation when its SQL readback differs from the write", async () => {
    insertReturningFn.mockResolvedValueOnce([
      {
        id: "another-deck",
        title: "T",
        data: JSON.stringify({ appId: "slides-2", title: "T", slides: [] }),
        designSystemId: null,
        ownerEmail: "owner@example.com",
        orgId: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ] as never);

    await expect(
      action.run({
        title: "T",
        slides: [{ id: "s1", content: "<div>Slide</div>" }],
      }),
    ).rejects.toMatchObject({ errorCode: "deck_persistence_unverified" });
    expect(
      mockTrack.mock.calls.some(([name]) => name === "generation_completed"),
    ).toBe(false);
  });

  it("refuses slides that carry rendered editor markup", async () => {
    await expect(
      action.run({
        title: "T",
        slides: [
          {
            id: "slide-1",
            content:
              '<div class="fmd-slide"><p data-builder-id="b-1">Hi</p></div>',
          },
        ],
      }),
    ).rejects.toMatchObject({ errorCode: "render_artifact_in_slide_content" });
    expect(insertedRow).toBeUndefined();
  });

  it("lets a replacement keep a stored slide's markers but not add new ones", async () => {
    const legacy =
      '<div class="fmd-slide"><p data-builder-id="b-1">Legacy</p></div>';
    existingDeckRow = {
      id: "deck-existing",
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        appId: "slides-2",
        title: "T",
        slides: [{ id: "slide-1", content: legacy }],
      }),
    };
    await expect(
      action.run({
        title: "T",
        deckId: "deck-existing",
        slides: [{ id: "slide-1", content: legacy.replace("Legacy", "Kept") }],
      }),
    ).resolves.toBeDefined();
    await expect(
      action.run({
        title: "T",
        deckId: "deck-existing",
        slides: [
          {
            id: "slide-1",
            content: `${legacy}<p contenteditable="true">x</p>`,
          },
        ],
      }),
    ).rejects.toMatchObject({ errorCode: "render_artifact_in_slide_content" });
  });
});

describe("create-deck — hygiene warnings", () => {
  const slidesWithProblems = [
    {
      id: "slide-1",
      content:
        '<div class="fmd-slide"><svg viewBox="0 0 4 4"></svg><footer>01 / 03</footer></div>',
    },
    { id: "slide-2", content: '<div class="fmd-slide"><p>Fine</p></div>' },
    {
      id: "slide-3",
      content:
        '<div class="fmd-slide"><svg></svg><footer>03 / 03</footer></div>',
    },
  ];

  it("groups warnings across the new deck's slides without blocking the write", async () => {
    const result = (await action.run({
      title: "Quarterly update",
      slides: slidesWithProblems,
    })) as { hygieneWarnings?: { warnings: Array<Record<string, unknown>> } };

    expect(insertedRow).toBeDefined();
    expect(result.hygieneWarnings?.warnings).toEqual([
      expect.objectContaining({
        code: "inline-svg",
        severity: "error",
        count: 2,
        slideIds: ["slide-1", "slide-3"],
      }),
      expect.objectContaining({
        code: "typed-page-number",
        count: 2,
        slideIds: ["slide-1", "slide-3"],
      }),
    ]);
  });

  it("also reports them when it replaces an existing deck", async () => {
    existingDeckRow = {
      id: "deck-1",
      data: JSON.stringify({ appId: "slides-2", title: "Old", slides: [] }),
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const result = (await action.run({
      title: "Old",
      deckId: "deck-1",
      slides: slidesWithProblems,
    })) as { hygieneWarnings?: { warnings: Array<Record<string, unknown>> } };

    expect(updatedFields).toBeDefined();
    expect(result.hygieneWarnings?.warnings.map((w) => w.code)).toEqual([
      "inline-svg",
      "typed-page-number",
    ]);
  });

  it("omits the field for a clean deck", async () => {
    const result = await action.run({
      title: "Quarterly update",
      slides: [slidesWithProblems[1]],
    });

    expect(result).not.toHaveProperty("hygieneWarnings");
  });
});

describe("create-deck — aspectRatio", () => {
  it("defaults omitted slides to an empty deck", async () => {
    await action.run({
      title: "T",
      aspectRatio: "16:9",
      contextModeOverride: "off",
    } as never);

    expect(insertedRow).toBeDefined();
    const data = JSON.parse(insertedRow!.data as string);
    expect(data.slides).toEqual([]);
  });

  it("opens a newly created empty deck for incremental slide generation", async () => {
    const result = await action.run({ title: "T", slides: [] });

    expect(result.slideCount).toBe(0);
    expect(mockWriteAppState).toHaveBeenCalledWith(
      "slides-2:navigate:slides-tab-1",
      expect.objectContaining({
        app: "slides-2",
        view: "editor",
        deckId: result.id,
        _writeId: expect.any(String),
      }),
    );
  });

  it("returns a persisted deck when post-insert work fails", async () => {
    mockNotifyClients.mockRejectedValueOnce(
      new Error("notification failed with private details"),
    );

    const result = await action.run({ title: "T", slides: [] });

    expect(insertedRow).toBeDefined();
    expect(result).toMatchObject({
      id: expect.any(String),
      postProcessStatus: "failed",
      persistenceStatus: "verified",
    });
    expect(mockRecordGenerationCreativeContext).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactType: "deck",
        artifactId: result.id,
      }),
    );
    const unresolved = mockTrack.mock.calls.find(
      ([name]) => name === "generation_outcome_unresolved",
    );
    expect(unresolved?.[1]).toMatchObject({
      output_id: result.id,
      outcome: "unresolved",
      reason: "postprocess_failed",
      persisted_output: true,
      error_type: "Error",
    });
  });

  it("records provenance before a failing app-state write", async () => {
    mockWriteAppState.mockRejectedValueOnce(new Error("state write failed"));

    const result = await action.run({ title: "T", slides: [] });

    expect(result.postProcessStatus).toBe("failed");
    expect(mockRecordGenerationCreativeContext).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactType: "deck",
        artifactId: result.id,
      }),
    );
  });

  it("omits aspectRatio from the data JSON when not provided (legacy default)", async () => {
    await action.run({ title: "T", slides: [] });
    expect(insertedRow).toBeDefined();
    const data = JSON.parse(insertedRow!.data as string);
    expect("aspectRatio" in data).toBe(false);
  });

  it("includes aspectRatio in the data JSON when provided on a new deck", async () => {
    await action.run({ title: "T", slides: [], aspectRatio: "9:16" });
    const data = JSON.parse(insertedRow!.data as string);
    expect(data.aspectRatio).toBe("9:16");
  });

  it("uses the user's default design system when creating a new deck without an explicit one", async () => {
    defaultDesignSystemId = "ds-default";

    const result = await action.run({ title: "T", slides: [] });

    expect(insertedRow!.designSystemId).toBe("ds-default");
    expect(result.designSystemId).toBe("ds-default");
    const data = JSON.parse(insertedRow!.data as string);
    expect(data.designSystemId).toBe("ds-default");
  });

  it("uses an explicit design system instead of the default", async () => {
    defaultDesignSystemId = "ds-default";

    const result = await action.run({
      title: "T",
      slides: [],
      designSystemId: "ds-explicit",
    });

    expect(mockAssertAccess).toHaveBeenCalledWith(
      "design-system",
      "ds-explicit",
      "viewer",
    );
    expect(insertedRow!.designSystemId).toBe("ds-explicit");
    expect(result.designSystemId).toBe("ds-explicit");
    expect(result.designSystem).toMatchObject({
      status: "available",
      id: "ds-explicit",
      agentContext: "Use --brand-accent: #123456.",
    });
    expect(mockGetDesignSystemRun).toHaveBeenCalledWith(
      expect.objectContaining({ compact: "false" }),
    );
    const data = JSON.parse(insertedRow!.data as string);
    expect(data.designSystemId).toBe("ds-explicit");
  });

  it("resolves designSystem by exact title, case-insensitively, when no id is given", async () => {
    titleQueryRows = [{ id: "ds-acme" }];

    const result = await action.run({
      title: "T",
      slides: [],
      designSystem: "acme",
    });

    expect(insertedRow!.designSystemId).toBe("ds-acme");
    expect(result.designSystemId).toBe("ds-acme");
  });

  it("fails with design_system_not_found for an unknown designSystem title", async () => {
    titleQueryRows = [];

    await expect(
      action.run({ title: "T", slides: [], designSystem: "Nonexistent" }),
    ).rejects.toMatchObject({
      errorCode: "design_system_not_found",
      statusCode: 404,
    });
    expect(insertedRow).toBeUndefined();
  });

  it("fails with design_system_ambiguous when two rows share a title", async () => {
    titleQueryRows = [{ id: "ds-a" }, { id: "ds-b" }];

    await expect(
      action.run({ title: "T", slides: [], designSystem: "Acme" }),
    ).rejects.toMatchObject({
      errorCode: "design_system_ambiguous",
      statusCode: 409,
    });
    expect(insertedRow).toBeUndefined();
  });

  it("prefers an explicit designSystemId over a designSystem title", async () => {
    titleQueryRows = [{ id: "ds-by-title" }];

    const result = await action.run({
      title: "T",
      slides: [],
      designSystemId: "ds-explicit",
      designSystem: "Acme",
    });

    expect(mockAssertAccess).toHaveBeenCalledWith(
      "design-system",
      "ds-explicit",
      "viewer",
    );
    expect(titleWhereFn).not.toHaveBeenCalled();
    expect(insertedRow!.designSystemId).toBe("ds-explicit");
    expect(result.designSystemId).toBe("ds-explicit");
  });

  it("returns a workspace-scoped deck URL when the app is mounted under a base path", async () => {
    vi.stubEnv("WORKSPACE_GATEWAY_URL", "https://workspace.example.test");
    vi.stubEnv("APP_BASE_PATH", "/slides");

    const result = await action.run({ title: "T", slides: [] });

    expect(result.url).toMatch(
      /^https:\/\/workspace\.example\.test\/slides\/deck\/deck-/,
    );
  });

  it("preserves the existing aspectRatio when bulk-replacing slides without specifying it", async () => {
    existingDeckRow = {
      id: "deck-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        appId: "slides-2",
        title: "T",
        slides: [],
        aspectRatio: "1:1",
      }),
    };
    await action.run({
      title: "T2",
      slides: [{ id: "s1", content: "<div></div>" }],
      deckId: "deck-1",
    });
    expect(updatedFields).toBeDefined();
    const data = JSON.parse(updatedFields!.data as string);
    expect(data.aspectRatio).toBe("1:1");
  });

  it("honors a designSystem title when replacing an existing deck", async () => {
    existingDeckRow = {
      id: "deck-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({ appId: "slides-2", title: "T", slides: [] }),
    };
    titleQueryRows = [{ id: "ds-acme" }];
    const result = await action.run({
      title: "T2",
      slides: [],
      deckId: "deck-1",
      designSystem: "Acme",
    });
    expect(updatedFields!.designSystemId).toBe("ds-acme");
    expect(JSON.parse(updatedFields!.data as string).designSystemId).toBe(
      "ds-acme",
    );
    expect(result.designSystemId).toBe("ds-acme");
  });

  it("keeps a legacy JSON design-system link when replacing a deck", async () => {
    existingDeckRow = {
      id: "deck-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        appId: "slides-2",
        title: "T",
        slides: [],
        designSystemId: "ds-legacy",
      }),
    };
    const result = await action.run({
      title: "T2",
      slides: [],
      deckId: "deck-1",
    });
    expect(updatedFields!.designSystemId).toBe("ds-legacy");
    expect(result.designSystemId).toBe("ds-legacy");
  });

  it("scopes existing-deck navigation to the invoking browser tab", async () => {
    existingDeckRow = {
      id: "deck-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({ appId: "slides-2", title: "T", slides: [] }),
    };

    await action.run({ title: "T2", slides: [], deckId: "deck-1" });

    expect(mockWriteAppState).toHaveBeenCalledWith(
      "slides-2:navigate:slides-tab-1",
      expect.objectContaining({
        app: "slides-2",
        view: "editor",
        deckId: "deck-1",
      }),
    );
  });

  it("overwrites the existing aspectRatio when one is provided on bulk replace", async () => {
    existingDeckRow = {
      id: "deck-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        appId: "slides-2",
        title: "T",
        slides: [],
        aspectRatio: "16:9",
      }),
    };
    await action.run({
      title: "T",
      slides: [],
      deckId: "deck-1",
      aspectRatio: "4:5",
    });
    const data = JSON.parse(updatedFields!.data as string);
    expect(data.aspectRatio).toBe("4:5");
  });

  it("rejects an unknown aspect ratio at the schema boundary", async () => {
    await expect(
      action.run({
        title: "T",
        slides: [],
        aspectRatio: "21:9" as never,
      }),
    ).rejects.toThrow();
    expect(insertedRow).toBeUndefined();
  });

  it("persists speaker notes for bulk-created slides", async () => {
    await action.run({
      title: "T",
      slides: [
        {
          id: "s1",
          content: "<div>Slide</div>",
          notes: "Explain the decision behind this slide.",
        },
      ],
    });

    const data = JSON.parse(insertedRow!.data as string);
    expect(data.slides[0]).toMatchObject({
      id: "s1",
      notes: "Explain the decision behind this slide.",
    });
    expect(data.slides[0].content).toBe("<div>Slide</div>");
  });

  it("splits a static Page array alias into ordered persisted slides", async () => {
    const sourceTsx = `
function Cover() { return <main><h1>Cover</h1></main>; }
function Body() { return <main><h1>Body</h1></main>; }
export const meta = { theme: "aero" };
const pages: Page[] = [Cover, Body];
export const notes = ["Cover notes", "Body notes"];
export default pages;
`;
    mockGetOrgId.mockReturnValue("org-1");

    await action.run({
      title: "Source deck",
      slides: [{ id: "source-page", sourceTsx }],
    });

    const slides = JSON.parse(insertedRow!.data as string).slides;
    expect(slides).toMatchObject([
      {
        id: "source-page",
        content: "<div>Cover</div>",
        revision: 1,
        sourceHash: "hash-cover",
        notes: "Cover notes",
      },
      {
        id: "source-page-page-2",
        content: "<div>Body</div>",
        revision: 1,
        sourceHash: "hash-body",
        notes: "Body notes",
      },
    ]);
    expect(slides[0].sourceTsx).toContain("export default Cover;");
    expect(slides[0].sourceTsx).toContain('theme: "aero"');
    expect(slides[1].sourceTsx).toContain("export default Body;");
    expect(slides[1].sourceTsx).toContain('theme: "aero"');
    expect(mockCompileSlideSource).toHaveBeenCalledTimes(2);
    expect(mockCompileSlideSource.mock.calls[0]?.[1]).toEqual({
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    expect(insertedRow).toMatchObject({ orgId: "org-1" });
    expect(mockCompileSlideSource.mock.calls[0]?.[0]).not.toContain(
      "export const notes",
    );
  });

  it("does not persist source slides rejected by the source validator", async () => {
    mockCompileSlideSource.mockRejectedValueOnce(
      new Error("source validation failed"),
    );

    await expect(
      action.run({
        title: "Invalid source",
        slides: [
          {
            id: "source-slide",
            sourceTsx: "export default function Slide() { return <div />; }",
          },
        ],
      }),
    ).rejects.toThrow("source validation failed");
    expect(insertFn).not.toHaveBeenCalled();
    expect(insertedRow).toBeUndefined();
  });

  it("repairs duplicate slide IDs before persisting a deck", async () => {
    const result = await action.run({
      title: "T",
      slides: [
        { id: "slide-a", content: "<div>First</div>" },
        { id: "slide-a", content: "<div>Second</div>" },
      ],
    });
    const data = JSON.parse(insertedRow!.data as string);
    const ids = data.slides.map((slide: { id: string }) => slide.id);

    expect(new Set(ids).size).toBe(2);
    expect(result.slides.map((slide) => slide.id)).toEqual(ids);
    expect(data.slides[1].content).toBe("<div>Second</div>");
  });

  it("rebinds slide-scoped Creative Context labels when repairing IDs", async () => {
    const label = {
      itemId: "item-1",
      itemVersionId: "version-1",
      kind: "slide",
      label: "Referenced slide",
      dataRole: "untrusted-reference" as const,
      elementId: "slide-a",
    };
    const result = await action.run({
      title: "T",
      slides: [
        {
          id: "slide-a",
          content: "<div>First</div>",
          creativeContextReuseLabels: [label],
        },
        {
          id: "slide-a",
          content: "<div>Second</div>",
          creativeContextReuseLabels: [label],
        },
      ],
    });
    const ids = result.slides.map((slide) => slide.id);

    expect(result.slides[0].creativeContextReuseLabels?.[0].elementId).toBe(
      "slide-a",
    );
    expect(result.slides[1].creativeContextReuseLabels?.[0].elementId).toBe(
      ids[1],
    );
  });
});

describe("create-deck — generation lifecycle tracking", () => {
  function trackedEvents() {
    return mockTrack.mock.calls.map(([name, properties]) => ({
      name,
      properties: properties as Record<string, unknown>,
    }));
  }

  it("does not count an agent rewrite of an existing deck as a creation start", async () => {
    existingDeckRow = {
      id: "deck-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({ appId: "slides-2", title: "T", slides: [] }),
    };

    await action.run({
      title: "T",
      slides: [{ id: "s1", content: "<div></div>" }],
      deckId: "deck-1",
    });

    const names = trackedEvents().map((event) => event.name);
    expect(names).not.toContain("deck_creation_started");
    expect(names).not.toContain("deck_created");
    expect(names).toContain("deck_edited");
  });

  it("accepts only bounded URL-safe browser generation attempt IDs", () => {
    const base = { title: "T", slides: [], deckId: "deck-1" };

    expect(
      action.schema.safeParse({
        ...base,
        generationAttemptId: "browser_attempt-123",
      }).success,
    ).toBe(true);
    expect(
      action.schema.safeParse({ ...base, generationAttemptId: "bad id" })
        .success,
    ).toBe(false);
    expect(
      action.schema.safeParse({
        ...base,
        generationAttemptId: "a".repeat(65),
      }).success,
    ).toBe(false);
  });

  it("accepts slide source up to 256 KiB and rejects UTF-8 byte overflow", () => {
    const sourceAtLimit = "x".repeat(256 * 1024);
    const sourceOverLimit = "é".repeat(128 * 1024 + 1);
    const parse = (sourceTsx: string) =>
      action.schema.safeParse({
        title: "T",
        slides: [{ id: "s1", sourceTsx }],
      });

    expect(parse(sourceAtLimit).success).toBe(true);
    expect(sourceOverLimit.length).toBeLessThan(256 * 1024);
    expect(parse(sourceOverLimit).success).toBe(false);
  });

  it("does not report bulk generation complete when post-processing fails", async () => {
    mockNotifyClients.mockRejectedValueOnce(new Error("notification failed"));

    const result = await action.run({
      title: "T",
      slides: [{ id: "s1", content: "<div>Slide</div>" }],
    });
    const events = trackedEvents();

    expect(result.postProcessStatus).toBe("failed");
    expect(events.some((event) => event.name === "generation_completed")).toBe(
      false,
    );
    expect(
      events.find((event) => event.name === "generation_outcome_unresolved")
        ?.properties,
    ).toMatchObject({
      output_id: result.id,
      outcome: "unresolved",
      reason: "postprocess_failed",
      persisted_output: true,
      started_at_ms: expect.any(Number),
      ended_at_ms: expect.any(Number),
      duration_ms: expect.any(Number),
    });
  });

  it("does not start a generation lifecycle for an empty existing-deck replacement", async () => {
    existingDeckRow = {
      id: "deck-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        appId: "slides-2",
        title: "T",
        slides: [{ id: "s1" }],
        generationContext: {
          generationAttemptId: "previous-attempt",
          generationMode: "action",
        },
      }),
    };

    const result = await action.run({
      title: "T",
      slides: [],
      deckId: "deck-1",
    });

    expect(result.slideCount).toBe(0);
    const events = trackedEvents();
    expect(events.some((event) => event.name.startsWith("generation_"))).toBe(
      false,
    );
    expect(events.some((event) => event.name === "deck_edited")).toBe(true);
    expect(
      events.find((event) => event.name === "deck_edited")?.properties,
    ).not.toHaveProperty("generation_attempt_id");
    expect(JSON.parse(updatedFields!.data as string)).not.toHaveProperty(
      "generationContext",
    );
  });

  it.each([
    [
      "client notification",
      () =>
        mockNotifyClients.mockRejectedValueOnce(
          new Error("notification failed"),
        ),
    ],
    [
      "app-state update",
      () => mockWriteAppState.mockRejectedValueOnce(new Error("state failed")),
    ],
    [
      "provenance write",
      () =>
        mockRecordGenerationCreativeContext.mockRejectedValueOnce(
          new Error("provenance failed"),
        ),
    ],
  ] as const)(
    "returns the persisted replacement when %s post-processing fails",
    async (_step, failPostProcess) => {
      existingDeckRow = {
        id: "deck-1",
        updatedAt: "2026-01-01T00:00:00.000Z",
        data: JSON.stringify({
          appId: "slides-2",
          title: "T",
          slides: [],
          designSystemId: "ds-linked",
        }),
      };
      failPostProcess();

      const result = await action.run({
        title: "T2",
        slides: [{ id: "s1", content: "<div>Replacement</div>" }],
        deckId: "deck-1",
      });
      const events = trackedEvents();

      expect(updatedFields).toBeDefined();
      expect(JSON.parse(updatedFields!.data as string).slides).toHaveLength(1);
      expect(result).toMatchObject({
        id: "deck-1",
        postProcessStatus: "failed",
      });
      expect(
        events.some((event) => event.name === "generation_completed"),
      ).toBe(false);
      expect(events.some((event) => event.name === "generation_failed")).toBe(
        false,
      );
      expect(
        events.find((event) => event.name === "generation_outcome_unresolved")
          ?.properties,
      ).toMatchObject({
        output_id: "deck-1",
        outcome: "unresolved",
        reason: "postprocess_failed",
        persisted_output: true,
        started_at_ms: expect.any(Number),
        ended_at_ms: expect.any(Number),
        duration_ms: expect.any(Number),
      });
    },
  );

  it("joins generation start and completion with one opaque attempt id", async () => {
    const result = await action.run({
      title: "T",
      slides: [{ id: "s1", content: "<div>Slide</div>" }],
    });

    const events = trackedEvents();
    const started = events.find((event) => event.name === "generation_started");
    const completed = events.find(
      (event) => event.name === "generation_completed",
    );

    expect(started?.properties.generation_attempt_id).toEqual(
      completed?.properties.generation_attempt_id,
    );
    expect(started?.properties.generation_attempt_id).toEqual(
      expect.any(String),
    );
    expect(JSON.parse(insertedRow!.data as string)).not.toHaveProperty(
      "generationContext",
    );
    expect(result.id).toBe(completed?.properties.output_id);
    expect(started?.properties).not.toHaveProperty("title");
    expect(started?.properties).not.toHaveProperty("prompt");
    expect(completed?.properties).toMatchObject({
      output_type: "deck",
      slide_count: 1,
      started_at_ms: expect.any(Number),
      ended_at_ms: expect.any(Number),
      duration_ms: expect.any(Number),
    });
    expect(completed?.properties.ended_at_ms).toBeGreaterThanOrEqual(
      completed?.properties.started_at_ms as number,
    );
  });

  it("clears prior incremental context when an action-owned bulk attempt replaces a deck", async () => {
    existingDeckRow = {
      id: "deck-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        appId: "slides-2",
        title: "T",
        slides: [],
        generationContext: {
          generationAttemptId: "previous-attempt",
          generationMode: "action",
        },
      }),
    };

    await action.run({
      title: "T2",
      slides: [{ id: "s1", content: "<div>Replacement</div>" }],
      deckId: "deck-1",
    });

    const started = trackedEvents().find(
      (event) => event.name === "generation_started",
    );
    expect(JSON.parse(updatedFields!.data as string)).not.toHaveProperty(
      "generationContext",
    );
    expect(started?.properties.generation_attempt_id).not.toBe(
      "previous-attempt",
    );
  });

  it.each(["new deck", "replacement deck"] as const)(
    "reports completion when the slides persist but the design system is unavailable for a %s",
    async (mode) => {
      mockGetDesignSystemRun.mockResolvedValueOnce({
        title: "Design system",
        agentContext: "",
      });
      const args = {
        title: "T",
        slides: [{ id: "s1", content: "<div>Slide</div>" }],
        designSystemId: "ds-linked",
        ...(mode === "replacement deck" ? { deckId: "deck-1" } : {}),
      };
      if (mode === "replacement deck") {
        existingDeckRow = {
          id: "deck-1",
          updatedAt: "2026-01-01T00:00:00.000Z",
          data: JSON.stringify({ appId: "slides-2", title: "T", slides: [] }),
        };
      }

      const result = await action.run(args);
      const completed = trackedEvents().find(
        (event) => event.name === "generation_completed",
      );

      expect(result.postProcessStatus).toBe("completed");
      expect(completed?.properties).toMatchObject({
        output_id: result.id,
        slide_count: 1,
        design_system_status: "unavailable",
      });
      expect(
        trackedEvents().some(
          (event) => event.name === "generation_outcome_unresolved",
        ),
      ).toBe(false);
    },
  );

  it("joins the browser-owned attempt without duplicating its lifecycle events", async () => {
    const generationAttemptId = "browser_attempt_123";
    existingDeckRow = {
      id: "deck-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        appId: "slides-2",
        title: "T",
        slides: [],
        generationContext: { generationAttemptId },
      }),
    };
    mockTrack("generation_started", {
      generation_attempt_id: generationAttemptId,
      source: "new_deck_prompt",
    });

    await action.run({
      title: "T2",
      slides: [{ id: "s1", content: "<div>Slide</div>" }],
      deckId: "deck-1",
      generationAttemptId,
    });

    const events = trackedEvents();
    expect(
      events.filter((event) => event.name === "generation_started"),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.name === "generation_completed"),
    ).toHaveLength(0);
    expect(
      events.find((event) => event.name === "deck_edited")?.properties,
    ).toMatchObject({ generation_attempt_id: generationAttemptId });
  });

  it("does not emit a terminal lifecycle event when the browser owns a failing attempt", async () => {
    const generationAttemptId = "browser_attempt_123";
    existingDeckRow = {
      id: "deck-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        appId: "slides-2",
        title: "T",
        slides: [],
        generationContext: { generationAttemptId },
      }),
    };
    mockValidateGenerationCreativeContext.mockRejectedValueOnce(
      new Error("generation failed"),
    );

    await expect(
      action.run({
        title: "T2",
        slides: [{ id: "s1", content: "<div>Slide</div>" }],
        deckId: "deck-1",
        generationAttemptId,
      }),
    ).rejects.toThrow("generation failed");

    expect(
      trackedEvents().some((event) =>
        [
          "generation_completed",
          "generation_failed",
          "generation_stuck",
          "generation_cancelled",
        ].includes(event.name),
      ),
    ).toBe(false);
  });

  it("rejects a browser attempt ID that does not match the deck context without lifecycle events", async () => {
    existingDeckRow = {
      id: "deck-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        appId: "slides-2",
        title: "T",
        slides: [],
        generationContext: { generationAttemptId: "browser_attempt_other" },
      }),
    };

    await expect(
      action.run({
        title: "T2",
        slides: [{ id: "s1", content: "<div>Slide</div>" }],
        deckId: "deck-1",
        generationAttemptId: "browser_attempt_123",
      }),
    ).rejects.toThrow("does not match");

    expect(trackedEvents()).toEqual([]);
  });

  it("keeps incremental empty-deck generation open for later add-slide calls", async () => {
    const result = await action.run({ title: "T", slides: [] });

    const events = trackedEvents();
    expect(events.map((event) => event.name)).toEqual([
      "generation_started",
      "deck_creation_started",
      "generation_request_accepted",
      "deck_created",
    ]);
    expect(events[1]?.properties).toMatchObject({
      generation_attempt_id: events[0]?.properties.generation_attempt_id,
      output_type: "deck",
      creation_method: "generated",
      mode: "new",
      is_retry: false,
    });
    // An agent-created deck has no prompt or attachments to report: unknown,
    // so the event must not claim "none".
    for (const unknownFact of [
      "has_text_prompt",
      "prompt_length_bucket",
      "attachment_count",
      "attachment_types",
      "has_reference_deck",
    ]) {
      expect(events[1]?.properties).not.toHaveProperty(unknownFact);
    }
    expect(events[2]?.properties).toMatchObject({
      generation_mode: "incremental",
      slide_count: 0,
      started_at_ms: expect.any(Number),
      ended_at_ms: expect.any(Number),
      duration_ms: expect.any(Number),
    });
    expect(events[2]?.properties).not.toHaveProperty("prompt");
    expect(events[3]?.properties).toMatchObject({
      output_id: result.id,
      creation_method: "generated",
      slide_count: 0,
    });
    expect(JSON.parse(insertedRow!.data as string).generationContext).toEqual({
      generationAttemptId: events[0]?.properties.generation_attempt_id,
      generationMode: "action",
      generationStartedAt: events[0]?.properties.started_at_ms,
    });
    expect(result.slideCount).toBe(0);
  });

  it.each([
    ["generation_failed", undefined, "failed", "action_error"],
    ["generation_stuck", "no_progress", "stuck", "stuck"],
    ["generation_cancelled", "user_stuck_cancel", "cancelled", "cancelled"],
  ] as const)(
    "emits %s with the attempt id and bounded failure fields",
    async (eventName, abortReason, outcome, failureCode) => {
      const controller = new AbortController();
      if (abortReason) controller.abort(abortReason);
      mockValidateGenerationCreativeContext.mockRejectedValueOnce(
        new Error("generation failed with private details"),
      );

      await expect(
        action.run(
          { title: "T", slides: [] },
          { caller: "tool", signal: controller.signal },
        ),
      ).rejects.toThrow("generation failed");

      const events = trackedEvents();
      const started = events.find(
        (event) => event.name === "generation_started",
      );
      const terminal = events.find((event) => event.name === eventName);

      expect(terminal?.properties.generation_attempt_id).toBe(
        started?.properties.generation_attempt_id,
      );
      expect(terminal?.properties).toMatchObject({
        outcome,
        failure_code: failureCode,
        error_type: "Error",
      });
      expect(terminal?.properties).not.toHaveProperty("error_message");
    },
  );
});
