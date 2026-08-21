import { describe, expect, it } from "vitest";

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
      const propertyValues = action.tool.parameters.properties.propertyValues;
      expect(propertyValues.description).toContain(
        "Include every schema-valid writable property value the user explicitly requested",
      );
      expect(propertyValues.description).toContain(
        "never pass an empty object",
      );
      expect(propertyValues.description).toContain(
        "Do not invent or clear unmentioned properties",
      );
    },
  );
});
