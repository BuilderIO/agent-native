import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory slideComments rows, filtered by mocked and()/eq() conditions —
// mirrors the pattern in templates/content/actions/sync-notion-comments.test.ts
// so thread-wide resolve/reopen updates (which touch multiple rows) are
// exercised for real instead of only asserting on the last .set() call.
type Row = {
  id: string;
  deckId: string;
  slideId: string;
  threadId: string;
  parentId: string | null;
  content: string;
  authorEmail: string;
  resolved: boolean;
  updatedAt: string;
};

const state = vi.hoisted(() => ({ rows: [] as Row[] }));
const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockGetUserEmail = vi.hoisted(() => vi.fn(() => "author@example.com"));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mockGetUserEmail(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conds: unknown[]) => ({ __and: conds }),
  eq: (col: unknown, value: unknown) => ({ __eq: [col, value] }),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}));

function matches(row: Row, cond: any): boolean {
  if (cond.__and) return cond.__and.every((c: any) => matches(row, c));
  if (cond.__eq) {
    const [col, value] = cond.__eq;
    const key = String(col).split(".").pop() as keyof Row;
    return row[key] === value;
  }
  return true;
}

vi.mock("../server/db/index.js", () => {
  const col = (name: string) => `slideComments.${name}`;
  const schema = {
    slideComments: {
      id: col("id"),
      deckId: col("deckId"),
      slideId: col("slideId"),
      threadId: col("threadId"),
      parentId: col("parentId"),
      content: col("content"),
      authorEmail: col("authorEmail"),
      resolved: col("resolved"),
      updatedAt: col("updatedAt"),
    },
  };

  const db = {
    select: (projection?: Record<string, unknown>) => ({
      from: () => ({
        where: (cond: any) => ({
          limit: async (n: number) => {
            const matched = state.rows.filter((r) => matches(r, cond));
            const project = (row: Row) => {
              if (!projection) return row;
              const out: Record<string, unknown> = {};
              for (const key of Object.keys(projection)) {
                out[key] = (row as any)[key];
              }
              return out;
            };
            return matched.slice(0, n).map(project);
          },
        }),
      }),
    }),
    update: () => ({
      set: (patch: Partial<Row>) => ({
        where: (cond: any) => {
          for (const row of state.rows) {
            if (matches(row, cond)) Object.assign(row, patch);
          }
          return Promise.resolve();
        },
      }),
    }),
  };

  return { getDb: () => db, schema };
});

import action from "./update-slide-comment";

function run(args: {
  id: string;
  deckId?: string;
  content?: string;
  resolved?: boolean;
}) {
  return (action as any).run(args);
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so a mockImplementation set in one test
  // (e.g. the "rejects reopening" case below) never leaks into the next.
  vi.resetAllMocks();
  mockGetUserEmail.mockReturnValue("author@example.com");
  state.rows = [
    {
      id: "c-1",
      deckId: "deck-1",
      slideId: "slide-1",
      threadId: "c-1",
      parentId: null,
      content: "Original text",
      authorEmail: "author@example.com",
      resolved: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "c-2",
      deckId: "deck-1",
      slideId: "slide-1",
      threadId: "c-1",
      parentId: "c-1",
      content: "A reply",
      authorEmail: "other@example.com",
      resolved: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
});

describe("update-slide-comment", () => {
  it("resolves the whole thread and requires editor access", async () => {
    const result = await run({ id: "c-1", resolved: true });

    expect(result).toEqual({ ok: true, resolved: true });
    expect(mockAssertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");
    expect(state.rows[0].resolved).toBe(true);
    expect(state.rows[1].resolved).toBe(true); // reply in the same thread also resolved
  });

  it("reopens the whole thread and requires editor access even for the comment's own author", async () => {
    state.rows.forEach((r) => (r.resolved = true));
    mockGetUserEmail.mockReturnValue("author@example.com"); // author of c-1

    const result = await run({ id: "c-1", resolved: false });

    expect(result).toEqual({ ok: true, resolved: false });
    // This is the crux of the permission-parity fix: reopening a thread you
    // authored still requires editor, matching the resolve path and matching
    // the content update-comment action.
    expect(mockAssertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");
    expect(state.rows[0].resolved).toBe(false);
    expect(state.rows[1].resolved).toBe(false); // reply in the same thread also reopened
  });

  it("rejects reopening for a non-author with only viewer access", async () => {
    mockGetUserEmail.mockReturnValue("outsider@example.com");
    mockAssertAccess.mockImplementation(
      (_type: string, _id: string, role: string) => {
        if (role === "editor") throw new Error("Forbidden");
      },
    );

    await expect(run({ id: "c-1", resolved: false })).rejects.toThrow(
      "Forbidden",
    );
  });

  it("allows the author to edit their own comment content with only viewer access", async () => {
    const result = await run({ id: "c-1", content: "Updated text" });

    expect(result).toEqual({ ok: true });
    expect(mockAssertAccess).toHaveBeenCalledWith("deck", "deck-1", "viewer");
    expect(state.rows[0].content).toBe("Updated text");
    expect(state.rows[1].content).toBe("A reply"); // untouched — content edits are single-row
  });

  it("requires editor access to edit someone else's comment content", async () => {
    mockGetUserEmail.mockReturnValue("outsider@example.com");

    await run({ id: "c-1", content: "Hijacked" });

    expect(mockAssertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");
  });

  it("throws when the comment does not exist", async () => {
    await expect(run({ id: "missing" })).rejects.toThrow("Comment not found");
  });

  it("throws when deckId is provided but does not match", async () => {
    await expect(run({ id: "c-1", deckId: "deck-2" })).rejects.toThrow(
      "Comment not found",
    );
  });
});
