// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { BubbleToolbar } from "./BubbleToolbar.js";

it("cancels every pending blur update when the toolbar unmounts", () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const editor = new Editor({ extensions: [StarterKit] });
  const focused = vi.fn(() => false);
  Object.defineProperty(editor, "isFocused", {
    configurable: true,
    get: focused,
  });
  const root = createRoot(host);

  try {
    act(() => root.render(<BubbleToolbar editor={editor as never} />));
    act(() => {
      editor.emit("blur", { editor, event: new FocusEvent("blur") });
      editor.emit("blur", { editor, event: new FocusEvent("blur") });
      root.unmount();
    });
    act(() => {
      vi.runAllTimers();
    });
    expect(focused).not.toHaveBeenCalled();
  } finally {
    editor.destroy();
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
