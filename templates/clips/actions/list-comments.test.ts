import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { assertAccess, selectComments, ForbiddenError } = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  selectComments: vi.fn(),
  ForbiddenError: class extends Error {},
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess,
  ForbiddenError,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: selectComments }),
      }),
    }),
  }),
  schema: { recordingComments: {} },
}));

vi.mock("../server/lib/user-identities.js", () => ({
  hydrateCommentAuthorNames: async (comments: unknown[]) => comments,
}));

import listComments from "./list-comments";

describe("list-comments recording expiration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-20T12:00:00Z"));
    selectComments.mockResolvedValue([
      {
        id: "comment-1",
        recordingId: "recording-1",
        content: "A saved comment",
        mentionsJson: "[]",
        resolved: false,
      },
    ]);
  });

  afterEach(() => vi.restoreAllMocks());

  it("refuses a non-owner on an expired recording before reading comments", async () => {
    assertAccess.mockResolvedValue({
      role: "viewer",
      resource: { expiresAt: "2026-10-20T11:00:00Z" },
    });

    await expect(
      listComments.run({ recordingId: "recording-1" }),
    ).rejects.toThrow(ForbiddenError);
    expect(selectComments).not.toHaveBeenCalled();
  });

  it.each([
    ["owner", "2026-10-20T11:00:00Z"],
    ["viewer", "2026-10-20T13:00:00Z"],
  ])("allows a %s with expiry %s to read comments", async (role, expiresAt) => {
    assertAccess.mockResolvedValue({ role, resource: { expiresAt } });

    const result = await listComments.run({ recordingId: "recording-1" });

    expect(assertAccess).toHaveBeenCalledWith(
      "recording",
      "recording-1",
      "viewer",
    );
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]).toMatchObject({
      id: "comment-1",
      content: "A saved comment",
    });
  });
});
