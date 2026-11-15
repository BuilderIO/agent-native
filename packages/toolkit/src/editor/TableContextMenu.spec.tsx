// @vitest-environment happy-dom

import { expect, it } from "vitest";

import { TABLE_CONTEXT_MENU_ITEMS } from "./TableContextMenu.js";

it("lists the executor actions in menu order", () => {
  const labels = TABLE_CONTEXT_MENU_ITEMS.map((item) =>
    item.divider ? "---" : item.label,
  );
  expect(labels).toEqual([
    "Insert row above",
    "Insert row below",
    "Insert column left",
    "Insert column right",
    "---",
    "Delete row",
    "Delete column",
    "Delete table",
  ]);
});

it("marks Delete table as the only danger action after the divider", () => {
  const danger = TABLE_CONTEXT_MENU_ITEMS.filter((item) => item.danger);
  expect(danger.map((item) => item.label)).toEqual(["Delete table"]);
  const dividerIndex = TABLE_CONTEXT_MENU_ITEMS.findIndex((i) => i.divider);
  const dangerIndex = TABLE_CONTEXT_MENU_ITEMS.findIndex((i) => i.danger);
  expect(dangerIndex).toBeGreaterThan(dividerIndex);
});

it("gives every non-divider row a command", () => {
  for (const item of TABLE_CONTEXT_MENU_ITEMS) {
    if (item.divider) continue;
    expect(typeof item.run).toBe("function");
  }
});
