// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatShortcutLabel,
  isEditableTarget,
  matchesShortcutEvent,
  useCommandRegistry,
  type CommandRegistryItem,
  type ShortcutPlatform,
} from "./useCommandRegistry.js";

afterEach(() => {
  cleanup();
});

function CommandHarness({
  commands,
  platform = "mac",
  enabled = true,
}: {
  commands: readonly CommandRegistryItem[];
  platform?: ShortcutPlatform;
  enabled?: boolean;
}) {
  const { shortcuts, isHelpOpen } = useCommandRegistry(commands, {
    platform,
    enabled,
  });

  return (
    <div>
      <input aria-label="Search input" />
      <textarea aria-label="Notes textarea" />
      <div
        data-testid="editable-div"
        contentEditable={true}
        suppressContentEditableWarning={true}
      >
        Editable
      </div>
      <div data-testid="help-state">{isHelpOpen ? "open" : "closed"}</div>
      <ul>
        {shortcuts.map((item) => (
          <li key={item.id}>
            {item.label}: {item.displayShortcut}
          </li>
        ))}
      </ul>
    </div>
  );
}

describe("useCommandRegistry", () => {
  it("formats portable Mod shortcuts per platform", () => {
    expect(formatShortcutLabel("Mod+k", "mac")).toBe("⌘K");
    expect(formatShortcutLabel("Mod+k", "other")).toBe("Ctrl+K");
    expect(formatShortcutLabel("Mod+Shift+p", "mac")).toBe("⌘⇧P");
    expect(formatShortcutLabel("Mod+Shift+p", "other")).toBe("Ctrl+Shift+P");
    expect(formatShortcutLabel("Escape", "other")).toBe("Esc");
  });

  it("matches Mod shortcuts with either metaKey or ctrlKey", () => {
    const macEvent = new KeyboardEvent("keydown", { key: "k", metaKey: true });
    const winEvent = new KeyboardEvent("keydown", { key: "k", ctrlKey: true });
    const bareEvent = new KeyboardEvent("keydown", { key: "k" });

    expect(matchesShortcutEvent(macEvent, "Mod+k")).toBe(true);
    expect(matchesShortcutEvent(winEvent, "Mod+k")).toBe(true);
    expect(matchesShortcutEvent(bareEvent, "Mod+k")).toBe(false);
  });

  it("fires Mod, j/k, Esc, and ? help shortcuts on non-editable targets", () => {
    const onPalette = vi.fn();
    const onNext = vi.fn();
    const onPrev = vi.fn();
    const onEscape = vi.fn();

    render(
      <CommandHarness
        platform="mac"
        commands={[
          {
            id: "palette",
            label: "Command palette",
            shortcut: "Mod+k",
            onTrigger: onPalette,
          },
          {
            id: "next",
            label: "Next item",
            shortcut: "j",
            onTrigger: onNext,
          },
          {
            id: "prev",
            label: "Previous item",
            shortcut: "k",
            onTrigger: onPrev,
          },
          {
            id: "clear",
            label: "Clear selection",
            shortcut: "Escape",
            onTrigger: onEscape,
          },
        ]}
      />,
    );

    expect(screen.getByText("Command palette: ⌘K")).toBeTruthy();
    expect(screen.getByText("Show keyboard shortcuts: ?")).toBeTruthy();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(onPalette).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "k" });
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "?", shiftKey: true });
    expect(screen.getByTestId("help-state").textContent).toBe("open");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("help-state").textContent).toBe("closed");
    expect(onEscape).toHaveBeenCalledTimes(0);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("ignores non-Escape shortcuts inside input, textarea, and contenteditable targets", () => {
    const onNext = vi.fn();
    const onPalette = vi.fn();
    const onEscape = vi.fn();

    render(
      <CommandHarness
        commands={[
          {
            id: "next",
            label: "Next item",
            shortcut: "j",
            onTrigger: onNext,
          },
          {
            id: "palette",
            label: "Command palette",
            shortcut: "Mod+k",
            onTrigger: onPalette,
          },
          {
            id: "clear",
            label: "Dismiss",
            shortcut: "Escape",
            onTrigger: onEscape,
          },
        ]}
      />,
    );

    const input = screen.getByLabelText("Search input");
    const textarea = screen.getByLabelText("Notes textarea");
    const editableDiv = screen.getByTestId("editable-div");

    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(textarea)).toBe(true);
    expect(isEditableTarget(editableDiv)).toBe(true);

    fireEvent.keyDown(input, { key: "j" });
    fireEvent.keyDown(textarea, { key: "k", metaKey: true });
    fireEvent.keyDown(editableDiv, { key: "?", shiftKey: true });

    expect(onNext).not.toHaveBeenCalled();
    expect(onPalette).not.toHaveBeenCalled();
    expect(screen.getByTestId("help-state").textContent).toBe("closed");

    fireEvent.keyDown(input, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("respects disabled commands and global enabled=false", () => {
    const onDisabled = vi.fn();
    const onActive = vi.fn();

    const { rerender } = render(
      <CommandHarness
        commands={[
          {
            id: "disabled",
            label: "Disabled",
            shortcut: "j",
            enabled: false,
            onTrigger: onDisabled,
          },
          {
            id: "active",
            label: "Active",
            shortcut: "k",
            onTrigger: onActive,
          },
        ]}
      />,
    );

    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "k" });
    expect(onDisabled).not.toHaveBeenCalled();
    expect(onActive).toHaveBeenCalledTimes(1);

    rerender(
      <CommandHarness
        enabled={false}
        commands={[
          {
            id: "active",
            label: "Active",
            shortcut: "k",
            onTrigger: onActive,
          },
        ]}
      />,
    );

    fireEvent.keyDown(window, { key: "k" });
    expect(onActive).toHaveBeenCalledTimes(1);
  });
});
