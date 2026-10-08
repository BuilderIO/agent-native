// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DESIGN_SHORTCUT_CATEGORIES,
  DESIGN_SHORTCUTS,
} from "@/components/design/keyboard-shortcuts";
import enUS from "@/i18n/en-US";

function lookup(key: string): string {
  let node: unknown = enUS;
  for (const part of key.split(".")) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  return typeof node === "string" ? node : key;
}

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, params?: Record<string, string>) =>
    lookup(key).replace(/\{\{(\w+)\}\}/g, (_, name) => params?.[name] ?? ""),
}));

import {
  isKeyboardShortcutsDialogTarget,
  KeyboardShortcutsDialog,
} from "./KeyboardShortcutsDialog";

let root: Root | null = null;

beforeEach(() => {
  // happy-dom has no layout, so scrollTo is a recorded no-op.
  Element.prototype.scrollTo = vi.fn() as typeof Element.prototype.scrollTo;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

async function renderDialog(
  props: Partial<React.ComponentProps<typeof KeyboardShortcutsDialog>> = {},
) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const onClose = vi.fn();
  await act(async () => {
    root!.render(<KeyboardShortcutsDialog open onClose={onClose} {...props} />);
  });
  return { onClose };
}

const dialog = () =>
  document.querySelector<HTMLElement>("[data-keyboard-shortcuts-dialog]")!;
const search = () =>
  document.querySelector<HTMLInputElement>("[data-shortcuts-search]")!;
const categoryButtons = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>("[data-shortcuts-category]"),
  );

async function typeInSearch(value: string) {
  const input = search();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("KeyboardShortcutsDialog", () => {
  it("opens as a titled dialog with the search field focused", async () => {
    await renderDialog();
    expect(dialog().getAttribute("role")).toBe("dialog");
    expect(dialog().textContent).toContain("Keyboard shortcuts");
    expect(document.activeElement).toBe(search());
    expect(search().getAttribute("aria-label")).toBe(
      "Search keyboard shortcuts",
    );
  });

  it("renders nothing while closed so the editor pays no cost", async () => {
    await renderDialog({ open: false });
    expect(dialog()).toBeNull();
  });

  it("lists the same 13 categories in catalog order", async () => {
    await renderDialog();
    expect(categoryButtons().map((b) => b.dataset.shortcutsCategory)).toEqual([
      ...DESIGN_SHORTCUT_CATEGORIES,
    ]);
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>("[data-shortcut-section]"),
      ).map((s) => s.dataset.shortcutSection),
    ).toEqual([...DESIGN_SHORTCUT_CATEGORIES]);
  });

  it("shows Essential as plain rows, not tutorial cards", async () => {
    await renderDialog();
    expect(document.querySelector("[data-essential-shortcut-card]")).toBeNull();
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-shortcut-section="essential"] [data-shortcut-id]',
      ),
    );
    expect(rows.map((row) => row.dataset.shortcutId)).toEqual([
      "show-shortcuts",
      "undo",
      "redo",
    ]);
    expect(rows[0]?.textContent).toContain("Show keyboard shortcuts");
    const redo = rows[2]!;
    expect(redo.querySelector("[data-shortcut-bindings]")?.textContent).toMatch(
      /or/,
    );
    expect(
      redo
        .querySelector("[data-shortcut-bindings]")
        ?.getAttribute("aria-label"),
    ).toBe("Control Shift Z or Control Y");
    expect(redo.querySelector("kbd")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("does not repeat shape shortcuts under Tools", async () => {
    await renderDialog();
    const ids = (category: string) =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          `[data-shortcut-section="${category}"] [data-shortcut-id]`,
        ),
      ).map((row) => row.dataset.shortcutId);
    expect(ids("tools")).not.toContain("rectangle");
    expect(ids("shape")).toContain("rectangle");
    // Every catalog shortcut is still reachable exactly once.
    const all = Array.from(
      document.querySelectorAll<HTMLElement>("[data-shortcut-id]"),
    ).map((row) => row.dataset.shortcutId);
    expect(all.sort()).toEqual(DESIGN_SHORTCUTS.map((item) => item.id).sort());
  });

  it("filters rows across categories and hides empty categories", async () => {
    await renderDialog();
    await typeInSearch("undo");
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>("[data-shortcut-id]"),
      ).map((row) => row.dataset.shortcutId),
    ).toEqual(["undo"]);
    expect(categoryButtons().map((b) => b.dataset.shortcutsCategory)).toEqual([
      "essential",
    ]);

    await typeInSearch("zoom");
    expect(categoryButtons().map((b) => b.dataset.shortcutsCategory)).toEqual([
      "zoom",
    ]);
  });

  it("shows an empty state naming the query when nothing matches", async () => {
    await renderDialog();
    await typeInSearch("qqqqq");
    expect(document.querySelector("[data-shortcuts-empty]")?.textContent).toBe(
      "No shortcuts match “qqqqq”",
    );
    expect(categoryButtons()).toHaveLength(0);
    expect(document.querySelector("[data-shortcut-id]")).toBeNull();
  });

  it("scrolls to a clicked category and marks it current", async () => {
    await renderDialog();
    const scrollTo = Element.prototype.scrollTo as ReturnType<typeof vi.fn>;
    expect(categoryButtons()[0]?.getAttribute("aria-current")).toBe("true");
    const tools = categoryButtons().find(
      (b) => b.dataset.shortcutsCategory === "tools",
    )!;
    await act(async () => tools.click());
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(tools.getAttribute("aria-current")).toBe("true");
    expect(categoryButtons()[0]?.getAttribute("aria-current")).toBeNull();
  });

  it("keeps the nudge-size fields in the Cursor section", async () => {
    const onNudgeAmountsChange = vi.fn();
    await renderDialog({
      nudgeAmounts: { small: 1, big: 10 },
      onNudgeAmountsChange,
    });
    const field = document.querySelector<HTMLInputElement>(
      '[data-shortcut-section="cursor"] [data-nudge-amount="big"]',
    )!;
    expect(field.value).toBe("10");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(field, "25");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onNudgeAmountsChange).toHaveBeenCalledWith({ small: 1, big: 25 });
  });

  it("closes on Escape and consumes the event so editor hotkeys never see it", async () => {
    const { onClose } = await renderDialog();
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      search().dispatchEvent(event);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("closes from the close button", async () => {
    const { onClose } = await renderDialog();
    await act(async () =>
      document
        .querySelector<HTMLElement>("[data-keyboard-shortcuts-close]")!
        .click(),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("identifies events that originate inside the dialog", async () => {
    await renderDialog();
    expect(isKeyboardShortcutsDialogTarget(search())).toBe(true);
    expect(isKeyboardShortcutsDialogTarget(document.body)).toBe(false);
    expect(isKeyboardShortcutsDialogTarget(null)).toBe(false);
  });
});
