import { describe, expect, it } from "vitest";

import {
  contentDatabaseSourceFieldAllowsLocalWrite,
  contentDatabaseSourceFieldSavesEditsToSource,
  contentDatabaseSourceManagedPropertyIds,
  contentDatabaseSourceFieldsAllowLocalWrite,
  contentDatabaseSourceWritebackPropertyIds,
  contentDatabaseSourceWritebackValueError,
  parseContentDatabaseSourceFieldReadOnly,
  parseContentDatabaseSourceWriteOwner,
} from "./source-field-policy";

describe("Content source field write policy", () => {
  it("allows only explicit local ownership with an explicit writable flag", () => {
    expect(
      contentDatabaseSourceFieldAllowsLocalWrite({
        writeOwner: "local",
        readOnly: 0,
      }),
    ).toBe(true);
    expect(
      contentDatabaseSourceFieldAllowsLocalWrite({
        writeOwner: "local",
        readOnly: false,
      }),
    ).toBe(true);

    for (const field of [
      { writeOwner: "source", readOnly: 0 },
      { writeOwner: "derived", readOnly: 0 },
      { writeOwner: "local", readOnly: 1 },
      { writeOwner: "local", readOnly: true },
    ]) {
      expect(contentDatabaseSourceFieldAllowsLocalWrite(field)).toBe(false);
    }
  });

  it("rejects unknown ownership and read-only values instead of coercing them", () => {
    expect(() => parseContentDatabaseSourceWriteOwner("unknown")).toThrow(
      "Invalid Content source field write owner: unknown",
    );
    expect(() => parseContentDatabaseSourceWriteOwner(null)).toThrow(
      "Invalid Content source field write owner: null",
    );
    expect(() => parseContentDatabaseSourceFieldReadOnly(2)).toThrow(
      "Invalid Content source field read-only value: 2",
    );
    expect(() => parseContentDatabaseSourceFieldReadOnly(undefined)).toThrow(
      "Invalid Content source field read-only value: undefined",
    );
  });

  it("validates every mapped field before deciding the combined policy", () => {
    expect(() =>
      contentDatabaseSourceFieldsAllowLocalWrite([
        { writeOwner: "source", readOnly: 1 },
        { writeOwner: "unknown", readOnly: 0 },
      ]),
    ).toThrow("Invalid Content source field write owner: unknown");
  });

  it("marks a property source-managed when any mapping blocks local writes", () => {
    expect(
      contentDatabaseSourceManagedPropertyIds([
        { propertyId: "local", writeOwner: "local", readOnly: 0 },
        { propertyId: "shared", writeOwner: "local", readOnly: 0 },
        { propertyId: "shared", writeOwner: "source", readOnly: 1 },
      ]),
    ).toEqual(new Set(["shared"]));
  });

  it("saves edits to Builder entry fields only on the Builder test model", () => {
    const author = {
      writeOwner: "source",
      readOnly: 0,
      mappingType: "property",
      sourceFieldKey: "data.author",
      sourceType: "builder-cms",
      sourceTable: "agent-native-blog-article-test",
      sourceMetadataJson: "{}",
    };
    expect(contentDatabaseSourceFieldSavesEditsToSource(author)).toBe(true);
    expect(
      contentDatabaseSourceFieldSavesEditsToSource({
        ...author,
        sourceMetadataJson: JSON.stringify({ federation: { role: "primary" } }),
      }),
    ).toBe(true);

    for (const field of [
      {
        ...author,
        sourceMetadataJson: JSON.stringify({
          federation: { role: "secondary" },
        }),
      },
      {
        ...author,
        sourceMetadataJson: JSON.stringify({ federation: { role: "other" } }),
      },
      { ...author, sourceMetadataJson: JSON.stringify({ federation: {} }) },
      { ...author, sourceMetadataJson: "not json" },
      { ...author, sourceMetadataJson: "" },
      { ...author, sourceMetadataJson: "null" },
      { ...author, sourceMetadataJson: null },
      { ...author, sourceMetadataJson: undefined },
      { ...author, sourceTable: "blog-article" },
      { ...author, sourceType: "notion-database" },
      { ...author, readOnly: 1 },
      { ...author, writeOwner: "derived" },
      { ...author, writeOwner: "local" },
      { ...author, mappingType: "title" },
      { ...author, sourceFieldKey: "fields.status" },
      { ...author, sourceFieldKey: "data.title" },
      { ...author, sourceFieldKey: "data.blocks" },
    ]) {
      expect(contentDatabaseSourceFieldSavesEditsToSource(field)).toBe(false);
    }
  });

  it("lists source-managed properties whose every mapping saves edits back", () => {
    const builderField = {
      writeOwner: "source",
      readOnly: 0,
      mappingType: "property",
      sourceType: "builder-cms",
      sourceTable: "agent-native-blog-article-test",
      sourceMetadataJson: "{}",
    };
    expect(
      contentDatabaseSourceWritebackPropertyIds([
        {
          ...builderField,
          propertyId: "author",
          sourceFieldKey: "data.author",
        },
        {
          ...builderField,
          propertyId: "status",
          sourceFieldKey: "fields.status",
        },
        { ...builderField, propertyId: "shared", sourceFieldKey: "data.topic" },
        {
          ...builderField,
          propertyId: "shared",
          sourceFieldKey: "data.topic",
          sourceTable: "blog-article",
        },
        { propertyId: "notes", writeOwner: "local", readOnly: 0 },
      ]),
    ).toEqual(new Set(["author"]));
  });

  it("accepts only values Builder can store for a field that saves to Builder", () => {
    const link = "https://cdn.builder.io/api/v1/image/assets%2Fcover";
    expect(
      contentDatabaseSourceWritebackValueError("files_media", [link]),
    ).toBe(null);
    expect(contentDatabaseSourceWritebackValueError("files_media", null)).toBe(
      null,
    );
    expect(
      contentDatabaseSourceWritebackValueError("files_media", [link, link]),
    ).toMatch(/single link/);
    expect(
      contentDatabaseSourceWritebackValueError("files_media", [
        "/api/private-media/cover.png",
      ]),
    ).toMatch(/single link/);
    expect(
      contentDatabaseSourceWritebackValueError("date", {
        start: "2026-11-23",
        includeTime: false,
      }),
    ).toBe(null);
    expect(
      contentDatabaseSourceWritebackValueError("date", {
        start: "2026-11-23",
        end: "2026-11-24",
        includeTime: false,
      }),
    ).toMatch(/not a range/);
    expect(contentDatabaseSourceWritebackValueError("text", "x")).toBe(null);

    const options = [{ id: "author_1" }, { id: "author_2" }];
    expect(
      contentDatabaseSourceWritebackValueError("select", "author_1", options),
    ).toBe(null);
    expect(
      contentDatabaseSourceWritebackValueError("select", null, options),
    ).toBe(null);
    expect(
      contentDatabaseSourceWritebackValueError("select", "made_up", options),
    ).toMatch(/options this field already lists/);
    expect(
      contentDatabaseSourceWritebackValueError(
        "multi_select",
        ["author_1", "made_up"],
        options,
      ),
    ).toMatch(/options this field already lists/);
  });
});
