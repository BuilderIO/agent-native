import type { KeyboardEvent as ReactKeyboardEvent } from "react";

type SendKeyEvent =
  | Pick<KeyboardEvent, "key" | "shiftKey" | "isComposing" | "keyCode">
  | ReactKeyboardEvent;

/**
 * The send key in every comment box: Enter sends, Shift+Enter starts a new
 * line, and Cmd/Ctrl+Enter sends too. Nothing sends while an input method is
 * composing, because there Enter confirms the word being typed.
 */
export function isCommentSendKey(event: SendKeyEvent): boolean {
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  return native.key === "Enter" && !native.shiftKey && !isComposingKey(native);
}

/** Whether an input method is composing, so the key belongs to it. */
export function isComposingKey(event: SendKeyEvent): boolean {
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  return native.isComposing || native.keyCode === 229;
}
