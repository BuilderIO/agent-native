import { describe, expect, it } from "vitest";

import { normalizeDatabasePropertyInput } from "../../actions/_database-property-input";
import addDatabaseItem from "../../actions/add-database-item";
import updateDatabaseItem from "../../actions/update-database-item";
import upsertDatabaseItemByKey from "../../actions/upsert-database-item-by-key";

const rowMutationActions = [
  ["add-database-item", addDatabaseItem],
  ["update-database-item", updateDatabaseItem],
  ["upsert-database-item-by-key", upsertDatabaseItemByKey],
] as const;

describe("database row property inputs", () => {
  it.each(rowMutationActions)(
    "%s tells the agent to preserve explicitly requested writable values",
    (_name, action) => {
      const properties = action.tool.parameters.properties;
      expect(properties).not.toHaveProperty("propertyValues");
      const propertyEntries = properties.propertyEntries;
      expect(propertyEntries.type).toBe("array");
      expect(propertyEntries.items.properties.propertyId.description).toContain(
        "Exact immutable property definition ID",
      );
      expect(propertyEntries.description).toContain(
        "Include one entry for every schema-valid writable property value the user requested",
      );
      expect(propertyEntries.description).toContain(
        "never pass an empty array",
      );
      expect(propertyEntries.description).toContain(
        "Do not invent or clear unmentioned properties",
      );
    },
  );

  it("normalizes model-friendly entries into the strict action contract", () => {
    expect(
      normalizeDatabasePropertyInput({
        propertyEntries: [
          { propertyId: "status-id", value: "ready" },
          { propertyId: "evidence-id", value: "preserve me" },
        ],
      }),
    ).toEqual({
      "status-id": "ready",
      "evidence-id": "preserve me",
    });
  });

  it("rejects duplicate property entries instead of silently overwriting", () => {
    expect(() =>
      normalizeDatabasePropertyInput({
        propertyEntries: [
          { propertyId: "status-id", value: "ready" },
          { propertyId: "status-id", value: "changed" },
        ],
      }),
    ).toThrow(/provided more than once/);
  });

  it("rejects ambiguous entry and record inputs", () => {
    expect(() =>
      normalizeDatabasePropertyInput({
        propertyEntries: [{ propertyId: "status-id", value: "ready" }],
        propertyValues: { "status-id": "ready" },
      }),
    ).toThrow(/not both/);
  });
});
