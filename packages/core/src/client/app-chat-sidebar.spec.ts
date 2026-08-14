import { describe, expect, it } from "vitest";

import {
  APP_CHAT_SIDEBAR_STATE_MESSAGE,
  APP_CHAT_SIDEBAR_STATE_REQUEST_MESSAGE,
  buildAppChatSidebarStateMessage,
  buildAppChatSidebarStateRequest,
  isPerAppChatStorageKey,
} from "./app-chat-sidebar.js";

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
      data: { open: true },
    });
    expect(buildAppChatSidebarStateRequest()).toEqual({
      type: APP_CHAT_SIDEBAR_STATE_REQUEST_MESSAGE,
    });
  });
});
