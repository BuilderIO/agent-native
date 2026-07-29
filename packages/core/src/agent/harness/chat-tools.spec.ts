import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  cacheKey: vi.fn(() => "approval-key"),
}));

vi.mock("../production-agent.js", () => ({
  executeAgentToolCall: mocks.execute,
  toolCallCacheKey: mocks.cacheKey,
}));

const { createAgentHarnessActionTools } = await import("./chat-tools.js");

describe("createAgentHarnessActionTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ status: "completed", output: "ok" });
  });

  it("excludes actions that are unavailable to agent tools", () => {
    const tools = createAgentHarnessActionTools({
      actions: {
        visible: action(),
        hidden: { ...action(), agentTool: false },
        networkOnly: { ...action(), toolCallable: false },
      },
      ownerEmail: "owner@example.com",
    });

    expect(Object.keys(tools)).toEqual(["visible"]);
  });

  it("executes through the guarded Agent Native tool runtime", async () => {
    const tools = createAgentHarnessActionTools({
      actions: { lookup: action() },
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      threadId: "thread-1",
      turnId: "turn-1",
    });

    await expect(
      tools.lookup!.execute(
        { query: "hello" },
        { toolCallId: "call-1", abortSignal: new AbortController().signal },
      ),
    ).resolves.toBe("ok");
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "lookup",
        input: { query: "hello" },
        callId: "call-1",
        ownerEmail: "owner@example.com",
        orgId: "org-1",
        caller: "tool",
        threadId: "thread-1",
        turnId: "turn-1",
      }),
    );
  });

  it("fails closed before an adapter supplies a human-approval grant", async () => {
    const guarded = action();
    guarded.needsApproval = async () => {
      throw new Error("predicate failure");
    };
    const tools = createAgentHarnessActionTools({
      actions: { publish: guarded },
      ownerEmail: "owner@example.com",
    });

    await expect(tools.publish!.needsApproval!({})).resolves.toBe(true);
    await expect(
      tools.publish!.execute({}, { toolCallId: "call-1" }),
    ).rejects.toThrow("requires human approval");
    expect(mocks.execute).not.toHaveBeenCalled();

    await tools.publish!.execute({}, { toolCallId: "call-1", approved: true });
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({ approvedToolCalls: ["approval-key"] }),
    );
  });
});

function action() {
  return {
    tool: {
      description: "Test action",
      parameters: {
        type: "object" as const,
        properties: { query: { type: "string" } },
      },
    },
    run: vi.fn(async () => "ok"),
  };
}
