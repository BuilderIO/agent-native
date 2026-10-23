import type { CSSProperties } from "react";

export interface AgentChatTranscriptLayout {
  /** Top padding above transcript messages, in CSS pixels. */
  topInset?: number;
  /** Maximum centered message lane width, in CSS pixels. */
  messageLaneWidth?: number;
  /** Signed inline offset for the centered message lane, in CSS pixels. */
  messageLaneOffsetInline?: number;
  /** Keep the offset within the lane at all widths or allow wide-screen docking. */
  messageLaneOffsetMode?: "clamped" | "responsive";
  /** Space after each message, in CSS pixels. */
  messageGap?: number;
  /** Assistant message line height, in CSS pixels. */
  messageLineHeight?: number;
  /** Font family for transcript messages. Omitted uses the shared semantic font. */
  fontFamily?: string;
  /** Optional appearance for assistant text displayed after a widget. */
  postWidgetText?: {
    tone?: "muted";
    paragraphPaddingBlock?: number;
  };
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
  /** Signed margin before the row, in CSS pixels. */
  marginBlockStart?: number;
  /** Label font size, in CSS pixels. */
  fontSize?: number;
  /** Label line height, in CSS pixels. */
  lineHeight?: number;
  /** Padding on the block axis, in CSS pixels. */
  paddingBlock?: number;
  /** Padding on the inline axis, in CSS pixels. */
  paddingInline?: number;
}

function workedForRowLength(
  value: number | undefined,
  name: keyof AgentChatWorkedForRowLayout,
  positive = false,
) {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0 || (positive && value === 0)) {
    throw new RangeError(
      `workedForRowLayout.${name} must be a valid CSS length`,
    );
  }
  return `${value}px`;
}

function workedForRowOffset(
  value: number | undefined,
  name: keyof AgentChatWorkedForRowLayout,
) {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) {
    throw new RangeError(`workedForRowLayout.${name} must be finite`);
  }
  return `${value}px`;
}

export function workedForRowSummaryStyle(
  layout?: AgentChatWorkedForRowLayout,
): CSSProperties | undefined {
  if (!layout) return undefined;
  return {
    gap: workedForRowLength(layout.iconGap, "iconGap"),
    marginBlockStart: workedForRowOffset(
      layout.marginBlockStart,
      "marginBlockStart",
    ),
    fontSize: workedForRowLength(layout.fontSize, "fontSize", true),
    lineHeight: workedForRowLength(layout.lineHeight, "lineHeight", true),
    paddingBlock: workedForRowLength(layout.paddingBlock, "paddingBlock"),
    paddingInline: workedForRowLength(layout.paddingInline, "paddingInline"),
    fontFamily: "inherit",
  };
}

export function workedForRowChevronStyle(
  layout?: AgentChatWorkedForRowLayout,
): CSSProperties | undefined {
  const size = workedForRowLength(layout?.chevronSize, "chevronSize", true);
  return size ? { width: size, height: size } : undefined;
}
