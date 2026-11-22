import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ access: vi.fn(), verify: vi.fn() }));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.access,
  ForbiddenError: class ForbiddenError extends Error {},
}));
vi.mock("@agent-native/core/server/short-lived-token", () => ({
  verifyShortLivedToken: mocks.verify,
}));

import { assertCommentAccess } from "./comment-access";

describe("recording comment password access", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.verify.mockReturnValue({ ok: true });
  });

  it.each(["private", "org"])(
    "allows authorized %s viewers with a dormant password",
    async (visibility) => {
      const access = {
        role: "viewer",
        resource: { visibility, password: "encrypted", enableComments: true },
      };
      mocks.access.mockResolvedValue(access);
      await expect(assertCommentAccess("clip", "read")).resolves.toBe(access);
      expect(mocks.verify).not.toHaveBeenCalled();
    },
  );

  it("requires and validates a comment token for public password-protected viewers", async () => {
    const access = {
      role: "viewer",
      resource: {
        visibility: "public",
        password: "encrypted",
        enableComments: true,
      },
    };
    mocks.access.mockResolvedValue(access);
    await expect(assertCommentAccess("clip", "read")).rejects.toThrow();
    await expect(
      assertCommentAccess(
        "clip",
        "read",
        new Headers({ "x-clips-comment-token": "token" }),
      ),
    ).resolves.toBe(access);
    expect(mocks.verify).toHaveBeenCalledOnce();
  });

  it("still denies callers without recording access", async () => {
    mocks.access.mockRejectedValue(new Error("forbidden"));
    await expect(assertCommentAccess("clip", "read")).rejects.toThrow(
      "forbidden",
    );
  });
});
