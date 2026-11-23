import type { ActionRunContext } from "@agent-native/core/action";
import { beforeEach, expect, it, vi } from "vitest";

const invite = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/org", () => ({ inviteOrganizationAdmin: invite }));
import action from "./invite-data-connection-admin";

const ctx: ActionRunContext = {
  caller: "frontend",
  userEmail: "owner@example.test",
  orgId: "qa-workspace",
};
beforeEach(() => vi.resetAllMocks());

it("forwards runtime identity and preserves pending delivery without exposing transport diagnostics", async () => {
  invite.mockResolvedValue({
    id: "invitation",
    email: "recipient@example.test",
    role: "admin",
    status: "pending",
    emailSent: false,
    emailError: "private transport diagnostics",
  });
  await expect(
    action.run({ email: "recipient@example.test" }, ctx),
  ).resolves.toEqual({
    id: "invitation",
    email: "recipient@example.test",
    role: "admin",
    status: "pending",
    emailSent: false,
  });
  expect(invite).toHaveBeenCalledExactlyOnceWith(
    { email: "recipient@example.test" },
    ctx,
  );
  expect(action.audit).toMatchObject({ enabled: false });
  expect(action.uiOnly).toBe(true);
  expect(action.agentTool).toBe(false);
  expect(action.mcpTool).toBe(false);
  expect(action.toolCallable).toBe(false);
});

it.each([403, 409])(
  "propagates refusal %i without another invitation",
  async (statusCode) => {
    const error = Object.assign(new Error("Invitation refused"), {
      statusCode,
    });
    invite.mockRejectedValue(error);
    await expect(
      action.run({ email: "recipient@example.test" }, ctx),
    ).rejects.toBe(error);
    expect(invite).toHaveBeenCalledTimes(1);
  },
);

it("never relabels a mismatched invitation role as an admin invitation", async () => {
  invite.mockResolvedValue({
    id: "invitation",
    email: "recipient@example.test",
    role: "member",
    status: "pending",
    emailSent: true,
  });
  await expect(
    action.run({ email: "recipient@example.test" }, ctx),
  ).rejects.toBeDefined();
});
