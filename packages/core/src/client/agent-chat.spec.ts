import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need to set up a minimal window/postMessage before importing
const parentPostMessageSpy = vi.fn();
const selfPostMessageSpy = vi.fn();
const dispatchEventSpy = vi.fn();
const fetchSpy = vi.fn(() =>
  Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("") }),
);
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
    pathname: "/",
    search: "",
  },
});
vi.stubGlobal("fetch", fetchSpy);

const {
  _resetAgentChatContextForTests,
  addContextToAgentChat,
  clearAgentChatContext,
  formatAgentChatContextItemsForPrompt,
  generateTabId,
  insertAgentComposerReference,
  listAgentChatContext,
  normalizeAgentComposerReference,
  removeAgentChatContextItem,
  sendToAgentChat,
  setAgentChatContextItem,
  setContextToAgentChat,
} = await import("./agent-chat.js");
const { _resetEmbedAuthForTests } = await import("./embed-auth.js");

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

describe("sendToAgentChat", () => {
  beforeEach(() => {
    frameState.inBuilderFrame = false;
    (window as unknown as { parent: unknown }).parent = {
      postMessage: parentPostMessageSpy,
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createMemoryStorage(),
    });
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: createMemoryStorage(),
    });
    parentPostMessageSpy.mockClear();
    selfPostMessageSpy.mockClear();
    dispatchEventSpy.mockClear();
    sendToBuilderChatMock.mockClear();
    sendMcpAppHostMessageMock.mockClear();
    sendMcpAppHostMessageMock.mockReturnValue(false);
    fetchSpy.mockClear();
    window.location.search = "";
    window.localStorage?.clear();
    window.sessionStorage?.clear();
    _resetEmbedAuthForTests();
    _resetAgentChatContextForTests();
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

  it("includes submitted image data in the postMessage payload", () => {
    sendToAgentChat({
      message: "describe this image",
      images: ["data:image/png;base64,abc"],
      submit: true,
    });

    expect(parentPostMessageSpy).toHaveBeenCalledOnce();
    const payload = parentPostMessageSpy.mock.calls[0][0];
    expect(payload.data.images).toEqual(["data:image/png;base64,abc"]);
  });

  it("snapshots stored plan mode into the postMessage payload", () => {
    window.localStorage.setItem("agent-native-exec-mode", "plan");

    sendToAgentChat({
      message: "plan this dashboard",
      submit: true,
    });

    expect(parentPostMessageSpy).toHaveBeenCalledOnce();
    const payload = parentPostMessageSpy.mock.calls[0][0];
    expect(payload.data.mode).toBe("plan");
    expect(payload.data.requestMode).toBe("plan");
  });

  it("snapshots namespaced stored plan mode into the postMessage payload", () => {
    window.localStorage.setItem("agent-native-exec-mode:workspace-app", "plan");

    sendToAgentChat({
      message: "plan this workspace app",
      submit: true,
    });

    expect(parentPostMessageSpy).toHaveBeenCalledOnce();
    const payload = parentPostMessageSpy.mock.calls[0][0];
    expect(payload.data.mode).toBe("plan");
    expect(payload.data.requestMode).toBe("plan");
  });

  it("does not guess from ambiguous namespaced stored modes", () => {
    window.localStorage.setItem("agent-native-exec-mode:workspace-app", "plan");
    window.localStorage.setItem("agent-native-exec-mode:builder", "build");

    sendToAgentChat({
      message: "use the current explicit mode only",
      submit: true,
    });

    expect(parentPostMessageSpy).toHaveBeenCalledOnce();
    const payload = parentPostMessageSpy.mock.calls[0][0];
    expect(payload.data.mode).toBeUndefined();
    expect(payload.data.requestMode).toBeUndefined();
  });

  it("lets an explicit submitted mode override stored mode", () => {
    window.localStorage.setItem("agent-native-exec-mode", "build");

    sendToAgentChat({
      message: "plan this dashboard",
      mode: "plan",
      submit: true,
    });

    const payload = parentPostMessageSpy.mock.calls[0][0];
    expect(payload.data.mode).toBe("plan");
    expect(payload.data.requestMode).toBe("plan");
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
    window.localStorage.setItem("agent-native-exec-mode:builder", "plan");

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
      mode: "plan",
      requestMode: "plan",
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
    window.localStorage.setItem("agent-native-exec-mode:mcp-app", "plan");

    sendToAgentChat({
      message: "rewrite this",
      context: "Hidden draft context",
      submit: true,
    });

    expect(sendMcpAppHostMessageMock).toHaveBeenCalledWith({
      message: "rewrite this",
      context: "Hidden draft context",
      mode: "plan",
      requestMode: "plan",
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

  it("keeps legacy context helper names as aliases", () => {
    expect(setContextToAgentChat).toBe(setAgentChatContextItem);
    expect(addContextToAgentChat).toBe(setAgentChatContextItem);
  });

  it("normalizes composer references", () => {
    expect(
      normalizeAgentComposerReference({
        label: " Product shots ",
        icon: "folder",
        source: "assets",
        refType: " brand-kit ",
        refId: " lib_123 ",
        refPath: " /library/lib_123 ",
        slotKey: " brand-kit ",
        slotLabel: " Brand kit ",
        metadata: { libraryId: "lib_123" },
        clearsSlots: [" preset ", "", 123],
        relatedReferences: [
          {
            label: " Library preset ",
            refType: " preset ",
            refId: " preset_123 ",
            slotKey: " preset ",
          },
        ],
      }),
    ).toEqual({
      label: "Product shots",
      icon: "folder",
      source: "assets",
      refType: "brand-kit",
      refId: "lib_123",
      refPath: "/library/lib_123",
      slotKey: "brand-kit",
      slotLabel: "Brand kit",
      metadata: { libraryId: "lib_123" },
      clearsSlots: ["preset"],
      relatedReferences: [
        {
          label: "Library preset",
          refType: "preset",
          refId: "preset_123",
          refPath: null,
          slotKey: "preset",
        },
      ],
    });
    expect(
      normalizeAgentComposerReference({ label: "", refType: "preset" }),
    ).toBeNull();
  });

  it("posts composer references without submitting", () => {
    insertAgentComposerReference({
      label: "Product shots",
      icon: "folder",
      source: "assets",
      refType: "brand-kit",
      refId: "lib_123",
      refPath: "/library/lib_123",
    });

    expect(parentPostMessageSpy).toHaveBeenCalledOnce();
    const [payload, targetOrigin] = parentPostMessageSpy.mock.calls[0];
    expect(targetOrigin).toBe("http://localhost:3000");
    expect(payload.type).toBe("agentNative.insertComposerReference");
    expect(payload.data).toEqual(
      expect.objectContaining({
        label: "Product shots",
        icon: "folder",
        source: "assets",
        refType: "brand-kit",
        refId: "lib_123",
        refPath: "/library/lib_123",
      }),
    );
    expect(payload.data.insertMessageId).toMatch(/^reference-/);
    expect(dispatchEventSpy.mock.calls.map(([event]) => event.type)).toEqual([
      "agent-panel:prepare",
      "agentNative:insert-composer-reference",
    ]);
  });

  it("posts keyed context to the active chat without submitting", () => {
    setAgentChatContextItem({
      key: ".thing#hello",
      title: "Selected Element",
      context: "<div>Hello</div>",
    });

    expect(parentPostMessageSpy).toHaveBeenCalledOnce();
    const [payload, targetOrigin] = parentPostMessageSpy.mock.calls[0];
    expect(targetOrigin).toBe("http://localhost:3000");
    expect(payload).toEqual({
      type: "agentNative.setChatContext",
      data: {
        key: ".thing#hello",
        title: "Selected Element",
        context: "<div>Hello</div>",
      },
    });
    expect(listAgentChatContext()).toEqual([
      {
        key: ".thing#hello",
        title: "Selected Element",
        context: "<div>Hello</div>",
      },
    ]);
    expect(dispatchEventSpy.mock.calls.map(([event]) => event.type)).toEqual([
      "agentNative.chatContextChanged",
      "agent-panel:set-mode",
      "agent-panel:open",
    ]);
  });

  it("stages keyed context without opening the sidebar", () => {
    setAgentChatContextItem({
      key: "cart",
      title: "Cart",
      context: "Line item A",
      openSidebar: false,
    });

    expect(parentPostMessageSpy).toHaveBeenCalledOnce();
    expect(parentPostMessageSpy.mock.calls[0][0].type).toBe(
      "agentNative.setChatContext",
    );
    expect(dispatchEventSpy.mock.calls.map(([event]) => event.type)).toEqual([
      "agentNative.chatContextChanged",
      "agent-panel:prepare",
    ]);
  });

  it("removes a staged context item by key", () => {
    setAgentChatContextItem({
      key: "cart",
      title: "Cart",
      context: "Line item A",
      openSidebar: false,
    });
    parentPostMessageSpy.mockClear();
    dispatchEventSpy.mockClear();

    removeAgentChatContextItem("cart");

    expect(listAgentChatContext()).toEqual([]);
    expect(parentPostMessageSpy).toHaveBeenCalledOnce();
    expect(parentPostMessageSpy.mock.calls[0][0]).toEqual({
      type: "agentNative.removeChatContext",
      data: { key: "cart" },
    });
    expect(dispatchEventSpy.mock.calls.map(([event]) => event.type)).toEqual([
      "agentNative.chatContextChanged",
      "agent-panel:prepare",
    ]);
  });

  it("clears all staged context items", () => {
    setAgentChatContextItem({
      key: "cart",
      title: "Cart",
      context: "Line item A",
      openSidebar: false,
    });
    parentPostMessageSpy.mockClear();
    dispatchEventSpy.mockClear();

    clearAgentChatContext();

    expect(listAgentChatContext()).toEqual([]);
    expect(parentPostMessageSpy).toHaveBeenCalledOnce();
    expect(parentPostMessageSpy.mock.calls[0][0]).toEqual({
      type: "agentNative.clearChatContext",
      data: {},
    });
    expect(dispatchEventSpy.mock.calls.map(([event]) => event.type)).toEqual([
      "agentNative.chatContextChanged",
      "agent-panel:prepare",
    ]);
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

describe("formatAgentChatContextItemsForPrompt", () => {
  it("formats multiple context nuggets as titled hidden prompt sections", () => {
    expect(
      formatAgentChatContextItemsForPrompt([
        {
          key: "a",
          title: "Selected Element",
          context: "<button>Buy</button>",
        },
        { key: "b", title: "Cart", context: "2 items" },
      ]),
    ).toBe("## Selected Element\n<button>Buy</button>\n\n## Cart\n2 items");
  });
});
