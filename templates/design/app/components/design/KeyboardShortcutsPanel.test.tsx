// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const messages: Record<string, string> = {
  "designEditor.keyboardShortcuts.title": "Keyboard shortcuts",
  "designEditor.keyboardShortcuts.close": "Close keyboard shortcuts",
  "designEditor.keyboardShortcuts.keys.or": "or",
  "designEditor.keyboardShortcuts.keys.command": "Command",
  "designEditor.keyboardShortcuts.keys.control": "Control",
  "designEditor.keyboardShortcuts.keys.backslash": "Backslash",
  "designEditor.keyboardShortcuts.categories.essential": "Essential",
  "designEditor.keyboardShortcuts.commands.toggleUi": "Show/Hide UI",
  "designEditor.keyboardShortcuts.commands.undo": "Undo",
  "designEditor.keyboardShortcuts.commands.redo": "Redo",
  "designEditor.keyboardShortcuts.descriptions.toggleUi":
    "Press it now to quickly hide the panes and focus on your work",
  "designEditor.keyboardShortcuts.descriptions.undo":
    "Step back through your most recent design change",
  "designEditor.keyboardShortcuts.descriptions.redo":
    "Restore the design change you just undid",
};

vi.mock("@agent-native/core/client", () => ({
  useT: () => (key: string) =>
    messages[key] ?? key.split(".").slice(-1)[0] ?? key,
}));

import { KeyboardShortcutsPanel } from "./KeyboardShortcutsPanel";

afterEach(() => {
  document.body.replaceChildren();
});

describe("KeyboardShortcutsPanel Essential tutorial", () => {
  it("stacks a standalone number above a title, description, and keycaps row", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<KeyboardShortcutsPanel onClose={vi.fn()} />);
    });

    const cards = Array.from(
      container.querySelectorAll<HTMLElement>("[data-essential-shortcut-card]"),
    );
    expect(cards).toHaveLength(3);
    const first = cards[0]!;
    expect(first.children[0]?.textContent).toBe("1");
    expect(first.children[1]?.textContent).toContain("Show/Hide UI");
    expect(
      first.querySelector("[data-essential-shortcut-description]")?.textContent,
    ).toBe("Press it now to quickly hide the panes and focus on your work");
    expect(first.querySelectorAll("kbd")).toHaveLength(2);
    expect(
      first
        .querySelector("[data-shortcut-bindings]")
        ?.getAttribute("aria-label"),
    ).toBe(
      /Mac|iPhone|iPad/.test(navigator.platform)
        ? "Command Backslash"
        : "Control Backslash",
    );
    expect(first.querySelector("kbd")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(first.textContent).not.toContain("Keyboard shortcuts");

    await act(async () => root.unmount());
  });
});
