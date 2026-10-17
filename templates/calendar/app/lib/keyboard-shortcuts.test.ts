// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { isCalendarShortcutSuppressedTarget } from "./keyboard-shortcuts";

describe("isCalendarShortcutSuppressedTarget", () => {
  it("leaves calendar shortcuts available from the page", () => {
    const target = document.createElement("main");

    expect(isCalendarShortcutSuppressedTarget(target)).toBe(false);
    expect(isCalendarShortcutSuppressedTarget(null)).toBe(false);
  });

  it("lets focused editors and controls own their keystrokes", () => {
    for (const tag of ["input", "textarea", "select"]) {
      expect(
        isCalendarShortcutSuppressedTarget(document.createElement(tag)),
      ).toBe(true);
    }

    const editable = document.createElement("div");
    editable.contentEditable = "true";
    expect(isCalendarShortcutSuppressedTarget(editable)).toBe(true);
  });

  it("lets open dialogs, menus, and suggestion lists own navigation keys", () => {
    for (const role of ["dialog", "alertdialog", "menu", "listbox"]) {
      const owner = document.createElement("div");
      owner.setAttribute("role", role);
      const target = document.createElement("button");
      owner.append(target);

      expect(isCalendarShortcutSuppressedTarget(target)).toBe(true);
    }
  });

  it("lets custom comboboxes own calendar shortcuts", () => {
    const combobox = document.createElement("button");
    combobox.setAttribute("role", "combobox");

    expect(isCalendarShortcutSuppressedTarget(combobox)).toBe(true);
  });
});
