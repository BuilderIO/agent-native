export interface AgentChatTranscriptLayout {
  /** Top padding above transcript messages, in CSS pixels. */
  topInset?: number;
  /** Maximum centered message lane width, in CSS pixels. */
  messageLaneWidth?: number;
  /** Space after each message, in CSS pixels. */
  messageGap?: number;
  /** Maximum user bubble width, in CSS pixels. */
  userBubbleMaxWidth?: number;
  /** User bubble padding on the block and inline axes, in CSS pixels. */
  userBubblePadding?: { block?: number; inline?: number };
}
