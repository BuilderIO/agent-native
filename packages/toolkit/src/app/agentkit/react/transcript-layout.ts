export interface AgentChatTranscriptLayout {
  /** Top padding above transcript messages, in CSS pixels. */
  topInset?: number;
  /** Maximum centered message lane width, in CSS pixels. */
  messageLaneWidth?: number;
  /** Signed inline offset for the centered message lane, in CSS pixels. */
  messageLaneOffsetInline?: number;
  /** Space after each message, in CSS pixels. */
  messageGap?: number;
  /** Assistant message line height, in CSS pixels. */
  messageLineHeight?: number;
  /** Font family for transcript messages. Omitted uses the shared semantic font. */
  fontFamily?: string;
  /** User bubble line height, in CSS pixels. */
  userBubbleLineHeight?: number;
  /** Maximum user bubble width, in CSS pixels. */
  userBubbleMaxWidth?: number;
  /** Signed inline offset for the user bubble, in CSS pixels. */
  userBubbleOffsetInline?: number;
  /** User bubble padding on the block and inline axes, in CSS pixels. */
  userBubblePadding?: { block?: number; inline?: number };
}

/** Optional geometry for the completed-work disclosure row in chat. */
export interface AgentChatWorkedForRowLayout {
  /** Chevron width and height, in CSS pixels. */
  chevronSize?: number;
  /** Space between the chevron and label, in CSS pixels. */
  iconGap?: number;
  /** Label font size, in CSS pixels. */
  fontSize?: number;
  /** Label line height, in CSS pixels. */
  lineHeight?: number;
  /** Padding on the block axis, in CSS pixels. */
  paddingBlock?: number;
  /** Padding on the inline axis, in CSS pixels. */
  paddingInline?: number;
}
