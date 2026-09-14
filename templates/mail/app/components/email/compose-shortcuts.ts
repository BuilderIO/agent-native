export function handleComposeSendShortcut(
  event: Pick<
    KeyboardEvent,
    | "key"
    | "metaKey"
    | "ctrlKey"
    | "shiftKey"
    | "preventDefault"
    | "stopPropagation"
  >,
  onSend: (markDone: boolean) => void,
): boolean {
  if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  onSend(event.shiftKey);
  return true;
}
