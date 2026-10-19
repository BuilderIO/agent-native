import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  limit: vi.fn(),
  select: vi.fn(),
}));

const selectChain = {
  from: vi.fn(),
  where: vi.fn(),
  limit: mocks.limit,
};
selectChain.from.mockReturnValue(selectChain);
selectChain.where.mockReturnValue(selectChain);

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown) => ({ left, right }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ select: (...args: unknown[]) => mocks.select(...args) }),
  schema: {
    decks: {
      id: "deck_id",
      title: "deck_title",
      data: "deck_data",
    },
  },
}));

import { hashSlideSource } from "../server/lib/slide-source.js";
import action from "./get-slide-source.js";

const sourceTsx = "export default function Slide() { return <main />; }";
const sourceHash = hashSlideSource(sourceTsx);

function storedData(slideId = "slide-1") {
  return JSON.stringify({
    appId: "slides-2",
    slides: [
      { id: "slide-before", sourceTsx: "export default function Before() {}" },
      {
        id: slideId,
        sourceTsx,
        sourceHash,
        revision: 7,
        notes: "Presenter notes",
        transition: "fade",
      },
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  selectChain.from.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);
  mocks.select.mockReturnValue(selectChain);
  mocks.assertAccess.mockResolvedValue(undefined);
  mocks.limit.mockResolvedValue([
    {
      id: "deck-1",
      title: "Quarterly Review",
      data: storedData(),
    },
  ]);
});

describe("get-slide-source", () => {
  it("reads canonical source, revision, and hash from the SQL deck row", async () => {
    const result = (await action.run({
      deckId: "deck-1",
      slideId: "slide-1",
    })) as Record<string, unknown>;

    expect(mocks.assertAccess).toHaveBeenCalledWith("deck", "deck-1", "viewer");
    expect(mocks.select).toHaveBeenCalledWith({
      id: "deck_id",
      title: "deck_title",
      data: "deck_data",
    });
    expect(selectChain.where).toHaveBeenCalledWith({
      left: "deck_id",
      right: "deck-1",
    });
    expect(mocks.limit).toHaveBeenCalledWith(1);
    expect(result).toEqual({
      deck: { id: "deck-1", title: "Quarterly Review" },
      slide: {
        id: "slide-1",
        deckId: "deck-1",
        position: 1,
        sourceTsx,
        revision: 7,
        sourceHash,
        notes: "Presenter notes",
        transition: "fade",
      },
    });
  });

  it("returns a typed not-found result when the slide is absent from the deck", async () => {
    mocks.limit.mockResolvedValue([
      {
        id: "deck-1",
        title: "Quarterly Review",
        data: storedData("other-slide"),
      },
    ]);

    await expect(
      action.run({ deckId: "deck-1", slideId: "slide-1" }),
    ).rejects.toMatchObject({
      actionContractError: true,
      statusCode: 404,
      errorCode: "slide_not_found",
    });
  });
});
