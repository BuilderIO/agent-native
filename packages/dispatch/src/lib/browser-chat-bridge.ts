import {
  sendToAgentChat,
  setAgentChatContextItem,
} from "@agent-native/core/client/agent-chat";

import {
  BROWSER_CHAT_READY_MESSAGE_TYPE,
  BROWSER_CHAT_RESULT_MESSAGE_TYPE,
  formatBrowserChatContext,
  parseBrowserChatMessageV1,
  type BrowserChatMessageV1,
} from "./browser-chat-protocol.js";

export interface BrowserChatBridgeOptions {
  nonce: string;
  parentOrigin: string;
  onAccepted?: (message: BrowserChatMessageV1) => void;
}

function handleBrowserChatMessage(message: BrowserChatMessageV1): void {
  setAgentChatContextItem({
    key: "browser-current-page",
    title: new URL(message.context.page.url).hostname,
    context: formatBrowserChatContext(message.context, message.browserSession),
    focus: false,
    openSidebar: false,
  });

  if (message.intent === "submit") {
    sendToAgentChat({
      message: message.prompt,
      submit: true,
      chatTarget: "local",
      openSidebar: false,
    });
  }
}

export function installBrowserChatBridge(
  options: BrowserChatBridgeOptions,
): () => void {
  if (window.parent === window) return () => {};

  const handleMessage = (event: MessageEvent) => {
    if (
      event.source !== window.parent ||
      event.origin !== options.parentOrigin
    ) {
      return;
    }

    const message = parseBrowserChatMessageV1(event.data, options.nonce);
    if (!message) return;

    handleBrowserChatMessage(message);
    options.onAccepted?.(message);
    window.parent.postMessage(
      {
        type: BROWSER_CHAT_RESULT_MESSAGE_TYPE,
        nonce: options.nonce,
        intent: message.intent,
        captureId: message.context.captureId,
        ok: true,
      },
      options.parentOrigin,
    );
  };

  window.addEventListener("message", handleMessage);
  window.parent.postMessage(
    {
      type: BROWSER_CHAT_READY_MESSAGE_TYPE,
      nonce: options.nonce,
    },
    options.parentOrigin,
  );

  return () => window.removeEventListener("message", handleMessage);
}
