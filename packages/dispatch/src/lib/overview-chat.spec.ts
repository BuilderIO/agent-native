import { beforeEach, describe, expect, it, vi } from "vitest";

const sendToAgentChatMock = vi.hoisted(() => vi.fn(() => "chat-tab"));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: sendToAgentChatMock,
}));

const { submitOverviewPrompt } = await import("./overview-chat.js");

describe("submitOverviewPrompt", () => {
  beforeEach(() => {
    sendToAgentChatMock.mockClear();
  });

  it("sends overview prompts to a new local agent tab outside Builder", () => {
    const tabId = submitOverviewPrompt(" build a metrics app ", "auto");

    expect(tabId).toBe("chat-tab");
    expect(sendToAgentChatMock).toHaveBeenCalledWith({
      message: "build a metrics app",
      submit: true,
      newTab: true,
      model: "auto",
    });
  });

  it("can submit to a mounted page chat without opening the sidebar", () => {
    const tabId = submitOverviewPrompt(" build a metrics app ", "auto", {
      openSidebar: false,
      selectedEngine: "openai",
      selectedEffort: "high",
    });

    expect(tabId).toBe("chat-tab");
    expect(sendToAgentChatMock).toHaveBeenCalledWith({
      message: "build a metrics app",
      submit: true,
      newTab: true,
      model: "auto",
      engine: "openai",
      effort: "high",
      openSidebar: false,
    });
  });

  it("ignores empty prompts", () => {
    expect(submitOverviewPrompt("   ", "auto")).toBeNull();
    expect(sendToAgentChatMock).not.toHaveBeenCalled();
  });
});
