import { describe, expect, it } from "vitest";

import { ORGANIZATION_SOURCE_ONLY_NOTE } from "./connection-routing.js";

describe("connection routing messages", () => {
  it("names the catalog tools a saved connection uses", () => {
    expect(ORGANIZATION_SOURCE_ONLY_NOTE).toContain("list-connection-datasets");
    expect(ORGANIZATION_SOURCE_ONLY_NOTE).toContain("get-data-table-details");
  });
});
