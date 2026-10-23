// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  getSlides2EditorShortcut,
  shouldIgnoreModifiedArrowNavigation,
} from "./keyboard-shortcuts";

function key(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    ...init,
  });
}

describe("getSlides2EditorShortcut", () => {
  it("ignores composing, IME, and already-handled events", () => {
    const alreadyHandled = key("o");
    alreadyHandled.preventDefault();

    expect(
      getSlides2EditorShortcut(key("o", { isComposing: true })),
    ).toBeNull();
    expect(
      getSlides2EditorShortcut(key("o"), { isComposing: true }),
    ).toBeNull();
    const imeKeyEvent = key("o");
    Object.defineProperty(imeKeyEvent, "keyCode", { value: 229 });
    expect(getSlides2EditorShortcut(imeKeyEvent)).toBeNull();
    expect(getSlides2EditorShortcut(key("o"), { keyCode: 229 })).toBeNull();
    expect(getSlides2EditorShortcut(alreadyHandled)).toBeNull();
  });

  it("saves on unshifted Command-S or Control-S, including from controls", () => {
    const input = document.createElement("input");
    const button = document.createElement("button");
    document.body.append(input, button);

    expect(getSlides2EditorShortcut(key("s", { metaKey: true }))).toEqual({
      action: "save",
      preventDefault: true,
    });
    expect(getSlides2EditorShortcut(key("S", { ctrlKey: true }))).toEqual({
      action: "save",
      preventDefault: true,
    });

    const inputSave = key("s", { ctrlKey: true });
    input.dispatchEvent(inputSave);
    expect(getSlides2EditorShortcut(inputSave)).toEqual({
      action: "save",
      preventDefault: true,
    });

    const buttonSave = key("s", { metaKey: true });
    button.dispatchEvent(buttonSave);
    expect(getSlides2EditorShortcut(buttonSave)).toEqual({
      action: "save",
      preventDefault: true,
    });

    expect(
      getSlides2EditorShortcut(key("s", { ctrlKey: true, shiftKey: true })),
    ).toBeNull();
    expect(
      getSlides2EditorShortcut(key("s", { metaKey: true, altKey: true })),
    ).toBeNull();

    input.remove();
    button.remove();
  });

  it("selects all on Command-A or Control-A outside typing and control targets", () => {
    expect(getSlides2EditorShortcut(key("a", { metaKey: true }))).toEqual({
      action: "select-all",
      preventDefault: true,
    });
    expect(getSlides2EditorShortcut(key("A", { ctrlKey: true }))).toEqual({
      action: "select-all",
      preventDefault: true,
    });
    expect(
      getSlides2EditorShortcut(key("a", { ctrlKey: true }), {
        isControlTarget: true,
      }),
    ).toBeNull();
    expect(
      getSlides2EditorShortcut(key("a", { metaKey: true }), {
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
    expect(getSlides2EditorShortcut(controlEvent)).toBeNull();
    dialog.remove();

    expect(
      getSlides2EditorShortcut(key("a", { ctrlKey: true, altKey: true })),
    ).toBeNull();
    expect(getSlides2EditorShortcut(key("z", { metaKey: true }))).toBeNull();
  });

  it("toggles overview with O from either overview state, but not from controls", () => {
    expect(getSlides2EditorShortcut(key("o"))).toEqual({
      action: "toggle-overview",
      preventDefault: true,
    });
    expect(getSlides2EditorShortcut(key("O"), { overviewOpen: true })).toEqual({
      action: "toggle-overview",
      preventDefault: true,
    });
    expect(getSlides2EditorShortcut(key("o", { shiftKey: true }))).toEqual({
      action: "toggle-overview",
      preventDefault: true,
    });
    expect(getSlides2EditorShortcut(key("o", { metaKey: true }))).toBeNull();
    expect(getSlides2EditorShortcut(key("o", { altKey: true }))).toBeNull();

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const button = document.createElement("button");
    const input = document.createElement("input");
    dialog.append(button, input);
    document.body.append(dialog);

    const controlEvent = key("o");
    button.dispatchEvent(controlEvent);
    expect(
      getSlides2EditorShortcut(controlEvent, { overviewOpen: true }),
    ).toBeNull();
    expect(
      getSlides2EditorShortcut(key("o"), {
        overviewOpen: true,
        isControlTarget: true,
      }),
    ).toBeNull();

    const inputEvent = key("o");
    input.dispatchEvent(inputEvent);
    expect(getSlides2EditorShortcut(inputEvent)).toBeNull();
    expect(
      getSlides2EditorShortcut(key("o"), { isTypingTarget: true }),
    ).toBeNull();
    dialog.remove();
  });

  it("toggles the inspector with I outside typing and control targets", () => {
    expect(getSlides2EditorShortcut(key("i"))).toEqual({
      action: "toggle-inspector",
      preventDefault: true,
    });
    expect(getSlides2EditorShortcut(key("I", { shiftKey: true }))).toEqual({
      action: "toggle-inspector",
      preventDefault: true,
    });
    expect(getSlides2EditorShortcut(key("i", { metaKey: true }))).toBeNull();
    expect(
      getSlides2EditorShortcut(key("i"), { overviewOpen: true }),
    ).toBeNull();
    expect(
      getSlides2EditorShortcut(key("i"), { isTypingTarget: true }),
    ).toBeNull();
    expect(
      getSlides2EditorShortcut(key("i"), { isControlTarget: true }),
    ).toBeNull();

    const button = document.createElement("button");
    document.body.append(button);
    const controlEvent = key("i");
    button.dispatchEvent(controlEvent);
    expect(getSlides2EditorShortcut(controlEvent)).toBeNull();
    button.remove();
  });

  it("maps V and E to editor modes and C to comment mode when allowed", () => {
    expect(getSlides2EditorShortcut(key("v"))).toEqual({
      action: "preview-mode",
      preventDefault: true,
    });
    expect(getSlides2EditorShortcut(key("E", { shiftKey: true }))).toEqual({
      action: "edit-mode",
      preventDefault: true,
    });
    expect(getSlides2EditorShortcut(key("c"), { canComment: true })).toEqual({
      action: "toggle-comment-mode",
      preventDefault: true,
    });
    expect(getSlides2EditorShortcut(key("c"))).toBeNull();
    expect(
      getSlides2EditorShortcut(key("c", { metaKey: true }), {
        canComment: true,
      }),
    ).toBeNull();

    const button = document.createElement("button");
    document.body.append(button);
    const event = key("v");
    button.dispatchEvent(event);
    expect(getSlides2EditorShortcut(event)).toBeNull();
    button.remove();
  });

  it("blocks non-overview shortcuts while the overview is open", () => {
    for (const keyName of ["ArrowUp", "ArrowDown", "f", "Enter", "p"]) {
      expect(
        getSlides2EditorShortcut(key(keyName), { overviewOpen: true }),
      ).toBeNull();
    }
  });

  it("navigates between slides with arrows when no object is selected", () => {
    const arrows = [
      ["ArrowLeft", "previous-slide"],
      ["ArrowUp", "previous-slide"],
      ["ArrowRight", "next-slide"],
      ["ArrowDown", "next-slide"],
    ] as const;

    for (const [keyName, action] of arrows) {
      expect(getSlides2EditorShortcut(key(keyName))).toEqual({
        action,
        preventDefault: true,
      });
      expect(
        getSlides2EditorShortcut(key(keyName, { shiftKey: true })),
      ).toEqual({
        action,
        preventDefault: true,
      });
    }
  });

  it("nudges selected objects by one or ten pixels with arrow keys", () => {
    const deltas = [
      ["ArrowLeft", { x: -1, y: 0 }, { x: -10, y: 0 }],
      ["ArrowRight", { x: 1, y: 0 }, { x: 10, y: 0 }],
      ["ArrowUp", { x: 0, y: -1 }, { x: 0, y: -10 }],
      ["ArrowDown", { x: 0, y: 1 }, { x: 0, y: 10 }],
    ] as const;

    for (const [keyName, delta, shiftedDelta] of deltas) {
      expect(
        getSlides2EditorShortcut(key(keyName), { hasSelectedObject: true }),
      ).toEqual({
        action: "nudge-selected-object",
        preventDefault: true,
        delta,
      });
      expect(
        getSlides2EditorShortcut(key(keyName, { shiftKey: true }), {
          hasSelectedObject: true,
        }),
      ).toEqual({
        action: "nudge-selected-object",
        preventDefault: true,
        delta: shiftedDelta,
      });
    }
  });

  it("ignores arrow navigation modified by Alt, Control, or Command", () => {
    const modifiers = [{ altKey: true }, { ctrlKey: true }, { metaKey: true }];

    for (const keyName of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      for (const modifier of modifiers) {
        expect(
          shouldIgnoreModifiedArrowNavigation(keyName, {
            altKey: Boolean(modifier.altKey),
            ctrlKey: Boolean(modifier.ctrlKey),
            metaKey: Boolean(modifier.metaKey),
          }),
        ).toBe(true);
        expect(getSlides2EditorShortcut(key(keyName, modifier))).toBeNull();
      }
    }
    expect(
      shouldIgnoreModifiedArrowNavigation("ArrowRight", {
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      }),
    ).toBe(false);
  });

  it("starts fullscreen, windowed, or presenter mode from the matching key", () => {
    expect(getSlides2EditorShortcut(key("f"))).toEqual({
      action: "present-fullscreen",
      preventDefault: false,
    });
    expect(getSlides2EditorShortcut(key("F"))).toEqual({
      action: "present-fullscreen",
      preventDefault: false,
    });
    expect(getSlides2EditorShortcut(key("Enter"))).toEqual({
      action: "present-windowed",
      preventDefault: false,
    });
    expect(getSlides2EditorShortcut(key("p"))).toEqual({
      action: "open-presenter-view",
      preventDefault: false,
    });
    expect(getSlides2EditorShortcut(key("P"))).toEqual({
      action: "open-presenter-view",
      preventDefault: false,
    });
  });

  it("edits selected text on Enter instead of starting windowed presentation", () => {
    expect(
      getSlides2EditorShortcut(key("Enter"), { hasSelectedText: true }),
    ).toEqual({ action: "edit-selected-text", preventDefault: true });
  });

  it("deletes a selected object with Delete or Backspace outside editor controls", () => {
    for (const keyName of ["Delete", "Backspace"]) {
      expect(
        getSlides2EditorShortcut(key(keyName), { hasSelectedObject: true }),
      ).toEqual({ action: "delete-selected-object", preventDefault: true });
      expect(getSlides2EditorShortcut(key(keyName))).toBeNull();
      expect(
        getSlides2EditorShortcut(key(keyName, { metaKey: true }), {
          hasSelectedObject: true,
        }),
      ).toBeNull();
    }

    const input = document.createElement("input");
    document.body.append(input);
    const inputBackspace = key("Backspace");
    input.dispatchEvent(inputBackspace);
    expect(
      getSlides2EditorShortcut(inputBackspace, { hasSelectedObject: true }),
    ).toBeNull();
    input.remove();
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
      getSlides2EditorShortcut(buttonEnter, { hasSelectedText: true }),
    ).toBeNull();

    const inputEnter = key("Enter");
    input.dispatchEvent(inputEnter);
    expect(
      getSlides2EditorShortcut(inputEnter, { hasSelectedText: true }),
    ).toBeNull();

    const textareaEnter = key("Enter");
    textarea.dispatchEvent(textareaEnter);
    expect(
      getSlides2EditorShortcut(textareaEnter, { hasSelectedText: true }),
    ).toBeNull();

    const editableEnter = key("Enter");
    editable.dispatchEvent(editableEnter);
    expect(
      getSlides2EditorShortcut(editableEnter, { hasSelectedText: true }),
    ).toBeNull();
    expect(
      getSlides2EditorShortcut(key("Enter"), {
        hasSelectedText: true,
        isControlTarget: true,
      }),
    ).toBeNull();
    expect(
      getSlides2EditorShortcut(key("Enter"), {
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
    expect(getSlides2EditorShortcut(key("q"))).toBeNull();
    expect(getSlides2EditorShortcut(key("f", { ctrlKey: true }))).toBeNull();
    expect(getSlides2EditorShortcut(key("p", { metaKey: true }))).toBeNull();
    expect(
      getSlides2EditorShortcut(key("ArrowUp", { altKey: true })),
    ).toBeNull();
  });
});
