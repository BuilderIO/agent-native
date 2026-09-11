import { beforeEach, describe, expect, it, vi } from "vitest";

const sendToAgentChatMock = vi.hoisted(() => vi.fn(() => "tab-plan"));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: sendToAgentChatMock,
}));

import { sendToPlanCreationAgentChat } from "./agent-chat";

describe("Plan agent chat routing", () => {
  beforeEach(() => {
    sendToAgentChatMock.mockClear();
  });

  it("keeps New Plan prompts in the Plan chat and creates a fresh tab", () => {
    const tabId = sendToPlanCreationAgentChat({
      message: "Create an Agent-Native Plan from this request.",
      type: "content",
      submit: true,
      chatTarget: "auto",
    });

    expect(tabId).toBe("tab-plan");
    expect(sendToAgentChatMock).toHaveBeenCalledWith({
      message: "Create an Agent-Native Plan from this request.",
      type: "content",
      submit: true,
      newTab: true,
      reuseEmptyTab: true,
      chatTarget: "local",
    });
  });
});
