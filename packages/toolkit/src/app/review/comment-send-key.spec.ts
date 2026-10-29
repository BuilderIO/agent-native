// @vitest-environment happy-dom

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { describe, expect, it } from "vitest";

import { isComposingKey, isCommentSendKey } from "./comment-send-key.js";

function key(init: KeyboardEventInit & { keyCode?: number }) {
  const event = new KeyboardEvent("keydown", init);
  if (init.keyCode !== undefined) {
    Object.defineProperty(event, "keyCode", { value: init.keyCode });
  }
  return event;
}

describe("isCommentSendKey", () => {
  it("sends on Enter and Cmd/Ctrl+Enter, and not on Shift+Enter", () => {
    expect(isCommentSendKey(key({ key: "Enter" }))).toBe(true);
    expect(isCommentSendKey(key({ key: "Enter", metaKey: true }))).toBe(true);
    expect(isCommentSendKey(key({ key: "Enter", ctrlKey: true }))).toBe(true);
    expect(isCommentSendKey(key({ key: "Enter", shiftKey: true }))).toBe(false);
    expect(isCommentSendKey(key({ key: "a" }))).toBe(false);
  });

  it("leaves Enter to an input method that is composing", () => {
    expect(isCommentSendKey(key({ key: "Enter", isComposing: true }))).toBe(
      false,
    );
    expect(isCommentSendKey(key({ key: "Enter", keyCode: 229 }))).toBe(false);
    expect(isComposingKey(key({ key: "a", keyCode: 229 }))).toBe(true);
  });

  it("reads a React keyboard event through its native event", () => {
    const nativeEvent = key({ key: "Enter", isComposing: true });
    const event = {
      key: "Enter",
      shiftKey: false,
      nativeEvent,
    } as unknown as ReactKeyboardEvent;
    expect(isCommentSendKey(event)).toBe(false);
    expect(isComposingKey(event)).toBe(true);
  });
});
