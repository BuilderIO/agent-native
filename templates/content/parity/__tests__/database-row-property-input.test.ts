import { describe, expect, it } from "vitest";

import {
  canonicalizeDatabasePropertyInput,
  databasePropertyEntriesSchema,
  normalizeDatabasePropertyInput,
} from "../../actions/_database-property-input";
import { digest } from "../../actions/_database-row-mutation";
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

  it("preserves __proto__ as an ordinary property definition ID", () => {
    const propertyEntries = databasePropertyEntriesSchema.parse([
      { propertyId: "__proto__", value: "preserve me" },
    ]);
    const normalized = normalizeDatabasePropertyInput({
      propertyEntries,
    });

    expect(normalized).toBeDefined();
    expect(Object.getPrototypeOf(normalized)).toBeNull();
    expect(Object.keys(normalized!)).toEqual(["__proto__"]);
    expect(Object.prototype.hasOwnProperty.call(normalized, "__proto__")).toBe(
      true,
    );
    expect(normalized?.["__proto__"]).toBe("preserve me");
  });

  it("removes the model-only representation before canonical hashing", () => {
    const canonical = canonicalizeDatabasePropertyInput({
      idempotencyKey: "same-intent",
      propertyEntries: [
        { propertyId: "status-id", value: "ready" },
        { propertyId: "evidence-id", value: "preserve me" },
      ],
    });

    expect(canonical).toEqual({
      idempotencyKey: "same-intent",
      propertyValues: {
        "status-id": "ready",
        "evidence-id": "preserve me",
      },
    });
    expect(canonical).not.toHaveProperty("propertyEntries");
  });

  it("gives equivalent entry and record inputs the same canonical digest", () => {
    const fromEntries = canonicalizeDatabasePropertyInput({
      idempotencyKey: "same-intent",
      propertyEntries: [
        { propertyId: "status-id", value: "ready" },
        { propertyId: "evidence-id", value: "preserve me" },
      ],
    });
    const fromRecord = canonicalizeDatabasePropertyInput({
      idempotencyKey: "same-intent",
      propertyValues: {
        "evidence-id": "preserve me",
        "status-id": "ready",
      },
    });

    expect(digest(fromEntries)).toBe(digest(fromRecord));
  });

  it("includes __proto__ property values in the canonical digest", () => {
    const withPrototypeNamedProperty = canonicalizeDatabasePropertyInput({
      idempotencyKey: "same-intent",
      propertyEntries: [{ propertyId: "__proto__", value: "preserve me" }],
    });
    const withoutProperty = canonicalizeDatabasePropertyInput({
      idempotencyKey: "same-intent",
      propertyValues: {},
    });

    expect(digest(withPrototypeNamedProperty)).not.toBe(
      digest(withoutProperty),
    );
  });
});
