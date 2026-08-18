import { beforeEach, describe, expect, it, vi } from "vitest";

type CommentRow = {
  id: string;
  recordingId: string;
  authorEmail: string;
  content: string;
  updatedAt: string;
};

const state = vi.hoisted(() => ({
  rows: [] as CommentRow[],
  conflict: false,
}));
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

vi.mock("../server/lib/recordings.js", () => ({
  sameOwnerEmail: (
    left: string | null | undefined,
    right: string | null | undefined,
  ) =>
    !!left &&
    !!right &&
    left.trim().toLowerCase() === right.trim().toLowerCase(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({
    type: "eq",
    column,
    value,
  }),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}));

function matches(row: CommentRow, condition: any): boolean {
  if (condition.type === "and") {
    return condition.conditions.every((item: any) => matches(row, item));
  }
  if (condition.type === "eq") {
    const key = String(condition.column).split(".").pop() as keyof CommentRow;
    return row[key] === condition.value;
  }
  return true;
}

vi.mock("../server/db/index.js", () => {
  const column = (name: string) => `recordingComments.${name}`;
  const schema = {
    recordingComments: {
      id: column("id"),
      recordingId: column("recordingId"),
      authorEmail: column("authorEmail"),
      content: column("content"),
      updatedAt: column("updatedAt"),
    },
  };

  const db = {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => ({
          limit: async (limit: number) =>
            state.rows.filter((row) => matches(row, condition)).slice(0, limit),
        }),
      }),
    }),
    update: () => ({
      set: (patch: Partial<CommentRow>) => ({
        where: (condition: unknown) => ({
          returning: async () => {
            if (state.conflict) return [];
            const matchingRows = state.rows.filter((row) =>
              matches(row, condition),
            );
            matchingRows.forEach((row) => Object.assign(row, patch));
            return matchingRows.map(({ id }) => ({ id }));
          },
        }),
      }),
    }),
  };

  return { getDb: () => db, schema };
});

import action from "./update-comment";

async function run(args: { id: string; content: string }) {
  return action.run(action.schema.parse(args));
}

beforeEach(() => {
  vi.resetAllMocks();
  state.conflict = false;
  state.rows = [
    {
      id: "comment-1",
      recordingId: "recording-1",
      authorEmail: "author@example.com",
      content: "Original text",
      updatedAt: "2026-07-29T00:00:00.000Z",
    },
  ];
  mockGetUserEmail.mockReturnValue("author@example.com");
});

describe("update-comment", () => {
  it("requires a signed-in author", async () => {
    mockGetUserEmail.mockReturnValue(null);

    await expect(
      run({ id: "comment-1", content: "Updated text" }),
    ).rejects.toThrow("Sign in required to edit comments.");
    expect(mockAssertAccess).not.toHaveBeenCalled();
  });

  it("rejects a recording editor who is not the comment author", async () => {
    mockGetUserEmail.mockReturnValue("editor@example.com");

    await expect(
      run({ id: "comment-1", content: "Updated text" }),
    ).rejects.toThrow("Only the comment author can edit this comment.");
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "recording",
      "recording-1",
      "viewer",
    );
    expect(state.rows[0]?.content).toBe("Original text");
  });

  it("updates an author's comment with normalized email matching", async () => {
    mockGetUserEmail.mockReturnValue(" Author@Example.com ");

    const result = await run({
      id: "comment-1",
      content: "  Updated text  ",
    });

    expect(result).toEqual({
      id: "comment-1",
      content: "Updated text",
      updatedAt: expect.any(String),
    });
    expect(state.rows[0]).toMatchObject({
      content: "Updated text",
      updatedAt: result.updatedAt,
    });
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "recording",
      "recording-1",
      "viewer",
    );
    expect(mockWriteAppState).toHaveBeenCalledWith("refresh-signal", {
      ts: expect.any(Number),
    });
  });

  it("rejects blank comment text", () => {
    expect(() =>
      action.schema.parse({ id: "comment-1", content: "   " }),
    ).toThrow();
  });

  it("fails loudly when the comment changed concurrently", async () => {
    state.conflict = true;

    await expect(
      run({ id: "comment-1", content: "Updated text" }),
    ).rejects.toThrow("changed before this edit could be saved");
    expect(state.rows[0]?.content).toBe("Original text");
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });
});
