import { describe, it, expect, vi, beforeEach } from "vitest";

// We need to set up a minimal window/postMessage before importing
const postMessageSpy = vi.fn();

vi.stubGlobal("window", {
  parent: { postMessage: postMessageSpy },
  addEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
  postMessage: postMessageSpy,
});

const { sendToAgentChat, generateTabId } = await import("./agent-chat.js");

describe("sendToAgentChat", () => {
  beforeEach(() => {
    postMessageSpy.mockClear();
  });

  it("returns a non-empty tabId string", () => {
    const tabId = sendToAgentChat({ message: "hello" });
    expect(typeof tabId).toBe("string");
    expect(tabId.length).toBeGreaterThan(0);
  });

  it("includes tabId in the postMessage payload", () => {
    const tabId = sendToAgentChat({ message: "hello" });
    expect(postMessageSpy).toHaveBeenCalledOnce();
    const payload = postMessageSpy.mock.calls[0][0];
    expect(payload.type).toBe("builder.submitChat");
    expect(payload.data.tabId).toBe(tabId);
    expect(payload.data.message).toBe("hello");
  });

  it("reuses the provided tabId instead of generating a new one", () => {
    const tabId = sendToAgentChat({ message: "hi", tabId: "my-custom-id" });
    expect(tabId).toBe("my-custom-id");
    const payload = postMessageSpy.mock.calls[0][0];
    expect(payload.data.tabId).toBe("my-custom-id");
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
