import {
  sendToAgentChat,
  sendToAgentChatAndConfirm,
  type AgentChatMessage,
  type SendToAgentChatAndConfirmResult,
} from "@agent-native/core/client";

export const DESIGN_CHAT_STORAGE_KEY = "design";

export function sendToDesignAgentChat(opts: AgentChatMessage): string {
  return sendToAgentChat({
    ...opts,
    chatTarget: "local",
  });
}

/**
 * Ack-confirmed variant of `sendToDesignAgentChat`. Resolves once the
 * message either became a visible chat turn (`delivered: true`) or was
 * definitively rejected/timed out (`delivered: false`) — use this wherever
 * the caller owns state (draw overlay strokes, queued comment pins) that
 * must not be discarded on a silent drop. See the `design-canvas/
 * annotation-submit.ts` docblock for the contract this backs.
 */
export function sendToDesignAgentChatAndConfirm(
  opts: AgentChatMessage,
  options?: { timeoutMs?: number },
): Promise<SendToAgentChatAndConfirmResult> {
  return sendToAgentChatAndConfirm(
    {
      ...opts,
      chatTarget: "local",
    },
    options,
  );
}
