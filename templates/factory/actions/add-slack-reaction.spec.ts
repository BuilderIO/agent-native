import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCallerMock = vi.hoisted(() => vi.fn());
const workspaceMock = vi.hoisted(() => vi.fn());
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
}));
vi.mock("../server/triage/slack-client.js", () => ({
  createSlackWorkflowClient: createClientMock,
}));

import { SlackWriteError } from "../server/connectors/slack.js";
import action from "./add-slack-reaction.js";

const caller = {
  userEmail: "owner@example.test",
  orgId: "org-1",
  factoryId: "f1",
};
const context = { caller: "automation" as const, userEmail: caller.userEmail };
const input = {
  channel: "C0123ABCD",
  ts: "1700000000.000100",
  name: "eyes",
};

type Audit = {
  recordInputs?: boolean;
  target: (args: unknown) => Record<string, unknown>;
  summary: (args: unknown, result: unknown, meta: { status: string }) => string;
};

let slack: {
  verifyAgentNativeIdentity: ReturnType<typeof vi.fn>;
  addReaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  requireCallerMock.mockResolvedValue(caller);
  workspaceMock.mockResolvedValue("secondary");
  slack = {
    verifyAgentNativeIdentity: vi.fn().mockResolvedValue(undefined),
    addReaction: vi.fn().mockResolvedValue(undefined),
  };
  createClientMock.mockReturnValue(slack);
});

describe("add-slack-reaction", () => {
  it("declares an idempotent write that reaches outside, is not an HTTP route and is not offered to MCP clients", () => {
    expect(action.readOnly).toBeUndefined();
    expect(action.mcpAnnotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(action.http).toBe(false);
    expect(action.mcpTool).toBe(false);
    expect(action.outputSchema).toBeDefined();
  });

  it("reacts in the caller's workspace and returns the flag and the derived reference", async () => {
    const result = await action.run(input, context);

    expect(result).toEqual({
      ok: true,
      alreadyReacted: false,
      externalRef: "C0123ABCD:1700000000.000100:eyes",
    });
    expect(slack.addReaction).toHaveBeenCalledWith(
      "secondary",
      "C0123ABCD",
      "1700000000.000100",
      "eyes",
    );
    expect(createClientMock).toHaveBeenCalledWith({
      ownerEmail: "owner@example.test",
      orgId: "org-1",
    });
  });

  it("answers a repeat with alreadyReacted true instead of an error", async () => {
    slack.addReaction.mockRejectedValue(
      new SlackWriteError("Slack API error: already_reacted", "rejected"),
    );

    await expect(action.run(input, context)).resolves.toMatchObject({
      ok: true,
      alreadyReacted: true,
    });
  });

  it("does nothing for a caller the gate refuses", async () => {
    requireCallerMock.mockRejectedValue(new Error("not allowed"));

    await expect(action.run(input, context)).rejects.toThrow("not allowed");
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("records only a path in the audit row, and the message as its target", () => {
    const audit = action.audit as Audit;

    expect(audit.recordInputs).toBe(false);
    expect(audit.summary(input, undefined, { status: "success" })).toBe(
      "POST slack /reactions.add",
    );
    expect(audit.summary(input, undefined, { status: "error" })).toBe(
      "POST slack /reactions.add (failed)",
    );
    expect(audit.target(input)).toEqual({
      type: "slack-message",
      id: "C0123ABCD:1700000000.000100",
      visibility: "org",
    });
    expect(audit.target({ channel: "#support", ts: "soon" })).toEqual({
      type: "slack-message",
      visibility: "org",
    });
  });
});
