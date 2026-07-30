// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { shouldActivateTextTool } from "./text-tool-shortcut";

function keyboardEvent(
  overrides: Partial<KeyboardEventInit> & { target?: EventTarget | null } = {},
) {
  const target = overrides.target ?? document.body;
  return {
    key: overrides.key ?? "t",
    altKey: overrides.altKey ?? false,
    ctrlKey: overrides.ctrlKey ?? false,
    metaKey: overrides.metaKey ?? false,
    shiftKey: overrides.shiftKey ?? false,
    defaultPrevented: false,
    repeat: overrides.repeat ?? false,
    isComposing: false,
    target,
  };
}

function shouldActivate(
  event = keyboardEvent(),
  overrides: Partial<{
    canEdit: boolean;
    activeElement: Element | null;
    blockingSurfaceOpen: boolean;
  }> = {},
) {
  return shouldActivateTextTool(event, {
    canEdit: overrides.canEdit ?? true,
    activeElement: overrides.activeElement ?? document.body,
    blockingSurfaceOpen: overrides.blockingSurfaceOpen ?? false,
  });
}

describe("shouldActivateTextTool", () => {
  it("activates for an unmodified T on the editor canvas", () => {
    expect(shouldActivate()).toBe(true);
  });

  it("ignores modified shortcuts and read-only decks", () => {
    expect(shouldActivate(keyboardEvent({ metaKey: true }))).toBe(false);
    expect(shouldActivate(keyboardEvent({ ctrlKey: true }))).toBe(false);
    expect(shouldActivate(keyboardEvent({ altKey: true }))).toBe(false);
    expect(shouldActivate(keyboardEvent({ shiftKey: true }))).toBe(false);
    expect(shouldActivate(keyboardEvent(), { canEdit: false })).toBe(false);
  });

  it("ignores typing targets", () => {
    for (const element of [
      document.createElement("input"),
      document.createElement("textarea"),
      document.createElement("select"),
    ]) {
      expect(shouldActivate(keyboardEvent({ target: element }))).toBe(false);
    }

    const editable = document.createElement("div");
    editable.contentEditable = "true";
    expect(shouldActivate(keyboardEvent({ target: editable }))).toBe(false);
  });

  it("ignores open dialogs and menu surfaces", () => {
    expect(shouldActivate(keyboardEvent(), { blockingSurfaceOpen: true })).toBe(
      false,
    );

    const menuItem = document.createElement("button");
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.append(menuItem);
    expect(shouldActivate(keyboardEvent({ target: menuItem }))).toBe(false);
  });
});
