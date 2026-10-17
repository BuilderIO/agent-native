import type { SlideCommentAnchor } from "@shared/slide-comment-anchor";

type Rect = Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">;
type TextRangeBoundaries = Pick<
  Range,
  "startContainer" | "startOffset" | "endContainer" | "endOffset" | "toString"
>;

function toPercent(value: number, extent: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(extent) || extent <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (value / extent) * 100));
}

export function slideCommentAnchorAtPoint({
  clientX,
  clientY,
  slideRect,
  objectId,
  objectRect,
  targetText,
}: {
  clientX: number;
  clientY: number;
  slideRect: Rect;
  objectId?: string | null;
  objectRect?: Rect | null;
  targetText?: string;
}): SlideCommentAnchor {
  return {
    x: toPercent(clientX - slideRect.left, slideRect.width),
    y: toPercent(clientY - slideRect.top, slideRect.height),
    ...(targetText ? { targetText: targetText.slice(0, 200) } : {}),
    ...(objectId && objectRect && objectRect.width > 0 && objectRect.height > 0
      ? {
          objectId,
          objectX: toPercent(clientX - objectRect.left, objectRect.width),
          objectY: toPercent(clientY - objectRect.top, objectRect.height),
        }
      : {}),
  };
}

export function slideCommentAnchorFromRange({
  range,
  slideRect,
  objectId,
  objectRect,
  objectElement,
  targetText,
}: {
  range: Pick<Range, "getBoundingClientRect"> & Partial<TextRangeBoundaries>;
  slideRect: Rect;
  objectId?: string | null;
  objectRect?: Rect | null;
  objectElement?: Element | null;
  targetText?: string;
}): SlideCommentAnchor {
  const rect = range.getBoundingClientRect();
  const hasTextBoundaries = Boolean(
    range.startContainer &&
    range.endContainer &&
    range.startOffset !== undefined &&
    range.endOffset !== undefined &&
    typeof range.toString === "function",
  );
  const offsets =
    objectElement && hasTextBoundaries
      ? textOffsetsForRange(range as TextRangeBoundaries, objectElement)
      : null;
  const anchor = slideCommentAnchorAtPoint({
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    slideRect,
    objectId,
    objectRect,
    targetText,
  });
  return { ...anchor, ...(offsets ?? {}) };
}

function textOffsetsForRange(
  range: TextRangeBoundaries,
  objectElement: Element,
): Pick<SlideCommentAnchor, "textStartOffset" | "textEndOffset"> | null {
  if (
    !objectElement.contains(range.startContainer) ||
    !objectElement.contains(range.endContainer)
  ) {
    return null;
  }

  const textOffsetAt = (container: Node, offset: number) => {
    const prefix = document.createRange();
    prefix.selectNodeContents(objectElement);
    prefix.setEnd(container, offset);
    return prefix.toString().length;
  };
  const selectedText = range.toString();
  const leadingWhitespace =
    selectedText.length - selectedText.trimStart().length;
  const trailingWhitespace =
    selectedText.length - selectedText.trimEnd().length;
  const textStartOffset =
    textOffsetAt(range.startContainer, range.startOffset) + leadingWhitespace;
  const textEndOffset =
    textOffsetAt(range.endContainer, range.endOffset) - trailingWhitespace;
  return textEndOffset > textStartOffset && textEndOffset <= 200_000
    ? { textStartOffset, textEndOffset }
    : null;
}

function textPointAtOffset(
  root: Element,
  offset: number,
): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }
  let cursor = 0;
  for (const [index, text] of textNodes.entries()) {
    const end = cursor + text.length;
    if (offset < end) return { node: text, offset: offset - cursor };
    if (offset === end) {
      const next = textNodes
        .slice(index + 1)
        .find((candidate) => candidate.length);
      return next
        ? { node: next, offset: 0 }
        : { node: text, offset: text.length };
    }
    cursor = end;
  }
  return null;
}

export function slideCommentTextRange(
  objectElement: Element,
  anchor: SlideCommentAnchor,
  quotedText: string | null | undefined,
): Range | null {
  const quote = quotedText?.trim();
  if (!quote) return null;
  const text = objectElement.textContent ?? "";
  let start = anchor.textStartOffset;
  let end = anchor.textEndOffset;
  if (
    start === undefined ||
    end === undefined ||
    text.slice(start, end) !== quote
  ) {
    start = text.indexOf(quote);
    if (start < 0 || text.indexOf(quote, start + quote.length) !== -1) {
      return null;
    }
    end = start + quote.length;
  }

  const startPoint = textPointAtOffset(objectElement, start);
  const endPoint = textPointAtOffset(objectElement, end);
  if (!startPoint || !endPoint) return null;
  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  return range;
}

export function slideCommentThreadAtPoint(
  threads: Array<{
    threadId: string;
    quotedText: string | null;
    resolved: boolean;
    anchor?: SlideCommentAnchor | null;
  }>,
  slideContent: Element,
  clientX: number,
  clientY: number,
): string | null {
  for (const thread of threads) {
    const anchor = thread.anchor;
    if (thread.resolved || !anchor || !thread.quotedText) continue;
    const object = anchor.objectId
      ? Array.from(
          slideContent.querySelectorAll<HTMLElement>("[data-slide-object-id]"),
        ).find(
          (element) =>
            element.getAttribute("data-slide-object-id") === anchor.objectId,
        )
      : slideContent;
    if (!object) continue;
    const range = slideCommentTextRange(object, anchor, thread.quotedText);
    if (!range) continue;
    for (const rect of Array.from(range.getClientRects())) {
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return thread.threadId;
      }
    }
  }
  return null;
}

export function slideCommentAnchorPosition(
  anchor: SlideCommentAnchor,
  slideRect: Rect,
  objectRect?: Rect | null,
): { x: number; y: number } {
  if (
    !anchor.objectId ||
    anchor.objectX === undefined ||
    anchor.objectY === undefined ||
    !objectRect ||
    objectRect.width <= 0 ||
    objectRect.height <= 0
  ) {
    return { x: anchor.x, y: anchor.y };
  }

  return {
    x: toPercent(
      objectRect.left +
        (objectRect.width * anchor.objectX) / 100 -
        slideRect.left,
      slideRect.width,
    ),
    y: toPercent(
      objectRect.top +
        (objectRect.height * anchor.objectY) / 100 -
        slideRect.top,
      slideRect.height,
    ),
  };
}
