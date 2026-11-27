import { describe, expect, it } from "vitest";

import { contentActionInvalidatePredicate } from "./content-action-refresh";

const checks = (documentId: string) => ({
  queryKey: ["action", "list-page-checks", { documentId }],
});

describe("Check list refresh", () => {
  it.each([
    "add-page-check",
    "update-page-check",
    "delete-page-check",
    "run-page-checks",
    "skip-page-check",
  ])("reads the page's checks again after %s on it", (key) => {
    const predicate = contentActionInvalidatePredicate("/page/draft");
    expect(
      predicate(checks("draft"), [
        {
          source: "action",
          key,
          resourceType: "document",
          resourceId: "draft",
        },
      ]),
    ).toBe(true);
  });

  it("leaves the checks alone after another page's checks change", () => {
    const predicate = contentActionInvalidatePredicate("/page/draft");
    expect(
      predicate(checks("draft"), [
        {
          source: "action",
          key: "run-page-checks",
          resourceType: "document",
          resourceId: "other",
        },
      ]),
    ).toBe(false);
  });

  it("never reloads the page body for a check change", () => {
    const predicate = contentActionInvalidatePredicate("/page/draft");
    expect(
      predicate({ queryKey: ["action", "get-document", { id: "draft" }] }, [
        {
          source: "action",
          key: "run-page-checks",
          resourceType: "document",
          resourceId: "draft",
        },
      ]),
    ).toBe(false);
  });

  it("leaves the checks alone after a body edit, which the open editor sees itself", () => {
    const predicate = contentActionInvalidatePredicate("/page/draft");
    expect(
      predicate(checks("draft"), [
        {
          source: "action",
          key: "edit-document",
          resourceType: "document",
          resourceId: "draft",
        },
      ]),
    ).toBe(false);
  });
});
