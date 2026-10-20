import { describe, expect, it } from "vitest";

import { resolveContentOpenPath } from "./core-routes.js";

describe("Content open paths", () => {
  it("preserves database, membership, and named-view context", () => {
    expect(
      resolveContentOpenPath({
        view: "editor",
        params: {
          documentId: "row/page",
          databaseId: "database & one",
          databaseDocumentId: "database/page",
          viewId: "ready view",
        },
      }),
    ).toBe(
      "/page/row%2Fpage?databaseId=database+%26+one&databaseDocumentId=database%2Fpage&viewId=ready+view",
    );
  });

  it("keeps editor and list fallbacks on the Content home", () => {
    expect(resolveContentOpenPath({ view: "editor", params: {} })).toBe(
      "/home",
    );
    expect(resolveContentOpenPath({ view: "list", params: {} })).toBe("/home");
    expect(resolveContentOpenPath({ view: "unknown", params: {} })).toBeNull();
  });
});
