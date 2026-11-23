import { describe, expect, it } from "vitest";

import { sampleDatasetPage, SAMPLE_SCHEMA_ID } from "./sample-catalog.js";

describe("sampleDatasetPage search", () => {
  it("keeps the schema when only one of its tables matches", () => {
    const page = sampleDatasetPage({ search: "ord" });
    expect(page.items.map((item) => item.id)).toEqual([SAMPLE_SCHEMA_ID]);
  });

  it("narrows the expanded schema to the matching tables", () => {
    const page = sampleDatasetPage({
      parentId: SAMPLE_SCHEMA_ID,
      search: "ord",
    });
    expect(page.items.map((item) => item.name)).toEqual(["orders"]);
  });

  it("returns nothing when no schema or table matches", () => {
    expect(sampleDatasetPage({ search: "zzzz" }).items).toEqual([]);
  });
});
