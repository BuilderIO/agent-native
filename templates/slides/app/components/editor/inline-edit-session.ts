export interface InlineEditContentSnapshot {
  slideId: string;
  content: string;
}

export function inlineEditDraftNeedsPersistence(
  captured: InlineEditContentSnapshot | null,
  next: InlineEditContentSnapshot,
): boolean {
  return (
    captured?.slideId === next.slideId && captured.content !== next.content
  );
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
