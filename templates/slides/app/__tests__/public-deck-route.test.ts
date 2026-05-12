import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetRequestUserEmail = vi.hoisted(() => vi.fn());
const mockAccessFilter = vi.hoisted(() =>
  vi.fn((_args?: unknown[]) => "access_filter"),
);
const resultQueue = vi.hoisted(() => ({ current: [] as unknown[][] }));
const limit = vi.hoisted(() =>
  vi.fn(async () => resultQueue.current.shift() ?? []),
);
const where = vi.hoisted(() => vi.fn(() => ({ limit })));
const from = vi.hoisted(() => vi.fn(() => ({ where })));
const select = vi.hoisted(() => vi.fn(() => ({ from })));

vi.mock("@/pages/SharedPresentation", () => ({ default: () => null }));
vi.mock("@/components/ui/spinner", () => ({ Spinner: () => null }));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => mockGetRequestUserEmail(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: (...args: unknown[]) => mockAccessFilter(args),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ and: conditions }),
  or: (...conditions: unknown[]) => ({ or: conditions }),
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

vi.mock("../../server/db", () => ({
  getDb: () => ({ select }),
  schema: {
    decks: {
      id: "id_col",
      title: "title_col",
      data: "data_col",
      visibility: "visibility_col",
    },
    deckShares: "deck_shares_table",
  },
}));

import { loader } from "../routes/p.$id";

function requestFor(id = "deck-1") {
  return {
    params: { id },
    request: new Request(`https://slides.example.test/p/${id}`),
  } as any;
}

describe("public deck route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resultQueue.current = [];
    mockGetRequestUserEmail.mockReturnValue(undefined);
  });

  it("serves a public deck for anonymous viewers without speaker notes", async () => {
    resultQueue.current = [publicDeckRows()];

    const result = await loader(requestFor());

    expect(result.deck?.title).toBe("Launch review");
    expect(result.deck?.aspectRatio).toBe("16:9");
    expect(result.deck?.slides).toEqual([
      {
        id: "slide-1",
        content: "<h1>Launch</h1>",
        notes: "",
        layout: "title",
        background: "#111",
        transition: "fade",
        splitByParagraph: true,
        animations: [
          {
            id: "anim-1",
            elementIndex: 0,
            elementPath: [1, 0],
            type: "slide-up",
          },
        ],
      },
    ]);
    // Anonymous viewers only see decks with visibility = "public".
    expect(where).toHaveBeenCalledWith({
      and: [
        { column: "id_col", value: "deck-1" },
        { column: "visibility_col", value: "public" },
      ],
    });
  });

  it("renders the presentation for signed-in viewers with share access", async () => {
    mockGetRequestUserEmail.mockReturnValue("viewer@example.com");
    resultQueue.current = [publicDeckRows()];

    const result = await loader(requestFor());

    // Mirrors Google Slides: shared users open the presentation directly
    // instead of being bounced to the editor.
    expect(result.deck?.title).toBe("Launch review");
    // Signed-in viewers query unions accessFilter and visibility=public.
    expect(where).toHaveBeenCalledWith({
      and: [
        { column: "id_col", value: "deck-1" },
        {
          or: ["access_filter", { column: "visibility_col", value: "public" }],
        },
      ],
    });
  });

  it("404s when the deck is private and the viewer has no access", async () => {
    mockGetRequestUserEmail.mockReturnValue("viewer@example.com");
    resultQueue.current = [[]];
    await expect(loader(requestFor())).rejects.toMatchObject({ status: 404 });
  });

  it("404s anonymous visitors when the deck is not public", async () => {
    await expect(loader(requestFor())).rejects.toMatchObject({ status: 404 });
  });
});

function publicDeckRows() {
  return [
    {
      title: "Launch review",
      data: JSON.stringify({
        aspectRatio: "16:9",
        slides: [
          {
            id: "slide-1",
            content: "<h1>Launch</h1>",
            notes: "internal talking points",
            layout: "title",
            background: "#111",
            transition: "fade",
            splitByParagraph: true,
            animations: [
              {
                id: "anim-1",
                elementIndex: 0,
                elementPath: [1, 0],
                type: "slide-up",
              },
            ],
          },
        ],
      }),
    },
  ];
}
