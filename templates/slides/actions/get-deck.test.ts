import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveAccess = vi.fn();
const mockNotifyClients = vi.fn();
let updatedFields: { data?: string; updatedAt?: string } | undefined;
let currentResource:
  | { data: string; updatedAt: string; [key: string]: unknown }
  | undefined;
const mockWhereUpdate = vi.fn(async () => {
  if (updatedFields && currentResource) {
    currentResource.data = updatedFields.data ?? currentResource.data;
    currentResource.updatedAt =
      updatedFields.updatedAt ?? currentResource.updatedAt;
  }
});
const mockSet = vi.fn((fields: { data?: string; updatedAt?: string }) => {
  updatedFields = fields;
  return { where: mockWhereUpdate };
});
const mockUpdate = vi.fn(() => ({ set: mockSet }));
const mockDb = { update: mockUpdate };

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mockResolveAccess(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "alice@example.com",
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: { decks: { id: "id_col", data: "data_col", updatedAt: "ua_col" } },
}));

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: (...args: unknown[]) => mockNotifyClients(...args),
}));

vi.mock("./patch-deck.js", () => ({
  withDeckLock: (_deckId: string, run: () => Promise<unknown>) => run(),
}));

const mockGetDesignSystemRun = vi.fn(async ({ id }: { id: string }) => ({
  id,
  title: "Acme",
  agentContext: "Use --brand-accent: #123456.",
}));

vi.mock("./get-design-system.js", () => ({
  default: { run: (...args: unknown[]) => mockGetDesignSystemRun(...args) },
}));

import action from "./get-deck";

beforeEach(() => {
  vi.clearAllMocks();
  updatedFields = undefined;
  currentResource = {
    id: "deck-1",
    title: "Quarterly Review",
    visibility: "private",
    ownerEmail: "Alice@Example.com",
    designSystemId: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
    data: JSON.stringify({
      title: "Quarterly Review",
      generationContext: {
        originalPrompt: "Create a dark 6-slide deck from reference.png",
        targetSlideCount: 6,
        files: [{ path: "/uploads/reference.png" }],
      },
      slides: [
        {
          id: "slide-a",
          layout: "title",
          content: "<h1>Opening</h1>",
        },
        {
          id: "slide-b",
          layout: "content",
          content: "<p>Metrics</p>",
        },
      ],
    }),
  };
  mockResolveAccess.mockImplementation(async () => ({
    resource: currentResource,
  }));
});

describe("get-deck", () => {
  it("accepts the deck id under either `id` or `deckId`", () => {
    expect(action.schema.safeParse({ id: "deck-1" }).success).toBe(true);
    // Every sibling tool (create-deck, add-slide, update-slide, patch-deck)
    // names this parameter `deckId`; rejecting it here cost agents a retry.
    expect(action.schema.safeParse({ deckId: "deck-1" }).success).toBe(true);
    expect(JSON.stringify(action.tool.parameters).includes("deckId")).toBe(
      true,
    );
  });

  it("rejects a read with neither `id` nor `deckId`", async () => {
    await expect(action.run({} as any, { caller: "tool" })).rejects.toThrow(
      /`id` or `deckId`/,
    );
  });

  it("reads the same deck through the deckId alias", async () => {
    const result = (await action.run(
      { deckId: "deck-1" },
      { caller: "cli" },
    )) as any;

    expect(result.id).toBe("deck-1");
    expect(result.slides[0]).toMatchObject({ id: "slide-a" });
  });

  it("includes readable linked design-system context", async () => {
    currentResource!.designSystemId = "ds-1";

    const result = (await action.run(
      { id: "deck-1" },
      { caller: "tool" },
    )) as any;

    expect(result.designSystem).toMatchObject({
      status: "available",
      id: "ds-1",
      title: "Acme",
      agentContext: "Use --brand-accent: #123456.",
    });
    expect(mockGetDesignSystemRun).toHaveBeenCalledWith(
      expect.objectContaining({ compact: "true" }),
    );
  });

  it("summarizes the deck's shared style and names a representative slide", async () => {
    currentResource!.data = JSON.stringify({
      title: "Quarterly Review",
      slides: [
        {
          id: "slide-a",
          layout: "title",
          content:
            '<div style="background: #0a0a0a; color: #faf9f5; font-family: Inter"><h1>Opening</h1></div>',
        },
        {
          id: "slide-b",
          layout: "content",
          content:
            '<div style="background: #0a0a0a; color: #faf9f5; font-family: Inter"><p>Metrics</p></div>',
        },
      ],
    });

    const result = (await action.run(
      { id: "deck-1" },
      { caller: "tool" },
    )) as any;

    expect(result.deckStyle.length).toBeGreaterThan(0);
    expect(["slide-a", "slide-b"]).toContain(result.representativeSlideId);
  });

  it("omits deckStyle and representativeSlideId for an empty deck", async () => {
    currentResource!.data = JSON.stringify({
      title: "Empty Deck",
      slides: [],
    });

    const result = (await action.run(
      { id: "deck-1" },
      { caller: "tool" },
    )) as any;

    expect(result).not.toHaveProperty("deckStyle");
    expect(result).not.toHaveProperty("representativeSlideId");
  });

  it("bounds a full-deck read so a stalled lookup can return a tool error", () => {
    expect(action.timeoutMs).toBe(60_000);
  });

  it("returns 1-based slideNumber fields before internal zero-based indexes", async () => {
    const result = (await action.run(
      { id: "deck-1" },
      { caller: "cli" },
    )) as any;

    expect(result.slideNumbering).toContain("1-based");
    expect(result.slides[0]).toMatchObject({
      slideNumber: 1,
      zeroBasedIndex: 0,
      id: "slide-a",
    });
    expect(result.slides[1]).toMatchObject({
      slideNumber: 2,
      zeroBasedIndex: 1,
      id: "slide-b",
    });
    expect(result.createdByMe).toBe(true);
    expect(result.slides[0]).not.toHaveProperty("index");
  });

  it("repairs duplicate persisted slide IDs before returning the deck", async () => {
    currentResource = {
      id: "deck-1",
      title: "Quarterly Review",
      visibility: "private",
      ownerEmail: "Alice@Example.com",
      updatedAt: "2026-05-02T00:00:00.000Z",
      data: JSON.stringify({
        title: "Quarterly Review",
        slides: [
          {
            id: "slide-a",
            content: "<h1>First</h1>",
            creativeContextReuseLabels: [
              {
                itemId: "item-1",
                itemVersionId: "version-1",
                kind: "slide",
                label: "First slide",
                dataRole: "untrusted-reference",
                elementId: "slide-a",
              },
            ],
          },
          {
            id: "slide-a",
            content: "<h1>Second</h1>",
            creativeContextReuseLabels: [
              {
                itemId: "item-2",
                itemVersionId: "version-2",
                kind: "slide",
                label: "Second slide",
                dataRole: "untrusted-reference",
                elementId: "slide-a",
              },
            ],
          },
        ],
        sourceImport: {
          slideIds: ["slide-a", "slide-a"],
          slides: [
            { id: "slide-a", source: "first" },
            { id: "slide-a", source: "second" },
          ],
        },
      }),
    };

    const result = (await action.run(
      { id: "deck-1" },
      { caller: "frontend" },
    )) as any;
    const ids = result.slides.map((slide: { id: string }) => slide.id);

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(result.slides[0].id).toBe("slide-a");
    expect(result.slides[1].content).toBe("<h1>Second</h1>");
    expect(result.slides[1].creativeContextReuseLabels[0].elementId).toBe(
      ids[1],
    );
    expect(updatedFields?.data).toBeDefined();
    const persisted = JSON.parse(updatedFields!.data!);
    expect(persisted.slides.map((slide: { id: string }) => slide.id)).toEqual(
      ids,
    );
    expect(persisted.sourceImport.slideIds).toEqual(ids);
    expect(
      persisted.sourceImport.slides.map((slide: { id: string }) => slide.id),
    ).toEqual(ids);
    expect(mockNotifyClients).toHaveBeenCalledWith("deck-1");
  });

  it("rejects malformed persisted slide entries explicitly", async () => {
    currentResource!.data = JSON.stringify({ slides: [null] });

    await expect(
      action.run({ id: "deck-1" }, { caller: "frontend" }),
    ).rejects.toThrow("Slide 1 must be an object.");
  });

  it("defaults agent calls to compact output so full slide HTML is not retransmitted", async () => {
    const result = (await action.run(
      { id: "deck-1" },
      { caller: "tool" },
    )) as any;

    expect(result.slides[0]).toMatchObject({
      id: "slide-a",
      textPreview: "Opening",
    });
    expect(result.slides[0]).not.toHaveProperty("content");
    expect(result.generationContext).toMatchObject({
      originalPrompt: "Create a dark 6-slide deck from reference.png",
      targetSlideCount: 6,
    });
  });

  it("marks intentionally blank slides in compact output without hiding visual-only slides", async () => {
    currentResource!.data = JSON.stringify({
      slides: [
        {
          id: "blank",
          layout: "blank",
          content: '<div class="fmd-slide"></div>',
        },
        {
          id: "visual-only",
          layout: "blank",
          content: '<div class="fmd-slide"><img src="chart.png" alt=""></div>',
        },
        {
          id: "shape-only",
          layout: "blank",
          content:
            '<div class="fmd-slide"><div style="background-color:#123456"></div></div>',
        },
        {
          id: "rounded-empty",
          layout: "blank",
          content:
            '<div class="fmd-slide"><div style="border-radius:16px"></div></div>',
        },
        {
          id: "background-size-only",
          layout: "blank",
          content: '<div class="fmd-slide bg-cover"></div>',
        },
        {
          id: "class-background",
          layout: "blank",
          content: '<div class="fmd-slide bg-black"></div>',
        },
        {
          id: "variant-class-background",
          layout: "blank",
          content: '<div class="fmd-slide dark:bg-slate-900"></div>',
        },
        {
          id: "hover-background",
          layout: "blank",
          content: '<div class="fmd-slide hover:bg-black"></div>',
        },
        {
          id: "focus-within-background",
          layout: "blank",
          content: '<div class="fmd-slide focus-within:bg-black"></div>',
        },
        {
          id: "group-focus-background",
          layout: "blank",
          content: '<div class="fmd-slide group-focus:bg-black"></div>',
        },
        {
          id: "peer-active-background",
          layout: "blank",
          content: '<div class="fmd-slide peer-active:bg-black"></div>',
        },
        {
          id: "active-group-data-background",
          layout: "blank",
          content:
            '<div class="group" data-state="open"><div class="fmd-slide group-data-[state=open]:bg-black"></div></div>',
        },
        {
          id: "inactive-group-data-background",
          layout: "blank",
          content:
            '<div class="group" data-state="closed"><div class="fmd-slide group-data-[state=open]:bg-black"></div></div>',
        },
        {
          id: "case-mismatched-group-data-background",
          layout: "blank",
          content:
            '<div class="group" data-state="OPEN"><div class="fmd-slide group-data-[state=open]:bg-black"></div></div>',
        },
        {
          id: "active-outer-group-data-background",
          layout: "blank",
          content:
            '<div class="group" data-state="open"><div class="group" data-state="closed"><div class="fmd-slide group-data-[state=open]:bg-black"></div></div></div>',
        },
        {
          id: "active-peer-data-background",
          layout: "blank",
          content:
            '<div><button class="peer/menu" data-state="open"></button><div class="fmd-slide peer-data-[state=open]/menu:bg-black"></div></div>',
        },
        {
          id: "inactive-peer-data-background",
          layout: "blank",
          content:
            '<div><button class="peer/menu" data-state="closed"></button><div class="fmd-slide peer-data-[state=open]/menu:bg-black"></div></div>',
        },
        {
          id: "case-mismatched-peer-data-background",
          layout: "blank",
          content:
            '<div><button class="peer/menu" data-state="OPEN"></button><div class="fmd-slide peer-data-[state=open]/menu:bg-black"></div></div>',
        },
        {
          id: "active-has-selector-background",
          layout: "blank",
          content:
            '<div class="fmd-slide has-[.active]:bg-black"><span class="active"></span></div>',
        },
        {
          id: "active-not-selector-background",
          layout: "blank",
          content: '<div class="fmd-slide not-[:checked]:bg-black"></div>',
        },
        {
          id: "inactive-not-selector-background",
          layout: "blank",
          content:
            '<input class="fmd-slide not-[:checked]:bg-black" type="checkbox" checked>',
        },
        {
          id: "aria-state-background",
          layout: "blank",
          content:
            '<button class="fmd-slide aria-pressed:bg-black" aria-pressed="false"></button>',
        },
        {
          id: "active-aria-state-background",
          layout: "blank",
          content:
            '<button class="fmd-slide aria-pressed:bg-black" aria-pressed="true"></button>',
        },
        {
          id: "active-data-state-background",
          layout: "blank",
          content:
            '<div class="fmd-slide data-[state=open]:bg-black" data-state="open"></div>',
        },
        {
          id: "unquoted-active-data-state-background",
          layout: "blank",
          content:
            '<div class="fmd-slide data-[state=open]:bg-black" data-state=open></div>',
        },
        {
          id: "case-mismatched-data-state-background",
          layout: "blank",
          content:
            '<div class="fmd-slide data-[state=open]:bg-black" data-state="OPEN"></div>',
        },
        {
          id: "inactive-data-state-background",
          layout: "blank",
          content:
            '<div class="fmd-slide data-[state=open]:bg-black" data-state="closed"></div>',
        },
        {
          id: "inactive-has-state-background",
          layout: "blank",
          content:
            '<div class="fmd-slide has-[:checked]:bg-black"><input type="checkbox"></div>',
        },
        {
          id: "active-has-state-background",
          layout: "blank",
          content:
            '<div class="fmd-slide has-[:checked]:bg-black"><input type="checkbox" checked></div>',
        },
        {
          id: "text",
          layout: "blank",
          content: '<div class="fmd-slide"><p>Notes</p></div>',
        },
      ],
    });

    const result = (await action.run(
      { id: "deck-1" },
      { caller: "tool" },
    )) as any;

    expect(
      result.slides.map((slide: { isBlank: boolean }) => slide.isBlank),
    ).toEqual([
      true,
      false,
      false,
      true,
      true,
      false,
      false,
      true,
      true,
      true,
      true,
      false,
      true,
      true,
      false,
      false,
      true,
      true,
      false,
      false,
      true,
      true,
      false,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it("keeps compact reads working when imported selector variants are invalid", async () => {
    currentResource!.data = JSON.stringify({
      slides: [
        {
          id: "invalid-has-selector",
          layout: "blank",
          content: '<div class="fmd-slide has-[??]:bg-black"></div>',
        },
        {
          id: "invalid-not-selector",
          layout: "blank",
          content: '<div class="fmd-slide not-[??]:bg-black"></div>',
        },
        {
          id: "blank",
          layout: "blank",
          content: '<div class="fmd-slide"></div>',
        },
      ],
    });

    const result = (await action.run(
      { id: "deck-1" },
      { caller: "tool" },
    )) as any;

    expect(
      result.slides.map((slide: { isBlank: boolean }) => slide.isBlank),
    ).toEqual([false, false, true]);
  });

  it("reports source coverage and order in compact agent reads", async () => {
    currentResource!.data = JSON.stringify({
      title: "Imported source",
      slides: [
        { id: "source-1", content: "One" },
        { id: "extra", content: "Unrelated" },
        { id: "source-3", content: "Three" },
      ],
      sourceImport: {
        mode: "source-preserving",
        format: "pdf",
        fidelity: "source-faithful",
        slideCount: 3,
        slideIds: ["source-1", "source-2", "source-3"],
        slides: [{ id: "source-1" }, { id: "source-2" }, { id: "source-3" }],
      },
    });

    const result = (await action.run(
      { id: "deck-1" },
      { caller: "tool" },
    )) as any;

    expect(result.sourceCoverage).toMatchObject({
      complete: false,
      ordered: false,
      expectedSlideIds: ["source-1", "source-2", "source-3"],
      actualSlideIds: ["source-1", "extra", "source-3"],
      missingSlideIds: ["source-2"],
      unexpectedSlideIds: ["extra"],
    });
    expect(result.sourceImport).toMatchObject({
      mode: "source-preserving",
      format: "pdf",
    });
  });

  it("lets agent calls opt into full slide HTML", async () => {
    const result = (await action.run(
      { id: "deck-1", compact: "false" },
      { caller: "tool" },
    )) as any;

    expect(result.slides[0]).toMatchObject({
      id: "slide-a",
      content: "<h1>Opening</h1>",
    });
  });

  it("returns only the requested slide with full HTML for targeted agent reads", async () => {
    const result = (await action.run(
      { id: "deck-1", slideId: "slide-b" },
      { caller: "tool" },
    )) as any;

    expect(result).toMatchObject({
      slideCount: 2,
      selectedSlideId: "slide-b",
    });
    expect(result.slides).toHaveLength(1);
    expect(result.slides[0]).toMatchObject({
      id: "slide-b",
      slideNumber: 2,
      zeroBasedIndex: 1,
      content: "<p>Metrics</p>",
    });
    expect(result.slides[0].contentHash).toMatch(/^[0-9a-f]+$/);
  });

  it("returns multiple full slides and hashes in requested order", async () => {
    currentResource!.data = JSON.stringify({
      title: "Quarterly Review",
      slides: [
        { id: "slide-a", content: "<h1>Opening</h1>", notes: "Start" },
        { id: "slide-b", content: "<p>Metrics</p>", notes: "Explain" },
      ],
    });

    const result = (await action.run(
      { id: "deck-1", slideIds: ["slide-b", "slide-a"] },
      { caller: "tool" },
    )) as any;

    expect(result.selectedSlideIds).toEqual(["slide-b", "slide-a"]);
    expect(result.slides).toHaveLength(2);
    expect(result.slides.map((slide: { id: string }) => slide.id)).toEqual([
      "slide-b",
      "slide-a",
    ]);
    expect(result.slides[0]).toMatchObject({
      slideNumber: 2,
      zeroBasedIndex: 1,
      content: "<p>Metrics</p>",
      notes: "Explain",
    });
    expect(result.slides[0].contentHash).toMatch(/^[0-9a-f]+$/);
  });

  it("rejects invalid multi-slide read selectors", () => {
    expect(
      action.schema.safeParse({
        id: "deck-1",
        slideId: "slide-a",
        slideIds: ["slide-a"],
      }).success,
    ).toBe(false);
    expect(
      action.schema.safeParse({
        id: "deck-1",
        slideIds: ["slide-a", "slide-a"],
      }).success,
    ).toBe(false);
  });

  it("returns 404 instead of omitting a missing selected slide", async () => {
    await expect(
      action.run(
        { id: "deck-1", slideIds: ["missing-slide"] },
        { caller: "tool" },
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("can return readable HTML while hashing the persisted source", async () => {
    mockResolveAccess.mockResolvedValue({
      resource: {
        id: "deck-1",
        title: "Formatted",
        visibility: "private",
        designSystemId: null,
        data: JSON.stringify({
          title: "Formatted",
          slides: [
            { id: "slide-a", content: "<section><h1>Title</h1></section>" },
          ],
        }),
      },
    });

    const result = (await action.run(
      { id: "deck-1", slideId: "slide-a", format: "true" },
      { caller: "tool" },
    )) as any;

    expect(result.slides[0].content).toContain("\n");
    expect(result.slides[0].contentHash).toMatch(/^[0-9a-f]+$/);
  });

  it("supports compact summaries for a single requested slide", async () => {
    const result = (await action.run(
      { id: "deck-1", slideId: "slide-b", compact: "true" },
      { caller: "tool" },
    )) as any;

    expect(result).toMatchObject({ selectedSlideId: "slide-b" });
    expect(result.slides).toHaveLength(1);
    expect(result.slides[0]).toMatchObject({
      id: "slide-b",
      slideNumber: 2,
      zeroBasedIndex: 1,
      textPreview: "Metrics",
    });
    expect(result.slides[0]).not.toHaveProperty("content");
  });

  it("reports resolved animation targets in compact reads", async () => {
    mockResolveAccess.mockResolvedValue({
      resource: {
        id: "deck-1",
        title: "Animated",
        visibility: "private",
        designSystemId: null,
        data: JSON.stringify({
          title: "Animated",
          slides: [
            {
              id: "slide-a",
              content:
                '<div class="fmd-slide"><h1>Opening</h1><p>Details</p></div>',
              animations: [
                {
                  id: "opening",
                  elementIndex: 0,
                  elementPath: [0],
                  type: "fade",
                },
              ],
            },
          ],
        }),
      },
    });

    const result = (await action.run(
      { id: "deck-1", compact: "true" },
      { caller: "tool" },
    )) as any;

    expect(result.slides[0].animations.steps[0]).toMatchObject({
      targetPreview: "Opening",
      resolvedPath: "0",
      targetValid: true,
      targetIssue: null,
    });
  });

  it("returns a not-found error for an unknown requested slide", async () => {
    await expect(
      action.run(
        { id: "deck-1", slideId: "missing-slide" },
        { caller: "tool" },
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("keeps full slide HTML for frontend callers", async () => {
    const result = (await action.run(
      { id: "deck-1" },
      { caller: "frontend" },
    )) as any;

    expect(result.slides[0]).toMatchObject({
      id: "slide-a",
      content: "<h1>Opening</h1>",
    });
  });

  it("uses the same numbering contract for compact output", async () => {
    const result = (await action.run({
      id: "deck-1",
      compact: "true",
    })) as any;

    expect(result.slideNumbering).toContain("Slide 1");
    expect(result.slides[0]).toMatchObject({
      slideNumber: 1,
      zeroBasedIndex: 0,
      textPreview: "Opening",
    });
    expect(result.slides[0]).not.toHaveProperty("index");
  });
});
