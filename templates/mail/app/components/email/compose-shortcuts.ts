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

export function handleComposeSendLaterShortcut(
  event: Pick<
    KeyboardEvent,
    | "key"
    | "metaKey"
    | "ctrlKey"
    | "shiftKey"
    | "altKey"
    | "preventDefault"
    | "stopPropagation"
  >,
  onSendLater: () => void,
): boolean {
  if (
    event.key.toLowerCase() !== "l" ||
    (!event.metaKey && !event.ctrlKey) ||
    !event.shiftKey ||
    event.altKey
  ) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  onSendLater();
  return true;
}
