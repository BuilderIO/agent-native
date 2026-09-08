import type { ActionRunContext } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

type CommentRow = {
  id: string;
  documentId: string;
  threadId: string;
  parentId: string | null;
};

const state = vi.hoisted(() => ({
  rows: [] as CommentRow[],
  inserted: [] as Record<string, unknown>[],
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
    },
  };
  const db = {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => ({
          limit: async () =>
            state.rows
              .filter((row) => matches(row, condition))
              .map((row) => ({ threadId: row.threadId })),
        }),
      }),
    }),
    insert: () => ({
      values: async (value: Record<string, unknown>) => {
        state.inserted.push(value);
      },
    }),
  };
  return { getDb: () => db, schema };
});

import action from "./add-comment";

const run = (args: Record<string, unknown>, ctx?: ActionRunContext) =>
  (action as any).run(args, ctx);

beforeEach(() => {
  vi.clearAllMocks();
  state.inserted = [];
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
