import type { ActionEntry } from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getThread: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getThread: mocks.getThread,
}));

import { guardRepromptActionRegistry } from "./reprompt-action-guard";

function actionEntry(run: ActionEntry["run"], readOnly?: boolean): ActionEntry {
  return {
    tool: {
      description: "test",
      parameters: { type: "object", properties: {} },
    },
    run,
    ...(readOnly === undefined ? {} : { readOnly }),
  };
}

describe("guardRepromptActionRegistry", () => {
  beforeEach(() => {
    mocks.getThread.mockReset();
  });

  it("blocks generic agent mutations during a reprompt selection turn", async () => {
    const edit = vi.fn();
    mocks.getThread.mockResolvedValue({
      preview: "[Reprompt selection]\nrepromptId: reprompt-1",
      threadData: "{}",
    });
    const actions = guardRepromptActionRegistry({
      "edit-design": actionEntry(edit),
    });

    await expect(
      actions["edit-design"]!.run({}, { caller: "tool", threadId: "thread-1" }),
    ).rejects.toThrow("call propose-node-rewrite");
    expect(edit).not.toHaveBeenCalled();
  });

  it("allows the proposal action and non-agent callers", async () => {
    const propose = vi.fn().mockResolvedValue("proposed");
    const frontendEdit = vi.fn().mockResolvedValue("edited");
    mocks.getThread.mockResolvedValue({
      preview: "[Reprompt selection]\nrepromptId: reprompt-1",
      threadData: "{}",
    });
    const actions = guardRepromptActionRegistry({
      "propose-node-rewrite": actionEntry(propose),
      "edit-design": actionEntry(frontendEdit),
    });

    await expect(
      actions["propose-node-rewrite"]!.run(
        {},
        { caller: "tool", threadId: "thread-1" },
      ),
    ).resolves.toBe("proposed");
    await expect(
      actions["edit-design"]!.run({}, { caller: "frontend" }),
    ).resolves.toBe("edited");
  });

  it("blocks proposal resolution during a preview-only reprompt turn", async () => {
    const resolve = vi.fn();
    mocks.getThread.mockResolvedValue({
      preview: "[Reprompt selection]\nrepromptId: reprompt-1",
      threadData: "{}",
    });
    const actions = guardRepromptActionRegistry({
      "resolve-node-rewrite": actionEntry(resolve),
    });

    await expect(
      actions["resolve-node-rewrite"]!.run(
        { proposalId: "proposal-1", resolution: "accept" },
        { caller: "tool", threadId: "thread-1" },
      ),
    ).rejects.toThrow("preview-only");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("fails closed when a mutating tool call has no verifiable thread", async () => {
    const edit = vi.fn();
    mocks.getThread.mockResolvedValue(null);
    const actions = guardRepromptActionRegistry({
      "edit-design": actionEntry(edit),
    });

    await expect(
      actions["edit-design"]!.run(
        {},
        { caller: "tool", threadId: "missing-thread" },
      ),
    ).rejects.toThrow("Cannot verify the agent thread");
    expect(edit).not.toHaveBeenCalled();
  });

  it("detects the reprompt marker in hidden chat context", async () => {
    const edit = vi.fn();
    mocks.getThread.mockResolvedValue({
      preview: "Give this a better background",
      threadData: JSON.stringify({
        messages: [
          {
            message: {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Give this a better background\n<context>\n[Reprompt selection]\nrepromptId: reprompt-1\n</context>",
                },
              ],
            },
          },
        ],
      }),
    });
    const actions = guardRepromptActionRegistry({
      "edit-design": actionEntry(edit),
    });

    await expect(
      actions["edit-design"]!.run({}, { caller: "tool", threadId: "thread-1" }),
    ).rejects.toThrow("call propose-node-rewrite");
    expect(edit).not.toHaveBeenCalled();
  });

  it("blocks every mutation during a selection question turn", async () => {
    const edit = vi.fn();
    const propose = vi.fn();
    const inspect = vi.fn().mockResolvedValue("inspected");
    mocks.getThread.mockResolvedValue({
      preview: "Why does this feel unbalanced?",
      threadData: JSON.stringify({
        messages: [
          {
            message: {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Why does this feel unbalanced?\n<context>\n[Selection question]\ntarget: hero\n</context>",
                },
              ],
            },
          },
        ],
      }),
    });
    const actions = guardRepromptActionRegistry({
      "edit-design": actionEntry(edit),
      "propose-node-rewrite": actionEntry(propose),
      "get-design-snapshot": actionEntry(inspect, true),
    });

    await expect(
      actions["edit-design"]!.run(
        {},
        {
          caller: "tool",
          threadId: "thread-1",
        },
      ),
    ).rejects.toThrow("read-only");
    await expect(
      actions["propose-node-rewrite"]!.run(
        {},
        {
          caller: "tool",
          threadId: "thread-1",
        },
      ),
    ).rejects.toThrow("read-only");
    await expect(
      actions["get-design-snapshot"]!.run(
        {},
        {
          caller: "tool",
          threadId: "thread-1",
        },
      ),
    ).resolves.toBe("inspected");
    expect(edit).not.toHaveBeenCalled();
    expect(propose).not.toHaveBeenCalled();
  });
});
