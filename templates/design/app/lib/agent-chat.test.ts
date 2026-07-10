import { describe, expect, it, vi } from "vitest";

const sendToAgentChatMock = vi.hoisted(() => vi.fn(() => "tab-design"));
const sendToAgentChatAndConfirmMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ tabId: "tab-design", delivered: true })),
);

vi.mock("@agent-native/core/client", () => ({
  sendToAgentChat: sendToAgentChatMock,
  sendToAgentChatAndConfirm: sendToAgentChatAndConfirmMock,
}));

import {
  DESIGN_CHAT_STORAGE_KEY,
  sendToDesignAgentChat,
  sendToDesignAgentChatAndConfirm,
} from "./agent-chat";

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

  it("forces the ack-confirmed handoff to the local app chat and returns delivery status", async () => {
    const result = await sendToDesignAgentChatAndConfirm(
      {
        message: "Apply this annotation",
        submit: true,
        chatTarget: "auto",
      },
      { timeoutMs: 1234 },
    );

    expect(result).toEqual({ tabId: "tab-design", delivered: true });
    expect(sendToAgentChatAndConfirmMock).toHaveBeenCalledWith(
      {
        message: "Apply this annotation",
        submit: true,
        chatTarget: "local",
      },
      { timeoutMs: 1234 },
    );
  });
});
