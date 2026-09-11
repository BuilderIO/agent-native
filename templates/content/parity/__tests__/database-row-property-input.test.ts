import { describe, expect, it } from "vitest";

import {
  canonicalizeDatabasePropertyInput,
  databasePropertyEntriesSchema,
  normalizeDatabasePropertyInput,
} from "../../actions/_database-property-input";
import {
  databaseMutationPayloadDigest,
  legacyDatabaseMutationPayloadDigest,
} from "../../actions/_database-row-mutation";
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
      expect(JSON.stringify(propertyEntries.items)).toContain(
        "Exact immutable property definition ID",
      );
      expect(JSON.stringify(propertyEntries.items)).toContain("propertyType");
      expect(JSON.stringify(propertyEntries.items)).not.toContain('"value":{}');
      expect(propertyEntries.description).toContain(
        "include one entry for every writable property value the user requested",
      );
      expect(propertyEntries.description).toContain(
        "never pass an empty array",
      );
      expect(propertyEntries.description).toContain(
        "Do not invent or clear unmentioned properties",
      );
      expect(properties.target.properties).not.toHaveProperty("authorityScope");
    },
  );

  it("normalizes model-friendly entries into the strict action contract", () => {
    expect(
      normalizeDatabasePropertyInput({
        propertyEntries: [
          {
            propertyId: "status-id",
            propertyType: "status",
            value: "ready",
          },
          {
            propertyId: "evidence-id",
            propertyType: "text",
            value: "preserve me",
          },
        ],
      }),
    ).toEqual({
      propertyValues: {
        "status-id": "ready",
        "evidence-id": "preserve me",
      },
      propertyTypeAssertions: {
        "status-id": "status",
        "evidence-id": "text",
      },
    });
  });

  it("rejects duplicate property entries instead of silently overwriting", () => {
    expect(() =>
      normalizeDatabasePropertyInput({
        propertyEntries: [
          {
            propertyId: "status-id",
            propertyType: "status",
            value: "ready",
          },
          {
            propertyId: "status-id",
            propertyType: "status",
            value: "changed",
          },
        ],
      }),
    ).toThrow(/provided more than once/);
  });

  it("rejects ambiguous entry and record inputs", () => {
    expect(() =>
      normalizeDatabasePropertyInput({
        propertyEntries: [
          {
            propertyId: "status-id",
            propertyType: "status",
            value: "ready",
          },
        ],
        propertyValues: { "status-id": "ready" },
      }),
    ).toThrow(/not both/);
  });

  it("preserves __proto__ as an ordinary property definition ID", () => {
    const propertyEntries = databasePropertyEntriesSchema.parse([
      {
        propertyId: "__proto__",
        propertyType: "text",
        value: "preserve me",
      },
    ]);
    const normalized = normalizeDatabasePropertyInput({
      propertyEntries,
    });

    expect(Object.getPrototypeOf(normalized.propertyValues)).toBeNull();
    expect(Object.keys(normalized.propertyValues!)).toEqual(["__proto__"]);
    expect(
      Object.prototype.hasOwnProperty.call(
        normalized.propertyValues,
        "__proto__",
      ),
    ).toBe(true);
    expect(normalized.propertyValues?.["__proto__"]).toBe("preserve me");
    expect(normalized.propertyTypeAssertions?.["__proto__"]).toBe("text");
  });

  it("requires a schema-visible type and its matching JSON value shape", () => {
    expect(() =>
      databasePropertyEntriesSchema.parse([
        { propertyId: "count-id", value: 3314 },
      ]),
    ).toThrow(/propertyType/);
    expect(() =>
      databasePropertyEntriesSchema.parse([
        {
          propertyId: "count-id",
          propertyType: "number",
          value: "3314",
        },
      ]),
    ).toThrow();
    expect(
      databasePropertyEntriesSchema.parse([
        {
          propertyId: "count-id",
          propertyType: "number",
          value: 3314,
        },
      ]),
    ).toEqual([
      { propertyId: "count-id", propertyType: "number", value: 3314 },
    ]);
  });

  it("removes the model-only representation before canonical hashing", () => {
    const canonical = canonicalizeDatabasePropertyInput({
      idempotencyKey: "same-intent",
      propertyEntries: [
        {
          propertyId: "status-id",
          propertyType: "status",
          value: "ready",
        },
        {
          propertyId: "evidence-id",
          propertyType: "text",
          value: "preserve me",
        },
      ],
    });

    expect(canonical).toEqual({
      idempotencyKey: "same-intent",
      propertyValues: {
        "status-id": "ready",
        "evidence-id": "preserve me",
      },
      propertyTypeAssertions: {
        "status-id": "status",
        "evidence-id": "text",
      },
    });
    expect(canonical).not.toHaveProperty("propertyEntries");
  });

  it("gives equivalent entry and record inputs the same canonical digest", () => {
    const fromEntries = canonicalizeDatabasePropertyInput({
      idempotencyKey: "same-intent",
      propertyEntries: [
        {
          propertyId: "status-id",
          propertyType: "status",
          value: "ready",
        },
        {
          propertyId: "evidence-id",
          propertyType: "text",
          value: "preserve me",
        },
      ],
    });
    const fromRecord = canonicalizeDatabasePropertyInput({
      idempotencyKey: "same-intent",
      propertyValues: {
        "evidence-id": "preserve me",
        "status-id": "ready",
      },
    });

    expect(databaseMutationPayloadDigest("create", fromEntries)).toBe(
      databaseMutationPayloadDigest("create", fromRecord),
    );
  });

  it("retains the authority-bearing legacy digest for receipt replay", () => {
    const input = canonicalizeDatabasePropertyInput({
      idempotencyKey: "existing-receipt",
      target: {
        authorityScope: { kind: "personal", id: "owner@example.com" },
        spaceId: "space-id",
        databaseId: "database-id",
        databaseDocumentId: "database-document-id",
      },
      propertyValues: { "status-id": "ready" },
    });

    expect(legacyDatabaseMutationPayloadDigest("create", input)).not.toBe(
      databaseMutationPayloadDigest("create", input),
    );
    const withoutAuthoredAuthority = {
      ...input,
      target: { ...input.target, authorityScope: undefined },
    };
    expect(
      legacyDatabaseMutationPayloadDigest(
        "create",
        withoutAuthoredAuthority,
        input.target.authorityScope,
      ),
    ).toBe(legacyDatabaseMutationPayloadDigest("create", input));
  });

  it("includes __proto__ property values in the canonical digest", () => {
    const withPrototypeNamedProperty = canonicalizeDatabasePropertyInput({
      idempotencyKey: "same-intent",
      propertyEntries: [
        {
          propertyId: "__proto__",
          propertyType: "text",
          value: "preserve me",
        },
      ],
    });
    const withoutProperty = canonicalizeDatabasePropertyInput({
      idempotencyKey: "same-intent",
      propertyValues: {},
    });

    expect(
      databaseMutationPayloadDigest("create", withPrototypeNamedProperty),
    ).not.toBe(databaseMutationPayloadDigest("create", withoutProperty));
  });
});
