import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCallerMock = vi.hoisted(() => vi.fn());
const sendEmailMock = vi.hoisted(() => vi.fn());
const readinessMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("@agent-native/core/server", () => ({
  sendEmail: sendEmailMock,
  getEmailReadiness: readinessMock,
}));
vi.mock("../server/lib/workflow-action-support.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/workflow-action-support.js")
  >()),
  requireWorkflowActionCaller: requireCallerMock,
}));

import action from "./send-factory-email.js";

const caller = {
  userEmail: "owner@example.test",
  orgId: "org-1",
  factoryId: "f1",
};
const context = {
  caller: "automation" as const,
  userEmail: caller.userEmail,
  runId: "run-1",
  automation: { triggerId: "job-1", triggerName: "factories/f1/flow" },
};
const input = { to: "ada@example.test", subject: "Hello", body: "Hi **Ada**" };

beforeEach(() => {
  vi.clearAllMocks();
  requireCallerMock.mockResolvedValue(caller);
  readinessMock.mockResolvedValue({ status: "ready", provider: "resend" });
  sendEmailMock.mockResolvedValue({ status: "sent", provider: "resend" });
});

describe("send-factory-email", () => {
  it("sends through the workspace sender and returns messageRef", async () => {
    const result = await action.run(
      { ...input, cc: "lee@example.test", replyTo: "team@example.test" },
      context,
    );

    expect(result).toMatchObject({
      ok: true,
      provider: "resend",
      recipients: ["ada@example.test"],
    });
    expect((result as { messageRef: string }).messageRef).toMatch(
      /^factory-email-/,
    );
    expect(sendEmailMock.mock.calls[0]?.[0]).toMatchObject({
      to: "ada@example.test",
      cc: ["lee@example.test"],
      replyTo: "team@example.test",
      subject: "Hello",
    });
  });

  it("returns the same reference for a retry inside one run", async () => {
    const first = (await action.run(input, context)) as { messageRef: string };
    const again = (await action.run(input, context)) as { messageRef: string };

    expect(again.messageRef).toBe(first.messageRef);
  });

  it("sends the same text from two calls as two emails, keyed by the call", async () => {
    const callOne = { ...context, toolCallId: "wf:item-1:mail:0" };
    const callTwo = { ...context, toolCallId: "wf:item-2:mail:0" };

    const one = (await action.run(input, callOne)) as { messageRef: string };
    const two = (await action.run(input, callTwo)) as { messageRef: string };
    const retryOfOne = (await action.run(input, callOne)) as {
      messageRef: string;
    };

    expect(two.messageRef).not.toBe(one.messageRef);
    expect(retryOfOne.messageRef).toBe(one.messageRef);
  });

  it("names what is missing when no sender is configured, and sends nothing", async () => {
    readinessMock.mockResolvedValue({
      status: "not-configured",
      provider: "dev",
    });

    await expect(action.run(input, context)).rejects.toMatchObject({
      errorCode: "email_not_configured",
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("refuses a bad address, and cc with several recipients, before sending", async () => {
    await expect(
      action.run({ ...input, to: "not-an-address" }, context),
    ).rejects.toMatchObject({ errorCode: "email_recipient_invalid" });
    await expect(
      action.run(
        { ...input, to: "a@example.test,b@example.test", cc: "c@example.test" },
        context,
      ),
    ).rejects.toMatchObject({ errorCode: "email_recipient_invalid" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("does not send for a caller the gate refuses", async () => {
    requireCallerMock.mockRejectedValue(new Error("not allowed"));

    await expect(action.run(input, context)).rejects.toThrow("not allowed");
    expect(readinessMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("is a write that reaches outside and is not destructive", () => {
    expect(action.mcpAnnotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    });
  });
});
