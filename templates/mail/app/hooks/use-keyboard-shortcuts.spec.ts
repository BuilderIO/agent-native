// @vitest-environment happy-dom

import { cleanup, renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isKeyboardShortcutTarget,
  shouldCycleMailTab,
  useKeyboardShortcuts,
  useSequenceShortcuts,
} from "./use-keyboard-shortcuts";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("isKeyboardShortcutTarget", () => {
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

describe("useKeyboardShortcuts", () => {
  it("matches a layout-dependent slash with or without Shift", () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() =>
      useKeyboardShortcuts([{ key: "/", shift: "either", handler }]),
    );
    const unshiftedSlash = new KeyboardEvent("keydown", {
      key: "/",
      cancelable: true,
    });
    const shiftedSlash = new KeyboardEvent("keydown", {
      key: "/",
      shiftKey: true,
      cancelable: true,
    });
    const modifiedSlash = new KeyboardEvent("keydown", {
      key: "/",
      shiftKey: true,
      altKey: true,
      cancelable: true,
    });

    act(() => {
      window.dispatchEvent(unshiftedSlash);
      window.dispatchEvent(shiftedSlash);
      window.dispatchEvent(modifiedSlash);
    });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(unshiftedSlash.defaultPrevented).toBe(true);
    expect(shiftedSlash.defaultPrevented).toBe(true);
    expect(modifiedSlash.defaultPrevented).toBe(false);
    unmount();
  });

  it("keeps Shift strict for shortcuts without a layout-dependent alias", () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() =>
      useKeyboardShortcuts([{ key: "c", handler }]),
    );
    const shiftedC = new KeyboardEvent("keydown", {
      key: "c",
      shiftKey: true,
      cancelable: true,
    });

    act(() => window.dispatchEvent(shiftedC));

    expect(handler).not.toHaveBeenCalled();
    expect(shiftedC.defaultPrevented).toBe(false);
    unmount();
  });
});

describe("useSequenceShortcuts", () => {
  it("runs a matching sequence once and prevents its terminal key", () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() =>
      useSequenceShortcuts([{ keys: ["g", "i"], handler }]),
    );
    const terminalKey = new KeyboardEvent("keydown", {
      key: "i",
      cancelable: true,
    });

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "g", cancelable: true }),
      );
      window.dispatchEvent(terminalKey);
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "i", cancelable: true }),
      );
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(terminalKey.defaultPrevented).toBe(true);
    unmount();
  });

  it("does not capture sequence keys from an input", () => {
    const handler = vi.fn();
    const input = document.createElement("input");
    document.body.append(input);
    const { unmount } = renderHook(() =>
      useSequenceShortcuts([{ keys: ["g", "i"], handler }]),
    );

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "g", bubbles: true }),
      );
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "i", cancelable: true }),
      );
    });

    expect(handler).not.toHaveBeenCalled();
    unmount();
  });

  it("expires an incomplete sequence even when its owner rerenders", () => {
    vi.useFakeTimers();
    const handler = vi.fn();
    const makeSequences = () => [{ keys: ["g", "i"], handler }];
    const { rerender } = renderHook(
      ({ sequences }) => useSequenceShortcuts(sequences),
      { initialProps: { sequences: makeSequences() } },
    );

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "g", cancelable: true }),
      );
    });
    rerender({ sequences: makeSequences() });
    act(() => vi.advanceTimersByTime(1_001));
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "i", cancelable: true }),
      );
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("clears an incomplete sequence when disabled", () => {
    const handler = vi.fn();
    const sequences = [{ keys: ["g", "i"], handler }];
    const { rerender, unmount } = renderHook(
      ({ enabled }) => useSequenceShortcuts(sequences, enabled),
      { initialProps: { enabled: true } },
    );

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "g", cancelable: true }),
      );
    });
    rerender({ enabled: false });
    rerender({ enabled: true });
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "i", cancelable: true }),
      );
    });

    expect(handler).not.toHaveBeenCalled();
    unmount();
  });
});
