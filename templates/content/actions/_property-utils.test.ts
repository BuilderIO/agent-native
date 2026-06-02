import { describe, expect, it } from "vitest";
import { computedPropertyValue } from "./_property-utils";

const document = {
  id: "doc_abc123",
  createdAt: "2026-06-02T10:00:00.000Z",
  updatedAt: "2026-06-02T11:00:00.000Z",
  ownerEmail: "alice@example.com",
} as Parameters<typeof computedPropertyValue>[1];

describe("computedPropertyValue", () => {
  it("uses database row numbers for ID properties when available", () => {
    expect(
      computedPropertyValue("id", document, { databaseRowNumber: 7 }),
    ).toBe(7);
  });

  it("falls back to the document id when a row number is unavailable", () => {
    expect(computedPropertyValue("id", document)).toBe("doc_abc123");
  });
});
