import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { getUserSetting } = vi.hoisted(() => ({
  getUserSetting: vi.fn(),
}));
vi.mock("../settings/index.js", () => ({ getUserSetting }));

import {
  actionCallIntent,
  createReversibleWriteApprovalPolicy,
  defineAction,
  isReversibleWriteInlineApprovalAction,
  isReversibleWriteNoApprovalsMode,
  preparedCallClearsReview,
  preparedCallNeedsApproval,
  reversibleWriteNeedsApproval,
} from "../action.js";

const reversibleWrite = defineAction({
  description: "Save a reversible setting.",
  schema: z.object({ id: z.string() }),
  userTurn: "direct",
  needsApproval: reversibleWriteNeedsApproval,
  run: async ({ id }) => ({ saved: id }),
});

describe("reversible-write approval policy", () => {
  beforeEach(() => {
    getUserSetting.mockReset();
  });

  it("does not hold at the default setting (unset) or when no-approvals is on", async () => {
    const prepared = await actionCallIntent(reversibleWrite, { id: "item-1" });
    if (!prepared.valid) throw new Error("invalid fixture call");

    getUserSetting.mockResolvedValue(null);
    expect(await isReversibleWriteNoApprovalsMode("person@example.test")).toBe(
      true,
    );
    expect(
      await preparedCallNeedsApproval(reversibleWrite, prepared, {
        caller: "mcp",
        userEmail: "person@example.test",
      }),
    ).toBe(false);
    expect(
      await preparedCallClearsReview(reversibleWrite, prepared, {
        caller: "mcp",
        userEmail: "person@example.test",
      }),
    ).toBe(true);

    getUserSetting.mockResolvedValue({ enabled: true });
    expect(
      await preparedCallNeedsApproval(reversibleWrite, prepared, {
        caller: "tool",
        userEmail: "person@example.test",
      }),
    ).toBe(false);
    expect(
      await preparedCallClearsReview(reversibleWrite, prepared, {
        caller: "mcp",
        userEmail: "person@example.test",
      }),
    ).toBe(true);
  });

  it("asks when the user explicitly turns approvals on (no-approvals enabled: false)", async () => {
    const prepared = await actionCallIntent(reversibleWrite, { id: "item-1" });
    if (!prepared.valid) throw new Error("invalid fixture call");

    getUserSetting.mockResolvedValue({ enabled: false });
    expect(await isReversibleWriteNoApprovalsMode("person@example.test")).toBe(
      false,
    );
    for (const caller of ["mcp", "tool", "webmcp", "a2a", "http"] as const) {
      expect(
        await preparedCallNeedsApproval(reversibleWrite, prepared, {
          caller,
          userEmail: "person@example.test",
        }),
      ).toBe(true);
      expect(
        await preparedCallClearsReview(reversibleWrite, prepared, {
          caller,
          userEmail: "person@example.test",
        }),
      ).toBe(false);
    }
  });

  it("fails closed when email is absent, setting is malformed, or setting read fails", async () => {
    expect(await isReversibleWriteNoApprovalsMode(undefined)).toBe(false);
    expect(await isReversibleWriteNoApprovalsMode("")).toBe(false);

    getUserSetting.mockResolvedValue({});
    expect(await isReversibleWriteNoApprovalsMode("person@example.test")).toBe(
      false,
    );

    getUserSetting.mockResolvedValue({ enabled: "yes" });
    expect(await isReversibleWriteNoApprovalsMode("person@example.test")).toBe(
      false,
    );

    getUserSetting.mockRejectedValue(new Error("db unavailable"));
    expect(await isReversibleWriteNoApprovalsMode("person@example.test")).toBe(
      false,
    );
  });

  it("marks reversible-write actions for inline MCP form approval, never review-page approval", () => {
    expect(isReversibleWriteInlineApprovalAction(reversibleWrite)).toBe(true);

    const conditional = defineAction({
      description: "Conditional reversible write.",
      schema: z.object({ risky: z.boolean() }),
      userTurn: "direct",
      needsApproval: createReversibleWriteApprovalPolicy(
        (args: { risky: boolean }) => args.risky,
      ),
      run: async () => ({ ok: true }),
    });
    expect(isReversibleWriteInlineApprovalAction(conditional)).toBe(true);

    const approvalOnly = defineAction({
      description: "Send externally.",
      schema: z.object({}),
      userTurn: "approval",
      needsApproval: reversibleWriteNeedsApproval,
      run: async () => ({ ok: true }),
    });
    expect(isReversibleWriteInlineApprovalAction(approvalOnly)).toBe(false);
  });
});
