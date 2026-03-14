/**
 * Agent Chat Bridge (browser)
 *
 * Sends structured messages to the agent chat from UI interactions.
 * Messages are sent via postMessage to the parent window (or self if top-level).
 */

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
}

const AGENT_CHAT_MESSAGE_TYPE = "builder.submitChat";

/**
 * Listen for chatRunning messages from the harness (postMessage)
 * and re-dispatch as a CustomEvent so hooks like useAgentChatGenerating() work.
 */
if (typeof window !== "undefined") {
  window.addEventListener("message", (event) => {
    if (event.data?.type === "builder.fusion.chatRunning") {
      window.dispatchEvent(
        new CustomEvent("builder.fusion.chatRunning", {
          detail: event.data.detail,
        }),
      );
    }
  });
}

/**
 * Send a message to the agent chat via postMessage.
 */
export function sendToAgentChat(opts: AgentChatMessage): void {
  const payload = {
    type: AGENT_CHAT_MESSAGE_TYPE,
    data: opts,
  };

  const target = window.parent !== window ? window.parent : window;
  target.postMessage(payload, "*");
}
