import { describe, expect, it } from "vitest";

import { contentActionInvalidatePredicate } from "./content-action-refresh";

describe("Content Trash refresh invalidation", () => {
  it.each([
    "restore-document",
    "permanently-delete-document",
    "execute-content-trash-purge",
  ])("invalidates the Trash list after %s", (actionName) => {
    const predicate = contentActionInvalidatePredicate("/trash");
    expect(
      predicate({ queryKey: ["action", "list-content-trash", {}] }, [
        { source: "action", key: actionName },
      ]),
    ).toBe(true);
  });
});
