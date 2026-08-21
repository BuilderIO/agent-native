// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  APP_CHAT_SIDEBAR_STATE_MESSAGE,
  APP_CHAT_SIDEBAR_STATE_REQUEST_MESSAGE,
  buildAppChatSidebarStateMessage,
  buildAppChatSidebarStateRequest,
  isPerAppChatStorageKey,
  requestPerAppChatCommand,
} from "./app-chat-sidebar.js";

afterEach(() => {
  delete (window as Window & { agentNativeDesktop?: unknown })
    .agentNativeDesktop;
});

describe("per-app chat sidebar bridge", () => {
  it("only treats the Electron and Dispatch host keys as per-app chat", () => {
    expect(isPerAppChatStorageKey("desktop-app-chat")).toBe(true);
    expect(isPerAppChatStorageKey("dispatch-app-chat")).toBe(true);
    expect(isPerAppChatStorageKey("mail")).toBe(false);
    expect(isPerAppChatStorageKey(undefined)).toBe(false);
  });

  it("builds the host state message and iframe mount request", () => {
    expect(buildAppChatSidebarStateMessage(true)).toEqual({
      type: APP_CHAT_SIDEBAR_STATE_MESSAGE,
      data: { open: true, hosted: true },
    });
    expect(buildAppChatSidebarStateRequest()).toEqual({
      type: APP_CHAT_SIDEBAR_STATE_REQUEST_MESSAGE,
    });
  });

  it("routes app chat commands to the Electron host bridge", () => {
    const toggle = vi.fn();
    Object.defineProperty(window, "agentNativeDesktop", {
      configurable: true,
      value: { chat: { toggle } },
    });

    expect(requestPerAppChatCommand("toggle")).toBe(true);
    expect(toggle).toHaveBeenCalledOnce();
  });
});
