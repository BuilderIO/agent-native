import { beforeEach, describe, expect, it, vi } from "vitest";

const frameState = vi.hoisted(() => ({ inBuilderFrame: false }));
const sendToAgentChatMock = vi.hoisted(() => vi.fn(() => "chat-tab"));

vi.mock("@agent-native/core/client", () => ({
  isInBuilderFrame: () => frameState.inBuilderFrame,
  sendToAgentChat: sendToAgentChatMock,
}));

const { submitOverviewPrompt } = await import("./overview-chat.js");

describe("submitOverviewPrompt", () => {
  beforeEach(() => {
    frameState.inBuilderFrame = false;
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
    });

    expect(tabId).toBe("chat-tab");
    expect(sendToAgentChatMock).toHaveBeenCalledWith({
      message: "build a metrics app",
      submit: true,
      newTab: true,
      model: "auto",
      openSidebar: false,
    });
  });

  it("routes overview prompts to Builder chat inside Builder", () => {
    frameState.inBuilderFrame = true;

    const tabId = submitOverviewPrompt("ship the onboarding flow", "auto");

    expect(tabId).toBe("chat-tab");
    expect(sendToAgentChatMock).toHaveBeenCalledWith({
      message: "ship the onboarding flow",
      submit: true,
      type: "code",
    });
  });

  it("ignores empty prompts", () => {
    expect(submitOverviewPrompt("   ", "auto")).toBeNull();
    expect(sendToAgentChatMock).not.toHaveBeenCalled();
  });
});
