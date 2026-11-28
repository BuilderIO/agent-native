import { describe, expect, it } from "vitest";

import { contentActionInvalidatePredicate } from "./content-action-refresh";

const backlinks = (documentId: string, active = true) => ({
  queryKey: ["action", "list-backlinks", { documentId }],
  isActive: () => active,
});

const write = (key: string, resourceId?: string) => ({
  source: "action",
  key,
  ...(resourceId ? { resourceType: "document", resourceId } : {}),
});

describe("Backlink list refresh", () => {
  it.each([
    "edit-document",
    "update-document",
    "create-document",
    "delete-document",
    "restore-document",
    "share-resource",
  ])("reads the open list again after %s on another page", (key) => {
    const predicate = contentActionInvalidatePredicate("/page/target");
    expect(predicate(backlinks("target"), [write(key, "other")])).toBe(true);
  });

  it("leaves the list alone after a write to the page itself", () => {
    const predicate = contentActionInvalidatePredicate("/page/target");
    expect(
      predicate(backlinks("target"), [write("edit-document", "target")]),
    ).toBe(false);
  });

  it("leaves a list no one is showing alone", () => {
    const predicate = contentActionInvalidatePredicate("/page/target");
    expect(
      predicate(backlinks("target", false), [write("edit-document", "other")]),
    ).toBe(false);
  });

  it("leaves the list alone after a comment", () => {
    const predicate = contentActionInvalidatePredicate("/page/target");
    expect(
      predicate(backlinks("target"), [write("add-comment", "other")]),
    ).toBe(false);
  });
});
