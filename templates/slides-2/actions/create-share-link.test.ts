import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  readDeckLinkedDesignSystem: vi.fn(),
  insertedRows: [] as Array<Record<string, unknown>>,
  deleteWhere: vi.fn(async () => undefined),
  trackSlides: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
  resolveAccess: vi.fn(),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (...args: unknown[]) => args,
    lt: (...args: unknown[]) => args,
  };
});

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        mocks.insertedRows.push(row);
      },
    }),
    delete: () => ({
      where: (...args: unknown[]) => mocks.deleteWhere(...args),
    }),
  }),
  schema: {
    deckShareLinks: {
      token: "token_col",
      title: "title_col",
      slides: "slides_col",
      aspectRatio: "aspect_ratio_col",
      designSystemData: "design_system_data_col",
      deckId: "deck_id_col",
      createdAt: "created_at_col",
    },
  },
}));

vi.mock("../server/lib/slides-tracking.js", () => ({
  trackSlides: (...args: unknown[]) => mocks.trackSlides(...args),
}));

vi.mock("./_linked-design-system.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./_linked-design-system.js")>();
  return {
    ...actual,
    readDeckLinkedDesignSystem: (...args: unknown[]) =>
      mocks.readDeckLinkedDesignSystem(...args),
  };
});

import action from "./create-share-link";

const launchContent =
  '<div class="fmd-slide"><h1>Launch</h1><div class="text-box"><p>One</p><p>Two</p></div></div>';

describe("create-share-link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertedRows.length = 0;
    mocks.assertAccess.mockResolvedValue({
      resource: {
        id: "deck-1",
        title: "Launch review",
        designSystemId: "design-system-1",
        data: JSON.stringify({
          appId: "slides-2",
          aspectRatio: "16:9",
          slides: [
            {
              id: "slide-1",
              content: launchContent,
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
    });
    mocks.readDeckLinkedDesignSystem.mockResolvedValue({
      resource: {
        data: JSON.stringify({
          colors: {
            primary: "#123456",
            secondary: "#234567",
            accent: "#345678",
            background: "#000000",
            surface: "#111111",
            text: "#ffffff",
            textMuted: "#aaaaaa",
          },
          agentContext: "private design-system guidance",
        }),
      },
      viaDeck: false,
    });
  });

  it("keeps presentation animation metadata in share snapshots without speaker notes", async () => {
    const result = await action.run(
      { deckId: "deck-1" } as never,
      { userId: "owner@example.com" } as never,
    );

    expect(result).toMatchObject({ shareToken: expect.any(String) });
    expect(result.url).toContain(`/share/${result.shareToken}`);
    expect(mocks.assertAccess).toHaveBeenCalledWith("deck", "deck-1", "admin");
    expect(mocks.readDeckLinkedDesignSystem).toHaveBeenCalledWith(
      expect.objectContaining({ id: "deck-1" }),
      "design-system-1",
    );
    expect(mocks.insertedRows).toHaveLength(1);

    const row = mocks.insertedRows[0]!;
    expect(row.deckId).toBe("deck-1");
    const slides = JSON.parse(row.slides as string);

    expect(slides).toEqual([
      {
        id: "slide-1",
        content: launchContent,
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
    expect(row.designSystemData).toBe(
      JSON.stringify({
        colors: {
          primary: "#123456",
          secondary: "#234567",
          accent: "#345678",
          background: "#000000",
          surface: "#111111",
          text: "#ffffff",
          textMuted: "#aaaaaa",
        },
      }),
    );
    expect(row.designSystemData).not.toContain(
      "private design-system guidance",
    );
  });

  it("snapshots a reveal whose stored path went stale with its stale-path issue", async () => {
    mocks.assertAccess.mockResolvedValueOnce({
      resource: {
        id: "deck-1",
        title: "Launch review",
        data: JSON.stringify({
          appId: "slides-2",
          slides: [
            {
              id: "slide-1",
              content: launchContent,
              animations: [
                {
                  id: "anim-ok",
                  elementIndex: 0,
                  elementPath: [1, 0],
                  type: "fade",
                },
                {
                  id: "anim-gone",
                  elementIndex: 0,
                  elementPath: [9],
                  type: "fade",
                },
              ],
            },
          ],
        }),
      },
    });

    await action.run({ deckId: "deck-1" } as never, {} as never);

    const row = mocks.insertedRows[0]!;
    const [slide] = JSON.parse(row.slides as string);
    expect(
      slide.animations.map((animation: { id: string }) => animation.id),
    ).toEqual(["anim-ok", "anim-gone"]);
    expect(slide.animationIssues).toEqual([
      { index: 1, id: "anim-gone", code: "stale-path" },
    ]);
  });

  it("records share_link_created on the server without the token", async () => {
    const result = (await action.run(
      { deckId: "deck-1" } as never,
      { userId: "owner@example.com" } as never,
    )) as { shareToken: string };

    expect(mocks.trackSlides).toHaveBeenCalledTimes(1);
    expect(mocks.trackSlides).toHaveBeenCalledWith(
      "share_link_created",
      {
        output_id: "deck-1",
        output_type: "deck",
        share_type: "presentation_link",
        share_token_hash: createHash("sha256")
          .update(result.shareToken)
          .digest("hex")
          .slice(0, 16),
      },
      { userId: "owner@example.com" },
    );
    expect(JSON.stringify(mocks.trackSlides.mock.calls)).not.toContain(
      result.shareToken,
    );
  });
});
