import type { BrowserContextV1 } from "@agent-native/core/browser-context";

import type { BrowserPageSessionV1 } from "./page-session";

export const BROWSER_CONTEXT_MESSAGE_TYPE = "browser-context.v1" as const;
export const BROWSER_CHAT_READY_MESSAGE_TYPE = "browser-chat.ready.v1" as const;
export const BROWSER_CHAT_RESULT_MESSAGE_TYPE =
  "browser-chat.result.v1" as const;

export type BrowserChatContextMessage =
  | {
      type: typeof BROWSER_CONTEXT_MESSAGE_TYPE;
      nonce: string;
      intent: "stage";
      context: BrowserContextV1;
      browserSession: BrowserPageSessionV1;
    }
  | {
      type: typeof BROWSER_CONTEXT_MESSAGE_TYPE;
      nonce: string;
      intent: "submit";
      prompt: string;
      context: BrowserContextV1;
      browserSession: BrowserPageSessionV1;
    };

export type BrowserChatInboundMessage =
  | {
      type: typeof BROWSER_CHAT_READY_MESSAGE_TYPE;
      nonce: string;
    }
  | {
      type: typeof BROWSER_CHAT_RESULT_MESSAGE_TYPE;
      nonce: string;
      intent: "stage" | "submit";
      captureId: string;
      ok: boolean;
    };

export interface BrowserChatBinding {
  nonce: string;
  dispatchOrigin: string;
  frameWindow: WindowProxy;
}

export function createStageMessage(
  nonce: string,
  context: BrowserContextV1,
  browserSession: BrowserPageSessionV1,
): BrowserChatContextMessage {
  return {
    type: BROWSER_CONTEXT_MESSAGE_TYPE,
    nonce,
    intent: "stage",
    context,
    browserSession,
  };
}

export function createSubmitMessage(
  nonce: string,
  prompt: string,
  context: BrowserContextV1,
  browserSession: BrowserPageSessionV1,
): BrowserChatContextMessage {
  if (!prompt.trim() || prompt.length > 12_000) {
    throw new Error("Browser chat prompt is invalid.");
  }
  return {
    type: BROWSER_CONTEXT_MESSAGE_TYPE,
    nonce,
    intent: "submit",
    prompt: prompt.trim(),
    context,
    browserSession,
  };
}

export function parseBrowserChatEvent(
  event: Pick<MessageEvent, "data" | "origin" | "source">,
  binding: BrowserChatBinding,
): BrowserChatInboundMessage | null {
  if (
    event.source !== binding.frameWindow ||
    event.origin !== binding.dispatchOrigin ||
    !isRecord(event.data)
  ) {
    return null;
  }
  const data = event.data;
  if (
    data.type === BROWSER_CHAT_READY_MESSAGE_TYPE &&
    Object.keys(data).length === 2 &&
    data.nonce === binding.nonce
  ) {
    return {
      type: BROWSER_CHAT_READY_MESSAGE_TYPE,
      nonce: binding.nonce,
    };
  }
  if (
    data.type !== BROWSER_CHAT_RESULT_MESSAGE_TYPE ||
    Object.keys(data).length !== 5 ||
    data.nonce !== binding.nonce ||
    (data.intent !== "stage" && data.intent !== "submit") ||
    typeof data.captureId !== "string" ||
    !data.captureId ||
    data.captureId.length > 256 ||
    typeof data.ok !== "boolean"
  ) {
    return null;
  }
  return {
    type: BROWSER_CHAT_RESULT_MESSAGE_TYPE,
    nonce: binding.nonce,
    intent: data.intent,
    captureId: data.captureId,
    ok: data.ok,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
