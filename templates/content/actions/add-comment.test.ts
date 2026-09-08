import { beforeEach, describe, expect, it, vi } from "vitest";

type CommentRow = {
  id: string;
  documentId: string;
  threadId: string;
  parentId: string | null;
  [key: string]: unknown;
};

const state = vi.hoisted(() => ({
  rows: [] as CommentRow[],
  inserted: [] as Record<string, unknown>[],
  agent: true,
  lock: undefined as (() => Promise<void>) | undefined,
}));
const mockAssertAccess = vi.hoisted(() =>
  vi.fn(async () => ({
    resource: { ownerEmail: "owner@example.com", title: "Doc", orgId: null },
  })),
);

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestRunContext: () =>
    state.agent ? { runId: "agent-run-1" } : { browserTabId: "human-tab-1" },
  getRequestUserEmail: () => "author@example.com",
  getRequestUserName: () => "Authenticated Profile Name",
}));
vi.mock("../server/lib/comment-notifications.js", () => ({
  notifyDocumentComment: vi.fn(async () => false),
}));
vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ and: conditions }),
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

function matches(row: CommentRow, condition: any): boolean {
  if (condition.and) {
    return condition.and.every((child: unknown) => matches(row, child));
  }
  const key = String(condition.column).split(".").pop() as keyof CommentRow;
  return row[key] === condition.value;
}

vi.mock("../server/db/index.js", () => {
  const column = (name: string) => `documentComments.${name}`;
  const schema = {
    documents: { id: "documents.id", ownerEmail: "documents.ownerEmail" },
    documentComments: {
      id: column("id"),
      documentId: column("documentId"),
      threadId: column("threadId"),
    },
  };
  const db = {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => ({
          for: async () => {
            await state.lock?.();
            return [{ id: "doc-1" }];
          },
          limit: async () =>
            state.rows
              .filter((row) => matches(row, condition))
              .map((row) => ({ ...row })),
        }),
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (state.rows.some((row) => row.id === value.id)) return [];
            state.inserted.push(value);
            state.rows.push(value as CommentRow);
            return [{ id: value.id }];
          },
        }),
      }),
    }),
  };
  return {
    getDb: () => ({ ...db, transaction: (run: any) => run(db) }),
    schema,
  };
});

import action, { addCommentWithGuard } from "./add-comment";

const run = (args: Record<string, unknown>) => (action as any).run(args);

beforeEach(() => {
  vi.clearAllMocks();
  state.inserted = [];
  state.agent = true;
  state.lock = undefined;
  state.rows = [
    { id: "root-1", documentId: "doc-1", threadId: "root-1", parentId: null },
    { id: "root-2", documentId: "doc-2", threadId: "root-2", parentId: null },
  ];
});

describe("add-comment reply boundary", () => {
  it("adds a reply only when parent and thread match the document", async () => {
    const result = await run({
      documentId: "doc-1",
      content: "Reply",
      threadId: "root-1",
      parentId: "root-1",
    });

    expect(result.threadId).toBe("root-1");
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      documentId: "doc-1",
      threadId: "root-1",
      parentId: "root-1",
    });
  });

  it("does not insert a reply while final resolution holds the document lock", async () => {
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    state.lock = () => {
      entered();
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const pending = run({
      documentId: "doc-1",
      content: "Concurrent reply",
      threadId: "root-1",
      parentId: "root-1",
    });
    await waiting;
    expect(state.inserted).toHaveLength(0);
    release();
    await pending;
    expect(state.inserted).toHaveLength(1);
  });

  it("derives authorship from the authenticated caller", async () => {
    await run({
      documentId: "doc-1",
      content: "Comment",
      authorName: "Impersonated Person",
    });

    expect(state.inserted[0]).toMatchObject({
      authorEmail: "author@example.com",
      authorName: "AI Agent",
      actorKind: "agent",
    });
  });

  it("preserves human identity when request context contains only a browser tab", async () => {
    state.agent = false;
    await run({
      documentId: "doc-1",
      content: "Human comment",
      actorKind: "agent",
    });
    expect(state.inserted[0]).toMatchObject({
      authorName: "Authenticated Profile Name",
      actorKind: "human",
    });
  });

  it("reconciles an identical retry and rejects changed content for its key", async () => {
    const args = {
      documentId: "doc-1",
      threadId: "root-1",
      parentId: "root-1",
      content: "One answer",
      idempotencyKey: "request-1",
    };
    const first = await run(args);
    const retry = await run(args);
    expect(retry.id).toBe(first.id);
    expect(state.inserted).toHaveLength(1);
    await expect(run({ ...args, content: "Different answer" })).rejects.toThrow(
      "different comment",
    );
    expect(state.inserted).toHaveLength(1);
  });

  it.each([
    { quotedText: "Different quote" },
    { anchorPrefix: "Different prefix" },
    { anchorSuffix: "Different suffix" },
    { anchorStartOffset: 20 },
    { mentions: [{ email: "other@example.test", name: "Other" }] },
  ])("rejects a retry with changed comment context: %o", async (changed) => {
    const args = {
      documentId: "doc-1",
      content: "Same text",
      idempotencyKey: "context-request",
    };
    await run(args);
    await expect(run({ ...args, ...changed })).rejects.toThrow(
      "different comment",
    );
    expect(state.inserted).toHaveLength(1);
  });

  it("recovers an already saved reply before checking a now-stale source", async () => {
    const args = {
      documentId: "doc-1",
      threadId: "root-1",
      parentId: "root-1",
      content: "Saved answer",
      idempotencyKey: "saved-request",
    };
    await run(args);
    const guard = vi.fn(async () => {
      throw new Error("Page changed later");
    });
    await expect(
      addCommentWithGuard(args, undefined, guard),
    ).resolves.toMatchObject({ duplicate: true });
    expect(guard).not.toHaveBeenCalled();
    expect(state.inserted).toHaveLength(1);
  });

  it.each([
    { threadId: "root-1" },
    { parentId: "root-1" },
    { threadId: "root-2", parentId: "root-1" },
    { threadId: "root-2", parentId: "root-2" },
  ])(
    "rejects partial, mismatched, or foreign reply selectors: %o",
    async (reply) => {
      await expect(
        run({ documentId: "doc-1", content: "Reply", ...reply }),
      ).rejects.toThrow(/Replies require|does not belong/);
      expect(state.inserted).toHaveLength(0);
    },
  );
});
