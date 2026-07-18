import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schemaMutationActions = [
  "configure-document-property.ts",
  "delete-document-property.ts",
  "duplicate-document-property.ts",
  "reorder-document-property.ts",
  "add-content-database-source-field-property.ts",
  "bind-content-database-source-field.ts",
  "materialize-builder-required-fields.ts",
];

describe("Content database schema lock coverage", () => {
  it.each(schemaMutationActions)("guards %s", (fileName) => {
    const source = readFileSync(
      new URL(`./${fileName}`, import.meta.url),
      "utf8",
    );
    expect(source).toContain("assertContentDatabaseSchemaUnlocked");
  });
});
