import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need to set up a minimal window/postMessage before importing
const parentPostMessageSpy = vi.fn();
const selfPostMessageSpy = vi.fn();
const dispatchEventSpy = vi.fn();
const frameState = vi.hoisted(() => ({ inBuilderFrame: false }));
const sendToBuilderChatMock = vi.hoisted(() => vi.fn());
const sendMcpAppHostMessageMock = vi.hoisted(() => vi.fn(() => false));

vi.mock("./builder-frame.js", () => ({
  isInBuilderFrame: () => frameState.inBuilderFrame,
  isTrustedBuilderMessage: () => false,
  sendToBuilderChat: sendToBuilderChatMock,
}));

vi.mock("./mcp-app-host.js", () => ({
  sendMcpAppHostMessage: sendMcpAppHostMessageMock,
}));

vi.stubGlobal("window", {
  parent: { postMessage: parentPostMessageSpy },
  addEventListener: vi.fn(),
  dispatchEvent: dispatchEventSpy,
  postMessage: selfPostMessageSpy,
  location: {
    origin: "http://localhost:3000",
    search: "",
  },
});

const { sendToAgentChat, generateTabId } = await import("./agent-chat.js");
const { _resetEmbedAuthForTests } = await import("./embed-auth.js");

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("sendToAgentChat", () => {
  beforeEach(() => {
    frameState.inBuilderFrame = false;
    (window as unknown as { parent: unknown }).parent = {
      postMessage: parentPostMessageSpy,
    };
    parentPostMessageSpy.mockClear();
    selfPostMessageSpy.mockClear();
    dispatchEventSpy.mockClear();
    sendToBuilderChatMock.mockClear();
    sendMcpAppHostMessageMock.mockClear();
    sendMcpAppHostMessageMock.mockReturnValue(false);
    window.location.search = "";
    window.sessionStorage?.clear();
    _resetEmbedAuthForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("opens the local sidebar before posting to a top-level chat listener", () => {
    vi.useFakeTimers();
    (window as unknown as { parent: unknown }).parent = window;

    const tabId = sendToAgentChat({
      message: "fix the layout overflow",
      submit: true,
    });

    expect(parentPostMessageSpy).not.toHaveBeenCalled();
    expect(selfPostMessageSpy).not.toHaveBeenCalled();
    expect(dispatchEventSpy.mock.calls.map(([event]) => event.type)).toEqual([
      "agent-panel:set-mode",
      "agent-panel:open",
    ]);

    vi.runOnlyPendingTimers();

    expect(selfPostMessageSpy).toHaveBeenCalledOnce();
    const payload = selfPostMessageSpy.mock.calls[0][0];
    expect(payload.type).toBe("agentNative.submitChat");
    expect(payload.data.tabId).toBe(tabId);
    expect(payload.data.message).toBe("fix the layout overflow");
  });

  it("reuses the provided tabId instead of generating a new one", () => {
    const tabId = sendToAgentChat({ message: "hi", tabId: "my-custom-id" });
    expect(tabId).toBe("my-custom-id");
    const payload = parentPostMessageSpy.mock.calls[0][0];
    expect(payload.data.tabId).toBe("my-custom-id");
  });

  it("keeps content prompts inside the embedded app when mounted in Builder", () => {
    vi.useFakeTimers();
    frameState.inBuilderFrame = true;

    const tabId = sendToAgentChat({
      message: "create a dashboard",
      submit: true,
    });

    expect(parentPostMessageSpy).not.toHaveBeenCalled();
    expect(sendToBuilderChatMock).not.toHaveBeenCalled();
    expect(selfPostMessageSpy).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();

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

  it("prepares the local sidebar for silent background sends without opening it", () => {
    sendToAgentChat({
      message: "refresh quietly",
      submit: true,
      openSidebar: false,
    });

    const eventTypes = dispatchEventSpy.mock.calls.map(([event]) => event.type);
    expect(eventTypes).toContain("agent-panel:prepare");
    expect(eventTypes).not.toContain("agent-panel:open");
  });

  it("prepares the local sidebar for background tabs without opening it", () => {
    sendToAgentChat({
      message: "run in the background",
      submit: true,
      background: true,
    });

    const eventTypes = dispatchEventSpy.mock.calls.map(([event]) => event.type);
    expect(eventTypes).toContain("agent-panel:prepare");
    expect(eventTypes).not.toContain("agent-panel:open");
  });

  it("falls back to the MCP App wrapper relay when direct host messaging is unavailable", () => {
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";

    const tabId = sendToAgentChat({
      message: "continue with this selection",
      context: "Selected item ids: a, b",
      submit: true,
    });

    expect(parentPostMessageSpy).toHaveBeenCalledOnce();
    expect(sendMcpAppHostMessageMock).toHaveBeenCalledWith({
      message: "continue with this selection",
      context: "Selected item ids: a, b",
    });
    const [payload, targetOrigin] = parentPostMessageSpy.mock.calls[0];
    expect(targetOrigin).toBe("*");
    expect(payload.type).toBe("agentNative.submitChat");
    expect(payload.data.tabId).toBe(tabId);
    expect(payload.data.message).toBe("continue with this selection");
    expect(payload.data.context).toBe("Selected item ids: a, b");
    expect(dispatchEventSpy).not.toHaveBeenCalled();
  });

  it("does not duplicate MCP App prompts through both the direct bridge and wrapper relay", () => {
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";
    sendMcpAppHostMessageMock.mockReturnValue(Promise.resolve(true));

    sendToAgentChat({
      message: "rewrite this",
      context: "Hidden draft context",
      submit: true,
    });

    expect(sendMcpAppHostMessageMock).toHaveBeenCalledWith({
      message: "rewrite this",
      context: "Hidden draft context",
    });
    expect(parentPostMessageSpy).not.toHaveBeenCalled();
  });

  it("lets direct MCP App frames handle auto-submitted prompts via JSON-RPC", async () => {
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";
    sendMcpAppHostMessageMock.mockReturnValue(Promise.resolve(true));

    sendToAgentChat({
      message: "continue with this selection",
      context: "Selected item ids: a, b",
      submit: true,
    });

    expect(sendMcpAppHostMessageMock).toHaveBeenCalledWith({
      message: "continue with this selection",
      context: "Selected item ids: a, b",
    });
    expect(parentPostMessageSpy).not.toHaveBeenCalled();
    expect(dispatchEventSpy).not.toHaveBeenCalled();

    await flushMicrotasks();

    expect(parentPostMessageSpy).not.toHaveBeenCalled();
    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agentNative.chatRunning",
        detail: { isRunning: false },
      }),
    );
  });

  it("falls back to the wrapper relay if direct MCP App host messaging rejects the send", async () => {
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";
    sendMcpAppHostMessageMock.mockReturnValue(Promise.resolve(false));

    const tabId = sendToAgentChat({
      message: "continue with this selection",
      context: "Selected item ids: a, b",
      submit: true,
    });

    expect(parentPostMessageSpy).not.toHaveBeenCalled();

    await flushMicrotasks();

    expect(parentPostMessageSpy).toHaveBeenCalledOnce();
    const [payload, targetOrigin] = parentPostMessageSpy.mock.calls[0];
    expect(targetOrigin).toBe("*");
    expect(payload.type).toBe("agentNative.submitChat");
    expect(payload.data.tabId).toBe(tabId);
    expect(payload.data.message).toBe("continue with this selection");
    expect(payload.data.context).toBe("Selected item ids: a, b");
    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agentNative.chatRunning",
        detail: { isRunning: false },
      }),
    );
  });

  it("keeps direct MCP App embed sessions on the local app chat path", () => {
    vi.useFakeTimers();
    window.location.search = "?embedded=1&__an_embed_token=signed-token";

    const tabId = sendToAgentChat({
      message: "summarize this dashboard",
      context: "Dashboard: traffic",
      submit: true,
    });

    expect(parentPostMessageSpy).not.toHaveBeenCalled();
    expect(selfPostMessageSpy).not.toHaveBeenCalled();
    expect(dispatchEventSpy.mock.calls.map(([event]) => event.type)).toEqual([
      "agent-panel:set-mode",
      "agent-panel:open",
    ]);

    vi.runOnlyPendingTimers();

    expect(selfPostMessageSpy).toHaveBeenCalledOnce();
    const [payload, targetOrigin] = selfPostMessageSpy.mock.calls[0];
    expect(targetOrigin).toBe("http://localhost:3000");
    expect(payload.type).toBe("agentNative.submitChat");
    expect(payload.data.tabId).toBe(tabId);
    expect(payload.data.message).toBe("summarize this dashboard");
    expect(payload.data.context).toBe("Dashboard: traffic");
  });

  it("keeps MCP App prefill-only messages on the existing local path", () => {
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";

    sendToAgentChat({
      message: "prefill this for review",
      submit: false,
    });

    expect(parentPostMessageSpy).toHaveBeenCalledOnce();
    const [payload, targetOrigin] = parentPostMessageSpy.mock.calls[0];
    expect(targetOrigin).toBe("http://localhost:3000");
    expect(payload.type).toBe("agentNative.submitChat");
    expect(dispatchEventSpy.mock.calls.map(([event]) => event.type)).toEqual([
      "agent-panel:set-mode",
      "agent-panel:open",
    ]);
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
