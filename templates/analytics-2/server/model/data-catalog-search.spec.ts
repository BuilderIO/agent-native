import { describe, expect, it } from "vitest";

import { filterCatalogResources } from "./data-catalog-search.js";
import { SAMPLE_SCHEMA_ID } from "./sample-catalog.js";

const publicSchema = { id: SAMPLE_SCHEMA_ID, name: "PUBLIC" };
const otherSchema = { id: "schema:ARCHIVE", name: "ARCHIVE" };

describe("filterCatalogResources", () => {
  it("keeps the sample schema when only one of its tables matches", () => {
    expect(filterCatalogResources([publicSchema], "ord", true)).toEqual([
      publicSchema,
    ]);
  });

  it("drops the sample schema when neither it nor its tables match", () => {
    expect(filterCatalogResources([publicSchema], "zzzz", true)).toEqual([]);
  });

  it("matches warehouse schemas by name only", () => {
    expect(
      filterCatalogResources([publicSchema, otherSchema], "arch", false),
    ).toEqual([otherSchema]);
    expect(filterCatalogResources([publicSchema], "ord", false)).toEqual([]);
  });

  it("returns every resource for an empty search", () => {
    expect(
      filterCatalogResources([publicSchema, otherSchema], "", false),
    ).toEqual([publicSchema, otherSchema]);
  });

  it("matches warehouse schemas case-insensitively and ignores surrounding whitespace", () => {
    expect(
      filterCatalogResources([publicSchema, otherSchema], "ARCH", false),
    ).toEqual([otherSchema]);
    expect(
      filterCatalogResources([publicSchema, otherSchema], "  Public ", false),
    ).toEqual([publicSchema]);
    expect(
      filterCatalogResources([publicSchema, otherSchema], "   ", false),
    ).toEqual([publicSchema, otherSchema]);
  });
});
