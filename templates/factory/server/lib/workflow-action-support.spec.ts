import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAutomationMock = vi.hoisted(() => vi.fn());
const requireMemberMock = vi.hoisted(() => vi.fn());

vi.mock("./require-factory-automation.js", () => ({
  requireFactoryAutomation: requireAutomationMock,
}));
vi.mock("./require-workspace-member.js", () => ({
  requireWorkspaceMember: requireMemberMock,
  workspaceMemberIdentityFromContext: (context?: {
    userEmail?: string;
    orgId?: string | null;
  }) =>
    context?.userEmail
      ? { userEmail: context.userEmail, orgId: context.orgId }
      : undefined,
}));

import {
  WORKFLOW_ACTION_OUTPUT_LIMIT_CHARS,
  assertResultWithinLimit,
  clipText,
  requireWorkflowActionCaller,
  takeWithinBudget,
} from "./workflow-action-support.js";

const context = {
  caller: "automation" as const,
  userEmail: "owner@example.test",
  orgId: "org-1",
  automation: { triggerId: "job-1", triggerName: "factories/factory-1/flow" },
};

beforeEach(() => {
  vi.clearAllMocks();
  requireMemberMock.mockResolvedValue({
    userEmail: "owner@example.test",
    orgId: "org-1",
    role: "member",
  });
  requireAutomationMock.mockResolvedValue(undefined);
});

describe("requireWorkflowActionCaller", () => {
  it("admits through the workflow role, scoped to the named factory", async () => {
    const caller = await requireWorkflowActionCaller(context, {
      factoryId: "factory-1",
    });

    expect(caller).toEqual({
      userEmail: "owner@example.test",
      orgId: "org-1",
      factoryId: "factory-1",
    });
    expect(requireAutomationMock).toHaveBeenCalledWith(
      context,
      { userEmail: "owner@example.test", orgId: "org-1" },
      "workflow",
      "factory-1",
    );
  });

  it("takes the calling job's factory when none is named", async () => {
    await expect(
      requireWorkflowActionCaller(context, {}),
    ).resolves.toMatchObject({
      factoryId: "factory-1",
    });
  });

  it("fails when no factory can be named, and does not guess the default one", async () => {
    await expect(
      requireWorkflowActionCaller({ ...context, automation: undefined }, {}),
    ).rejects.toMatchObject({
      errorCode: "factory_id_required",
      statusCode: 400,
    });
    expect(requireAutomationMock).not.toHaveBeenCalled();
  });

  it("lets the gate's refusal through", async () => {
    requireAutomationMock.mockRejectedValue(new Error("not allowed"));

    await expect(
      requireWorkflowActionCaller(context, { factoryId: "factory-1" }),
    ).rejects.toThrow("not allowed");
  });
});

describe("output bounds", () => {
  it("keeps leading entries that fit and says when it stopped", () => {
    const entries = ["aaaa", "bbbb", "cccc"];

    expect(takeWithinBudget(entries, 1_000)).toEqual({
      kept: entries,
      truncated: false,
    });
    expect(takeWithinBudget(entries, 14)).toEqual({
      kept: ["aaaa", "bbbb"],
      truncated: true,
    });
    expect(takeWithinBudget(entries, 14, 5).kept).toEqual(["aaaa"]);
  });

  it("clips text and never leaves half a surrogate pair", () => {
    expect(clipText("short", 10)).toEqual({ text: "short", clipped: false });
    expect(clipText("abcdef", 3)).toEqual({ text: "abc", clipped: true });
    expect(clipText("ab\u{1F600}", 3)).toEqual({ text: "ab", clipped: true });
  });

  it("fails loudly on a result over the limit instead of clipping it", () => {
    const over = { text: "x".repeat(WORKFLOW_ACTION_OUTPUT_LIMIT_CHARS) };

    expect(() => assertResultWithinLimit("some-action", over)).toThrow(
      /some-action built a/,
    );
    expect(assertResultWithinLimit("some-action", { ok: true })).toEqual({
      ok: true,
    });
  });
});
