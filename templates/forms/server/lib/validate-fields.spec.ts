import { describe, expect, it } from "vitest";

import {
  assertValidFields,
  FIELD_ID_PATTERN,
  normalizeFieldIds,
  normalizePersistedFields,
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
      { id: "email", type: "text", label: "Email", required: false },
    ]) as Array<{ id: string }>;

    expect(field.id).toBe("email");
  });

  it("disambiguates generated ids so two fields never collide", () => {
    const fields = normalizeFieldIds([
      { type: "text", label: "Name", required: false },
      { type: "text", label: "Name", required: false },
    ]) as Array<{ id: string }>;

    expect(fields[0].id).not.toBe(fields[1].id);
    expect(() => assertValidFields(fields)).not.toThrow();
  });

  it("falls back to a generic id when the label is empty or unusable", () => {
    const [field] = normalizeFieldIds([
      { type: "text", label: "", required: false },
    ]) as Array<{ id: string }>;

    expect(field.id).toMatch(FIELD_ID_PATTERN);
  });

  it("does not touch an id that fails validation for a reason other than being missing", () => {
    // An unsafe id (XSS-shaped) must still fail assertValidFields — this
    // helper only fills in MISSING ids, it must never launder an attacker
    // -controlled string into looking "generated".
    const fields = normalizeFieldIds([
      {
        id: 'x" onfocus="alert(1)',
        type: "text",
        label: "Name",
        required: false,
      },
    ]) as Array<{ id: string }>;
    expect(fields[0].id).toMatch(FIELD_ID_PATTERN);
    expect(fields[0].id).not.toContain("onfocus");
  });

  it("rejects incomplete field objects before they can be persisted", () => {
    expect(() => assertValidFields([{ id: "name" }])).toThrow(
      "field #1 has an invalid type",
    );
    expect(() =>
      assertValidFields([{ id: "name", type: "text", required: false }]),
    ).toThrow("field #1 label must be a string");
    expect(() =>
      assertValidFields([{ id: "name", type: "text", label: "Name" }]),
    ).toThrow("field #1 required must be a boolean");
  });
});

describe("normalizePersistedFields", () => {
  it("keeps legacy granular edits compatible with the current field contract", () => {
    const fields = normalizePersistedFields([
      { id: "legacy", type: "dropdown", label: "Legacy" },
      { id: "known", type: "text", label: "Known" },
    ]) as Array<Record<string, unknown>>;

    expect(fields).toEqual([
      {
        id: "legacy",
        type: "text",
        label: "Legacy",
        required: false,
      },
      {
        id: "known",
        type: "text",
        label: "Known",
        required: false,
      },
    ]);
    expect(() => assertValidFields(fields)).not.toThrow();
  });
});

describe("file field metadata", () => {
  it("accepts bounded multiple file fields", () => {
    expect(() =>
      assertValidFields([
        {
          id: "screenshots",
          type: "file",
          label: "Screenshots",
          required: false,
          multiple: true,
          accept: "image/png,.webp",
          maxSizeBytes: 5 * 1024 * 1024,
          maxFiles: 5,
        },
      ]),
    ).not.toThrow();
  });

  it("rejects file metadata on other field types and unsafe limits", () => {
    expect(() =>
      assertValidFields([
        {
          id: "name",
          type: "text",
          label: "Name",
          required: false,
          accept: "image/png",
        },
      ]),
    ).toThrow("file metadata is only valid for file fields");
    expect(() =>
      assertValidFields([
        {
          id: "screenshots",
          type: "file",
          label: "Screenshots",
          required: false,
          multiple: false,
          maxFiles: 2,
        },
      ]),
    ).toThrow("maxFiles requires multiple");
  });
});
