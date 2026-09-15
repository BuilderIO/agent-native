import type { BlockAttrReader } from "@agent-native/core/blocks/server";
import { describe, expect, it } from "vitest";

import {
  jsonExplorerMdx,
  jsonExplorerSchema,
  type JsonExplorerData,
} from "./json-explorer.config.js";

/**
 * Minimal `BlockAttrReader` over a plain attribute bag, mirroring the runtime
 * `createAttrReader` value-domain narrowing (string-vs-number-vs-object). Lets
 * the test assert the `toAttrs` → `fromAttrs` round-trip without spinning up the
 * full MDX serialize/parse pipeline.
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
function roundTrip(data: JsonExplorerData): JsonExplorerData {
  const attrs = jsonExplorerMdx.toAttrs(data) as Record<string, unknown>;
  return jsonExplorerMdx.fromAttrs(reader(attrs), "");
}

describe("json-explorer block config", () => {
  it("parses valid json-explorer data", () => {
    const data = {
      title: "Sample payload",
      json: '{\n  "id": "abc123",\n  "active": true\n}',
      collapsedDepth: 2,
    };
    expect(jsonExplorerSchema.parse(data)).toEqual(data);
  });

  it("parses data with only the required json field", () => {
    const data = { json: '{"x":1}' };
    expect(jsonExplorerSchema.parse(data)).toEqual(data);
  });

  it("rejects a non-integer collapsedDepth", () => {
    expect(() =>
      jsonExplorerSchema.parse({ json: "{}", collapsedDepth: 1.5 }),
    ).toThrow();
  });

  it("rejects a negative collapsedDepth", () => {
    expect(() =>
      jsonExplorerSchema.parse({ json: "{}", collapsedDepth: -1 }),
    ).toThrow();
  });

  it("uses the stable Json MDX tag", () => {
    expect(jsonExplorerMdx.tag).toBe("Json");
  });

  it("round-trips title + json + collapsedDepth losslessly", () => {
    const data: JsonExplorerData = {
      title: "Response",
      json: '{\n  "tags": ["alpha", "beta"],\n  "meta": { "count": 2, "owner": null }\n}',
      collapsedDepth: 1,
    };
    expect(roundTrip(data)).toEqual(data);
  });

  it("round-trips a multiline json payload byte-for-byte", () => {
    const json = JSON.stringify(
      { id: "abc123", active: true, tags: ["alpha", "beta"] },
      null,
      2,
    );
    const data: JsonExplorerData = { json };
    // No title/collapsedDepth attributes are emitted, so the decode yields
    // `title: undefined` / `collapsedDepth: undefined`.
    expect(roundTrip(data)).toEqual({
      json,
      title: undefined,
      collapsedDepth: undefined,
    });
  });

  it("decodes a missing json attribute to an empty string", () => {
    expect(jsonExplorerMdx.fromAttrs(reader({}), "")).toEqual({
      json: "",
      title: undefined,
      collapsedDepth: undefined,
    });
  });

  it("preserves the json text exactly even when it is invalid JSON", () => {
    // The block stores raw text as the source of truth; the config must NOT
    // validate or reformat it (the reader parses defensively at render time).
    const data: JsonExplorerData = { json: "{ not valid json," };
    expect(jsonExplorerSchema.parse(data)).toEqual(data);
    expect(roundTrip(data)).toEqual({
      json: "{ not valid json,",
      title: undefined,
      collapsedDepth: undefined,
    });
  });
});
