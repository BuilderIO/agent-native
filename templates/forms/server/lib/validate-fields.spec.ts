import { describe, expect, it } from "vitest";

import {
  assertValidFields,
  FIELD_ID_PATTERN,
  normalizeFieldIds,
} from "./validate-fields.js";

describe("normalizeFieldIds", () => {
  it("generates a safe id from the label when id is missing (the create-form #1 prod failure)", () => {
    const [field] = normalizeFieldIds([
      { type: "text", label: "Full Name", required: true },
    ]) as Array<{ id: string }>;

    expect(field.id).toMatch(FIELD_ID_PATTERN);
    expect(() => assertValidFields([field])).not.toThrow();
  });

  it("leaves an already-valid id untouched", () => {
    const [field] = normalizeFieldIds([
      { id: "email", type: "text", label: "Email" },
    ]) as Array<{ id: string }>;

    expect(field.id).toBe("email");
  });

  it("disambiguates generated ids so two fields never collide", () => {
    const fields = normalizeFieldIds([
      { type: "text", label: "Name" },
      { type: "text", label: "Name" },
    ]) as Array<{ id: string }>;

    expect(fields[0].id).not.toBe(fields[1].id);
    expect(() => assertValidFields(fields)).not.toThrow();
  });

  it("falls back to a generic id when the label is empty or unusable", () => {
    const [field] = normalizeFieldIds([{ type: "text", label: "" }]) as Array<{
      id: string;
    }>;

    expect(field.id).toMatch(FIELD_ID_PATTERN);
  });

  it("does not touch an id that fails validation for a reason other than being missing", () => {
    // An unsafe id (XSS-shaped) must still fail assertValidFields — this
    // helper only fills in MISSING ids, it must never launder an attacker
    // -controlled string into looking "generated".
    const fields = normalizeFieldIds([
      { id: 'x" onfocus="alert(1)', type: "text", label: "Name" },
    ]) as Array<{ id: string }>;
    expect(fields[0].id).toMatch(FIELD_ID_PATTERN);
    expect(fields[0].id).not.toContain("onfocus");
  });
});
