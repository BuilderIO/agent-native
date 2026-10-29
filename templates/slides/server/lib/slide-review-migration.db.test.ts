import { rmSync } from "node:fs";

import { queryReviewComments } from "@agent-native/core/review";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getDb, schema } from "../db/index.js";
import {
  __resetSlideReviewMigrationForTests,
  ensureSlideReviewMigrated,
  legacyCommentsToReview,
} from "./slide-review-migration.js";

function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("expected a value");
  }
  return value;
}

// The database URL is read when the db modules load, so it is set before them.
const TEST_DB_PATH = await vi.hoisted(async () => {
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const path = join(
    tmpdir(),
    `slide-review-migration-${process.pid}-${Date.now()}.pglite`,
  );
  process.env.DATABASE_URL = `pglite:${path}`;
  return path;
});
const importSpy = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@agent-native/core/review", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/review")>();
  importSpy.fn.mockImplementation(actual.importReviewComments);
  return { ...actual, importReviewComments: importSpy.fn };
});

type LegacyRow = typeof schema.slideComments.$inferSelect;

const DECK = { ownerEmail: "owner@example.com", orgId: "org-1" } as const;

function legacy(id: string, overrides: Partial<LegacyRow> = {}): LegacyRow {
  return {
    id,
    deckId: "deck-1",
    slideId: "slide-1",
    threadId: "thread-1",
    parentId: "root",
    content: `Body ${id}`,
    quotedText: null,
    anchor: null,
    emojiReactionsJson: "{}",
    authorEmail: "rev@example.com",
    authorName: "Reviewer",
    resolved: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("legacyCommentsToReview", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("maps a legacy thread onto one review thread anchored to its slide", () => {
    const rows = [
      legacy("root", {
        parentId: null,
        quotedText: " Revenue ",
        anchor: JSON.stringify({
          x: 10,
          y: 20,
          objectId: "chart",
          objectX: 1,
          objectY: 2,
        }),
        emojiReactionsJson: JSON.stringify({
          "👍": ["a@x.com", "b@x.com"],
          "🎉": ["c@x.com"],
        }),
        resolved: true,
        updatedAt: "2026-01-05T00:00:00.000Z",
      }),
      legacy("reply", {
        resolved: false,
        createdAt: "2026-01-02T00:00:00.000Z",
      }),
      legacy("orphan", {
        parentId: "deleted",
        createdAt: "2026-01-03T00:00:00.000Z",
      }),
      legacy("bot", {
        authorName: " AI Agent ",
        authorEmail: "owner@example.com",
      }),
    ];

    const [root, reply, orphan, bot] = legacyCommentsToReview(
      "deck-1",
      rows,
      DECK,
    );

    expect(root).toMatchObject({
      id: "root",
      resourceType: "deck",
      resourceId: "deck-1",
      threadId: "thread-1",
      parentCommentId: null,
      targetId: "slide-1",
      status: "resolved",
      resolvedAt: "2026-01-05T00:00:00.000Z",
      anchor: {
        kind: "slide",
        slideId: "slide-1",
        quotedText: "Revenue",
        point: { x: 10, y: 20, objectId: "chart", objectX: 1, objectY: 2 },
      },
      createdBy: "human",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      visibility: "private",
      metadata: { source: "slide_comments" },
    });
    expect(present(root).reactions).toEqual([
      { actorEmail: "a@x.com", reaction: "👍" },
      { actorEmail: "b@x.com", reaction: "👍" },
      { actorEmail: "c@x.com", reaction: "🎉" },
    ]);
    for (const child of [reply, orphan, bot]) {
      expect(child).toMatchObject({
        parentCommentId: "root",
        threadId: "thread-1",
        targetId: "slide-1",
        status: "resolved",
        anchor: null,
      });
    }
    expect(present(bot).createdBy).toBe("agent");
    expect(present(reply).createdBy).toBe("human");
  });

  it("promotes the earliest surviving comment when a thread lost its root", () => {
    const [first, second] = legacyCommentsToReview(
      "deck-1",
      [
        legacy("first", {
          parentId: "gone",
          slideId: "slide-2",
          quotedText: "Q",
        }),
        legacy("second", { parentId: "gone" }),
      ],
      DECK,
    );

    expect(first).toMatchObject({
      parentCommentId: null,
      targetId: "slide-2",
      anchor: { kind: "slide", slideId: "slide-2", quotedText: "Q" },
    });
    expect(second).toMatchObject({
      parentCommentId: "first",
      targetId: "slide-2",
    });
  });

  it("keeps a comment whose anchor or reactions cannot be read and names the field", () => {
    const [root, reply] = legacyCommentsToReview(
      "deck-1",
      [
        legacy("root", {
          parentId: null,
          anchor: "{not json",
          emojiReactionsJson: "[1]",
        }),
        legacy("reply", { emojiReactionsJson: "{broken" }),
      ],
      DECK,
    );

    expect(root).toMatchObject({
      body: "Body root",
      anchor: { kind: "slide", slideId: "slide-1" },
      reactions: [],
      metadata: {
        source: "slide_comments",
        unreadableLegacyFields: ["anchor", "reactions"],
      },
    });
    expect(present(root).anchor).not.toHaveProperty("point");
    expect(reply).toMatchObject({
      body: "Body reply",
      reactions: [],
      metadata: { unreadableLegacyFields: ["reactions"] },
    });
  });
});

describe("ensureSlideReviewMigrated", () => {
  beforeAll(async () => {
    const { runSlidesMigrations } = await import("../plugins/db.js");
    await runSlidesMigrations(undefined);
  }, 120_000);

  afterAll(() => {
    rmSync(TEST_DB_PATH, { force: true, recursive: true });
  });

  beforeEach(() => {
    importSpy.fn.mockClear();
    __resetSlideReviewMigrationForTests();
  });

  async function marker(deckId: string) {
    const [row] = await getDb()
      .select()
      .from(schema.slideCommentReviewMigrations)
      .where(eq(schema.slideCommentReviewMigrations.deckId, deckId));
    return row;
  }

  it("copies a deck once, shares a concurrent run, and trusts the marker afterwards", async () => {
    await getDb()
      .insert(schema.slideComments)
      .values([
        legacy("m1-root", {
          deckId: "deck-m1",
          threadId: "m1",
          parentId: null,
        }),
        legacy("m1-reply", {
          deckId: "deck-m1",
          threadId: "m1",
          parentId: "m1-root",
        }),
      ]);

    await Promise.all([
      ensureSlideReviewMigrated("deck-m1", DECK),
      ensureSlideReviewMigrated("deck-m1", DECK),
    ]);
    expect(importSpy.fn).toHaveBeenCalledTimes(1);
    expect(await marker("deck-m1")).toMatchObject({ importedCount: 2 });

    // A fresh process has no in-memory record; the marker row alone stops it.
    __resetSlideReviewMigrationForTests();
    await ensureSlideReviewMigrated("deck-m1", DECK);
    expect(importSpy.fn).toHaveBeenCalledTimes(1);

    const comments = await queryReviewComments({
      resourceType: "deck",
      resourceId: "deck-m1",
      scope: {},
      bypassScope: true,
      includeResolved: true,
    });
    expect(
      Object.fromEntries(
        comments.map((comment) => [comment.id, comment.parentCommentId]),
      ),
    ).toEqual({ "m1-root": null, "m1-reply": "m1-root" });
  });

  it("writes no marker when the import fails, so the next request retries", async () => {
    await getDb()
      .insert(schema.slideComments)
      .values(
        legacy("m2-root", {
          deckId: "deck-m2",
          threadId: "m2",
          parentId: null,
        }),
      );
    importSpy.fn.mockRejectedValueOnce(new Error("pool closed"));

    await expect(ensureSlideReviewMigrated("deck-m2", DECK)).rejects.toThrow(
      "pool closed",
    );
    expect(await marker("deck-m2")).toBeUndefined();

    await ensureSlideReviewMigrated("deck-m2", DECK);
    expect(await marker("deck-m2")).toMatchObject({ importedCount: 1 });
  });

  it("reads every page of a large deck's comments", async () => {
    const rows = Array.from({ length: 501 }, (_, index) =>
      legacy(`m3-${String(index).padStart(3, "0")}`, {
        deckId: "deck-m3",
        threadId: `m3-${index}`,
        parentId: null,
        // Most rows share a timestamp, so the cursor has to break ties by id.
        createdAt:
          index < 450
            ? "2026-01-01T00:00:00.000Z"
            : `2026-01-02T00:00:${String(index - 450).padStart(2, "0")}.000Z`,
      }),
    );
    await getDb().insert(schema.slideComments).values(rows);
    importSpy.fn.mockImplementationOnce(async (comments: unknown[]) => ({
      inserted: comments.length,
      skipped: 0,
    }));

    await ensureSlideReviewMigrated("deck-m3", DECK);

    const imported = present(importSpy.fn.mock.calls[0])[0] as { id: string }[];
    expect(new Set(imported.map((comment) => comment.id)).size).toBe(501);
  });
});
