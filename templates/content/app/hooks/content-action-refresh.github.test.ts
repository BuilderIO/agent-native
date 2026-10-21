import { describe, expect, it } from "vitest";

import { contentActionInvalidatePredicate } from "./content-action-refresh";

describe("GitHub folder sync refresh invalidation", () => {
  const pageId = "content_github_page_1";

  it.each(["sync-github-folder", "refresh-content-database-source"])(
    "rereads an open page after %s",
    (actionName) => {
      const predicate = contentActionInvalidatePredicate(`/page/${pageId}`);
      expect(
        predicate(
          {
            queryKey: ["action", "get-document", { id: pageId }],
            isActive: () => true,
          },
          [{ source: "action", key: actionName }],
        ),
      ).toBe(true);
    },
  );

  it.each(["sync-github-folder", "refresh-content-database-source"])(
    "rereads the open collection, the page list and Trash after %s",
    (actionName) => {
      const predicate = contentActionInvalidatePredicate("/page/collection_1");
      const events = [{ source: "action", key: actionName }];
      expect(
        predicate(
          {
            queryKey: [
              "action",
              "get-content-database",
              { documentId: "collection_1" },
            ],
            isActive: () => true,
          },
          events,
        ),
      ).toBe(true);
      expect(
        predicate({ queryKey: ["action", "list-documents", {}] }, events),
      ).toBe(true);
      expect(
        predicate({ queryKey: ["action", "list-content-trash", {}] }, events),
      ).toBe(true);
    },
  );
});
