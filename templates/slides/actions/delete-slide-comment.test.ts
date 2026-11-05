import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  deckId: string;
  slideId: string;
  authorEmail: string;
  threadId: string;
  parentId: string | null;
  createdAt?: string;
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
  asc: (column: unknown) => ({ __asc: column }),
  inArray: (col: unknown, values: unknown[]) => ({ __in: [col, values] }),
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
  if (cond.__in) {
    const [col, values] = cond.__in;
    const key = String(col).split(".").pop() as keyof Row;
    return values.includes(row[key]);
  }
  return true;
}

vi.mock("../server/db/index.js", () => {
  const col = (name: string) => `slideComments.${name}`;
  const schema = {
    decks: { id: "decks.id" },
    slideComments: {
      id: col("id"),
      deckId: col("deckId"),
      slideId: col("slideId"),
      authorEmail: col("authorEmail"),
      threadId: col("threadId"),
      parentId: col("parentId"),
      createdAt: col("createdAt"),
    },
  };

  const db = {
    select: (projection?: Record<string, unknown>) => ({
      from: (table?: unknown) => ({
        where: (cond: any) => {
          if (table === schema.decks)
            return { for: async () => [{ id: "deck-1" }] };
          const matched = state.rows.filter((r) => matches(r, cond));
          const project = (row: Row) => {
            if (!projection) return row;
            const out: Record<string, unknown> = {};
            for (const key of Object.keys(projection))
              out[key] = row[key as keyof Row];
            return out;
          };
          const limit = async (n: number) => matched.slice(0, n).map(project);
          const ordered = [...matched].sort(
            (left, right) =>
              String(left.createdAt ?? "").localeCompare(
                String(right.createdAt ?? ""),
              ) || left.id.localeCompare(right.id),
          );
          const orderedLimit = async (n: number) =>
            ordered.slice(0, n).map(project);
          const forUpdate = async () => ordered.map(project);
          const all = async () => matched.map(project);
          return {
            limit,
            then: (resolve: (rows: unknown) => unknown, reject?: unknown) =>
              all().then(resolve, reject as never),
            orderBy: () => ({
              limit: orderedLimit,
              for: forUpdate,
              then: (resolve: (rows: unknown) => unknown, reject?: unknown) =>
                forUpdate().then(resolve, reject as never),
            }),
          };
        },
      }),
    }),
    delete: () => ({
      where: (cond: any) => {
        state.rows = state.rows.filter((r) => !matches(r, cond));
        return Promise.resolve();
      },
    }),
  };

  return {
    getDb: () => ({
      ...db,
      transaction: async (run: (tx: typeof db) => Promise<unknown>) => run(db),
    }),
    schema,
  };
});

import action from "./delete-slide-comment";

type DeleteArgs = { id: string; deckId: string };
type DeleteAction = {
  changeResource: (args: { deckId: string }) => unknown;
  needsApproval: (
    args: DeleteArgs,
    ctx?: { caller: string },
  ) => Promise<boolean>;
  audit: { target: (args: DeleteArgs, result: unknown) => unknown };
  run: (args: DeleteArgs, ctx?: { caller: string }) => Promise<unknown>;
};
const deleteAction = action as unknown as DeleteAction;

function run(args: DeleteArgs, ctx?: { caller: string }) {
  return deleteAction.run(args, ctx);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockGetUserEmail.mockReturnValue("author@example.com");
  state.rows = [
    {
      id: "c-1",
      deckId: "deck-1",
      slideId: "slide-1",
      authorEmail: "author@example.com",
      threadId: "c-1",
      parentId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "c-2",
      deckId: "deck-1",
      slideId: "slide-1",
      authorEmail: "other@example.com",
      threadId: "c-1",
      parentId: "c-1",
      createdAt: "2026-01-01T00:01:00.000Z",
    },
    {
      id: "c-3",
      deckId: "deck-1",
      slideId: "slide-1",
      authorEmail: "other@example.com",
      threadId: "c-3",
      parentId: null,
      createdAt: "2026-01-02T00:00:00.000Z",
    },
  ];
});

describe("delete-slide-comment", () => {
  it("announces its change to every collaborator on the deck", () => {
    expect(deleteAction.changeResource({ deckId: "deck-1" })).toEqual({
      resourceType: "deck",
      resourceId: "deck-1",
    });
  });

  it("asks before an agent deletes another person's comment", async () => {
    const needsApproval = deleteAction.needsApproval;
    expect(
      await needsApproval({ id: "c-3", deckId: "deck-1" }, { caller: "tool" }),
    ).toBe(true);
    expect(
      await needsApproval(
        { id: "c-3", deckId: "deck-1" },
        { caller: "frontend" },
      ),
    ).toBe(false);
  });

  it("asks before an agent deletes a thread root that holds another user's reply", async () => {
    const needsApproval = deleteAction.needsApproval;
    expect(
      await needsApproval({ id: "c-1", deckId: "deck-1" }, { caller: "tool" }),
    ).toBe(true);
  });

  it("asks before an agent deletes another user's agent comment", async () => {
    state.rows.push({
      id: "c-4",
      deckId: "deck-1",
      slideId: "slide-1",
      authorEmail: "other@example.com",
      authorKind: "agent",
      threadId: "c-4",
      parentId: null,
      createdAt: "2026-01-03T00:00:00.000Z",
    } as Row);
    const needsApproval = deleteAction.needsApproval;
    expect(
      await needsApproval({ id: "c-4", deckId: "deck-1" }, { caller: "tool" }),
    ).toBe(true);
  });

  it("does not ask when the agent deletes the user's own agent comment", async () => {
    state.rows.push({
      id: "c-5",
      deckId: "deck-1",
      slideId: "slide-1",
      authorEmail: "author@example.com",
      authorKind: "agent",
      threadId: "c-5",
      parentId: null,
      createdAt: "2026-01-03T00:00:00.000Z",
    } as Row);
    const needsApproval = deleteAction.needsApproval;
    expect(
      await needsApproval({ id: "c-5", deckId: "deck-1" }, { caller: "tool" }),
    ).toBe(false);
  });

  it("records the deleted comment as the audit target", () => {
    expect(
      deleteAction.audit.target({ id: "c-3", deckId: "deck-1" }, { ok: true }),
    ).toEqual({ type: "slide-comment", id: "c-3" });
  });

  it("lets the author delete their own comment with commenter access", async () => {
    const result = await run({ id: "c-1", deckId: "deck-1" });

    expect(result).toEqual({ ok: true, removedIds: ["c-1", "c-2"] });
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "deck",
      "deck-1",
      "commenter",
    );
    expect(state.rows.map((r) => r.id)).toEqual(["c-3"]);
  });

  it("refuses an agent delete whose thread now holds another person's reply", async () => {
    await expect(
      run({ id: "c-1", deckId: "deck-1" }, { caller: "tool" }),
    ).rejects.toThrow("Ask the user");
    expect(state.rows.map((r) => r.id)).toEqual(["c-1", "c-2", "c-3"]);
  });

  it("checks deck access before the approval preflight reads comments", async () => {
    mockAssertAccess.mockRejectedValueOnce(new Error("no access"));

    await expect(
      deleteAction.needsApproval(
        { id: "c-1", deckId: "deck-1" },
        {
          caller: "tool",
        },
      ),
    ).rejects.toThrow("no access");
  });

  it("lets an agent delete another person's reply once the user approved the call", async () => {
    const result = await deleteAction.run({ id: "c-1", deckId: "deck-1" }, {
      caller: "tool",
      approvedToolCallKey: "key-1",
    } as never);

    expect(result).toMatchObject({ ok: true });
    expect(state.rows.map((r) => r.id)).toEqual(["c-3"]);
  });

  it("requires editor access to delete someone else's comment", async () => {
    await run({ id: "c-3", deckId: "deck-1" });

    expect(mockAssertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");
    expect(state.rows.map((r) => r.id)).toEqual(["c-1", "c-2"]);
  });

  it("deletes only the selected reply and keeps the thread root", async () => {
    mockGetUserEmail.mockReturnValue("other@example.com");

    await run({ id: "c-2", deckId: "deck-1" });

    expect(state.rows.map((r) => r.id)).toEqual(["c-1", "c-3"]);
  });

  it("deletes a root thread by parentage when its id differs from threadId", async () => {
    state.rows[0]!.threadId = "thread-root";
    state.rows[1]!.threadId = "thread-root";

    await run({ id: "c-1", deckId: "deck-1" });

    expect(state.rows.map((r) => r.id)).toEqual(["c-3"]);
  });

  it("deletes a legacy reply with a null parent without deleting its thread", async () => {
    state.rows.push({
      id: "legacy-reply",
      deckId: "deck-1",
      slideId: "slide-1",
      authorEmail: "other@example.com",
      threadId: "c-1",
      parentId: null,
      createdAt: "2026-01-01T00:02:00.000Z",
    });
    mockGetUserEmail.mockReturnValue("other@example.com");

    await run({ id: "legacy-reply", deckId: "deck-1" });

    expect(state.rows.map((r) => r.id)).toEqual(["c-1", "c-2", "c-3"]);
  });

  it("propagates a Forbidden failure when the caller lacks the required role", async () => {
    mockGetUserEmail.mockReturnValue("outsider@example.com");
    mockAssertAccess.mockImplementation(() => {
      throw new Error("Forbidden");
    });

    await expect(run({ id: "c-3", deckId: "deck-1" })).rejects.toThrow(
      "Forbidden",
    );
    expect(state.rows.map((r) => r.id)).toEqual(["c-1", "c-2", "c-3"]);
  });

  it("throws when the comment does not exist", async () => {
    await expect(run({ id: "missing", deckId: "deck-1" })).rejects.toThrow(
      "Comment not found",
    );
  });

  it("does not find a comment outside the authorized deck", async () => {
    await expect(run({ id: "c-1", deckId: "deck-2" })).rejects.toThrow(
      "Comment not found",
    );
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "deck",
      "deck-2",
      "commenter",
    );
    expect(state.rows.map((r) => r.id)).toEqual(["c-1", "c-2", "c-3"]);
  });
});
