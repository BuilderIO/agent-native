import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  resolveAccess: vi.fn(),
  verifyScopedAgentAccessToken: vi.fn(),
  readDeckLinkedDesignSystem: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  verifyScopedAgentAccessToken: (...args: unknown[]) =>
    mocks.verifyScopedAgentAccessToken(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  currentAccess: () => ({ userEmail: "viewer@example.com" }),
  resolveAccess: (...args: unknown[]) => mocks.resolveAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown) => ({ left, right }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => mocks.rows }),
      }),
    }),
  }),
  schema: {
    decks: {
      id: "decks.id",
      title: "decks.title",
      data: "decks.data",
      visibility: "decks.visibility",
      designSystemId: "decks.design_system_id",
    },
  },
}));

vi.mock("./_linked-design-system.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./_linked-design-system.js")>()),
  readDeckLinkedDesignSystem: (...args: unknown[]) =>
    mocks.readDeckLinkedDesignSystem(...args),
}));

import getPresentationDeck from "./get-presentation-deck.js";

type PresentationResult = {
  status: string;
  deck: {
    title: string;
    aspectRatio?: string;
    slides: Array<{ notes?: string }>;
    designSystem?: unknown;
  };
};

const run = (args: { deckId: string; agentAccessToken?: string }) =>
  (
    getPresentationDeck as unknown as {
      run: (input: typeof args) => Promise<PresentationResult>;
    }
  ).run(args);

function deckRow(visibility: "private" | "org" | "public") {
  return {
    title: "Launch review",
    visibility,
    designSystemId: "ds-1",
    data: JSON.stringify({
      aspectRatio: "16:9",
      slides: [
        {
          id: "slide-1",
          content: "<div><h1>Launch</h1></div>",
          notes: "internal talking points",
          layout: "title",
        },
      ],
    }),
  };
}

describe("get-presentation-deck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [];
    mocks.resolveAccess.mockResolvedValue(null);
    mocks.verifyScopedAgentAccessToken.mockReturnValue({ ok: false });
    mocks.readDeckLinkedDesignSystem.mockResolvedValue({
      viaDeck: true,
      resource: {
        data: JSON.stringify({
          colors: { primary: "#123456" },
          notes: "brand voice notes stay private",
        }),
      },
    });
  });

  it("serves a public deck on brand and without speaker notes", async () => {
    mocks.rows = [deckRow("public")];

    const result = await run({ deckId: "deck-1" });

    expect(result.status).toBe("ok");
    expect(result.deck.title).toBe("Launch review");
    expect(result.deck.aspectRatio).toBe("16:9");
    expect(result.deck.slides.at(0)?.notes).toBe("");
    expect(result.deck.designSystem).toEqual({
      colors: { primary: "#123456" },
    });
    expect(mocks.readDeckLinkedDesignSystem).toHaveBeenCalledWith(
      expect.objectContaining({ designSystemId: "ds-1" }),
      "ds-1",
    );
  });

  it.each(["private", "org"] as const)(
    "restricts a %s deck the viewer cannot open",
    async (visibility) => {
      mocks.rows = [deckRow(visibility)];

      await expect(run({ deckId: "deck-1" })).resolves.toEqual({
        status: "restricted",
      });
      expect(mocks.resolveAccess).toHaveBeenCalledWith("deck", "deck-1", {
        userEmail: "viewer@example.com",
      });
    },
  );

  it("presents a private deck to someone with access", async () => {
    mocks.rows = [deckRow("private")];
    mocks.resolveAccess.mockResolvedValue({ role: "viewer" });

    await expect(run({ deckId: "deck-1" })).resolves.toMatchObject({
      status: "ok",
      deck: { title: "Launch review" },
    });
  });

  it("presents a private deck to a deck-scoped agent link", async () => {
    mocks.rows = [deckRow("private")];
    mocks.verifyScopedAgentAccessToken.mockReturnValue({ ok: true });

    await expect(
      run({ deckId: "deck-1", agentAccessToken: "tok" }),
    ).resolves.toMatchObject({ status: "ok" });
    expect(mocks.verifyScopedAgentAccessToken).toHaveBeenCalledWith("tok", {
      resourceKind: "slides:deck",
      resourceId: "deck-1",
    });
  });

  it("404s a deck that does not exist", async () => {
    await expect(run({ deckId: "missing" })).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
