import { createHash } from "node:crypto";

import { signShortLivedToken } from "@agent-native/core/server/short-lived-token";
import { ForbiddenError } from "@agent-native/core/sharing";
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
vi.mock("@agent-native/core/sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/sharing")>()),
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mockGetUserEmail(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
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
  mockAssertAccess.mockResolvedValue({
    role: "viewer",
    resource: { enableComments: true },
  });
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
  it("refuses a password-protected author's deletion without proof", async () => {
    mockAssertAccess.mockResolvedValue({
      role: "viewer",
      resource: {
        enableComments: true,
        password: "fake-password",
        sharePasswordVersion: "initial",
      },
    });
    const original = [...state.rows];
    await expect(action.run({ id: "comment-1" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(state.rows).toEqual(original);
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it.each([
    { role: "viewer", email: "author@example.com" },
    { role: "editor", email: "editor@example.com" },
  ])(
    "refuses deletion from Trash for a nonowner: %j",
    async ({ role, email }) => {
      mockGetUserEmail.mockReturnValue(email);
      mockAssertAccess.mockResolvedValue({
        role,
        resource: { enableComments: true, trashedAt: "2026-01-01T00:00:00Z" },
      });
      const originalRows = [...state.rows];
      await expect(
        action.run(action.schema.parse({ id: "comment-1" })),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(state.rows).toEqual(originalRows);
      expect(mockWriteAppState).not.toHaveBeenCalled();
    },
  );

  it("preserves owner cleanup in Trash with comments enabled", async () => {
    mockGetUserEmail.mockReturnValue("owner@example.com");
    mockAssertAccess.mockResolvedValue({
      role: "owner",
      resource: { enableComments: true, trashedAt: "2026-01-01T00:00:00Z" },
    });
    const result = await action.run(action.schema.parse({ id: "comment-1" }));
    expect(result.deletedCommentIds).toEqual([
      "comment-1",
      "comment-1-reply",
      "comment-1-reply-2",
    ]);
  });

  it("deletes a comment and descendants with comments enabled", async () => {
    mockAssertAccess.mockResolvedValue({
      role: "viewer",
      resource: { enableComments: true, trashedAt: null },
    });
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

  it.each(["viewer", "editor", "owner"])(
    "refuses deletion with comments disabled for %s",
    async (role) => {
      mockAssertAccess.mockResolvedValue({
        role,
        resource: { enableComments: false },
      });
      const originalRows = [...state.rows];
      await expect(action.run({ id: "comment-1" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      expect(state.rows).toEqual(originalRows);
      expect(mockWriteAppState).not.toHaveBeenCalled();
    },
  );

  it("recognizes the author regardless of email case", async () => {
    state.rows[0].authorEmail = "Author@Example.com";
    mockGetUserEmail.mockReturnValue("author@example.COM");
    mockAssertAccess.mockImplementation(async (_type, _id, role) => {
      if (role === "editor") throw new ForbiddenError();
      return { role: "viewer", resource: { enableComments: true } };
    });
    expect(await action.run({ id: "comment-1" })).toMatchObject({
      id: "comment-1",
    });
    expect(state.rows.map((row) => row.id)).not.toContain("comment-1");
  });

  it("still refuses deletion by an unrelated viewer", async () => {
    mockGetUserEmail.mockReturnValue("unrelated@example.com");
    mockAssertAccess.mockImplementation(async (_type, _id, role) => {
      if (role === "editor") throw new ForbiddenError();
      return { role: "viewer", resource: { enableComments: true } };
    });
    const originalRows = [...state.rows];
    await expect(action.run({ id: "comment-1" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(state.rows).toEqual(originalRows);
  });

  it("preserves deletion by a recording editor with comments enabled", async () => {
    mockGetUserEmail.mockReturnValue("editor@example.com");
    mockAssertAccess.mockResolvedValue({
      role: "editor",
      resource: { enableComments: true },
    });
    expect(await action.run({ id: "comment-1" })).toMatchObject({
      id: "comment-1",
    });
    expect(state.rows.map((row) => row.id)).toEqual([
      "comment-2",
      "comment-1-cross-record-reply",
    ]);
  });
});

it("deletes the unlocked author's comment with purpose-scoped proof", async () => {
  const password = "fake-stored-password";
  mockAssertAccess.mockResolvedValue({
    role: "viewer",
    resource: {
      enableComments: true,
      password,
      sharePasswordVersion: "initial",
    },
  });
  const scope = createHash("sha256")
    .update(JSON.stringify(["recording-1", password, "initial"]))
    .digest("hex");
  const token = signShortLivedToken({
    resourceId: `clips-comment:recording-1:${scope}`,
    ttlSeconds: 600,
  });
  await expect(
    action.run(
      { id: "comment-1" },
      { requestHeaders: new Headers({ "x-clips-comment-token": token }) },
    ),
  ).resolves.toMatchObject({
    deletedCommentIds: ["comment-1", "comment-1-reply", "comment-1-reply-2"],
  });
});
