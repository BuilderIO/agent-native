import type { BlockAttrReader } from "@agent-native/core/blocks/server";
import { describe, expect, it } from "vitest";

import {
  dataModelMdx,
  dataModelSchema,
  type DataModelData,
} from "./data-model.config.js";

/**
 * Minimal `BlockAttrReader` over a plain attribute bag, mirroring the runtime
 * `createAttrReader` value-domain narrowing (string-vs-number-vs-array-vs-object).
 * Lets the test assert the `toAttrs` → `fromAttrs` round-trip without spinning up
 * the full MDX serialize/parse pipeline.
 */
function reader(attrs: Record<string, unknown>): BlockAttrReader {
  const read = (name: string) => attrs[name];
  return {
    raw: read,
    string: (name) =>
      typeof read(name) === "string" ? (read(name) as string) : undefined,
    number: (name) =>
      typeof read(name) === "number" ? (read(name) as number) : undefined,
    bool: (name) =>
      typeof read(name) === "boolean" ? (read(name) as boolean) : undefined,
    array: <T = unknown>(name: string) =>
      Array.isArray(read(name)) ? (read(name) as T[]) : undefined,
    object: <T = unknown>(name: string) => {
      const value = read(name);
      return value && typeof value === "object" ? (value as T) : undefined;
    },
  };
}

/** Re-decode data from the attribute bag `toAttrs` produced. */
function roundTrip(data: DataModelData): DataModelData {
  const attrs = dataModelMdx.toAttrs(data) as Record<string, unknown>;
  return dataModelMdx.fromAttrs(reader(attrs), "");
}

const sample: DataModelData = {
  entities: [
    {
      id: "e_user",
      name: "User",
      fields: [
        { name: "id", type: "uuid", pk: true },
        { name: "email", type: "text" },
        { name: "name", type: "text", nullable: true },
      ],
    },
    {
      id: "e_post",
      name: "Post",
      note: "Authored content",
      fields: [
        { name: "id", type: "uuid", pk: true },
        { name: "author_id", type: "uuid", fk: "User.id" },
        { name: "title", type: "text", default: "Untitled" },
      ],
    },
  ],
  relations: [{ from: "e_user", to: "e_post", kind: "1-n", label: "writes" }],
};

describe("data-model block config", () => {
  it("parses a valid data model with entities and relations", () => {
    expect(dataModelSchema.parse(sample)).toEqual(sample);
  });

  it("parses a data model without explicit relations", () => {
    const data = {
      entities: [
        {
          id: "e_user",
          name: "User",
          fields: [{ name: "id", type: "uuid", pk: true }],
        },
      ],
    };
    expect(dataModelSchema.parse(data)).toEqual(data);
  });

  it("rejects a data model with no entities", () => {
    expect(() => dataModelSchema.parse({ entities: [] })).toThrow();
  });

  it("rejects an entity missing a name", () => {
    expect(() =>
      dataModelSchema.parse({
        entities: [{ id: "e_user", fields: [] }],
      }),
    ).toThrow();
  });

  it("rejects a field missing a name", () => {
    expect(() =>
      dataModelSchema.parse({
        entities: [{ id: "e_user", name: "User", fields: [{ type: "uuid" }] }],
      }),
    ).toThrow();
  });

  it("rejects an unknown relation kind", () => {
    expect(() =>
      dataModelSchema.parse({
        entities: [
          {
            id: "e_user",
            name: "User",
            fields: [{ name: "id" }],
          },
        ],
        relations: [{ from: "e_user", to: "e_user", kind: "many" }],
      }),
    ).toThrow();
  });

  it("uses the stable DataModel MDX tag", () => {
    expect(dataModelMdx.tag).toBe("DataModel");
  });

  it("round-trips entities + relations losslessly through toAttrs/fromAttrs", () => {
    expect(roundTrip(sample)).toEqual(sample);
  });

  it("round-trips losslessly when relations are absent", () => {
    const data: DataModelData = {
      entities: [
        {
          id: "e_user",
          name: "User",
          fields: [
            { name: "id", type: "uuid", pk: true },
            { name: "email", type: "text" },
          ],
        },
      ],
    };
    // No `relations` attribute is emitted, so the decode yields
    // `relations: undefined`.
    expect(roundTrip(data)).toEqual({
      entities: data.entities,
      relations: undefined,
    });
  });

  it("decodes a missing entities attribute to an empty array", () => {
    expect(dataModelMdx.fromAttrs(reader({}), "")).toEqual({
      entities: [],
      relations: undefined,
    });
  });
});
