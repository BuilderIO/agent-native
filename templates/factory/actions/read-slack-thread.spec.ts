import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCallerMock = vi.hoisted(() => vi.fn());
const workspaceMock = vi.hoisted(() => vi.fn());
const getCompleteThreadMock = vi.hoisted(() => vi.fn());
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

import action from "./read-slack-thread.js";

const caller = {
  userEmail: "owner@example.test",
  orgId: "org-1",
  factoryId: "f1",
};
const context = { caller: "automation" as const, userEmail: caller.userEmail };
const input = { channel: "C0123ABCD", threadTs: "1700000000.000100" };

beforeEach(() => {
  vi.clearAllMocks();
  requireCallerMock.mockResolvedValue(caller);
  workspaceMock.mockResolvedValue("primary");
  createClientMock.mockReturnValue({
    getCompleteThread: getCompleteThreadMock,
  });
  getCompleteThreadMock.mockResolvedValue({
    hasMore: false,
    messages: [
      { type: "message", text: "first", ts: "1700000000.000100", user: "U1" },
      { type: "message", text: "second", ts: "1700000001.000100", user: "U2" },
    ],
  });
});

describe("read-slack-thread", () => {
  it("is a read-only action that only a workflow can call", () => {
    expect(action.readOnly).toBe(true);
    expect(action.http).toBe(false);
  });

  it("returns the thread in full for the caller's workspace", async () => {
    workspaceMock.mockResolvedValue("secondary");

    const result = await action.run(input, context);

    expect(result).toMatchObject({
      ok: true,
      coverage: "complete",
      messageCount: 2,
      truncated: false,
    });
    expect(getCompleteThreadMock).toHaveBeenCalledWith(
      "secondary",
      "C0123ABCD",
      "1700000000.000100",
    );
    expect(createClientMock).toHaveBeenCalledWith({
      ownerEmail: "owner@example.test",
      orgId: "org-1",
    });
  });

  it("passes oldest through as a filter", async () => {
    const result = await action.run(
      { ...input, oldest: "1700000000.000100" },
      context,
    );

    expect(result).toMatchObject({ messageCount: 1 });
  });

  it("fails, never returns a short thread, when Slack cannot be paged to the end", async () => {
    getCompleteThreadMock.mockResolvedValue({ hasMore: true, messages: [] });

    await expect(action.run(input, context)).rejects.toMatchObject({
      errorCode: "slack_thread_incomplete",
    });
  });

  it("does not touch Slack for a caller the gate refuses", async () => {
    requireCallerMock.mockRejectedValue(new Error("not allowed"));

    await expect(action.run(input, context)).rejects.toThrow("not allowed");
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("takes only a Slack channel id and timestamps", () => {
    const parse = (value: unknown) =>
      (
        action.schema as { safeParse: (v: unknown) => { success: boolean } }
      ).safeParse(value).success;

    expect(parse(input)).toBe(true);
    expect(parse({ ...input, channel: "general" })).toBe(false);
    expect(parse({ ...input, threadTs: "yesterday" })).toBe(false);
    expect(parse({ ...input, oldest: "soon" })).toBe(false);
  });
});
