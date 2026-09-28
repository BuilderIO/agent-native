import { beforeEach, describe, expect, it, vi } from "vitest";

type CommentRow = {
  id: string;
  recordingId: string;
  parentId: string | null;
  authorEmail: string;
  organizationId: string;
  expiresAt?: string | null;
};

const state = vi.hoisted(() => ({ rows: [] as CommentRow[] }));
const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockGetUserEmail = vi.hoisted(() =>
  vi.fn<() => string | null>(() => "author@example.com"),
);
const mockWriteAppState = vi.hoisted(() => vi.fn());
const { MockForbiddenError } = vi.hoisted(() => {
  class MockForbiddenError extends Error {}
  return { MockForbiddenError };
});

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
  ForbiddenError: MockForbiddenError,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mockGetUserEmail(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("../server/lib/recording-page-access.js", () => ({
  isRecordingExpiredForViewer: () => false,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({
    type: "eq",
    column,
    value,
  }),
  inArray: (column: unknown, values: unknown[]) => ({
    type: "inArray",
    column,
    values,
  }),
}));

function matches(row: CommentRow, condition: any): boolean {
  if (condition.type === "and") {
    return condition.conditions.every((nested: unknown) =>
      matches(row, nested),
    );
  }
  const key = String(condition.column).split(".").pop() as keyof CommentRow;
  if (condition.type === "eq") return row[key] === condition.value;
  if (condition.type === "inArray") return condition.values.includes(row[key]);
  return true;
}

vi.mock("../server/db/index.js", () => {
  const column = (name: string) => `recordingComments.${name}`;
  const schema = {
    recordingComments: {
      id: column("id"),
      parentId: column("parentId"),
      recordingId: column("recordingId"),
      organizationId: column("organizationId"),
    },
  };

  const db = {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          const result = state.rows.filter((row) => matches(row, condition));
          return {
            limit: async (limit: number) => result.slice(0, limit),
            then: (
              resolve: (value: CommentRow[]) => unknown,
              reject: (reason: unknown) => unknown,
            ) => Promise.resolve(result).then(resolve, reject),
          };
        },
      }),
    }),
    delete: () => ({
      where: async (condition: unknown) => {
        state.rows = state.rows.filter((row) => !matches(row, condition));
      },
    }),
  };

  return { getDb: () => db, schema };
});

import action from "./delete-comment";

beforeEach(() => {
  vi.resetAllMocks();
  mockAssertAccess.mockResolvedValue({ role: "viewer", resource: {} });
  mockGetUserEmail.mockReturnValue("author@example.com");
  state.rows = [
    {
      id: "comment-1",
      recordingId: "recording-1",
      parentId: null,
      authorEmail: "author@example.com",
      organizationId: "org-1",
    },
    {
      id: "comment-1-reply",
      recordingId: "recording-1",
      parentId: "comment-1",
      authorEmail: "reply@example.com",
      organizationId: "org-1",
    },
    {
      id: "comment-1-reply-2",
      recordingId: "recording-1",
      parentId: "comment-1-reply",
      authorEmail: "reply-2@example.com",
      organizationId: "org-1",
    },
    {
      id: "comment-2",
      recordingId: "recording-1",
      parentId: null,
      authorEmail: "other@example.com",
      organizationId: "org-1",
    },
    {
      id: "comment-1-cross-record-reply",
      recordingId: "recording-2",
      parentId: "comment-1",
      authorEmail: "other@example.com",
      organizationId: "org-2",
    },
  ];
});

describe("delete-comment", () => {
  it("deletes a comment and every nested descendant", async () => {
    const result = await action.run(action.schema.parse({ id: "comment-1" }));

    expect(result).toEqual({
      id: "comment-1",
      deletedCommentIds: ["comment-1", "comment-1-reply", "comment-1-reply-2"],
    });
    expect(state.rows.map((row) => row.id)).toEqual([
      "comment-2",
      "comment-1-cross-record-reply",
    ]);
    expect(mockWriteAppState).toHaveBeenCalledWith("refresh-signal", {
      ts: expect.any(Number),
    });
  });
});
