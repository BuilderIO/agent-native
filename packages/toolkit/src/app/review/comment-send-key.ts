import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { isComposingKey } from "../../ui/is-composing-key.js";

export { isComposingKey };

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
