export interface InlineEditContentSnapshot {
  slideId: string;
  content: string;
}

export function inlineEditDraftNeedsPersistence(
  captured: InlineEditContentSnapshot | null,
  next: InlineEditContentSnapshot,
  initial: InlineEditContentSnapshot,
): boolean {
  if (captured && captured.slideId !== next.slideId) return false;
  if (captured) return captured.content !== next.content;
  return shouldPersistInlineEditContent(initial, next);
}

export function shouldPersistInlineEditContent(
  initial: InlineEditContentSnapshot | null,
  current: InlineEditContentSnapshot | null,
): boolean {
  if (!current) return false;
  return (
    !initial ||
    initial.slideId !== current.slideId ||
    initial.content !== current.content
  );
}
