/**
 * Fusion Chat Bridge (browser)
 *
 * Sends structured messages to the Fusion AI chat from UI interactions.
 * Messages are sent via postMessage to the parent window (or self if top-level).
 */

export interface FusionChatMessage {
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

const FUSION_MESSAGE_TYPE = "builder.submitChat";

/**
 * Send a message to the Fusion AI chat via postMessage.
 */
export function sendToFusionChat(opts: FusionChatMessage): void {
  const payload = {
    type: FUSION_MESSAGE_TYPE,
    data: opts,
  };

  const target = window.parent !== window ? window.parent : window;
  target.postMessage(payload, "*");
}
