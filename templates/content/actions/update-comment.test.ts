import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  documentId: string;
  threadId: string;
  parentId: string | null;
  content: string;
  mentionsJson?: string | null;
  authorEmail: string;
  resolved: number;
  updatedAt: string;
};

const state = vi.hoisted(() => ({ rows: [] as Row[], locked: [] as string[] }));
const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockGetUserEmail = vi.hoisted(() => vi.fn(() => "author@example.com"));
const mockGetUserName = vi.hoisted(() =>
  vi.fn((): string | undefined => undefined),
);
const mockWriteAppState = vi.hoisted(() => vi.fn());
const mockNotifyMentions = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mockGetUserEmail(),
  getRequestUserName: () => mockGetUserName(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("../server/lib/comment-notifications.js", () => ({
  notifyEditedCommentMentions: (...args: unknown[]) =>
    mockNotifyMentions(...args),
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
  const col = (name: string) => `documentComments.${name}`;
  const schema = {
    documentComments: {
      id: col("id"),
      documentId: col("documentId"),
      threadId: col("threadId"),
      parentId: col("parentId"),
      content: col("content"),
      mentionsJson: col("mentionsJson"),
      authorEmail: col("authorEmail"),
      resolved: col("resolved"),
      updatedAt: col("updatedAt"),
    },
  };

  const db = {
    transaction: async (callback: (tx: any) => Promise<unknown>) =>
      callback(db),
    select: (projection?: Record<string, unknown>) => ({
      from: () => ({
        where: (cond: any) => ({
          limit: (n: number) => {
            const matched = state.rows.filter((r) => matches(r, cond));
            const project = (row: Row) => {
              if (!projection) return row;
              const out: Record<string, unknown> = {};
              for (const key of Object.keys(projection)) {
                out[key] = (row as any)[key];
              }
              return out;
            };
            const result = matched.slice(0, n).map(project);
            return Object.assign(Promise.resolve(result), {
              for: async () => {
                state.locked.push(...matched.map((row) => row.id));
                return result;
              },
            });
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

import action from "./update-comment";

function run(
  args: {
    id: string;
    documentId?: string;
    content?: string;
    mentions?: string;
    resolved?: boolean;
  },
  ctx?: { caller: string },
) {
  return (action as any).run(args, ctx);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockGetUserEmail.mockReturnValue("author@example.com");
  mockAssertAccess.mockResolvedValue({
    resource: { title: "Plan", ownerEmail: "owner@example.com", orgId: null },
  });
  mockNotifyMentions.mockResolvedValue({
    status: "sent",
    sent: [],
    failed: [],
  });
  state.locked = [];
  state.rows = [
    {
      id: "c-1",
      documentId: "doc-1",
      threadId: "c-1",
      parentId: null,
      content: "Original text",
      authorEmail: "author@example.com",
      resolved: 0,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "c-2",
      documentId: "doc-1",
      threadId: "c-1",
      parentId: "c-1",
      content: "A reply",
      authorEmail: "other@example.com",
      resolved: 0,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "c-3",
      documentId: "doc-1",
      threadId: "c-3",
      parentId: null,
      content: "Unrelated thread",
      authorEmail: "other@example.com",
      resolved: 0,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
});

describe("update-comment (action) — reopen permission", () => {
  it("rejects an update without a mutation", async () => {
    await expect(run({ id: "c-1" })).rejects.toThrow(
      "Provide content, mentions, or resolved to update a comment",
    );
    expect(mockAssertAccess).not.toHaveBeenCalled();
  });

  it("requires editor access to reopen a thread, even for the comment's own author", async () => {
    state.rows.forEach((r) => (r.resolved = 1));
    mockGetUserEmail.mockReturnValue("author@example.com");

    const result = await run({ id: "c-1", resolved: false });

    expect(result).toEqual({
      ok: true,
      resolved: false,
      documentId: "doc-1",
    });
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "document",
      "doc-1",
      "editor",
    );
    expect(state.rows[0].resolved).toBe(0);
    expect(state.rows[1].resolved).toBe(0);
  });

  it("rejects reopening for a caller with only viewer access", async () => {
    state.rows.forEach((r) => (r.resolved = 1));
    mockAssertAccess.mockImplementation(
      (_type: string, _id: string, role: string) => {
        if (role === "editor") throw new Error("Forbidden");
      },
    );

    await expect(run({ id: "c-1", resolved: false })).rejects.toThrow(
      "Forbidden",
    );
    expect(state.rows[0].resolved).toBe(1);
    expect(state.rows[1].resolved).toBe(1);
  });

  it("requires editor access to resolve a thread", async () => {
    const result = await run({ id: "c-1", resolved: true });

    expect(result).toEqual({ ok: true, resolved: true, documentId: "doc-1" });
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "document",
      "doc-1",
      "editor",
    );
    expect(state.locked).toEqual(["c-1"]);
    expect(state.rows[1].resolved).toBe(1);
    expect(state.rows[2].resolved).toBe(0);
  });

  it("updates content and resolves the full thread in one transaction", async () => {
    const result = await run({
      id: "c-1",
      content: "Corrected text",
      resolved: true,
    });

    expect(result).toEqual({ ok: true, resolved: true, documentId: "doc-1" });
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "document",
      "doc-1",
      "editor",
    );
    expect(state.rows[0].content).toBe("Corrected text");
    expect(state.rows[0].resolved).toBe(1);
    expect(state.rows[1].content).toBe("A reply");
    expect(state.rows[1].resolved).toBe(1);
    expect(state.rows[2].resolved).toBe(0);
  });

  it("returns the same resolved state when an already-resolved thread is resolved again", async () => {
    state.rows[0].resolved = 1;
    state.rows[1].resolved = 1;

    const result = await run({
      id: "c-1",
      documentId: "doc-1",
      resolved: true,
    });

    expect(result).toEqual({ ok: true, resolved: true, documentId: "doc-1" });
    expect(state.rows[0].resolved).toBe(1);
    expect(state.rows[1].resolved).toBe(1);
    expect(state.rows[2].resolved).toBe(0);
  });

  it("fails closed on a mismatched document and comment pair", async () => {
    await expect(
      run({ id: "c-1", documentId: "doc-2", resolved: true }),
    ).rejects.toThrow("Comment not found: c-1");

    expect(mockAssertAccess).not.toHaveBeenCalled();
    expect(state.rows.every((row) => row.resolved === 0)).toBe(true);
  });

  it("allows the author to edit their own comment content with commenter access", async () => {
    const result = await run({ id: "c-1", content: "Updated" });

    expect(result).toEqual({ ok: true, documentId: "doc-1" });
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "document",
      "doc-1",
      "commenter",
    );
  });

  it("matches comment authorship case-insensitively for commenter access", async () => {
    state.rows[0].authorEmail = "Author@Example.COM";
    mockGetUserEmail.mockReturnValue("author@example.com");

    await run({ id: "c-1", content: "Updated with mixed-case identity" });

    expect(mockAssertAccess).toHaveBeenCalledWith(
      "document",
      "doc-1",
      "commenter",
    );
    expect(mockAssertAccess).not.toHaveBeenCalledWith(
      "document",
      "doc-1",
      "editor",
    );
    expect(state.rows[0].content).toBe("Updated with mixed-case identity");
  });

  it("updates mention metadata with edited content and clears removed mentions", async () => {
    await run({
      id: "c-1",
      content: "Hello @Sam and @Claude",
      mentions: JSON.stringify([
        { email: "sam@example.com", name: "Sam" },
        { kind: "agent", model: "claude-sonnet-4-6", name: "Claude" },
      ]),
    });

    expect(state.rows[0]).toMatchObject({
      content: "Hello @Sam and @Claude",
      mentionsJson: JSON.stringify([
        { kind: "person", email: "sam@example.com", name: "Sam" },
        { kind: "agent", model: "claude-sonnet-4-6", name: "Claude" },
      ]),
    });

    await run({ id: "c-1", content: "Hello", mentions: "[]" });
    expect(state.rows[0].mentionsJson).toBeNull();
  });

  it("notifies only the people an edit newly mentions", async () => {
    state.rows[0].content = "Hi @Sam";
    state.rows[0].mentionsJson = JSON.stringify([
      { email: "sam@example.com", name: "Sam" },
    ]);

    await run({
      id: "c-1",
      content: "Hi @Sam, @Lee, and @Claude",
      mentions: JSON.stringify([
        { email: "SAM@example.com", name: "Sam" },
        { email: "lee@example.com", name: "Lee" },
        { kind: "agent", model: "claude-sonnet-4-6", name: "Claude" },
      ]),
    });
    await run({
      id: "c-1",
      content: "Hi @Sam and @Lee",
      mentions: JSON.stringify([
        { email: "sam@example.com", name: "Sam" },
        { email: "lee@example.com", name: "Lee" },
      ]),
    });

    expect(mockNotifyMentions).toHaveBeenCalledTimes(1);
    expect(mockNotifyMentions).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "doc-1",
        documentTitle: "Plan",
        ownerEmail: "owner@example.com",
        authorEmail: "author@example.com",
        content: "Hi @Sam, @Lee, and @Claude",
        mentions: [{ kind: "person", email: "lee@example.com", name: "Lee" }],
      }),
    );
  });

  it("names the editor, not the comment's author, as who mentioned someone", async () => {
    mockGetUserEmail.mockReturnValue("editor@example.com");
    mockGetUserName.mockReturnValue("Edie");

    await run(
      {
        id: "c-2",
        content: "A reply for @Lee",
        mentions: JSON.stringify([{ email: "lee@example.com", name: "Lee" }]),
      },
      { caller: "tool" },
    );

    expect(mockAssertAccess).toHaveBeenCalledWith(
      "document",
      "doc-1",
      "editor",
    );
    expect(state.rows[1].authorEmail).toBe("other@example.com");
    expect(mockNotifyMentions).toHaveBeenCalledWith(
      expect.objectContaining({
        authorEmail: "editor@example.com",
        authorName: "Edie",
        submissionSource: "agent",
        isReply: true,
      }),
    );
  });

  it("rejects malformed mention metadata instead of silently clearing it", async () => {
    state.rows[0].mentionsJson = JSON.stringify([
      { email: "sam@example.com", name: "Sam" },
    ]);

    await expect(
      run({ id: "c-1", content: "Broken", mentions: "{not-json" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Comment mentions metadata is not valid JSON",
    });
    expect(state.rows[0]).toMatchObject({
      content: "Original text",
      mentionsJson: JSON.stringify([{ email: "sam@example.com", name: "Sam" }]),
    });
  });

  it("rejects an edit that leaves a mention without its @name in the final text", async () => {
    const stored = JSON.stringify([
      { kind: "person", email: "a@example.com", name: "Sam" },
      { kind: "person", email: "b@example.com", name: "Sam" },
    ]);
    state.rows[0].content = "@Sam and @Sam";
    state.rows[0].mentionsJson = stored;

    await expect(
      run({ id: "c-1", content: "Just @Sam" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("@Sam (b@example.com)"),
    });
    await expect(
      run({
        id: "c-1",
        mentions: JSON.stringify([
          { kind: "person", email: "c@example.com", name: "Cy" },
        ]),
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("@Cy (c@example.com)"),
    });
    expect(state.rows[0]).toMatchObject({
      content: "@Sam and @Sam",
      mentionsJson: stored,
    });

    await run({ id: "c-1", content: "@Sam, then @Sam again" });
    expect(state.rows[0]).toMatchObject({
      content: "@Sam, then @Sam again",
      mentionsJson: stored,
    });
  });
});
