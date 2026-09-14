// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import {
  isKeyboardShortcutTarget,
  shouldCycleMailTab,
} from "./use-keyboard-shortcuts";

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

  it("recognizes SVG and text-node descendants inside interactive controls", () => {
    const button = document.createElement("button");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const text = document.createTextNode("Send");
    svg.append(path);
    button.append(svg, text);
    document.body.append(button);

    expect(isKeyboardShortcutTarget(path)).toBe(true);
    expect(isKeyboardShortcutTarget(text)).toBe(true);
  });

  it("leaves a non-interactive list surface available to shortcuts", () => {
    const row = document.createElement("div");
    row.setAttribute("role", "row");
    document.body.append(row);

    expect(isKeyboardShortcutTarget(row)).toBe(false);
  });
});

describe("shouldCycleMailTab", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("preserves native Tab behavior in editors and interactive controls", () => {
    const input = document.createElement("input");
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const button = document.createElement("button");
    const focusable = document.createElement("div");
    focusable.tabIndex = 0;
    document.body.append(input, editor, button, focusable);

    expect(shouldCycleMailTab(input)).toBe(false);
    expect(shouldCycleMailTab(editor)).toBe(false);
    expect(shouldCycleMailTab(button)).toBe(false);
    expect(shouldCycleMailTab(focusable)).toBe(false);
  });

  it("cycles from the workspace and the mail tab bar, but not from dialogs", () => {
    const workspace = document.createElement("main");
    const tabList = document.createElement("div");
    tabList.setAttribute("data-mail-tab-list", "");
    const tab = document.createElement("button");
    tab.setAttribute("role", "tab");
    tabList.append(tab);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const dialogButton = document.createElement("button");
    dialog.append(dialogButton);
    document.body.append(workspace, tabList, dialog);

    expect(shouldCycleMailTab(workspace)).toBe(true);
    expect(shouldCycleMailTab(tab)).toBe(true);
    expect(shouldCycleMailTab(dialogButton)).toBe(false);
  });
});
