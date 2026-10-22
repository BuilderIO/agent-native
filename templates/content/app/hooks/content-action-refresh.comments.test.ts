import { describe, expect, it } from "vitest";

import { contentActionInvalidatePredicate } from "./content-action-refresh";

describe("Collection refresh after Comment changes", () => {
  it.each(["add-comment", "update-comment", "delete-comment"])(
    "refreshes the open Collection's rows after %s, so their counts follow",
    (actionName) => {
      const predicate = contentActionInvalidatePredicate("/page/board-page");
      for (const queryKey of [
        ["action", "get-content-database", { documentId: "board-page" }],
        [
          "action",
          "query-content-database-items",
          { documentId: "board-page", limit: 100 },
        ],
      ]) {
        expect(
          predicate({ queryKey }, [{ source: "action", key: actionName }]),
        ).toBe(true);
      }
    },
  );

  it("leaves another Collection that isn't on screen alone", () => {
    const predicate = contentActionInvalidatePredicate("/page/board-page");
    expect(
      predicate(
        {
          queryKey: [
            "action",
            "get-content-database",
            { documentId: "other-board" },
          ],
          isActive: () => false,
        },
        [{ source: "action", key: "add-comment" }],
      ),
    ).toBe(false);
  });
});
