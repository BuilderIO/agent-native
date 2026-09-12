// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import { isKeyboardShortcutTarget } from "./use-keyboard-shortcuts";

describe("isKeyboardShortcutTarget", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("keeps global shortcuts inside editable controls", () => {
    const input = document.createElement("input");
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    document.body.append(input, editor);

    expect(isKeyboardShortcutTarget(input)).toBe(true);
    expect(isKeyboardShortcutTarget(editor)).toBe(true);
  });

  it("keeps global shortcuts from stealing action-control keys", () => {
    const button = document.createElement("button");
    const icon = document.createElement("span");
    button.append(icon);
    document.body.append(button);

    expect(isKeyboardShortcutTarget(button)).toBe(true);
    expect(isKeyboardShortcutTarget(icon)).toBe(true);
  });

  it("leaves a non-interactive list surface available to shortcuts", () => {
    const row = document.createElement("div");
    row.setAttribute("role", "row");
    document.body.append(row);

    expect(isKeyboardShortcutTarget(row)).toBe(false);
  });
});
