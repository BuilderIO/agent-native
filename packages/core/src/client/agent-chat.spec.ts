import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const parentPostMessageSpy = vi.fn();
const selfPostMessageSpy = vi.fn();
const windowListeners = new Map<
  string,
  Set<EventListenerOrEventListenerObject>
>();
const addEventListenerSpy = vi.fn(
  (type: string, listener: EventListenerOrEventListenerObject) => {
    const listeners = windowListeners.get(type) ?? new Set();
    listeners.add(listener);
    windowListeners.set(type, listeners);
  },
);
const removeEventListenerSpy = vi.fn(
  (type: string, listener: EventListenerOrEventListenerObject) => {
    windowListeners.get(type)?.delete(listener);
  },
);
const dispatchEventSpy = vi.fn((event: Event) => {
  for (const listener of windowListeners.get(event.type) ?? []) {
    if (typeof listener === "function") listener(event);
    else listener.handleEvent(event);
  }
  return true;
});
const fetchSpy = vi.fn(() =>
  Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("") }),
);
const frameState = vi.hoisted(() => ({ inBuilderFrame: false }));
const sendToBuilderChatMock = vi.hoisted(() => vi.fn());
const sendMcpAppHostMessageMock = vi.hoisted(() => vi.fn(() => false));
const isOpenAiMcpAppHostMock = vi.hoisted(() => vi.fn(() => false));

vi.mock("./builder-frame.js", () => ({
  isInBuilderFrame: () => frameState.inBuilderFrame,
  isTrustedBuilderMessage: () => false,
  sendToBuilderChat: sendToBuilderChatMock,
}));

vi.mock("./mcp-app-host.js", () => ({
  isOpenAiMcpAppHost: isOpenAiMcpAppHostMock,
  sendMcpAppHostMessage: sendMcpAppHostMessageMock,
}));

const windowStub = {
  parent: { postMessage: parentPostMessageSpy },
  addEventListener: addEventListenerSpy,
  removeEventListener: removeEventListenerSpy,
  dispatchEvent: dispatchEventSpy,
  postMessage: selfPostMessageSpy,
  setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  location: {
    origin: "http://localhost:3000",
    hostname: "localhost",
    pathname: "/",
    search: "",
  },
};
vi.stubGlobal("window", windowStub);
vi.stubGlobal("fetch", fetchSpy);

const {
  _resetAgentChatContextForTests,
  _resetAgentChatSubmitBufferForTests,
  addContextToAgentChat,
  claimAgentChatSubmit,
  clearAgentChatContext,
  drainBufferedAgentChatSubmits,
  filterAgentChatContextItems,
  formatAgentChatContextItemsForPrompt,
  generateTabId,
  insertAgentComposerReference,
  listAgentChatContext,
  normalizeAgentComposerReference,
  parseSubmitChatMessage,
  removeAgentChatContextItem,
  reportAgentChatSubmitResult,
  sendToAgentChat,
  sendToAgentChatAndConfirm,
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
    windowListeners.clear();
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
    isOpenAiMcpAppHostMock.mockReturnValue(false);
    fetchSpy.mockClear();
    window.location.search = "";
    window.localStorage?.clear();
    window.sessionStorage?.clear();
    _resetEmbedAuthForTests();
    _resetAgentChatContextForTests();
    _resetAgentChatSubmitBufferForTests();
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

  it("carries usageLabel through the postMessage payload and back out", () => {
    sendToAgentChat({
      message: "enrich this record",
      usageLabel: "crm:enrich",
    });
    const payload = parentPostMessageSpy.mock.calls[0][0];
    expect(payload.data.usageLabel).toBe("crm:enrich");

    const parsed = parseSubmitChatMessage({
      data: payload,
    } as MessageEvent);
    expect(parsed?.usageLabel).toBe("crm:enrich");
  });

  it("carries an explicit existing chat target through the bridge", () => {
    sendToAgentChat({
      message: "Continue the original run",
      targetTabId: "generation-tab",
    });
    const payload = parentPostMessageSpy.mock.calls[0][0];
    const parsed = parseSubmitChatMessage({ data: payload } as MessageEvent);

    expect(payload.data.targetTabId).toBe("generation-tab");
    expect(parsed?.targetTabId).toBe("generation-tab");
  });

  it("carries a bounded action scope through the postMessage payload", () => {
    sendToAgentChat({
      message: "Draft a reply",
      actionScope: { kind: "content-comment-ai", requestId: "request-1" },
    });
    const payload = parentPostMessageSpy.mock.calls[0][0];
    const parsed = parseSubmitChatMessage({ data: payload } as MessageEvent);

    expect(parsed?.actionScope).toEqual({
      kind: "content-comment-ai",
      requestId: "request-1",
    });
  });

  it("carries a prefill context chip label through the postMessage payload", () => {
    sendToAgentChat({
      message: "Tell me more",
      context: '{"movieId":969681}',
      contextLabel: "Spider-Man: Brand New Day",
      submit: false,
    });
    const payload = parentPostMessageSpy.mock.calls[0][0];
    const parsed = parseSubmitChatMessage({ data: payload } as MessageEvent);

    expect(parsed?.contextLabel).toBe("Spider-Man: Brand New Day");
    expect(parsed?.context).toBe('{"movieId":969681}');
  });

  it("rejects malformed and oversized action scopes", () => {
    expect(() =>
      sendToAgentChat({
        message: "Draft a reply",
        actionScope: { value: Number.NaN },
      }),
    ).toThrow("actionScope must contain only JSON values");
    expect(() =>
      sendToAgentChat({
        message: "Draft a reply",
        actionScope: { value: "x".repeat(9_000) },
      }),
    ).toThrow("actionScope must be at most 8192 bytes");
    expect(
      parseSubmitChatMessage({
        data: {
          type: "agentNative.submitChat",
          data: { message: "Draft a reply", actionScope: [] },
        },
      } as MessageEvent),
    ).toBeNull();
  });

  it("drops a blank usageLabel instead of forwarding an empty label", () => {
    const parsed = parseSubmitChatMessage({
      data: {
        type: "agentNative.submitChat",
        data: { message: "hi", usageLabel: "   " },
      },
    } as MessageEvent);
    expect(parsed?.usageLabel).toBeUndefined();
  });

  it("carries approvedToolCalls through the postMessage payload and back out", () => {
    sendToAgentChat({
      message: "Approved.",
      approvedToolCalls: ["publish-release:{}"],
    });
    const payload = parentPostMessageSpy.mock.calls[0][0];
    expect(payload.data.approvedToolCalls).toEqual(["publish-release:{}"]);

    const parsed = parseSubmitChatMessage({ data: payload } as MessageEvent);
    expect(parsed?.approvedToolCalls).toEqual(["publish-release:{}"]);
  });

  it("keeps only non-empty string approval keys, capped, and verbatim", () => {
    const parse = (approvedToolCalls: unknown) =>
      parseSubmitChatMessage({
        data: {
          type: "agentNative.submitChat",
          data: { message: "Approved.", approvedToolCalls },
        },
      } as MessageEvent)?.approvedToolCalls;

    expect(parse(["a:{}", "", "   ", 7, null, { key: "b" }, " c:{} "])).toEqual(
      ["a:{}", " c:{} "],
    );
    expect(
      parse(Array.from({ length: 250 }, (_, index) => `k${index}`)),
    ).toHaveLength(200);
    expect(parse([])).toBeUndefined();
    expect(parse(["", 1])).toBeUndefined();
    expect(parse("a:{}")).toBeUndefined();
    expect(parse(undefined)).toBeUndefined();
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

  it("rehydrates hosted reference images into the submitted image sources", () => {
    const parsed = parseSubmitChatMessage({
      data: {
        type: "agentNative.submitChat",
        data: {
          message: "use these references",
          images: ["https://cdn.example.test/first.png"],
          referenceImagePaths: [
            "https://cdn.example.test/first.png",
            "https://cdn.example.test/second.png",
          ],
          uploadedReferenceImages: ["data:image/png;base64,abc"],
        },
      },
    } as MessageEvent);

    expect(parsed?.images).toEqual([
      "https://cdn.example.test/first.png",
      "https://cdn.example.test/second.png",
      "data:image/png;base64,abc",
    ]);
  });

  it("preserves the new-deck inline image and hosted reference payload", () => {
    const inlineImage = "data:image/png;base64,abc";
    const hostedImage = "https://cdn.example.test/source.png";
    const parsed = parseSubmitChatMessage({
      data: {
        type: "agentNative.submitChat",
        data: {
          message: "use this image as reference",
          images: [inlineImage],
          referenceImagePaths: [hostedImage],
        },
      },
    } as MessageEvent);

    expect(parsed?.images).toEqual([inlineImage, hostedImage]);
  });

  it("preserves lightweight attachment descriptors across the chat bridge", () => {
    const parsed = parseSubmitChatMessage({
      data: {
        type: "agentNative.submitChat",
        data: {
          message: "make a deck from this reference",
          attachments: [
            {
              type: "file",
              name: "reference.pdf",
              contentType: "application/pdf",
              displayOnly: true,
            },
            {
              type: "file",
              name: "pasted-text-1.txt",
              contentType: "text/plain",
              displayOnly: true,
              text: "outline",
            },
            {
              type: "file",
              name: "pasted-text-2.txt",
            },
          ],
        },
      },
    } as MessageEvent);

    expect(parsed?.attachments).toEqual([
      {
        type: "file",
        name: "reference.pdf",
        contentType: "application/pdf",
        displayOnly: true,
      },
      {
        type: "file",
        name: "pasted-text-1.txt",
        contentType: "text/plain",
        displayOnly: true,
        text: "outline",
      },
      {
        type: "file",
        name: "pasted-text-2.txt",
        displayOnly: true,
      },
    ]);
  });

  it("preserves display-only markers serialized under attachment metadata", () => {
    const parsed = parseSubmitChatMessage({
      data: {
        type: "agentNative.submitChat",
        data: {
          message: "make a deck from this reference",
          attachments: [
            {
              type: "file",
              name: "reference.pdf",
              contentType: "application/pdf",
              content: [],
              metadata: { displayOnly: true },
            },
          ],
        },
      },
    } as MessageEvent);

    expect(parsed?.attachments).toEqual([
      {
        type: "file",
        name: "reference.pdf",
        contentType: "application/pdf",
        displayOnly: true,
      },
    ]);
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

  it("keeps a Builder-frame code approval continuation in the embedded app", () => {
    vi.useFakeTimers();
    frameState.inBuilderFrame = true;

    const tabId = sendToAgentChat({
      message: "Approved.",
      submit: true,
      type: "code",
      approvedToolCalls: ["publish-release:{}"],
    });

    expect(sendToBuilderChatMock).not.toHaveBeenCalled();
    expect(parentPostMessageSpy).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();

    expect(selfPostMessageSpy).toHaveBeenCalledOnce();
    const [payload, targetOrigin] = selfPostMessageSpy.mock.calls[0];
    expect(targetOrigin).toBe("http://localhost:3000");
    expect(payload.type).toBe("agentNative.submitChat");
    expect(payload.data.tabId).toBe(tabId);
    expect(payload.data.approvedToolCalls).toEqual(["publish-release:{}"]);
    expect(
      parseSubmitChatMessage({ data: payload } as MessageEvent)
        ?.approvedToolCalls,
    ).toEqual(["publish-release:{}"]);
  });

  it("keeps code approval continuations on the code frame outside Builder", () => {
    sendToAgentChat({
      message: "Approved.",
      submit: true,
      type: "code",
      approvedToolCalls: ["publish-release:{}"],
    });

    expect(sendToBuilderChatMock).not.toHaveBeenCalled();
    expect(selfPostMessageSpy).not.toHaveBeenCalled();
    expect(parentPostMessageSpy).toHaveBeenCalledOnce();
    const [payload] = parentPostMessageSpy.mock.calls[0];
    expect(payload.data.approvedToolCalls).toEqual(["publish-release:{}"]);
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

  it("routes MCP App attachments to the local app chat", () => {
    vi.useFakeTimers();
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";
    const attachments = [
      {
        type: "file",
        name: "reference.pdf",
        contentType: "application/pdf",
        displayOnly: true,
      },
    ];

    const tabId = sendToAgentChat({
      message: "create from this reference",
      submit: true,
      attachments,
    });

    expect(sendMcpAppHostMessageMock).not.toHaveBeenCalled();
    expect(parentPostMessageSpy).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    expect(selfPostMessageSpy).toHaveBeenCalledOnce();
    const [payload, targetOrigin] = selfPostMessageSpy.mock.calls[0];
    expect(targetOrigin).toBe("http://localhost:3000");
    expect(payload.type).toBe("agentNative.submitChat");
    expect(payload.data.tabId).toBe(tabId);
    expect(payload.data.attachments).toEqual(attachments);
  });

  it.each([
    ["type", { type: "code" as const }],
    ["requiresCode", { requiresCode: true }],
  ])("keeps rich MCP App %s requests in the local app chat", (_kind, code) => {
    vi.useFakeTimers();
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";
    const attachments = [
      {
        type: "file",
        name: "reference.pdf",
        contentType: "application/pdf",
        displayOnly: true,
      },
    ];
    const images = ["data:image/png;base64,abc"];
    const referenceImagePaths = ["https://cdn.example.test/reference.png"];
    const uploadedReferenceImages = ["https://cdn.example.test/uploaded.png"];
    const actionScope = { kind: "record-enrichment", recordId: "record-1" };

    const tabId = sendToAgentChat({
      message: "update this record from the references",
      submit: true,
      ...code,
      attachments,
      images,
      referenceImagePaths,
      uploadedReferenceImages,
      usageLabel: "crm:enrich-record",
      actionScope,
    });

    expect(sendMcpAppHostMessageMock).not.toHaveBeenCalled();
    expect(parentPostMessageSpy).not.toHaveBeenCalled();
    expect(sendToBuilderChatMock).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    expect(selfPostMessageSpy).toHaveBeenCalledOnce();
    const [payload] = selfPostMessageSpy.mock.calls[0];
    expect(payload.data.tabId).toBe(tabId);
    expect(payload.data.attachments).toEqual(attachments);
    expect(payload.data.images).toEqual(images);
    expect(payload.data.referenceImagePaths).toEqual(referenceImagePaths);
    expect(payload.data.uploadedReferenceImages).toEqual(
      uploadedReferenceImages,
    );
    expect(payload.data.usageLabel).toBe("crm:enrich-record");
    expect(payload.data.actionScope).toEqual(actionScope);
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

    const tabId = sendToAgentChat({
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
        detail: { isRunning: false, tabId },
      }),
    );
  });

  it("does not relay a direct MCP App chat when host delivery is unknown", async () => {
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";
    sendMcpAppHostMessageMock.mockReturnValue(Promise.resolve(null));

    const tabId = sendToAgentChat({
      message: "continue with this selection",
      submit: true,
    });

    await flushMicrotasks();

    expect(parentPostMessageSpy).not.toHaveBeenCalled();
    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agentNative.chatRunning",
        detail: { isRunning: false, tabId },
      }),
    );
  });

  it("routes MCP App usage labels and action scopes to the local app chat", () => {
    vi.useFakeTimers();
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";

    const actionScope = { kind: "record-enrichment", recordId: "record-1" };
    const tabId = sendToAgentChat({
      message: "enrich this record",
      submit: true,
      usageLabel: "crm:enrich-record",
      actionScope,
    });

    expect(sendMcpAppHostMessageMock).not.toHaveBeenCalled();
    expect(parentPostMessageSpy).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    expect(selfPostMessageSpy).toHaveBeenCalledOnce();
    const [payload, targetOrigin] = selfPostMessageSpy.mock.calls[0];
    expect(targetOrigin).toBe("http://localhost:3000");
    expect(payload.data.tabId).toBe(tabId);
    expect(payload.data.usageLabel).toBe("crm:enrich-record");
    expect(payload.data.actionScope).toEqual(actionScope);
  });

  it.each([
    ["a chat", undefined],
    ["a code", "code" as const],
  ])(
    "keeps %s approval continuation in the app chat inside an MCP App embed",
    (_label, type) => {
      vi.useFakeTimers();
      window.location.search =
        "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";

      const tabId = sendToAgentChat({
        message: "Approved.",
        submit: true,
        type,
        approvedToolCalls: ["publish-release:{}"],
      });

      expect(sendMcpAppHostMessageMock).not.toHaveBeenCalled();
      expect(parentPostMessageSpy).not.toHaveBeenCalled();
      expect(sendToBuilderChatMock).not.toHaveBeenCalled();

      vi.runOnlyPendingTimers();

      expect(selfPostMessageSpy).toHaveBeenCalledOnce();
      const [payload, targetOrigin] = selfPostMessageSpy.mock.calls[0];
      expect(targetOrigin).toBe("http://localhost:3000");
      expect(payload.type).toBe("agentNative.submitChat");
      expect(payload.data.tabId).toBe(tabId);
      expect(
        parseSubmitChatMessage({ data: payload } as MessageEvent)
          ?.approvedToolCalls,
      ).toEqual(["publish-release:{}"]);
    },
  );

  it("still relays an MCP App send without approval keys to the host", () => {
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";

    sendToAgentChat({ message: "summarize this", submit: true });

    expect(sendMcpAppHostMessageMock).toHaveBeenCalledOnce();
    expect(selfPostMessageSpy).not.toHaveBeenCalled();
  });

  it("can force MCP App embeds to use the local app chat", () => {
    vi.useFakeTimers();
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";

    const tabId = sendToAgentChat({
      message: "apply plan feedback",
      context: "Open comments: 2",
      submit: true,
      chatTarget: "local",
    });

    expect(sendMcpAppHostMessageMock).not.toHaveBeenCalled();
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
    expect(payload.data.message).toBe("apply plan feedback");
    expect(payload.data.context).toBe("Open comments: 2");
    expect(payload.data.chatTarget).toBe("local");
  });

  it("routes an explicit local prompt to ChatGPT when its MCP App bridge is active", () => {
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";
    isOpenAiMcpAppHostMock.mockReturnValue(true);
    sendMcpAppHostMessageMock.mockReturnValue(Promise.resolve(true));

    sendToAgentChat({
      message: "Apply these visual changes",
      context: "Selected frame: hero",
      submit: true,
      chatTarget: "local",
    });

    expect(sendMcpAppHostMessageMock).toHaveBeenCalledWith({
      message: "Apply these visual changes",
      context: "Selected frame: hero",
    });
    expect(parentPostMessageSpy).not.toHaveBeenCalled();
    expect(selfPostMessageSpy).not.toHaveBeenCalled();
  });

  it("routes text-only branch prompts to the active ChatGPT chat", () => {
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";
    isOpenAiMcpAppHostMock.mockReturnValue(true);
    sendMcpAppHostMessageMock.mockReturnValue(Promise.resolve(true));

    sendToAgentChat({
      message: "Try a different hero direction",
      submit: true,
      chatTarget: "local",
      newTab: true,
    });

    expect(sendMcpAppHostMessageMock).toHaveBeenCalledWith({
      message: "Try a different hero direction",
    });
    expect(selfPostMessageSpy).not.toHaveBeenCalled();
  });

  it("keeps ChatGPT prompts that reuse an empty app tab in the embedded app", () => {
    vi.useFakeTimers();
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";
    isOpenAiMcpAppHostMock.mockReturnValue(true);

    sendToAgentChat({
      message: "Try a different hero direction",
      submit: true,
      chatTarget: "local",
      newTab: true,
      reuseEmptyTab: true,
    });
    vi.runOnlyPendingTimers();

    expect(sendMcpAppHostMessageMock).not.toHaveBeenCalled();
    expect(selfPostMessageSpy.mock.calls.at(-1)?.[0]?.data).toMatchObject({
      message: "Try a different hero direction",
      newTab: true,
      reuseEmptyTab: true,
    });
  });

  it("keeps code-targeted requests out of the ChatGPT follow-up route", () => {
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";
    isOpenAiMcpAppHostMock.mockReturnValue(true);

    sendToAgentChat({
      message: "Update the repository implementation",
      submit: true,
      chatTarget: "local",
      type: "code",
      newTab: true,
    });

    expect(sendMcpAppHostMessageMock).not.toHaveBeenCalled();
    expect(parentPostMessageSpy.mock.calls[0]?.[0]?.data).toMatchObject({
      message: "Update the repository implementation",
      type: "code",
      newTab: true,
    });
    expect(selfPostMessageSpy).not.toHaveBeenCalled();
  });

  it("keeps new-branch prompts in the app for other MCP hosts", () => {
    vi.useFakeTimers();
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";

    sendToAgentChat({
      message: "Try a different hero direction",
      submit: true,
      chatTarget: "local",
      newTab: true,
    });
    vi.runOnlyPendingTimers();

    expect(sendMcpAppHostMessageMock).not.toHaveBeenCalled();
    expect(selfPostMessageSpy.mock.calls.at(-1)?.[0]?.data).toMatchObject({
      message: "Try a different hero direction",
      newTab: true,
    });
  });

  it("sends inline images with local ChatGPT handoffs", () => {
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";
    isOpenAiMcpAppHostMock.mockReturnValue(true);
    sendMcpAppHostMessageMock.mockReturnValue(Promise.resolve(true));

    sendToAgentChat({
      message: "Review this screenshot",
      submit: true,
      chatTarget: "local",
      images: ["data:IMAGE/PNG;charset=binary;base64,AQID"],
    });

    expect(sendMcpAppHostMessageMock).toHaveBeenCalledWith({
      message: "Review this screenshot",
      content: [
        { type: "text", text: "Review this screenshot" },
        { type: "image", data: "AQID", mimeType: "image/png" },
      ],
    });
    expect(selfPostMessageSpy).not.toHaveBeenCalled();
  });

  it("omits display-only attachments from ChatGPT handoff content", () => {
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";
    isOpenAiMcpAppHostMock.mockReturnValue(true);
    sendMcpAppHostMessageMock.mockReturnValue(Promise.resolve(true));

    sendToAgentChat({
      message: "Review the attached references",
      submit: true,
      chatTarget: "local",
      attachments: [
        {
          type: "text",
          name: "preview.txt",
          text: "Visible in the app only",
          displayOnly: true,
        },
        {
          type: "text",
          name: "requirements.txt",
          text: "Keep the header compact",
        },
        {
          type: "file",
          name: "reference.pdf",
          displayOnly: true,
        },
      ],
    });

    expect(sendMcpAppHostMessageMock).toHaveBeenCalledWith({
      message: "Review the attached references",
      content: [
        {
          type: "text",
          text: "Review the attached references",
        },
        {
          type: "text",
          text: "Attachment: requirements.txt\nKeep the header compact",
        },
      ],
    });
    expect(parentPostMessageSpy).not.toHaveBeenCalled();
    expect(selfPostMessageSpy).not.toHaveBeenCalled();
  });

  it("routes ChatGPT handoffs with only display-only attachments without content", () => {
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";
    isOpenAiMcpAppHostMock.mockReturnValue(true);
    sendMcpAppHostMessageMock.mockReturnValue(Promise.resolve(true));

    sendToAgentChat({
      message: "Summarize the selected page",
      submit: true,
      chatTarget: "local",
      attachments: [
        {
          type: "file",
          name: "page-preview.pdf",
          displayOnly: true,
        },
      ],
    });

    expect(sendMcpAppHostMessageMock).toHaveBeenCalledWith({
      message: "Summarize the selected page",
    });
    expect(parentPostMessageSpy).not.toHaveBeenCalled();
    expect(selfPostMessageSpy).not.toHaveBeenCalled();
  });

  it("keeps image attachments without inline data in the app chat", () => {
    vi.useFakeTimers();
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";
    isOpenAiMcpAppHostMock.mockReturnValue(true);

    sendToAgentChat({
      message: "Review the attached screenshot",
      submit: true,
      chatTarget: "local",
      attachments: [
        {
          type: "image",
          name: "screen.png",
          url: "https://cdn.builder.io/screen.png",
          contentType: "image/png",
        },
      ],
    });

    expect(sendMcpAppHostMessageMock).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    expect(selfPostMessageSpy).toHaveBeenCalledOnce();
  });

  it("confirms an explicit local ChatGPT handoff through the MCP App bridge", async () => {
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";
    isOpenAiMcpAppHostMock.mockReturnValue(true);
    sendMcpAppHostMessageMock.mockReturnValue(Promise.resolve(true));

    const result = await sendToAgentChatAndConfirm({
      message: "Review these comments",
      context: "Two unresolved comments",
      submit: true,
      chatTarget: "local",
    });

    expect(result).toMatchObject({ delivered: true });
    expect(sendMcpAppHostMessageMock).toHaveBeenCalledWith({
      message: "Review these comments",
      context: "Two unresolved comments",
    });
    expect(selfPostMessageSpy).not.toHaveBeenCalled();
  });

  it("falls back to a confirmed wrapper relay when ChatGPT rejects the handoff", async () => {
    vi.useFakeTimers();
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";
    isOpenAiMcpAppHostMock.mockReturnValue(true);
    sendMcpAppHostMessageMock.mockReturnValue(Promise.resolve(false));

    const resultPromise = sendToAgentChatAndConfirm({
      message: "Apply these review comments",
      context: "Two unresolved comments",
      submit: true,
      chatTarget: "local",
    });
    await flushMicrotasks();
    const [payload, targetOrigin] =
      parentPostMessageSpy.mock.calls.at(-1) ?? [];
    const submitMessageId = payload?.data?.submitMessageId as string;
    reportAgentChatSubmitResult(submitMessageId, true);

    await expect(resultPromise).resolves.toMatchObject({ delivered: true });
    expect(sendMcpAppHostMessageMock).toHaveBeenCalledOnce();
    expect(targetOrigin).toBe("*");
    expect(payload?.data).toMatchObject({
      message: "Apply these review comments",
      context: "Two unresolved comments",
    });
    expect(parentPostMessageSpy).toHaveBeenCalledOnce();
    expect(selfPostMessageSpy).not.toHaveBeenCalled();
  });

  it("confirms a new-branch prompt in ChatGPT without requiring local correlation", async () => {
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";
    isOpenAiMcpAppHostMock.mockReturnValue(true);
    sendMcpAppHostMessageMock.mockReturnValue(Promise.resolve(true));

    const result = await sendToAgentChatAndConfirm(
      {
        message: "Try the alternate layout",
        submit: true,
        chatTarget: "local",
        newTab: true,
      },
      { submitMessageId: "local-correlation-id" },
    );

    expect(result).toMatchObject({ delivered: true });
    expect(sendMcpAppHostMessageMock).toHaveBeenCalledWith({
      message: "Try the alternate layout",
    });
    expect(selfPostMessageSpy).not.toHaveBeenCalled();
  });

  it("keeps background ChatGPT work in the embedded app", () => {
    vi.useFakeTimers();
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";
    isOpenAiMcpAppHostMock.mockReturnValue(true);

    sendToAgentChat({
      message: "Generate a title",
      submit: true,
      background: true,
      chatTarget: "local",
    });

    expect(sendMcpAppHostMessageMock).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    expect(selfPostMessageSpy).toHaveBeenCalledOnce();
  });

  it("keeps ChatGPT local submits with app-scoped routing metadata in the app", () => {
    vi.useFakeTimers();
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";
    isOpenAiMcpAppHostMock.mockReturnValue(true);

    sendToAgentChat({
      message: "Continue the app workflow",
      submit: true,
      chatTarget: "local",
      projectSlug: "prototype-project",
      tabId: "clips-workflow:recording-1:request-1",
      submitMessageId: "workflow-submit-1",
    });
    vi.runOnlyPendingTimers();

    expect(sendMcpAppHostMessageMock).not.toHaveBeenCalled();
    expect(selfPostMessageSpy.mock.calls.at(-1)?.[0]?.data).toMatchObject({
      projectSlug: "prototype-project",
      tabId: "clips-workflow:recording-1:request-1",
      submitMessageId: "workflow-submit-1",
    });
  });

  it("routes ChatGPT confirmation submits with an explicit correlation id to the host", async () => {
    window.location.search =
      "?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1";
    isOpenAiMcpAppHostMock.mockReturnValue(true);
    sendMcpAppHostMessageMock.mockReturnValue(Promise.resolve(true));

    const result = await sendToAgentChatAndConfirm(
      {
        message: "Generate the current deck",
        submit: true,
        chatTarget: "local",
      },
      { submitMessageId: "slides-submit-1" },
    );

    expect(result).toMatchObject({ delivered: true });
    expect(sendMcpAppHostMessageMock).toHaveBeenCalledWith({
      message: "Generate the current deck",
    });
    expect(selfPostMessageSpy).not.toHaveBeenCalled();
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
        detail: { isRunning: false, tabId },
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

  it("keeps a direct MCP App embed code approval continuation in the app chat", () => {
    vi.useFakeTimers();
    window.location.search = "?embedded=1&__an_embed_token=signed-token";

    const tabId = sendToAgentChat({
      message: "Approved.",
      submit: true,
      type: "code",
      approvedToolCalls: ["publish-release:{}"],
    });

    expect(parentPostMessageSpy).not.toHaveBeenCalled();
    expect(sendMcpAppHostMessageMock).not.toHaveBeenCalled();
    expect(sendToBuilderChatMock).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();

    expect(selfPostMessageSpy).toHaveBeenCalledOnce();
    const [payload, targetOrigin] = selfPostMessageSpy.mock.calls[0];
    expect(targetOrigin).toBe("http://localhost:3000");
    expect(payload.data.tabId).toBe(tabId);
    expect(
      parseSubmitChatMessage({ data: payload } as MessageEvent)
        ?.approvedToolCalls,
    ).toEqual(["publish-release:{}"]);
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

  it("parses a context-only prefill and rejects an empty submitted message", () => {
    sendToAgentChat({
      message: "",
      context: '{"movieId":969681}',
      contextLabel: "Spider-Man: Brand New Day",
      submit: false,
    });
    const prefill = parentPostMessageSpy.mock.calls[0][0];
    expect(
      parseSubmitChatMessage({ data: prefill } as MessageEvent, {
        allowContextOnlyPrefill: true,
      }),
    ).toMatchObject({
      message: "",
      contextLabel: "Spider-Man: Brand New Day",
      submit: false,
    });
    expect(
      parseSubmitChatMessage({ data: prefill } as MessageEvent),
    ).toBeNull();

    parentPostMessageSpy.mockClear();
    sendToAgentChat({ message: "", context: "Hidden context" });
    const submitted = parentPostMessageSpy.mock.calls[0][0];
    expect(
      parseSubmitChatMessage({ data: submitted } as MessageEvent),
    ).toBeNull();
  });

  it("generates distinct tabIds across calls", () => {
    const id1 = sendToAgentChat({ message: "a" });
    const id2 = sendToAgentChat({ message: "b" });
    expect(id1).not.toBe(id2);
  });

  it("confirms a local submit after the receiving chat accepts it", async () => {
    vi.useFakeTimers();
    const resultPromise = sendToAgentChatAndConfirm({
      message: "apply these annotations",
      submit: true,
      chatTarget: "local",
    });

    vi.advanceTimersByTime(0);
    const payload = selfPostMessageSpy.mock.calls.at(-1)?.[0];
    expect(payload?.data?.submitMessageId).toEqual(expect.any(String));
    reportAgentChatSubmitResult(payload.data.submitMessageId, true);

    await expect(resultPromise).resolves.toMatchObject({ delivered: true });
  });

  it("confirms a local submit with a caller-provided correlation id", async () => {
    vi.useFakeTimers();
    const resultPromise = sendToAgentChatAndConfirm(
      {
        message: "continue the existing run",
        submit: true,
        chatTarget: "local",
      },
      { submitMessageId: "continuation-submit" },
    );

    vi.advanceTimersByTime(0);
    expect(
      selfPostMessageSpy.mock.calls.at(-1)?.[0]?.data?.submitMessageId,
    ).toBe("continuation-submit");
    reportAgentChatSubmitResult("continuation-submit", true);

    await expect(resultPromise).resolves.toMatchObject({ delivered: true });
  });

  it("preserves an explicit local rejection reason", async () => {
    vi.useFakeTimers();
    const resultPromise = sendToAgentChatAndConfirm({
      message: "apply these annotations",
      submit: true,
      chatTarget: "local",
    });
    vi.advanceTimersByTime(0);
    const submitMessageId = selfPostMessageSpy.mock.calls.at(-1)?.[0]?.data
      ?.submitMessageId as string;
    reportAgentChatSubmitResult(submitMessageId, false, "missing-engine");

    await expect(resultPromise).resolves.toMatchObject({
      delivered: false,
      reason: "missing-engine",
    });
  });

  it("confirms a Builder-frame code approval continuation kept in the app chat", async () => {
    vi.useFakeTimers();
    frameState.inBuilderFrame = true;
    const resultPromise = sendToAgentChatAndConfirm({
      message: "Approved.",
      submit: true,
      chatTarget: "local",
      type: "code",
      approvedToolCalls: ["publish-release:{}"],
    });

    vi.advanceTimersByTime(0);
    expect(sendToBuilderChatMock).not.toHaveBeenCalled();
    const payload = selfPostMessageSpy.mock.calls.at(-1)?.[0];
    expect(payload?.data?.approvedToolCalls).toEqual(["publish-release:{}"]);
    reportAgentChatSubmitResult(payload.data.submitMessageId, true);

    await expect(resultPromise).resolves.toMatchObject({ delivered: true });
  });

  it("still rejects confirmation for a code request bound for Builder", async () => {
    frameState.inBuilderFrame = true;
    const result = await sendToAgentChatAndConfirm({
      message: "change this app",
      submit: true,
      chatTarget: "local",
      type: "code",
    });

    expect(result).toMatchObject({
      delivered: false,
      reason: "unsupported-target",
    });
    expect(sendToBuilderChatMock).not.toHaveBeenCalled();
    expect(selfPostMessageSpy).not.toHaveBeenCalled();
  });

  it("rejects non-local confirmation targets without sending", async () => {
    const result = await sendToAgentChatAndConfirm({
      message: "route to a parent chat",
      submit: true,
    });

    expect(result).toMatchObject({
      delivered: false,
      reason: "unsupported-target",
    });
    expect(parentPostMessageSpy).not.toHaveBeenCalled();
    expect(selfPostMessageSpy).not.toHaveBeenCalled();
  });

  it("short-circuits safely without window", async () => {
    vi.stubGlobal("window", undefined);
    const result = await sendToAgentChatAndConfirm({
      message: "server render",
      submit: true,
      chatTarget: "local",
    });
    vi.stubGlobal("window", windowStub);

    expect(result).toMatchObject({
      delivered: false,
      reason: "no-window",
    });
    expect(parentPostMessageSpy).not.toHaveBeenCalled();
    expect(selfPostMessageSpy).not.toHaveBeenCalled();
  });

  it("tombstones a timed-out submit so a late receiver cannot claim it", async () => {
    vi.useFakeTimers();
    const resultPromise = sendToAgentChatAndConfirm(
      {
        message: "do not arrive late",
        submit: true,
        chatTarget: "local",
      },
      { timeoutMs: 5 },
    );
    vi.advanceTimersByTime(0);
    const submitMessageId = selfPostMessageSpy.mock.calls.at(-1)?.[0]?.data
      ?.submitMessageId as string;

    vi.advanceTimersByTime(5);
    await expect(resultPromise).resolves.toMatchObject({
      delivered: false,
      reason: "timeout",
    });
    expect(drainBufferedAgentChatSubmits()).toEqual([]);
    expect(claimAgentChatSubmit(submitMessageId)).toBe(false);
  });

  it("keeps the default confirmation alive beyond the replay buffer TTL", async () => {
    vi.useFakeTimers();
    let settled = false;
    const resultPromise = sendToAgentChatAndConfirm({
      message: "wait for the lazy panel",
      submit: true,
      chatTarget: "local",
    }).then((result) => {
      settled = true;
      return result;
    });
    vi.advanceTimersByTime(8001);
    await flushMicrotasks();
    expect(settled).toBe(false);

    const submitMessageId = selfPostMessageSpy.mock.calls.at(-1)?.[0]?.data
      ?.submitMessageId as string;
    reportAgentChatSubmitResult(submitMessageId, true);
    await expect(resultPromise).resolves.toMatchObject({ delivered: true });
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
        media: {
          type: "text",
          text: " 📷 ",
          backgroundColor: " #0f766e ",
        },
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
      media: {
        type: "text",
        text: "📷",
        backgroundColor: "#0f766e",
      },
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
    expect(
      normalizeAgentComposerReference({
        label: "No icon",
        refType: "agent",
        media: { type: "none" },
      }),
    ).toMatchObject({ media: { type: "none" } });
    expect(
      normalizeAgentComposerReference({
        label: "Invalid media",
        refType: "agent",
        media: { type: "text", text: "" },
      }),
    ).not.toHaveProperty("media");
    expect(
      normalizeAgentComposerReference({
        label: "Logo",
        refType: "agent",
        media: {
          type: "image",
          src: " /agents/logo.png ",
          fit: "cover",
        },
      }),
    ).toMatchObject({
      media: { type: "image", src: "/agents/logo.png", fit: "cover" },
    });
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
    expect(parentPostMessageSpy.mock.calls[0][0]).toEqual({
      type: "agentNative.setChatContext",
      data: {
        key: "cart",
        title: "Cart",
        context: "Line item A",
        openSidebar: false,
      },
    });
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

  it("sends hidden context without a heading", () => {
    expect(
      formatAgentChatContextItemsForPrompt([
        { key: "a", title: "a", context: "Selected rows: a, b", hidden: true },
      ]),
    ).toBe("Selected rows: a, b");
  });
});

describe("filterAgentChatContextItems", () => {
  it("keeps unscoped context and only the active surface namespace", () => {
    const items = [
      { key: "selection", title: "Selection", context: "A row" },
      {
        key: "desktop-app:mail",
        title: "Mail",
        context: "Mail context",
        contextNamespace: "desktop-app:mail",
      },
      {
        key: "desktop-app:calendar",
        title: "Calendar",
        context: "Calendar context",
        contextNamespace: "desktop-app:calendar",
      },
    ];

    expect(filterAgentChatContextItems(items, "desktop-app:calendar")).toEqual([
      items[0],
      items[2],
    ]);
  });
});
