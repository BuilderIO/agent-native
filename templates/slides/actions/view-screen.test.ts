import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashSlideContent } from "../shared/slide-fit";

let mockRows: unknown[] = [];
let navigationState: Record<string, unknown> | null = null;
let slidesSelectionState: Record<string, unknown> | null = null;
let slideFitState: Record<string, unknown> | null = null;
let deckFitState: Record<string, unknown> | null = null;

const limitFn = vi.fn(async () => mockRows);
const orderByFn = vi.fn(async () => mockRows);
const whereFn = vi.fn(() => ({ limit: limitFn, orderBy: orderByFn }));
const fromFn = vi.fn(() => ({ where: whereFn }));
const selectFn = vi.fn((..._args: unknown[]) => ({ from: fromFn }));
const mockDb = { select: selectFn };

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    decks: {
      id: "id_col",
      title: "title_col",
      ownerEmail: "owner_email_col",
      updatedAt: "updated_at_col",
    },
    deckShares: {},
  },
}));

vi.mock("./_tab-state.js", () => ({
  readAppStateForCurrentTab: vi.fn(async (key: string) => {
    if (key === "navigation") return navigationState;
    if (key === "slides-selection") return slidesSelectionState;
    if (key === "slide-fit-check") return slideFitState;
    if (key === "deck-fit-checks") return deckFitState;
    return null;
  }),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestRunContext: () => undefined,
  getRequestUserEmail: () => "alice@example.com",
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => ({ allowed: true }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...values: unknown[]) => ({ and: values }),
  desc: (value: unknown) => ({ desc: value }),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  sql: vi.fn((strings: unknown, ...values: unknown[]) => ({ strings, values })),
}));

import action from "./view-screen";

beforeEach(() => {
  vi.clearAllMocks();
  mockRows = [];
  navigationState = null;
  slidesSelectionState = null;
  slideFitState = null;
  deckFitState = null;
});

describe("view-screen", () => {
  it("projects only metadata columns for the deck list — never selects the deck body", async () => {
    mockRows = [
      {
        id: "deck_123",
        title: "Roadmap",
        ownerEmail: "alice@example.com",
      },
    ];
    navigationState = { view: "list" };

    const result = await action.run({});

    // The `data` column (each deck's full slide JSON) must never be
    // requested for the plain list — this mirrors list-decks.ts light mode.
    expect(selectFn).toHaveBeenCalledWith({
      id: "id_col",
      title: "title_col",
      ownerEmail: "owner_email_col",
    });
    expect(result).toContain("id=deck_123");
    expect(result).toContain('title="Roadmap"');
    expect(result).not.toContain("slides=");
  });

  it("still fetches full deck content for a single open deck", async () => {
    mockRows = [
      {
        id: "deck-1",
        title: "Quarterly Review",
        data: JSON.stringify({
          title: "Quarterly Review",
          slides: [
            { id: "slide-a", layout: "title", content: "<h1>Opening</h1>" },
          ],
        }),
      },
    ];
    navigationState = { view: "editor", deckId: "deck-1", slideIndex: 0 };

    const result = await action.run({});

    // The single-deck fetch is a targeted, limit(1) lookup and genuinely
    // needs the full row (slide content is rendered below).
    expect(limitFn).toHaveBeenCalled();
    expect(orderByFn).not.toHaveBeenCalled();
    expect(result).toContain("deckId: deck-1");
    expect(result).toContain("slideCount: 1");
    expect(result).toContain("<h1>Opening</h1>");
  });

  it("surfaces stable freeform object identity alongside the runtime selector", async () => {
    mockRows = [
      {
        id: "deck-1",
        title: "Quarterly Review",
        data: JSON.stringify({
          title: "Quarterly Review",
          slides: [
            {
              id: "slide-a",
              layout: "blank",
              content:
                '<div class="fmd-slide"><div data-slide-object-id="object-1">Text</div></div>',
            },
          ],
        }),
      },
    ];
    navigationState = { view: "editor", deckId: "deck-1", slideIndex: 0 };
    slidesSelectionState = {
      slideId: "slide-a",
      mode: "box-selected",
      activeTool: "select",
      items: [
        {
          selector: '[data-slide-object-id="object-1"]',
          runtimeSelector: '[data-builder-id="b-7"]',
          objectId: "object-1",
          kind: "element",
          tagName: "div",
        },
      ],
    };

    const result = await action.run({});

    expect(result).toContain("selectionSlideId: slide-a");
    expect(result).toContain("mode: box-selected");
    expect(result).toContain('selector=[data-slide-object-id="object-1"]');
    expect(result).toContain("objectId: object-1");
    expect(result).toContain('runtimeSelector: [data-builder-id="b-7"]');
  });

  it("does not surface a selection from a different slide", async () => {
    mockRows = [
      {
        id: "deck-1",
        title: "Quarterly Review",
        data: JSON.stringify({
          title: "Quarterly Review",
          slides: [{ id: "slide-a", layout: "blank", content: "<p>A</p>" }],
        }),
      },
    ];
    navigationState = { view: "editor", deckId: "deck-1", slideIndex: 0 };
    slidesSelectionState = {
      slideId: "slide-b",
      mode: "single",
      items: [{ selector: '[data-builder-id="b-8"]' }],
    };

    const result = await action.run({});

    expect(result).not.toContain("### Current visual selection");
  });

  it("filters the list to decks created by the current user without reading deck bodies", async () => {
    mockRows = [
      { id: "deck_1", title: "Mine", ownerEmail: "alice@example.com" },
      { id: "deck_2", title: "Theirs", ownerEmail: "bob@example.com" },
    ];
    navigationState = { view: "list", deckFilter: "created-by-me" };

    const result = await action.run({});

    expect(result).toContain("id=deck_1");
    expect(result).not.toContain("id=deck_2");
    expect(result).toContain("Decks created by current user (1 of 2)");
  });

  it("lets the current slide measurement override a stale deck-wide fit claim", async () => {
    const slideAContent = "<p>A</p>";
    const slideBContent = "<p>B</p>";
    const measurement = (content: string, verticalOverflow = 0) => ({
      contentHash: hashSlideContent(content),
      contentHeight: verticalOverflow > 0 ? 645 : 380,
      contentWidth: 740,
      viewportHeight: 420,
      viewportWidth: 740,
      verticalOverflow,
      horizontalOverflow: 0,
      measuredAt: 2000,
    });

    mockRows = [
      {
        id: "deck-1",
        title: "Quarterly Review",
        data: JSON.stringify({
          aspectRatio: "16:9",
          slides: [
            { id: "slide-a", content: slideAContent },
            { id: "slide-b", content: slideBContent },
          ],
        }),
      },
    ];
    navigationState = { view: "editor", deckId: "deck-1", slideIndex: 0 };
    deckFitState = {
      deckId: "deck-1",
      aspectRatio: "16:9",
      slides: {
        "slide-a": measurement(slideAContent),
        "slide-b": measurement(slideBContent),
      },
    };
    slideFitState = {
      ...measurement(slideAContent, 225),
      slideId: "slide-a",
      deckId: "deck-1",
    };

    const result = await action.run({});

    expect(result).toContain("### ⚠ Layout overflows the canvas");
    expect(result).toContain(
      "Overflow detected on 1 slide(s): slide 1 (225px vertical, 0px horizontal).",
    );
    expect(result).not.toContain("All 2 slides fit their measured content area.");
  });
});
