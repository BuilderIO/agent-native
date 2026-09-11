import type { ActionRunContext } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

type CommentRow = {
  id: string;
  documentId: string;
  threadId: string;
  parentId: string | null;
  resolved?: number;
  [key: string]: unknown;
};

const state = vi.hoisted(() => ({
  rows: [] as CommentRow[],
  inserted: [] as Record<string, unknown>[],
  locked: [] as string[],
  afterRootLock: undefined as (() => void) | undefined,
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
  getRequestRunContext: () => ({ runId: "run-1" }),
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
    documentComments: {
      id: column("id"),
      documentId: column("documentId"),
      threadId: column("threadId"),
      authorEmail: column("authorEmail"),
    },
  };
  const db = {
    transaction: async (callback: (tx: any) => Promise<unknown>) =>
      callback(db),
    select: () => ({
      from: () => ({
        where: (condition: unknown) => ({
          limit: () => {
            const result = state.rows.filter((row) => matches(row, condition));
            return Object.assign(Promise.resolve(result), {
              for: async () => {
                state.locked.push(...result.map((row) => row.id));
                state.afterRootLock?.();
                return result;
              },
            });
          },
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
  return { getDb: () => db, schema };
});

import { notifyDocumentComment } from "../server/lib/comment-notifications.js";
import action from "./add-comment";

const run = (args: Record<string, unknown>, ctx?: ActionRunContext) =>
  (action as any).run(args, ctx);

beforeEach(() => {
  vi.clearAllMocks();
  state.inserted = [];
  state.locked = [];
  state.afterRootLock = undefined;
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

  it("derives authorship from the authenticated caller", async () => {
    await run({
      documentId: "doc-1",
      content: "Comment",
      authorName: "Impersonated Person",
    });

    expect(state.inserted[0]).toMatchObject({
      authorEmail: "author@example.com",
      authorName: "Author",
    });
  });

  it.each([
    ["mcp", "mcp"],
    ["webmcp", "mcp"],
    ["tool", "agent"],
    ["frontend", "frontend"],
    ["http", "http"],
    ["cli", "cli"],
    ["automation", "automation"],
  ] as const)(
    "records %s submission separately from the account",
    async (caller, source) => {
      await run(
        {
          documentId: "doc-1",
          content: "Comment",
          submissionSource: "frontend",
        },
        { caller, runId: caller === "tool" ? "run-1" : undefined },
      );
      expect(state.inserted[0]).toMatchObject({
        authorEmail: "author@example.com",
        authorName: "Author",
        submissionSource: source,
        submissionRunId: caller === "tool" ? "run-1" : null,
      });
    },
  );

  it("does not infer an agent from absent caller metadata", async () => {
    await run({
      documentId: "doc-1",
      content: "Comment",
      submissionSource: "mcp",
    });
    expect(state.inserted[0]).toMatchObject({ submissionSource: null });
  });

  it("attributes a reply to its own submission source", async () => {
    await run(
      {
        documentId: "doc-1",
        content: "Reply",
        threadId: "root-1",
        parentId: "root-1",
      },
      { caller: "tool", runId: "run-reply" },
    );
    expect(state.inserted[0]).toMatchObject({
      parentId: "root-1",
      submissionSource: "agent",
      submissionRunId: "run-reply",
    });
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

describe("comment submission receipts", () => {
  const clientOperationId = "11111111-1111-4111-8111-111111111111";
  const input = { documentId: "doc-1", content: "Comment", clientOperationId };
  it("uses the client UUID as the receipt and inserts a retried submission once", async () => {
    expect(await run(input)).toMatchObject({
      id: clientOperationId,
      threadId: clientOperationId,
    });
    expect(await run(input)).toMatchObject({
      id: clientOperationId,
      replayed: true,
      notified: null,
    });
    expect(state.inserted).toHaveLength(1);
    expect(notifyDocumentComment).toHaveBeenCalledTimes(1);
    expect(mockAssertAccess).toHaveBeenCalledTimes(2);
  });
  it("preserves original submission provenance when a retry comes from a new run", async () => {
    await run(input, { caller: "tool", runId: "original-run" });
    expect(
      await run(input, { caller: "mcp", runId: "retry-run" }),
    ).toMatchObject({ replayed: true });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      submissionSource: "agent",
      submissionRunId: "original-run",
    });
  });
  it("recovers the same receipt after notification fails after insertion", async () => {
    vi.mocked(notifyDocumentComment).mockRejectedValueOnce(
      new Error("Notification failed"),
    );
    await expect(run(input)).rejects.toThrow("Notification failed");
    expect(await run(input)).toMatchObject({
      id: clientOperationId,
      replayed: true,
    });
    expect(state.inserted).toHaveLength(1);
    expect(notifyDocumentComment).toHaveBeenCalledTimes(1);
  });
  it.each(["documentId", "authorEmail", "content"])(
    "rejects receipt reuse with another %s",
    async (field) => {
      await run(input);
      state.rows.find((row) => row.id === clientOperationId)![field] =
        "different";
      await expect(run(input)).rejects.toThrow(
        "conflicts with another submission",
      );
      expect(state.inserted).toHaveLength(1);
    },
  );
  it("inserts identical content with different operation receipts separately", async () => {
    await run(input);
    await run({
      ...input,
      clientOperationId: "22222222-2222-4222-8222-222222222222",
    });
    expect(state.inserted).toHaveLength(2);
  });
  it("rejects a reply to a resolved root even if its parent reply is stale", async () => {
    state.rows[0].resolved = 1;
    state.rows.push({
      id: "reply-1",
      documentId: "doc-1",
      threadId: "root-1",
      parentId: "root-1",
      resolved: 0,
    });
    await expect(
      run({ ...input, threadId: "root-1", parentId: "reply-1" }),
    ).rejects.toThrow("Reopen the thread");
    expect(state.inserted).toHaveLength(0);
    expect(state.locked).toEqual(["root-1"]);
  });
  it("rechecks a receipt committed while waiting for a subsequently resolved root", async () => {
    const reply = { ...input, threadId: "root-1", parentId: "root-1" };
    await run(reply);
    const saved = state.rows.pop()!;
    state.afterRootLock = () => {
      state.rows.push(saved);
      state.rows[0].resolved = 1;
    };
    expect(await run(reply)).toMatchObject({
      id: clientOperationId,
      replayed: true,
    });
    expect(state.inserted).toHaveLength(1);
  });
  it("reconciles an already-saved reply after its thread is resolved", async () => {
    const reply = { ...input, threadId: "root-1", parentId: "root-1" };
    await run(reply);
    state.rows[0].resolved = 1;
    expect(await run(reply)).toMatchObject({
      id: clientOperationId,
      replayed: true,
    });
    expect(state.inserted).toHaveLength(1);
  });
});
