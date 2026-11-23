// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { KeyboardShortcutsProvider } from "./KeyboardShortcutsDialog";
import { ProjectHelpPanel } from "./ProjectHelpPanel";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

it("report M5-T2-F-01: opens the same filterable shortcuts from the keyboard and Help", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <KeyboardShortcutsProvider>
          <div className="nb-root">
            <ProjectHelpPanel onClose={() => {}} />
            <input aria-label="Notebook text" />
          </div>
        </KeyboardShortcutsProvider>,
      ),
    );
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "?",
          code: "Slash",
          metaKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      ),
    );
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    const dialog = document.querySelector('[role="dialog"]');
    const shortcuts = [...(dialog?.querySelectorAll("kbd") ?? [])].map(
      (key) => [
        key.closest("dd")?.previousElementSibling?.textContent,
        key.textContent,
      ],
    );
    for (const [label, key] of [
      ["keyboardShortcuts.runCellAndAdvance", "Shift + Enter"],
      ["keyboardShortcuts.runCellAndInsert", "Alt + Enter"],
      ["keyboardShortcuts.editMode", "Enter"],
      ["keyboardShortcuts.addAbove", "A"],
      ["keyboardShortcuts.addBelow", "B"],
      ["keyboardShortcuts.deleteCell", "DD"],
      ["keyboardShortcuts.fullScreen", "FF"],
      ["keyboardShortcuts.formatSql", "FS"],
      ["notebookInsert.addCell", "⌥A"],
      ["notebookInsert.query", "Q"],
      ["notebookInsert.python", "W"],
      ["notebookInsert.text", "E"],
      ["notebookInsert.chart", "R"],
      ["notebookInsert.pivot", "V"],
    ] as const) {
      expect(shortcuts, label).toContainEqual([label, key]);
    }
    expect(shortcuts).toContainEqual(["notebookInsert.singleValue", "U"]);
    expect(shortcuts).toContainEqual(["notebookInsert.table", "T"]);

    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="keyboardShortcuts.filter"]',
    );
    if (!input) throw new Error("Shortcut filter missing");
    expect(document.activeElement).toBe(input);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      if (!setter) throw new Error("Input value setter missing");
      setter.call(input, "zzzz");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("keyboardShortcuts.noMatches");
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const plainShortcut = () =>
      new KeyboardEvent("keydown", {
        key: "?",
        code: "Slash",
        shiftKey: true,
        bubbles: true,
      });
    await act(async () =>
      host.querySelector("input")?.dispatchEvent(plainShortcut()),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () =>
      host.querySelector(".nb-root")?.dispatchEvent(plainShortcut()),
    );
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    const button = [...host.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("keyboardShortcuts.title"),
    );
    if (!button) throw new Error("Help shortcut button missing");
    button.focus();
    await act(async () => button.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(button);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
