import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendToAgentChatMock = vi.hoisted(() => vi.fn(() => "tab-design"));
const sendToAgentChatAndConfirmMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ tabId: "tab-design", delivered: true })),
);
const sendMcpAppHostMessageMock = vi.hoisted(() =>
  vi.fn<() => false | Promise<boolean | null>>(() => false),
);

const sendToBuilderChatMock = vi.hoisted(() => vi.fn(() => true));
const isBuilderHostEmbedMock = vi.hoisted(() => vi.fn(() => false));
const isEmbedChromeRequestedMock = vi.hoisted(() => vi.fn(() => false));
const isMcpAppWidgetEmbedMock = vi.hoisted(() => vi.fn(() => false));
const isInFrameMock = vi.hoisted(() => vi.fn(() => false));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: sendToAgentChatMock,
  sendToAgentChatAndConfirm: sendToAgentChatAndConfirmMock,
  sendMcpAppHostMessage: sendMcpAppHostMessageMock,
}));

vi.mock("@agent-native/core/client/host", () => ({
  sendToBuilderChat: sendToBuilderChatMock,
  isInFrame: isInFrameMock,
}));
vi.mock("@agent-native/core/client/mcp-app-host", () => ({
  isMcpAppWidgetEmbed: isMcpAppWidgetEmbedMock,
}));

vi.mock("./builder-host-origin", () => ({
  isBuilderHostEmbed: isBuilderHostEmbedMock,
  getVerifiedBuilderHostOrigin: () => "https://builder.io",
}));

vi.mock("./embed-chrome", () => ({
  isEmbedChromeRequested: isEmbedChromeRequestedMock,
}));

import {
  DESIGN_CHAT_STORAGE_KEY,
  sendDesignSourceHandoffAndConfirm,
  sendDesignHostFollowUp,
  isDesignHostChatEmbed,
  sendToDesignAgentChat,
  sendToDesignAgentChatAndConfirm,
} from "./agent-chat";

describe("Design agent chat routing", () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    sendToAgentChatMock.mockClear();
    sendToAgentChatAndConfirmMock.mockClear();
    sendMcpAppHostMessageMock.mockClear();
    sendToBuilderChatMock.mockClear();
    sendToBuilderChatMock.mockReturnValue(true);
    isBuilderHostEmbedMock.mockReturnValue(false);
    isEmbedChromeRequestedMock.mockReturnValue(false);
    isMcpAppWidgetEmbedMock.mockReturnValue(false);
    isInFrameMock.mockReturnValue(false);
  });

  it("namespaces Design chat state", () => {
    expect(DESIGN_CHAT_STORAGE_KEY).toBe("design");
  });

  it("recognizes an MCP host even when no local model is available", async () => {
    isMcpAppWidgetEmbedMock.mockReturnValue(true);
    sendMcpAppHostMessageMock.mockReturnValueOnce(Promise.resolve(true));
    expect(isDesignHostChatEmbed()).toBe(true);
    await expect(
      sendDesignHostFollowUp({ message: "Review", submit: true }),
    ).resolves.toEqual({ delivered: true });
    expect(sendToAgentChatAndConfirmMock).not.toHaveBeenCalled();
  });

  it("does not retry an uncertain host comment locally", async () => {
    isMcpAppWidgetEmbedMock.mockReturnValue(true);
    sendMcpAppHostMessageMock.mockReturnValueOnce(Promise.resolve(false));
    await expect(
      sendDesignHostFollowUp({ message: "Review", submit: true }),
    ).resolves.toEqual({ delivered: false, reason: "host-rejected" });
    expect(sendToAgentChatAndConfirmMock).not.toHaveBeenCalled();
  });

  it("uses the acknowledged native frame relay for WorkspaceAppFrame", async () => {
    isInFrameMock.mockReturnValue(true);
    sendToAgentChatAndConfirmMock.mockResolvedValueOnce({
      tabId: "tab-design",
      delivered: true,
    });
    await expect(
      sendDesignHostFollowUp({
        message: "Make the heading bigger",
        context: "Bounded thread context",
        submit: true,
      }),
    ).resolves.toEqual({ delivered: true });
    expect(sendToAgentChatAndConfirmMock).toHaveBeenCalledWith(
      {
        message: "Make the heading bigger",
        context: "Bounded thread context",
        submit: true,
        chatTarget: "auto",
      },
      { confirmParentFrame: true },
    );
  });

  it("treats host timeouts and null MCP acknowledgements as unconfirmed", async () => {
    vi.useFakeTimers();
    isMcpAppWidgetEmbedMock.mockReturnValue(true);
    sendMcpAppHostMessageMock.mockReturnValueOnce(new Promise(() => {}));
    const timedOut = sendDesignHostFollowUp(
      { message: "Review", submit: true },
      { timeoutMs: 100 },
    );
    await vi.advanceTimersByTimeAsync(100);
    await expect(timedOut).resolves.toEqual({ delivered: "unconfirmed" });

    sendMcpAppHostMessageMock.mockReturnValueOnce(Promise.resolve(null));
    await expect(
      sendDesignHostFollowUp({ message: "Review", submit: true }),
    ).resolves.toEqual({ delivered: "unconfirmed" });
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

  it("preserves new-branch prompts for the ChatGPT host router", async () => {
    const result = await sendToDesignAgentChatAndConfirm({
      message: "Apply the alternate direction",
      submit: true,
      newTab: true,
    });

    expect(result).toEqual({ tabId: "tab-design", delivered: true });
    expect(sendToAgentChatAndConfirmMock).toHaveBeenCalledWith(
      {
        message: "Apply the alternate direction",
        submit: true,
        newTab: true,
        chatTarget: "local",
      },
      undefined,
    );
  });

  it("hands source edits to Builder on the shell canvas, which holds no session of its own", async () => {
    isBuilderHostEmbedMock.mockReturnValue(true);
    isEmbedChromeRequestedMock.mockReturnValue(true);

    const result = await sendDesignSourceHandoffAndConfirm({
      message: "Apply the pending visual style edits to the source.",
      context: "Structured source instructions",
      submit: true,
    });

    expect(result).toEqual({
      target: "host",
      delivered: true,
      awaitingHostTurn: true,
    });
    expect(sendToBuilderChatMock).toHaveBeenCalledWith({
      message: "Apply the pending visual style edits to the source.",
      context: "Structured source instructions",
      submit: true,
      targetOrigin: "https://builder.io",
    });
    expect(sendMcpAppHostMessageMock).not.toHaveBeenCalled();
    expect(sendToAgentChatAndConfirmMock).not.toHaveBeenCalled();
  });

  it("keeps the pending edits when the Builder post fails", async () => {
    isBuilderHostEmbedMock.mockReturnValue(true);
    isEmbedChromeRequestedMock.mockReturnValue(true);
    sendToBuilderChatMock.mockReturnValue(false);

    const result = await sendDesignSourceHandoffAndConfirm({
      message: "Apply these edits",
      submit: true,
    });

    expect(result).toEqual({
      target: "host",
      delivered: false,
      reason: "host-post-failed",
    });
    expect(sendToAgentChatAndConfirmMock).not.toHaveBeenCalled();
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
