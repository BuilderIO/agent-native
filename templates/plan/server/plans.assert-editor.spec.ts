import { beforeEach, describe, expect, it, vi } from "vitest";

const assertAccessMock = vi.hoisted(() => vi.fn());
const resolveAccessMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/sharing", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/sharing")>();
  return {
    ...actual,
    currentAccess: () => ({ userEmail: "member@example.com" }),
    assertAccess: (...args: unknown[]) => assertAccessMock(...args),
    resolveAccess: (...args: unknown[]) => resolveAccessMock(...args),
  };
});

const { ForbiddenError } = await import("@agent-native/core/sharing");
const { assertPlanEditor } = await import("./plans.js");

function coreRoleError(planId: string, role: string) {
  return new ForbiddenError(
    `Requires editor role on plan ${planId} (have ${role})`,
  );
}

describe("assertPlanEditor teaching errors", () => {
  beforeEach(() => {
    assertAccessMock.mockReset();
    resolveAccessMock.mockReset();
  });

  it("returns access when the caller has editor rank", async () => {
    const access = {
      role: "owner",
      resource: { id: "recap-1", kind: "recap", deletedAt: null },
    };
    assertAccessMock.mockResolvedValueOnce(access);

    await expect(assertPlanEditor("recap-1")).resolves.toBe(access);
    expect(resolveAccessMock).not.toHaveBeenCalled();
  });

  it("teaches the recap next steps when a viewer tries to edit a recap", async () => {
    assertAccessMock.mockRejectedValueOnce(coreRoleError("recap-42", "viewer"));
    resolveAccessMock.mockResolvedValueOnce({
      role: "viewer",
      resource: { id: "recap-42", kind: "recap", deletedAt: null },
    });

    const error = await assertPlanEditor("recap-42").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenError);
    const message = (error as Error).message;
    // Names the resource kind and the caller's actual role.
    expect(message).toContain(
      "Recap recap-42 is read-only for you (your role: viewer)",
    );
    // Tells the agent not to loop on the same call.
    expect(message).toContain("Do not retry this call");
    // Names the sanctioned alternatives.
    expect(message).toContain("create-visual-recap");
    expect(message).toContain("reply-to-plan-comment");
    expect(message).toContain("comment-only update-visual-plan");
  });

  it("teaches the comment/share next steps when a viewer tries to edit a plan", async () => {
    assertAccessMock.mockRejectedValueOnce(coreRoleError("plan-7", "viewer"));
    resolveAccessMock.mockResolvedValueOnce({
      role: "viewer",
      resource: { id: "plan-7", kind: "plan", deletedAt: null },
    });

    const error = await assertPlanEditor("plan-7").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenError);
    const message = (error as Error).message;
    expect(message).toContain(
      "Plan plan-7 is read-only for you (your role: viewer)",
    );
    expect(message).toContain("Do not retry this call");
    expect(message).toContain("reply-to-plan-comment");
    // Plan phrasing must not point at the recap-only replacement flow.
    expect(message).not.toContain("create-visual-recap");
  });

  it("keeps the original non-leaking error when the caller has no read access", async () => {
    const original = new ForbiddenError("No access to plan plan-hidden");
    assertAccessMock.mockRejectedValueOnce(original);
    resolveAccessMock.mockResolvedValueOnce(null);

    await expect(assertPlanEditor("plan-hidden")).rejects.toBe(original);
  });

  it("keeps the not-found error for deleted plans", async () => {
    const deleted = {
      role: "owner",
      resource: { id: "plan-del", kind: "plan", deletedAt: "2026-01-01" },
    };
    assertAccessMock.mockResolvedValueOnce(deleted);
    resolveAccessMock.mockResolvedValueOnce(deleted);

    await expect(assertPlanEditor("plan-del")).rejects.toMatchObject({
      message: "Plan plan-del not found",
    });
  });

  it("rethrows unexpected non-Forbidden errors untouched", async () => {
    const boom = new Error("db exploded");
    assertAccessMock.mockRejectedValueOnce(boom);

    await expect(assertPlanEditor("plan-1")).rejects.toBe(boom);
    expect(resolveAccessMock).not.toHaveBeenCalled();
  });
});
