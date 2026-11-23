import { describe, expect, it } from "vitest";

import { collectionIdFrom } from "./collectionRouteParam";

/**
 * sprint-analytics-2#515 / #516: a collection's own page rendered the index
 * because the page read only React Router's params, which are empty under the
 * workspace catchall route.
 */
describe("collectionIdFrom", () => {
  it("takes the id from the resolved route the page is given", () => {
    expect(
      // the catchall route gives React Router no params at all
      collectionIdFrom({ params: { collectionId: "col_1" } }, {}),
    ).toBe("col_1");
  });

  it("falls back to the router's params when a real route matched", () => {
    expect(collectionIdFrom(undefined, { collectionId: "col_2" })).toBe(
      "col_2",
    );
  });

  it("is undefined on the collections index", () => {
    expect(collectionIdFrom({ params: {} }, {})).toBeUndefined();
    expect(collectionIdFrom(undefined, undefined)).toBeUndefined();
  });

  it("prefers the resolved route when both know an id", () => {
    expect(
      collectionIdFrom(
        { params: { collectionId: "col_route" } },
        { collectionId: "col_router" },
      ),
    ).toBe("col_route");
  });
});
