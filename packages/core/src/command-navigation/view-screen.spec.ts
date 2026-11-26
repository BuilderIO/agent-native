import { expect, it } from "vitest";

import { defineViewScreen } from "./index.js";
import { viewScreenSchema } from "./view-screen.js";

const screen = {
  route: "/items",
  view: "list",
  title: "Items",
  activeFilters: { archived: false },
  selection: [{ id: "item-1" }],
  visibleItems: [{ id: "item-1", name: "Example" }],
  liveDraft: { name: "Draft" },
  userEditedSince: 1234,
};

it("keeps a typed screen snapshot intact", () => {
  expect(defineViewScreen(screen)).toBe(screen);
  expect(viewScreenSchema.parse(screen)).toEqual(screen);
});

it("refuses a snapshot that cannot describe a screen", () => {
  expect(
    viewScreenSchema.safeParse({ ...screen, selection: "item-1" }).success,
  ).toBe(false);
  expect(
    viewScreenSchema.safeParse({ ...screen, visibleItems: undefined }).success,
  ).toBe(false);
});
