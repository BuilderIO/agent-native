// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { getOpenSlideEditorShortcut } from "./keyboard-shortcuts";

function key(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    ...init,
  });
}

describe("getOpenSlideEditorShortcut", () => {
  it("ignores composing, IME, and already-handled events", () => {
    const alreadyHandled = key("o");
    alreadyHandled.preventDefault();

    expect(
      getOpenSlideEditorShortcut(key("o", { isComposing: true })),
    ).toBeNull();
    expect(
      getOpenSlideEditorShortcut(key("o"), { isComposing: true }),
    ).toBeNull();
    const imeKeyEvent = key("o");
    Object.defineProperty(imeKeyEvent, "keyCode", { value: 229 });
    expect(getOpenSlideEditorShortcut(imeKeyEvent)).toBeNull();
    expect(getOpenSlideEditorShortcut(key("o"), { keyCode: 229 })).toBeNull();
    expect(getOpenSlideEditorShortcut(alreadyHandled)).toBeNull();
  });

  it("saves on unshifted Command-S or Control-S, including from controls", () => {
    const input = document.createElement("input");
    const button = document.createElement("button");
    document.body.append(input, button);

    expect(getOpenSlideEditorShortcut(key("s", { metaKey: true }))).toEqual({
      action: "save",
      preventDefault: true,
    });
    expect(getOpenSlideEditorShortcut(key("S", { ctrlKey: true }))).toEqual({
      action: "save",
      preventDefault: true,
    });

    const inputSave = key("s", { ctrlKey: true });
    input.dispatchEvent(inputSave);
    expect(getOpenSlideEditorShortcut(inputSave)).toEqual({
      action: "save",
      preventDefault: true,
    });

    const buttonSave = key("s", { metaKey: true });
    button.dispatchEvent(buttonSave);
    expect(getOpenSlideEditorShortcut(buttonSave)).toEqual({
      action: "save",
      preventDefault: true,
    });

    expect(
      getOpenSlideEditorShortcut(key("s", { ctrlKey: true, shiftKey: true })),
    ).toBeNull();
    expect(
      getOpenSlideEditorShortcut(key("s", { metaKey: true, altKey: true })),
    ).toBeNull();

    input.remove();
    button.remove();
  });

  it("selects all on Command-A or Control-A outside typing and control targets", () => {
    expect(getOpenSlideEditorShortcut(key("a", { metaKey: true }))).toEqual({
      action: "select-all",
      preventDefault: true,
    });
    expect(getOpenSlideEditorShortcut(key("A", { ctrlKey: true }))).toEqual({
      action: "select-all",
      preventDefault: true,
    });
    expect(
      getOpenSlideEditorShortcut(key("a", { ctrlKey: true }), {
        isControlTarget: true,
      }),
    ).toBeNull();
    expect(
      getOpenSlideEditorShortcut(key("a", { metaKey: true }), {
        isTypingTarget: true,
      }),
    ).toBeNull();

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const button = document.createElement("button");
    dialog.append(button);
    document.body.append(dialog);
    const controlEvent = key("a", { ctrlKey: true });
    button.dispatchEvent(controlEvent);
    expect(getOpenSlideEditorShortcut(controlEvent)).toBeNull();
    dialog.remove();

    expect(
      getOpenSlideEditorShortcut(key("a", { ctrlKey: true, altKey: true })),
    ).toBeNull();
    expect(getOpenSlideEditorShortcut(key("z", { metaKey: true }))).toBeNull();
  });

  it("toggles overview with O from either overview state, but not from controls", () => {
    expect(getOpenSlideEditorShortcut(key("o"))).toEqual({
      action: "toggle-overview",
      preventDefault: true,
    });
    expect(
      getOpenSlideEditorShortcut(key("O"), { overviewOpen: true }),
    ).toEqual({ action: "toggle-overview", preventDefault: true });
    expect(getOpenSlideEditorShortcut(key("o", { shiftKey: true }))).toEqual({
      action: "toggle-overview",
      preventDefault: true,
    });
    expect(getOpenSlideEditorShortcut(key("o", { metaKey: true }))).toBeNull();
    expect(getOpenSlideEditorShortcut(key("o", { altKey: true }))).toBeNull();

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const button = document.createElement("button");
    const input = document.createElement("input");
    dialog.append(button, input);
    document.body.append(dialog);

    const controlEvent = key("o");
    button.dispatchEvent(controlEvent);
    expect(
      getOpenSlideEditorShortcut(controlEvent, { overviewOpen: true }),
    ).toBeNull();
    expect(
      getOpenSlideEditorShortcut(key("o"), {
        overviewOpen: true,
        isControlTarget: true,
      }),
    ).toBeNull();

    const inputEvent = key("o");
    input.dispatchEvent(inputEvent);
    expect(getOpenSlideEditorShortcut(inputEvent)).toBeNull();
    expect(
      getOpenSlideEditorShortcut(key("o"), { isTypingTarget: true }),
    ).toBeNull();
    dialog.remove();
  });

  it("toggles the inspector with I outside typing and control targets", () => {
    expect(getOpenSlideEditorShortcut(key("i"))).toEqual({
      action: "toggle-inspector",
      preventDefault: true,
    });
    expect(getOpenSlideEditorShortcut(key("I", { shiftKey: true }))).toEqual({
      action: "toggle-inspector",
      preventDefault: true,
    });
    expect(getOpenSlideEditorShortcut(key("i", { metaKey: true }))).toBeNull();
    expect(
      getOpenSlideEditorShortcut(key("i"), { overviewOpen: true }),
    ).toBeNull();
    expect(
      getOpenSlideEditorShortcut(key("i"), { isTypingTarget: true }),
    ).toBeNull();
    expect(
      getOpenSlideEditorShortcut(key("i"), { isControlTarget: true }),
    ).toBeNull();

    const button = document.createElement("button");
    document.body.append(button);
    const controlEvent = key("i");
    button.dispatchEvent(controlEvent);
    expect(getOpenSlideEditorShortcut(controlEvent)).toBeNull();
    button.remove();
  });

  it("blocks non-overview shortcuts while the overview is open", () => {
    for (const keyName of ["ArrowUp", "ArrowDown", "f", "Enter", "p"]) {
      expect(
        getOpenSlideEditorShortcut(key(keyName), { overviewOpen: true }),
      ).toBeNull();
    }
  });

  it("navigates to the previous and next slides with the vertical arrows", () => {
    expect(getOpenSlideEditorShortcut(key("ArrowUp"))).toEqual({
      action: "previous-slide",
      preventDefault: true,
    });
    expect(getOpenSlideEditorShortcut(key("ArrowDown"))).toEqual({
      action: "next-slide",
      preventDefault: true,
    });
    expect(getOpenSlideEditorShortcut(key("ArrowLeft"))).toBeNull();
    expect(getOpenSlideEditorShortcut(key("ArrowRight"))).toBeNull();
    expect(
      getOpenSlideEditorShortcut(key("ArrowDown", { ctrlKey: true })),
    ).toBeNull();
  });

  it("starts fullscreen, windowed, or presenter mode from the matching key", () => {
    expect(getOpenSlideEditorShortcut(key("f"))).toEqual({
      action: "present-fullscreen",
      preventDefault: false,
    });
    expect(getOpenSlideEditorShortcut(key("F"))).toEqual({
      action: "present-fullscreen",
      preventDefault: false,
    });
    expect(getOpenSlideEditorShortcut(key("Enter"))).toEqual({
      action: "present-windowed",
      preventDefault: false,
    });
    expect(getOpenSlideEditorShortcut(key("p"))).toEqual({
      action: "open-presenter-view",
      preventDefault: false,
    });
    expect(getOpenSlideEditorShortcut(key("P"))).toEqual({
      action: "open-presenter-view",
      preventDefault: false,
    });
  });

  it("edits selected text on Enter instead of starting windowed presentation", () => {
    expect(
      getOpenSlideEditorShortcut(key("Enter"), { hasSelectedText: true }),
    ).toEqual({ action: "edit-selected-text", preventDefault: true });
  });

  it("does not enter text editing from editor controls or while typing", () => {
    const button = document.createElement("button");
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { value: true });
    document.body.append(button, input, textarea, editable);

    const buttonEnter = key("Enter");
    button.dispatchEvent(buttonEnter);
    expect(
      getOpenSlideEditorShortcut(buttonEnter, { hasSelectedText: true }),
    ).toBeNull();

    const inputEnter = key("Enter");
    input.dispatchEvent(inputEnter);
    expect(
      getOpenSlideEditorShortcut(inputEnter, { hasSelectedText: true }),
    ).toBeNull();

    const textareaEnter = key("Enter");
    textarea.dispatchEvent(textareaEnter);
    expect(
      getOpenSlideEditorShortcut(textareaEnter, { hasSelectedText: true }),
    ).toBeNull();

    const editableEnter = key("Enter");
    editable.dispatchEvent(editableEnter);
    expect(
      getOpenSlideEditorShortcut(editableEnter, { hasSelectedText: true }),
    ).toBeNull();
    expect(
      getOpenSlideEditorShortcut(key("Enter"), {
        hasSelectedText: true,
        isControlTarget: true,
      }),
    ).toBeNull();
    expect(
      getOpenSlideEditorShortcut(key("Enter"), {
        hasSelectedText: true,
        isTypingTarget: true,
      }),
    ).toBeNull();

    button.remove();
    input.remove();
    textarea.remove();
    editable.remove();
  });

  it("ignores unsupported keys and letter shortcuts with browser modifiers", () => {
    expect(getOpenSlideEditorShortcut(key("q"))).toBeNull();
    expect(getOpenSlideEditorShortcut(key("f", { ctrlKey: true }))).toBeNull();
    expect(getOpenSlideEditorShortcut(key("p", { metaKey: true }))).toBeNull();
    expect(
      getOpenSlideEditorShortcut(key("ArrowUp", { altKey: true })),
    ).toBeNull();
  });
});
