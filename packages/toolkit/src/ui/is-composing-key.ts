import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/** Whether an input method is composing, so the key belongs to it. */
export function isComposingKey(
  event: Pick<KeyboardEvent, "isComposing" | "keyCode"> | ReactKeyboardEvent,
): boolean {
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  return native.isComposing || native.keyCode === 229;
}
