import { describe, expect, it } from "vitest";

import type { ContentDatabaseRowMutationResult } from "../shared/api.js";
import addDatabaseItem from "./add-database-item.js";
import updateDatabaseItem from "./update-database-item.js";
import upsertDatabaseItemByKey from "./upsert-database-item-by-key.js";

const result = {
  receipt: {
    target: {
      databaseId: "database & one",
      databaseDocumentId: "database/page",
    },
    row: { documentId: "row/page" },
  },
} as unknown as ContentDatabaseRowMutationResult;

describe("database row action links", () => {
  it.each([
    ["add-database-item", addDatabaseItem],
    ["update-database-item", updateDatabaseItem],
    ["upsert-database-item-by-key", upsertDatabaseItemByKey],
  ])("preserves membership context for %s", (_name, action) => {
    expect(typeof action.link).toBe("function");
    const link = (action.link as Function)({ args: {}, result });
    const url = new URL(link.url, "http://content.test");

    expect(url.pathname).toBe("/_agent-native/open");
    expect(url.searchParams.get("view")).toBe("editor");
    expect(url.searchParams.get("documentId")).toBe("row/page");
    expect(url.searchParams.get("databaseId")).toBe("database & one");
    expect(url.searchParams.get("databaseDocumentId")).toBe("database/page");
  });
});
