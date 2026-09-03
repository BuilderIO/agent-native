import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/index.js", () => ({
  getDb: vi.fn(),
  schema: {
    deckVersions: {
      id: "id",
      deckId: "deckId",
      ownerEmail: "ownerEmail",
      title: "title",
      data: "data",
      createdAt: "createdAt",
      chatContext: "chatContext",
      changeGroup: "changeGroup",
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  desc: (value: unknown) => value,
  eq: (...args: unknown[]) => args,
}));

import { getDb } from "../db/index.js";
import {
  createDeckVersionSnapshot,
  deckVersionChangeGroupFromAction,
  deckVersionChatContextFromAction,
  deckVersionContentSignature,
} from "./deck-versions.js";

let latestVersion:
  | {
      title: string;
      data: string;
      createdAt: string;
      chatContext?: string | null;
    }
  | undefined;
const insertedVersions: unknown[] = [];
let insertedRows: unknown[] = [];
let conflictInsert = false;
const db = {
  select: () => ({
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: async () => (latestVersion ? [latestVersion] : []),
        }),
      }),
    }),
  }),
  insert: () => ({
    values: (value: unknown) => {
      insertedVersions.push(value);
      return {
        onConflictDoNothing: () => ({
          returning: async () => (conflictInsert ? [] : insertedRows),
        }),
      };
    },
  }),
};

describe("deck version action context", () => {
  it("preserves WebMCP thread, run, and turn metadata", () => {
    expect(
      deckVersionChatContextFromAction({
        caller: "webmcp",
        threadId: "thread-webmcp",
        runId: "run-webmcp",
        turnId: "turn-webmcp",
      }),
    ).toEqual({
      threadId: "thread-webmcp",
      runId: "run-webmcp",
      turnId: "turn-webmcp",
    });
  });

  it("uses the turn as the remote undo group", () => {
    expect(
      deckVersionChangeGroupFromAction({
        caller: "tool",
        threadId: "thread-1",
        runId: "run-1",
        turnId: "turn-1",
      }),
    ).toBe("turn-1");
  });
});

describe("deck version snapshot deduplication", () => {
  beforeEach(() => {
    latestVersion = undefined;
    insertedVersions.length = 0;
    insertedRows = [{ id: "version-1" }];
    conflictInsert = false;
  });

  it("ignores updatedAt when checking for duplicate deck content", () => {
    expect(
      deckVersionContentSignature(
        JSON.stringify({
          updatedAt: "new",
          slides: [{ id: "s1" }],
          id: "deck-1",
        }),
      ),
    ).toBe(
      deckVersionContentSignature(
        JSON.stringify({
          id: "deck-1",
          slides: [{ id: "s1" }],
          updatedAt: "old",
        }),
      ),
    );
    expect(
      deckVersionContentSignature(
        JSON.stringify({
          slides: [{ id: "s1" }],
          id: "deck-1",
        }),
      ),
    ).toBe(
      deckVersionContentSignature(
        JSON.stringify({
          id: "deck-1",
          slides: [{ id: "s1" }],
        }),
      ),
    );
  });

  it("keeps one snapshot for a multi-action agent turn", async () => {
    latestVersion = {
      title: "Deck",
      data: JSON.stringify({ slides: [{ id: "s1", content: "first" }] }),
      createdAt: "2026-09-03T00:00:00.000Z",
      chatContext: JSON.stringify({
        threadId: "thread-1",
        runId: "run-1",
        turnId: "turn-1",
      }),
    };

    await expect(
      createDeckVersionSnapshot(
        {
          id: "deck-1",
          title: "Deck",
          data: JSON.stringify({ slides: [{ id: "s1", content: "last" }] }),
          ownerEmail: "owner@example.com",
        },
        {
          force: true,
          chatContext: {
            threadId: "thread-1",
            runId: "run-1",
            turnId: "turn-1",
          },
          db: db as unknown as ReturnType<typeof getDb>,
        },
      ),
    ).resolves.toEqual({ created: false, reason: "same-agent-turn" });
    expect(insertedVersions).toHaveLength(0);
  });

  it("uses an atomic change-group insert for concurrent agent turns", async () => {
    conflictInsert = true;

    await expect(
      createDeckVersionSnapshot(
        {
          id: "deck-1",
          title: "Deck",
          data: JSON.stringify({ slides: [{ id: "s1", content: "last" }] }),
          ownerEmail: "owner@example.com",
        },
        {
          force: true,
          chatContext: { turnId: "turn-1" },
          db: db as unknown as ReturnType<typeof getDb>,
        },
      ),
    ).resolves.toEqual({ created: false, reason: "same-agent-turn" });
    expect(insertedVersions).toEqual([
      expect.objectContaining({ changeGroup: "turn-1" }),
    ]);
  });
});
