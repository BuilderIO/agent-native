import { describe, it, expect, vi, beforeEach } from "vitest";

// We need to set up a minimal window/postMessage before importing
const parentPostMessageSpy = vi.fn();
const selfPostMessageSpy = vi.fn();
const dispatchEventSpy = vi.fn();
const frameState = vi.hoisted(() => ({ inBuilderFrame: false }));
const sendToBuilderChatMock = vi.hoisted(() => vi.fn());

vi.mock("./builder-frame.js", () => ({
  isInBuilderFrame: () => frameState.inBuilderFrame,
  isTrustedBuilderMessage: () => false,
  sendToBuilderChat: sendToBuilderChatMock,
}));

vi.stubGlobal("window", {
  parent: { postMessage: parentPostMessageSpy },
  addEventListener: vi.fn(),
  dispatchEvent: dispatchEventSpy,
  postMessage: selfPostMessageSpy,
  location: { origin: "http://localhost:3000" },
});

const { sendToAgentChat, generateTabId } = await import("./agent-chat.js");

describe("sendToAgentChat", () => {
  beforeEach(() => {
    frameState.inBuilderFrame = false;
    parentPostMessageSpy.mockClear();
    selfPostMessageSpy.mockClear();
    dispatchEventSpy.mockClear();
    sendToBuilderChatMock.mockClear();
  });

  it("returns a non-empty tabId string", () => {
    const tabId = sendToAgentChat({ message: "hello" });
    expect(typeof tabId).toBe("string");
    expect(tabId.length).toBeGreaterThan(0);
  });

  it("includes tabId in the postMessage payload", () => {
    const tabId = sendToAgentChat({ message: "hello" });
    expect(parentPostMessageSpy).toHaveBeenCalledOnce();
    const payload = parentPostMessageSpy.mock.calls[0][0];
    expect(payload.type).toBe("agentNative.submitChat");
    expect(payload.data.tabId).toBe(tabId);
    expect(payload.data.message).toBe("hello");
  });

  it("reuses the provided tabId instead of generating a new one", () => {
    const tabId = sendToAgentChat({ message: "hi", tabId: "my-custom-id" });
    expect(tabId).toBe("my-custom-id");
    const payload = parentPostMessageSpy.mock.calls[0][0];
    expect(payload.data.tabId).toBe("my-custom-id");
  });

  it("keeps content prompts inside the embedded app when mounted in Builder", () => {
    frameState.inBuilderFrame = true;

    const tabId = sendToAgentChat({
      message: "create a dashboard",
      submit: true,
    });

    expect(parentPostMessageSpy).not.toHaveBeenCalled();
    expect(sendToBuilderChatMock).not.toHaveBeenCalled();
    expect(selfPostMessageSpy).toHaveBeenCalledOnce();
    const [payload, targetOrigin] = selfPostMessageSpy.mock.calls[0];
    expect(targetOrigin).toBe("http://localhost:3000");
    expect(payload.type).toBe("agentNative.submitChat");
    expect(payload.data.tabId).toBe(tabId);
    expect(payload.data.message).toBe("create a dashboard");
  });

  it("routes Builder-frame code prompts to Builder chat", () => {
    frameState.inBuilderFrame = true;

    sendToAgentChat({
      message: "change this app",
      context: "code context",
      submit: true,
      type: "code",
    });

    expect(parentPostMessageSpy).not.toHaveBeenCalled();
    expect(selfPostMessageSpy).not.toHaveBeenCalled();
    expect(sendToBuilderChatMock).toHaveBeenCalledWith({
      message: "change this app",
      context: "code context",
      submit: true,
    });
  });

  it("generates distinct tabIds across calls", () => {
    const id1 = sendToAgentChat({ message: "a" });
    const id2 = sendToAgentChat({ message: "b" });
    expect(id1).not.toBe(id2);
  });
});

describe("generateTabId", () => {
  it("returns a string starting with 'chat-'", () => {
    const id = generateTabId();
    expect(id).toMatch(/^chat-/);
  });

  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTabId()));
    expect(ids.size).toBe(100);
  });
});
