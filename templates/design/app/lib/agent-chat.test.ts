import { describe, expect, it, vi } from "vitest";

const sendToAgentChatMock = vi.hoisted(() => vi.fn(() => "tab-design"));

vi.mock("@agent-native/core/client", () => ({
  sendToAgentChat: sendToAgentChatMock,
}));

import { DESIGN_CHAT_STORAGE_KEY, sendToDesignAgentChat } from "./agent-chat";

describe("Design agent chat routing", () => {
  it("namespaces Design chat state", () => {
    expect(DESIGN_CHAT_STORAGE_KEY).toBe("design");
  });

  it("forces Design handoffs to the local app chat", () => {
    const tabId = sendToDesignAgentChat({
      message: "Refine this design",
      submit: true,
      chatTarget: "auto",
    });

    expect(tabId).toBe("tab-design");
    expect(sendToAgentChatMock).toHaveBeenCalledWith({
      message: "Refine this design",
      submit: true,
      chatTarget: "local",
    });
  });
});
