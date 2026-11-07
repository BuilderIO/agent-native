import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../sharing/access.js", () => ({
  ForbiddenError: class ForbiddenError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ForbiddenError";
    }
  },
  resolveAccess: vi.fn(),
}));

vi.mock("../sharing/registry.js", () => ({
  getShareableResource: vi.fn(),
}));

const { resolveAccess } = await import("../sharing/access.js");
const { getShareableResource } = await import("../sharing/registry.js");
const { ReviewAnchorError } = await import("./errors.js");
const {
  __resetReviewableResourcesForTests,
  assertReviewCommentAccess,
  assertReviewableResourceAccess,
  canCommentOnReviewableResource,
  hasReviewCommentWriteHook,
  normalizeReviewAnchor,
  REVIEW_SUGGESTION_ANCHOR_KIND,
  registerReviewableResource,
  resolveReviewableResourceAccess,
  reviewCommentPolicy,
  runReviewCommentWriteHook,
} = await import("./registry.js");
type ReviewResourceRole = import("./types.js").ReviewResourceRole;
type DbExec = import("../db/client.js").DbExec;

beforeEach(() => {
  __resetReviewableResourcesForTests();
  vi.mocked(resolveAccess).mockReset();
  vi.mocked(getShareableResource).mockReset();
  vi.mocked(getShareableResource).mockReturnValue(undefined);
});

afterEach(() => {
  __resetReviewableResourcesForTests();
  vi.clearAllMocks();
});

describe("reviewable resource registry", () => {
  it("fails closed for unregistered resource types", async () => {
    await expect(
      resolveReviewableResourceAccess("mystery", "abc", {
        userEmail: "bob@example.com",
      }),
    ).resolves.toBeNull();

    await expect(
      assertReviewableResourceAccess(
        "mystery",
        "abc",
        { userEmail: "bob@example.com" },
        "viewer",
      ),
    ).rejects.toThrow(/Not allowed/);
  });

  it("fails closed for registered types without an access resolver or shareable binding", async () => {
    registerReviewableResource({ type: "doc" });
    await expect(
      resolveReviewableResourceAccess("doc", "d1", {
        userEmail: "alice@example.com",
      }),
    ).resolves.toBeNull();
  });

  it("passes action context into shareable resolveAccess", async () => {
    vi.mocked(getShareableResource).mockReturnValue({ type: "doc" } as never);
    vi.mocked(resolveAccess).mockResolvedValue({
      role: "editor",
      resource: {
        ownerEmail: "alice@example.com",
        orgId: null,
        visibility: "private",
      },
    } as never);

    const access = await resolveReviewableResourceAccess("doc", "d1", {
      userEmail: "bob@example.com",
    });

    expect(resolveAccess).toHaveBeenCalledWith("doc", "d1", {
      userEmail: "bob@example.com",
      orgId: undefined,
    });
    expect(access).toMatchObject({
      role: "editor",
      ownerEmail: "alice@example.com",
    });
  });
});

describe("review comment rules", () => {
  const access = (role: ReviewResourceRole) => ({
    role,
    ownerEmail: "alice@example.com",
    orgId: null,
    visibility: "private" as const,
  });
  const keep = (anchor: unknown) => anchor;
  const asViewer = () => access("viewer");

  it("refuses an anchor kind without a name or a whole version from 1", () => {
    for (const anchorKinds of [
      { "": { version: 1, parse: keep } },
      { " ": { version: 1, parse: keep } },
      { pin: { version: 0, parse: keep } },
      { pin: { version: 1.5, parse: keep } },
    ]) {
      expect(() =>
        registerReviewableResource({ type: "doc", anchorKinds }),
      ).toThrow("needs a name and a whole version from 1");
    }
    registerReviewableResource({
      type: "doc",
      anchorKinds: { pin: { version: 1, parse: keep } },
    });
    expect(
      normalizeReviewAnchor("doc", { anchor: 1, anchorKind: "pin" }),
    ).toEqual({ anchor: 1, anchorKind: "pin", anchorVersion: 1 });
  });

  it("fills in the comment policy and holds callers to its role", async () => {
    registerReviewableResource({ type: "doc", resolveAccess: asViewer });
    registerReviewableResource({
      type: "deck",
      resolveAccess: asViewer,
      comments: { minimumRole: "viewer", unmentionedRoute: "human" },
    });
    registerReviewableResource({
      type: "board",
      comments: { unmentionedRoute: "human" },
    });
    expect(reviewCommentPolicy("doc")).toEqual({
      minimumRole: "commenter",
      unmentionedRoute: "agent",
    });
    expect(reviewCommentPolicy("deck")).toEqual({
      minimumRole: "viewer",
      unmentionedRoute: "human",
    });
    expect(reviewCommentPolicy("board")).toEqual({
      minimumRole: "commenter",
      unmentionedRoute: "human",
    });
    expect(reviewCommentPolicy("mystery").minimumRole).toBe("commenter");

    expect(canCommentOnReviewableResource("doc", access("viewer"))).toBe(false);
    expect(canCommentOnReviewableResource("doc", access("commenter"))).toBe(
      true,
    );
    expect(canCommentOnReviewableResource("deck", access("viewer"))).toBe(true);
    expect(canCommentOnReviewableResource("deck", null)).toBe(false);

    await expect(
      assertReviewCommentAccess("doc", "d1", { userEmail: "bob@example.com" }),
    ).rejects.toThrow("Not allowed to comment on doc:d1");
    await expect(
      assertReviewCommentAccess("deck", "d1", { userEmail: "bob@example.com" }),
    ).resolves.toMatchObject({ role: "viewer" });
  });

  it("keeps untyped anchors on a resource that declares no kinds", () => {
    registerReviewableResource({ type: "doc" });
    expect(normalizeReviewAnchor("doc", { anchor: { x: 1 } })).toEqual({
      anchor: { x: 1 },
      anchorKind: null,
      anchorVersion: null,
    });
    expect(normalizeReviewAnchor("doc", {})).toEqual({
      anchor: null,
      anchorKind: null,
      anchorVersion: null,
    });
    expect(() =>
      normalizeReviewAnchor("doc", { anchor: { x: 1 }, anchorVersion: 1 }),
    ).toThrow("An anchor version needs an anchor kind.");
    expect(() =>
      normalizeReviewAnchor("doc", { anchor: { x: 1 }, anchorKind: "pin" }),
    ).toThrow('doc comments have no anchor kind "pin".');
  });

  it("checks a typed anchor against its kind and version", () => {
    const parse = vi.fn((anchor: unknown, version: number): unknown => {
      if (anchor === "bad") throw new Error("off the canvas");
      if (anchor === "gone") return undefined;
      return { anchor, version };
    });
    registerReviewableResource({
      type: "deck",
      anchorKinds: { pin: { version: 3, parse }, note: { version: 1, parse } },
    });

    expect(
      normalizeReviewAnchor("deck", { anchor: "a", anchorKind: "pin" }),
    ).toEqual({
      anchor: { anchor: "a", version: 3 },
      anchorKind: "pin",
      anchorVersion: 3,
    });
    expect(parse).toHaveBeenLastCalledWith("a", 3);
    expect(
      normalizeReviewAnchor("deck", {
        anchor: "a",
        anchorKind: "pin",
        anchorVersion: 1,
      }),
    ).toEqual({
      anchor: { anchor: "a", version: 1 },
      anchorKind: "pin",
      anchorVersion: 1,
    });
    expect(
      normalizeReviewAnchor("deck", { anchor: "gone", anchorKind: "pin" }),
    ).toEqual({ anchor: null, anchorKind: "pin", anchorVersion: 3 });
    expect(normalizeReviewAnchor("deck", { anchorKind: "note" })).toEqual({
      anchor: { anchor: null, version: 1 },
      anchorKind: "note",
      anchorVersion: 1,
    });
    expect(normalizeReviewAnchor("deck", { anchor: null })).toEqual({
      anchor: null,
      anchorKind: null,
      anchorVersion: null,
    });

    const refusal = (input: Parameters<typeof normalizeReviewAnchor>[1]) => {
      try {
        normalizeReviewAnchor("deck", input);
      } catch (error) {
        expect(error).toBeInstanceOf(ReviewAnchorError);
        expect(error).toMatchObject({
          statusCode: 400,
          errorCode: "invalid_anchor",
        });
        return (error as Error).message;
      }
      throw new Error("expected the anchor to be refused");
    };
    expect(refusal({ anchor: "a" })).toBe(
      "Anchored deck comments need an anchor kind: pin, note.",
    );
    expect(refusal({ anchor: "a", anchorKind: "toString" })).toBe(
      'deck comments have no anchor kind "toString".',
    );
    for (const anchorVersion of [0, 4, 1.5]) {
      expect(refusal({ anchor: "a", anchorKind: "pin", anchorVersion })).toBe(
        `Anchor kind "pin" has no version ${anchorVersion}; the latest is 3.`,
      );
    }
    expect(refusal({ anchor: "bad", anchorKind: "pin" })).toBe(
      'Not a valid "pin" anchor: off the canvas',
    );
  });

  it("runs a resource's write hook with the write's own handle", async () => {
    const onCommentWrite = vi.fn();
    registerReviewableResource({ type: "doc" });
    registerReviewableResource({ type: "deck", onCommentWrite });
    expect(hasReviewCommentWriteHook("doc")).toBe(false);
    expect(hasReviewCommentWriteHook("deck")).toBe(true);
    expect(hasReviewCommentWriteHook("mystery")).toBe(false);

    const tx = { execute: vi.fn() } as unknown as DbExec;
    const event = {
      type: "resolved" as const,
      resourceType: "deck",
      resourceId: "d1",
      threadId: "t1",
      actorEmail: null,
    };
    await runReviewCommentWriteHook("deck", event, tx);
    expect(onCommentWrite).toHaveBeenCalledWith(event, tx);
    await expect(
      runReviewCommentWriteHook("doc", event, tx),
    ).resolves.toBeUndefined();
    expect(onCommentWrite).toHaveBeenCalledTimes(1);
  });
});

describe("the kit's suggestion anchor kind", () => {
  it("is accepted on every resource and declared by none", () => {
    registerReviewableResource({ type: "doc" });
    registerReviewableResource({
      type: "deck",
      anchorKinds: { pin: { version: 1, parse: (anchor) => anchor } },
    });
    for (const type of ["doc", "deck"]) {
      expect(
        normalizeReviewAnchor(type, {
          anchor: [null, { at: 1 }],
          anchorKind: REVIEW_SUGGESTION_ANCHOR_KIND,
        }),
      ).toEqual({
        anchor: [null, { at: 1 }],
        anchorKind: "review-suggestion",
        anchorVersion: 1,
      });
    }
    expect(() =>
      registerReviewableResource({
        type: "deck",
        anchorKinds: {
          [REVIEW_SUGGESTION_ANCHOR_KIND]: {
            version: 1,
            parse: (anchor) => anchor,
          },
        },
      }),
    ).toThrow('Anchor kind "review-suggestion" belongs to the review kit');
  });
});
