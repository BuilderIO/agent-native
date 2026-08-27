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
