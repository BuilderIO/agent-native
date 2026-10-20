import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCallerMock = vi.hoisted(() => vi.fn());
const workspaceMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
const createClientMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("../server/lib/workflow-action-support.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/workflow-action-support.js")
  >()),
  requireWorkflowActionCaller: requireCallerMock,
}));
vi.mock("../server/connectors/slack-workflow.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/connectors/slack-workflow.js")
  >()),
  resolveFactorySlackWorkspace: workspaceMock,
  postWorkflowSlackMessage: postMock,
}));
vi.mock("../server/triage/slack-client.js", () => ({
  createSlackWorkflowClient: createClientMock,
}));

import action from "./post-slack-message.js";

const caller = {
  userEmail: "owner@example.test",
  orgId: "org-1",
  factoryId: "f1",
};
const context = { caller: "automation" as const, userEmail: caller.userEmail };

beforeEach(() => {
  vi.clearAllMocks();
  requireCallerMock.mockResolvedValue(caller);
  workspaceMock.mockResolvedValue("primary");
  createClientMock.mockReturnValue({ marker: "client" });
  postMock.mockResolvedValue({
    channel: "C0123ABCD",
    ts: "1700000000.000200",
    threadTs: null,
    permalink: "https://example.slack.com/archives/C0123ABCD/p1",
    recipient: { kind: "channel", id: "C0123ABCD" },
  });
});

describe("post-slack-message", () => {
  it("declares a write that is additive and reaches outside", () => {
    expect(action.readOnly).toBeUndefined();
    expect(action.mcpAnnotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    });
    expect(action.http).toBe(false);
  });

  it("posts and returns ts and permalink for the receipt", async () => {
    const result = await action.run(
      { to: "C0123ABCD", text: "Hello" },
      context,
    );

    expect(result).toMatchObject({
      ok: true,
      ts: "1700000000.000200",
      permalink: "https://example.slack.com/archives/C0123ABCD/p1",
    });
    expect(postMock).toHaveBeenCalledWith(
      { marker: "client" },
      {
        workspace: "primary",
        to: "C0123ABCD",
        text: "Hello",
        threadTs: undefined,
      },
    );
  });

  it("serves a thread reply through the same action", async () => {
    await action.run(
      { to: "C0123ABCD", text: "Reply", threadTs: "1700000000.000100" },
      context,
    );

    expect(postMock.mock.calls[0]?.[1]).toMatchObject({
      threadTs: "1700000000.000100",
    });
  });

  it("passes allowMentions through, and leaves it unset by default", async () => {
    await action.run({ to: "C0123ABCD", text: "Hello" }, context);
    await action.run(
      { to: "C0123ABCD", text: "<!here> look", allowMentions: true },
      context,
    );

    expect(postMock.mock.calls[0]?.[1].allowMentions).toBeUndefined();
    expect(postMock.mock.calls[1]?.[1]).toMatchObject({ allowMentions: true });
  });

  it("describes its audit target from the posted message", () => {
    const audit = action.audit as {
      target: (args: unknown, result: unknown) => unknown;
      summary: (args: unknown, result: unknown) => string;
    };

    expect(
      audit.target({}, { channel: "C0123ABCD", ts: "1700000000.000200" }),
    ).toEqual({
      type: "slack-message",
      id: "C0123ABCD:1700000000.000200",
      visibility: "org",
    });
    expect(audit.target({}, undefined)).toMatchObject({ id: undefined });
    expect(audit.summary({ threadTs: "1.1" }, { channel: "C1" })).toContain(
      "thread",
    );
  });

  it("does not post for a caller the gate refuses", async () => {
    requireCallerMock.mockRejectedValue(new Error("not allowed"));

    await expect(
      action.run({ to: "C0123ABCD", text: "Hello" }, context),
    ).rejects.toThrow("not allowed");
    expect(postMock).not.toHaveBeenCalled();
  });

  it("keeps a post that may have been delivered visible as unknown", async () => {
    postMock.mockRejectedValue(
      Object.assign(new Error("unsure"), {
        errorCode: "slack_post_outcome_unknown",
      }),
    );

    await expect(
      action.run({ to: "C0123ABCD", text: "Hello" }, context),
    ).rejects.toMatchObject({ errorCode: "slack_post_outcome_unknown" });
  });

  it("refuses text Slack would cut without saying so", () => {
    const schema = action.schema as {
      safeParse: (v: unknown) => { success: boolean };
    };

    expect(
      schema.safeParse({ to: "C0123ABCD", text: "x".repeat(39_000) }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ to: "C0123ABCD", text: "x".repeat(39_001) }).success,
    ).toBe(false);
  });
});
