import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetRequestUserEmail = vi.hoisted(() => vi.fn());
const mockResolveAccess = vi.hoisted(() => vi.fn());
const rows = vi.hoisted(() => ({ current: [] as unknown[] }));
const limit = vi.hoisted(() => vi.fn(async () => rows.current));
const where = vi.hoisted(() => vi.fn(() => ({ limit })));
const from = vi.hoisted(() => vi.fn(() => ({ where })));
const select = vi.hoisted(() => vi.fn(() => ({ from })));

vi.mock("@/pages/SharedPresentation", () => ({ default: () => null }));
vi.mock("@/components/ui/spinner", () => ({ Spinner: () => null }));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => mockGetRequestUserEmail(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mockResolveAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ and: conditions }),
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
    rows.current = [];
    mockGetRequestUserEmail.mockReturnValue(undefined);
    mockResolveAccess.mockResolvedValue(null);
  });

  it("serves a public deck without speaker notes", async () => {
    rows.current = [
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
            },
          ],
        }),
      },
    ];

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
      },
    ]);
    expect(where).toHaveBeenCalledWith({
      and: [
        { column: "id_col", value: "deck-1" },
        { column: "visibility_col", value: "public" },
      ],
    });
  });

  it("redirects signed-in viewers with access to the editor", async () => {
    mockGetRequestUserEmail.mockReturnValue("viewer@example.com");
    mockResolveAccess.mockResolvedValue({ role: "viewer", resource: {} });

    try {
      await loader(requestFor());
      throw new Error("Expected redirect");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      const response = error as Response;
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/deck/deck-1");
    }
  });

  it("404s when the deck is not public", async () => {
    await expect(loader(requestFor())).rejects.toMatchObject({ status: 404 });
  });
});
