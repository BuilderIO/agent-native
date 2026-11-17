import { describe, expect, it } from "vitest";

import { contentActionInvalidatePredicate } from "./content-action-refresh";

const titles = (open: boolean) => ({
  queryKey: ["action", "list-document-titles", {}],
  isActive: () => open,
});
const results = (open: boolean) => ({
  queryKey: ["action", "search-documents", { query: "plan" }],
  isActive: () => open,
});
const event = (key: string) => [{ source: "action", key }];

describe("Search's title list after another tab's writes", () => {
  it.each([
    "create-document",
    "delete-document",
    "restore-document",
    "move-document",
    "duplicate-page",
    "add-database-item",
    "remove-database-items",
    "set-document-discoverability",
    "restore-document-version",
    "share-resource",
    "unshare-resource",
    "set-resource-visibility",
  ])("reloads after %s, with the menu open or closed", (key) => {
    const predicate = contentActionInvalidatePredicate("/page/document-1");
    expect(predicate(titles(true), event(key))).toBe(true);
    expect(predicate(titles(false), event(key))).toBe(true);
    expect(predicate(results(true), event(key))).toBe(true);
    expect(predicate(results(false), event(key))).toBe(true);
  });

  it.each(["update-document", "update-database-item"])(
    "marks a closed menu's titles stale after %s, which can rename a page",
    (key) => {
      const predicate = contentActionInvalidatePredicate("/page/document-1");
      expect(predicate(titles(false), event(key))).toBe(true);
      expect(predicate(results(false), event(key))).toBe(true);
    },
  );

  it("doesn't reload an open menu's titles for every body save", () => {
    const predicate = contentActionInvalidatePredicate("/page/document-1");
    expect(predicate(titles(true), event("update-document"))).toBe(false);
    expect(predicate(results(true), event("update-document"))).toBe(false);
  });

  it("ignores writes that can't change a title or place", () => {
    const predicate = contentActionInvalidatePredicate("/page/document-1");
    expect(predicate(titles(false), event("add-comment"))).toBe(false);
    expect(predicate(titles(false), event("edit-document"))).toBe(false);
  });
});
