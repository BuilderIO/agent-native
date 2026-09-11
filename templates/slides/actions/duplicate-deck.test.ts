import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveAccess: vi.fn(),
  insertValues: vi.fn(),
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
  getRequestOrgId: vi.fn(() => null),
}));

vi.mock("@agent-native/core/action", () => ({
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

  it("makes a source-preserving deck copy editable without losing provenance", async () => {
    await action.run({
      deckId: "deck-source",
      newId: "deck-copy",
      slideIds: ["slide-copy"],
    });

    const insertedData = JSON.parse(
      mocks.insertValues.mock.calls[0]?.[0].data as string,
    );
    expect(insertedData.sourceImport).toMatchObject({
      editableSnapshot: true,
      slideIds: ["slide-copy"],
      slides: [{ id: "slide-copy" }],
    });
    expect(insertedData.slides).toEqual([
      { id: "slide-copy", content: "<div />" },
    ]);
  });
});
