import type { BlockAttrReader } from "@agent-native/core/blocks/server";
import { describe, expect, it } from "vitest";

import {
  openApiSpecMdx,
  openApiSpecSchema,
  type OpenApiSpecData,
} from "./openapi-spec.config.js";

/**
 * Minimal `BlockAttrReader` over a plain attribute bag, mirroring the runtime
 * `createAttrReader` value-domain narrowing. Lets the test assert the `toAttrs` →
 * `fromAttrs` round-trip without spinning up the full MDX serialize/parse
 * pipeline (the server registry specs cover the full path).
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

/** Drop keys whose value is `undefined`, mirroring the `prop()` encoder. */
function compactAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attrs).filter(([, value]) => value !== undefined),
  );
}

/** Re-decode data from the attribute bag `toAttrs` produced. */
function roundTrip(data: OpenApiSpecData): OpenApiSpecData {
  const attrs = compactAttrs(
    openApiSpecMdx.toAttrs(data) as Record<string, unknown>,
  );
  return openApiSpecMdx.fromAttrs(reader(attrs), "");
}

const sampleSpec = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "Widgets API", version: "1.2.0" },
  tags: [{ name: "widgets", description: "Manage widgets" }],
  paths: {
    "/widgets": {
      get: {
        tags: ["widgets"],
        summary: "List widgets",
        responses: { "200": { description: "OK" } },
      },
    },
  },
});

const sample: OpenApiSpecData = {
  spec: sampleSpec,
  title: "Widgets reference",
};

describe("openapi-spec block — schema", () => {
  it("accepts a full spec block", () => {
    expect(openApiSpecSchema.parse(sample)).toEqual(sample);
  });

  it("accepts a minimal spec-only block", () => {
    const minimal = { spec: "{}" };
    expect(openApiSpecSchema.parse(minimal)).toEqual(minimal);
  });

  it("accepts an empty spec string (defensive: reader handles parse errors)", () => {
    expect(openApiSpecSchema.parse({ spec: "" })).toEqual({ spec: "" });
  });

  it("rejects a missing spec", () => {
    expect(() => openApiSpecSchema.parse({ title: "x" })).toThrow();
  });

  it("rejects a non-string spec", () => {
    expect(() =>
      openApiSpecSchema.parse({ spec: { openapi: "3.0.0" } }),
    ).toThrow();
  });
});

describe("openapi-spec block — mdx round-trip", () => {
  it("uses the stable OpenApi MDX tag", () => {
    expect(openApiSpecMdx.tag).toBe("OpenApi");
  });

  it("emits attributes in a stable order (title → spec)", () => {
    const attrs = openApiSpecMdx.toAttrs(sample);
    expect(Object.keys(attrs)).toEqual(["title", "spec"]);
  });

  it("round-trips title + spec losslessly through toAttrs/fromAttrs", () => {
    expect(roundTrip(sample)).toEqual(sample);
  });

  it("round-trips a spec-only block (no title attribute)", () => {
    const data: OpenApiSpecData = { spec: sampleSpec };
    // No `title` attribute is emitted, so the decode yields `title: undefined`.
    expect(roundTrip(data)).toEqual({ spec: sampleSpec, title: undefined });
  });

  it("decodes a missing spec attribute to an empty string", () => {
    expect(openApiSpecMdx.fromAttrs(reader({}), "")).toEqual({
      spec: "",
      title: undefined,
    });
  });
});
