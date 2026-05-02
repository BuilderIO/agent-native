/**
 * Agent Chat Bridge (browser)
 *
 * Sends structured messages to the agent chat from UI interactions.
 * Messages are sent via postMessage to the parent window (or self if top-level).
 */

import { getFrameOrigin, isTrustedFrameMessage } from "./frame.js";
import {
  isInBuilderFrame,
  isTrustedBuilderMessage,
  sendToBuilderChat,
} from "./builder-frame.js";

export interface AgentChatMessage {
  /** The visible prompt message sent to the chat */
  message: string;
  /** Hidden context appended to the message (not shown in chat UI) */
  context?: string;
  /** true = auto-submit, false = prefill only, omit = use project setting */
  submit?: boolean;
  /** Optional project slug for structured context */
  projectSlug?: string;
  /** Optional preset name for downstream consumers */
  preset?: string;
  /** Optional reference image paths */
  referenceImagePaths?: string[];
  /** Optional uploaded reference images */
  uploadedReferenceImages?: string[];
  /** Stable tab identifier — auto-generated if omitted */
  tabId?: string;
  /**
   * Message routing type:
   * - "content" (default): stays in the embedded app agent for content/data operations
   * - "code": routes to the code editing frame (local dev frame or Builder.io)
   *
   * When type is "code" and no frame is connected, a dialog is shown.
   * `requiresCode: true` is treated as `type: "code"` for backward compatibility.
   */
  type?: "content" | "code";
  /** @deprecated Use `type: "code"` instead. If true, treated as `type: "code"`. */
  requiresCode?: boolean;
  /** Model preference for this sub-agent (e.g. "claude-haiku-4-5"). Uses default if omitted */
  model?: string;
  /** Scoped system prompt additions for this sub-agent */
  instructions?: string;
  /**
   * Whether to open the agent sidebar if it's currently hidden.
   * Defaults to true — submitting a chat should make the response visible.
   * Pass `false` for background/silent sends that shouldn't pop the UI open.
   */
  openSidebar?: boolean;
  /**
   * When true, opens a new chat tab before sending the message.
   * Use for creation requests (create tool, dashboard, etc.) that deserve
   * their own isolated thread rather than cluttering an existing conversation.
   */
  newTab?: boolean;
  /**
   * When true with newTab, creates the tab in the background without
   * focusing it or opening the sidebar. The message runs silently.
   */
  background?: boolean;
}

const AGENT_CHAT_MESSAGE_TYPE = "agentNative.submitChat";

/**
 * Listen for chatRunning messages from the frame (postMessage)
 * and re-dispatch as a CustomEvent so hooks like useAgentChatGenerating() work.
 */
if (typeof window !== "undefined") {
  window.addEventListener("message", (event) => {
    if (!isTrustedFrameMessage(event) && !isTrustedBuilderMessage(event)) {
      return;
    }
    if (
      event.data?.type === "agentNative.chatRunning" ||
      event.data?.type === "builder.chatRunning"
    ) {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: event.data.detail ?? event.data.data,
        }),
      );
    }
  });
}

/** Generate a unique tab ID */
export function generateTabId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Send a message to the agent chat via postMessage.
 */
/**
 * Send a message to the agent chat via postMessage.
 * Returns the stable tabId for tracking this chat run.
 */
export function sendToAgentChat(opts: AgentChatMessage): string {
  const tabId = opts.tabId ?? generateTabId();
  const isCodeRequest = opts.type === "code" || opts.requiresCode === true;
  if (isCodeRequest && isInBuilderFrame()) {
    sendToBuilderChat({
      message: opts.message,
      context: opts.context,
      submit: opts.submit,
    });
    return tabId;
  }

  const payload = {
    type: AGENT_CHAT_MESSAGE_TYPE,
    data: { ...opts, tabId },
  };

  const target = window.parent !== window ? window.parent : window;
  const targetOrigin = getFrameOrigin() || window.location.origin;
  target.postMessage(payload, targetOrigin);

  // Surface the sidebar so the user sees the response. Callers can opt out
  // via `openSidebar: false` for background/silent sends. AgentSidebar
  // listens for this event; the parent-frame case is handled by whoever
  // owns that sidebar receiving the postMessage above.
  if (opts.openSidebar !== false && !opts.background) {
    window.dispatchEvent(new CustomEvent("agent-panel:open"));
  }
  return tabId;
}
