import { beforeEach, describe, expect, it, vi } from "vitest";

const sendToAgentChatMock = vi.hoisted(() => vi.fn(() => "tab-design"));
const sendToAgentChatAndConfirmMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ tabId: "tab-design", delivered: true })),
);
const sendMcpAppHostMessageMock = vi.hoisted(() =>
  vi.fn<() => false | Promise<boolean>>(() => false),
);

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: sendToAgentChatMock,
  sendToAgentChatAndConfirm: sendToAgentChatAndConfirmMock,
  sendMcpAppHostMessage: sendMcpAppHostMessageMock,
}));

import {
  DESIGN_CHAT_STORAGE_KEY,
  sendDesignSourceHandoffAndConfirm,
  sendToDesignAgentChat,
  sendToDesignAgentChatAndConfirm,
} from "./agent-chat";

describe("Design agent chat routing", () => {
  beforeEach(() => {
    sendToAgentChatMock.mockClear();
    sendToAgentChatAndConfirmMock.mockClear();
    sendMcpAppHostMessageMock.mockClear();
  });

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

  it("hands source edits to the MCP host when Design is embedded there", async () => {
    sendMcpAppHostMessageMock.mockReturnValueOnce(Promise.resolve(true));

    const result = await sendDesignSourceHandoffAndConfirm({
      message: "Apply these edits",
      context: "Structured source instructions",
      submit: true,
      mode: "act",
    });

    expect(result).toEqual({ target: "host", delivered: true });
    expect(sendMcpAppHostMessageMock).toHaveBeenCalledWith({
      message: "Apply these edits",
      context: "Structured source instructions",
      mode: "act",
      requestMode: undefined,
    });
    expect(sendToAgentChatAndConfirmMock).not.toHaveBeenCalled();
  });

  it("preserves a rejected host handoff without duplicating it locally", async () => {
    sendMcpAppHostMessageMock.mockReturnValueOnce(Promise.resolve(false));

    const result = await sendDesignSourceHandoffAndConfirm({
      message: "Apply these edits",
      submit: true,
    });

    expect(result).toEqual({
      target: "host",
      delivered: false,
      reason: "host-rejected",
    });
    expect(sendToAgentChatAndConfirmMock).not.toHaveBeenCalled();
  });

  it("times out a stalled host handoff without duplicating it locally", async () => {
    vi.useFakeTimers();
    try {
      sendMcpAppHostMessageMock.mockReturnValueOnce(
        new Promise<boolean>(() => {}),
      );

      const resultPromise = sendDesignSourceHandoffAndConfirm(
        {
          message: "Apply these edits",
          submit: true,
        },
        { timeoutMs: 123 },
      );
      await vi.advanceTimersByTimeAsync(123);

      await expect(resultPromise).resolves.toEqual({
        target: "host",
        delivered: false,
        reason: "host-timeout",
      });
      expect(sendToAgentChatAndConfirmMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the confirmed local Design agent when no host bridge exists", async () => {
    sendMcpAppHostMessageMock.mockReturnValueOnce(false);

    const result = await sendDesignSourceHandoffAndConfirm(
      {
        message: "Apply these edits",
        context: "Structured source instructions",
        submit: true,
      },
      { timeoutMs: 4321 },
    );

    expect(result).toEqual({
      target: "local",
      tabId: "tab-design",
      delivered: true,
    });
    expect(sendToAgentChatAndConfirmMock).toHaveBeenCalledWith(
      {
        message: "Apply these edits",
        context: "Structured source instructions",
        submit: true,
        chatTarget: "local",
      },
      { timeoutMs: 4321 },
    );
  });
});
