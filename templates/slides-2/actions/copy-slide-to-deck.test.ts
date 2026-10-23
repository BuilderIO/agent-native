import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  patchRun: vi.fn(),
  sourceRows: [] as Array<{ id: string; data: string }>,
  accessRoles: {} as Record<
    string,
    "owner" | "admin" | "editor" | "commenter" | "viewer"
  >,
  deniedDeckIds: [] as string[],
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown) => ({ left, right }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (condition: { right: string }) => ({
          limit: async () =>
            mocks.sourceRows
              .filter((row) => row.id === condition.right)
              .slice(0, 1),
        }),
      }),
    }),
  }),
  schema: { decks: { id: "decks.id", data: "decks.data" } },
}));

vi.mock("./patch-deck.js", () => ({
  default: { run: (...args: unknown[]) => mocks.patchRun(...args) },
}));

import { hashSlideSource } from "../server/lib/slide-source.js";
import action from "./copy-slide-to-deck.js";

const sourceTsx =
  'export default function Slide() { return <img src="asset://source-image" />; }';

function sourceDeckData(slide: Record<string, unknown>): string {
  return JSON.stringify({ appId: "slides-2", slides: [slide] });
}

function runCopy() {
  return action.run(
    {
      sourceDeckId: "source-deck",
      sourceSlideId: "source-slide",
      targetDeckId: "target-deck",
      slideId: "copied-slide",
      afterSlideId: "target-anchor",
    },
    { caller: "frontend" },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sourceRows = [];
  mocks.accessRoles = { "source-deck": "owner", "target-deck": "editor" };
  mocks.deniedDeckIds = [];
  mocks.assertAccess.mockImplementation(
    async (_resourceType: string, deckId: string) => {
      if (mocks.deniedDeckIds.includes(deckId)) {
        throw new Error("access denied");
      }
      return { role: mocks.accessRoles[deckId] ?? "viewer" };
    },
  );
  mocks.patchRun.mockResolvedValue({
    ok: true,
    deckId: "target-deck",
    updatedAt: "2026-10-20T12:00:00.000Z",
    updatedSlideIds: ["copied-slide"],
  });
});

describe("copy-slide-to-deck", () => {
  it("copies a source slide through the destination editor write path", async () => {
    mocks.sourceRows = [
      {
        id: "source-deck",
        data: sourceDeckData({
          id: "source-slide",
          sourceTsx,
          sourceHash: hashSlideSource(sourceTsx),
          revision: 3,
          notes: "Presenter notes",
          layout: "content",
          background: "#112233",
          transition: "fade",
          transitionSpeed: 40,
          animations: [],
          splitByParagraph: true,
          skipped: false,
          layoutFitRevision: "source-only-revision",
        }),
      },
    ];

    await expect(runCopy()).resolves.toEqual({
      deckId: "target-deck",
      slideId: "copied-slide",
      updatedAt: "2026-10-20T12:00:00.000Z",
      updatedSlideIds: ["copied-slide"],
      revision: 1,
      sourceHash: hashSlideSource(sourceTsx),
    });

    expect(mocks.assertAccess).toHaveBeenNthCalledWith(
      1,
      "deck",
      "source-deck",
      "viewer",
    );
    expect(mocks.assertAccess).toHaveBeenNthCalledWith(
      2,
      "deck",
      "target-deck",
      "editor",
    );
    expect(mocks.patchRun).toHaveBeenCalledWith(
      {
        deckId: "target-deck",
        operations: [
          {
            op: "add-slide",
            slideId: "copied-slide",
            afterSlideId: "target-anchor",
            fields: {
              sourceTsx,
              notes: "Presenter notes",
              layout: "content",
              background: "#112233",
              transition: "fade",
              transitionSpeed: 40,
              animations: [],
              splitByParagraph: true,
              skipped: false,
            },
          },
        ],
      },
      { caller: "frontend" },
    );
    const copiedFields = mocks.patchRun.mock.calls[0]?.[0].operations[0].fields;
    expect(copiedFields).not.toHaveProperty("sourceHash");
    expect(copiedFields).not.toHaveProperty("revision");
    expect(copiedFields).not.toHaveProperty("layoutFitRevision");
  });

  it("redacts presenter notes from a viewer's copied source", async () => {
    const notesSource =
      'export const notes = ["Private speaker notes"]; export default function Slide() { return <main />; }';
    mocks.accessRoles["source-deck"] = "viewer";
    mocks.sourceRows = [
      {
        id: "source-deck",
        data: sourceDeckData({
          id: "source-slide",
          sourceTsx: notesSource,
          sourceHash: hashSlideSource(notesSource),
          revision: 1,
          notes: "Private speaker notes",
        }),
      },
    ];

    const result = await runCopy();

    const operation = mocks.patchRun.mock.calls[0]?.[0].operations[0];
    expect(operation.fields.sourceTsx).not.toContain("Private speaker notes");
    expect(operation.fields.sourceTsx).not.toContain("export const notes");
    expect(operation.fields).not.toHaveProperty("notes");
    expect(result).toMatchObject({
      revision: 1,
      sourceHash: hashSlideSource(operation.fields.sourceTsx),
    });
  });

  it("preserves legacy asset references for destination-scoped validation", async () => {
    mocks.sourceRows = [
      {
        id: "source-deck",
        data: sourceDeckData({
          id: "source-slide",
          content: '<img src="asset://source-image" alt="Chart">',
          notes: "Copied notes",
          layout: "image",
        }),
      },
    ];

    await runCopy();

    expect(mocks.patchRun).toHaveBeenCalledWith(
      expect.objectContaining({ deckId: "target-deck" }),
      expect.anything(),
    );
    const fields = mocks.patchRun.mock.calls[0]?.[0].operations[0].fields;
    expect(fields.content).toContain("asset://source-image");
    expect(fields.layout).toBe("image");
    expect(fields.notes).toBe("Copied notes");
  });

  it("does not copy when destination editor access is denied", async () => {
    mocks.deniedDeckIds = ["target-deck"];
    mocks.sourceRows = [
      {
        id: "source-deck",
        data: sourceDeckData({ id: "source-slide", content: "<main />" }),
      },
    ];

    await expect(runCopy()).rejects.toThrow("access denied");
    expect(mocks.patchRun).not.toHaveBeenCalled();
  });

  it("rejects a copy that the destination write did not apply", async () => {
    mocks.sourceRows = [
      {
        id: "source-deck",
        data: sourceDeckData({ id: "source-slide", content: "<main />" }),
      },
    ];
    mocks.patchRun.mockResolvedValue({
      ok: true,
      deckId: "target-deck",
      updatedAt: "2026-10-20T12:00:00.000Z",
      updatedSlideIds: [],
    });

    await expect(runCopy()).rejects.toMatchObject({
      errorCode: "slide_copy_not_applied",
      statusCode: 409,
    });
  });
});
