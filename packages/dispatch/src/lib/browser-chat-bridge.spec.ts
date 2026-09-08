// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installBrowserChatBridge } from "./browser-chat-bridge.js";

const chat = vi.hoisted(() => ({
  send: vi.fn(),
  setContext: vi.fn(),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: chat.send,
  setAgentChatContextItem: chat.setContext,
}));

const nonce = "browser-chat-nonce-1234567890";
const parentOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const browserSession = {
  version: 1,
  handle: "bsn_00000000-0000-4000-8000-000000000000",
  origin: "https://example.com",
  title: "Example profile",
};

function context() {
  return {
    schema: "browser-context.v1",
    captureId: "capture-example",
    capturedAt: "2026-07-29T18:00:00.000Z",
    page: {
      url: "https://example.com/profile",
      origin: "https://example.com",
      title: "Example profile",
    },
    outcome: {
      state: "complete",
      projections: [
        {
          type: "readable",
          status: { state: "complete" },
          text: "Example Person",
        },
      ],
    },
  };
}

describe("browser chat postMessage bridge", () => {
  const originalParent = Object.getOwnPropertyDescriptor(window, "parent");
  const parentWindow = { postMessage: vi.fn() };

  beforeEach(() => {
    chat.send.mockReset();
    chat.setContext.mockReset();
    parentWindow.postMessage.mockReset();
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: parentWindow,
    });
  });

  afterEach(() => {
    if (originalParent) Object.defineProperty(window, "parent", originalParent);
  });

  it("requires the exact parent source, extension origin, and nonce", () => {
    const dispose = installBrowserChatBridge({ nonce, parentOrigin });

    window.dispatchEvent(
      new MessageEvent("message", {
        source: parentWindow as unknown as MessageEventSource,
        origin: "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba",
        data: {
          type: "browser-context.v1",
          nonce,
          intent: "stage",
          context: context(),
          browserSession,
        },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        source: parentWindow as unknown as MessageEventSource,
        origin: parentOrigin,
        data: {
          type: "browser-context.v1",
          nonce: "browser-chat-nonce-wrong-123456",
          intent: "stage",
          context: context(),
          browserSession,
        },
      }),
    );

    expect(chat.setContext).not.toHaveBeenCalled();
    expect(parentWindow.postMessage).toHaveBeenCalledWith(
      { type: "browser-chat.ready.v1", nonce },
      parentOrigin,
    );
    dispose();
  });

  it("stages hidden context, then submits a generic prompt locally", () => {
    const dispose = installBrowserChatBridge({ nonce, parentOrigin });

    window.dispatchEvent(
      new MessageEvent("message", {
        source: parentWindow as unknown as MessageEventSource,
        origin: parentOrigin,
        data: {
          type: "browser-context.v1",
          nonce,
          intent: "submit",
          prompt: "Help me work with this page",
          context: context(),
          browserSession,
        },
      }),
    );

    expect(chat.setContext).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "browser-current-page",
        title: "example.com",
        focus: false,
        openSidebar: false,
      }),
    );
    expect(chat.setContext.mock.calls[0]![0].context).toContain(
      browserSession.handle,
    );
    expect(chat.send).toHaveBeenCalledWith({
      message: "Help me work with this page",
      submit: true,
      chatTarget: "local",
      openSidebar: false,
    });
    expect(parentWindow.postMessage).toHaveBeenLastCalledWith(
      {
        type: "browser-chat.result.v1",
        nonce,
        intent: "submit",
        captureId: "capture-example",
        ok: true,
      },
      parentOrigin,
    );
    dispose();
  });
});
