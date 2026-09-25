import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock dependencies BEFORE importing the action ---

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
  | { id: string; data: string; updatedAt: string }
  | undefined = undefined;
let defaultDesignSystemId: string | undefined = undefined;
let titleQueryRows: Array<{ id: string }> = [];
let insertedRow: Record<string, unknown> | undefined = undefined;
let updatedFields: Record<string, unknown> | undefined = undefined;

// db.select().from(...).where(...).limit(...)
const limitFn = vi.fn(async () => (existingDeckRow ? [existingDeckRow] : []));
const defaultDesignSystemLimitFn = vi.fn(async () =>
  defaultDesignSystemId ? [{ id: defaultDesignSystemId }] : [],
);
// resolveDesignSystemIdByTitle has no `.limit()` — it awaits `.where(...)`
// directly, so its clause is distinguished by the accessFilter sentinel that
// leads its `and(...)` conditions rather than by a subsequent chained call.
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

// db.insert().values(...)
const valuesFn = vi.fn(async (row: Record<string, unknown>) => {
  insertedRow = row;
});
const insertFn = vi.fn(() => ({ values: valuesFn }));

// db.update().set(...).where(...)
const whereUpdateFn = vi.fn(async () => ({ rowsAffected: 1 }));
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
  createDeckVersionSnapshot: vi.fn(async () => ({ created: true })),
}));

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
  mockTrack.mockClear();
  mockGetUserEmail.mockReturnValue("owner@example.com");
  mockGetOrgId.mockReturnValue(null);
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
      "navigate:slides-tab-1",
      expect.objectContaining({
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
      data: JSON.stringify({ title: "T", slides: [], aspectRatio: "1:1" }),
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
      data: JSON.stringify({ title: "T", slides: [] }),
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
      data: JSON.stringify({ title: "T", slides: [] }),
    };

    await action.run({ title: "T2", slides: [], deckId: "deck-1" });

    expect(mockWriteAppState).toHaveBeenCalledWith(
      "navigate:slides-tab-1",
      expect.objectContaining({ view: "editor", deckId: "deck-1" }),
    );
  });

  it("overwrites the existing aspectRatio when one is provided on bulk replace", async () => {
    existingDeckRow = {
      id: "deck-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({ title: "T", slides: [], aspectRatio: "16:9" }),
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
    });
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
    expect(JSON.parse(insertedRow!.data as string).generationContext).toEqual({
      generationAttemptId: started?.properties.generation_attempt_id,
      generationMode: "action",
    });
    expect(result.id).toBe(completed?.properties.output_id);
    expect(started?.properties).not.toHaveProperty("title");
    expect(started?.properties).not.toHaveProperty("prompt");
    expect(completed?.properties).toMatchObject({
      output_type: "deck",
      slide_count: 1,
      duration_ms: expect.any(Number),
    });
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
          data: JSON.stringify({ title: "T", slides: [] }),
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
      "generation_request_accepted",
      "deck_created",
    ]);
    expect(events[1]?.properties).toMatchObject({
      generation_mode: "incremental",
      slide_count: 0,
    });
    expect(events[1]?.properties).not.toHaveProperty("prompt");
    expect(JSON.parse(insertedRow!.data as string).generationContext).toEqual({
      generationAttemptId: events[0]?.properties.generation_attempt_id,
      generationMode: "action",
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
