import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveAccess: vi.fn(),
  insertValues: vi.fn(),
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
  getRequestOrgId: vi.fn(() => null),
  track: vi.fn(),
}));

vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => mocks.track(...args),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  defineAction: (definition: unknown) => definition,
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mocks.resolveAccess(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mocks.getRequestUserEmail(),
  getRequestOrgId: () => mocks.getRequestOrgId(),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    insert: () => ({ values: mocks.insertValues }),
  }),
  schema: { decks: {} },
}));

vi.mock("./_app-url.js", () => ({
  getDeckUrl: (deckId: string) => `/deck/${deckId}`,
}));

import action from "./duplicate-deck.js";

describe("duplicate-deck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAccess.mockResolvedValue({
      resource: {
        title: "BoD Recap",
        designSystemId: null,
        data: JSON.stringify({
          title: "BoD Recap",
          sourceImport: {
            mode: "source-preserving",
            format: "pdf",
            slideIds: ["source-slide-1"],
            slides: [{ id: "source-slide-1" }],
          },
          slides: [{ id: "source-slide-1", content: "<div />" }],
        }),
      },
    });
  });

  it("preserves source provenance on a copied deck", async () => {
    await action.run({
      deckId: "deck-source",
      newId: "deck-copy",
      slideIds: ["slide-copy"],
    });

    const insertedData = JSON.parse(
      mocks.insertValues.mock.calls[0]?.[0].data as string,
    );
    expect(insertedData.sourceImport).toMatchObject({
      slideIds: ["slide-copy"],
      slides: [{ id: "slide-copy" }],
    });
    expect(insertedData.slides).toEqual([
      { id: "slide-copy", content: "<div />" },
    ]);
  });

  it("maps a newId collision to a 409 without leaking the SQL", async () => {
    // Drizzle wraps the driver error: the SQL text is on the outer message and the 23505 code on its cause.
    mocks.insertValues.mockRejectedValueOnce(
      Object.assign(
        new Error('Failed query: insert into "decks" params: ["deck-taken"]'),
        {
          cause: Object.assign(new Error("duplicate key value"), {
            code: "23505",
          }),
        },
      ),
    );

    const failure = await action
      .run({ deckId: "deck-source", newId: "deck-taken" })
      .catch(
        (error: unknown) => error as { statusCode?: number; message: string },
      );

    expect(failure.statusCode).toBe(409);
    expect(failure.message).not.toContain("insert into");
  });

  it("reports the copy as a duplicated deck", async () => {
    await action.run({ deckId: "deck-source", newId: "deck-copy" }, {
      caller: "frontend",
    } as never);

    expect(mocks.track).toHaveBeenCalledWith(
      "deck_created",
      expect.objectContaining({
        output_id: "deck-copy",
        output_type: "deck",
        creation_method: "duplicate",
        purpose: "direct",
        slide_count: 1,
        caller: "frontend",
      }),
      { caller: "frontend" },
    );
  });
});
