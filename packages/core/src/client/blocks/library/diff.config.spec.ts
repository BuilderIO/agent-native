import { describe, expect, it } from "vitest";
import type { BlockAttrReader } from "@agent-native/core/blocks/server";
import { diffMdx, diffSchema, type DiffData } from "./diff.config.js";

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
function roundTrip(data: DiffData): DiffData {
  const attrs = diffMdx.toAttrs(data) as Record<string, unknown>;
  return diffMdx.fromAttrs(reader(attrs), "");
}

describe("diff block config", () => {
  it("parses valid diff data", () => {
    const data = {
      filename: "src/add.ts",
      language: "ts",
      before: "function add(a, b) {\n  return a + b;\n}",
      after: "function add(a: number, b: number): number {\n  return a + b;\n}",
      mode: "unified" as const,
    };
    expect(diffSchema.parse(data)).toEqual(data);
  });

  it("parses diff data with only before/after", () => {
    const data = { before: "a", after: "b" };
    expect(diffSchema.parse(data)).toEqual(data);
  });

  it("accepts both layout modes", () => {
    expect(
      diffSchema.parse({ before: "a", after: "b", mode: "split" }),
    ).toMatchObject({ mode: "split" });
    expect(
      diffSchema.parse({ before: "a", after: "b", mode: "unified" }),
    ).toMatchObject({ mode: "unified" });
  });

  it("rejects an unknown mode", () => {
    expect(() =>
      diffSchema.parse({ before: "a", after: "b", mode: "inline" }),
    ).toThrow();
  });

  it("rejects a non-string before/after", () => {
    expect(() => diffSchema.parse({ before: 123, after: "b" })).toThrow();
  });

  it("uses the stable Diff MDX tag", () => {
    expect(diffMdx.tag).toBe("Diff");
  });

  it("round-trips all fields losslessly through toAttrs/fromAttrs", () => {
    const data: DiffData = {
      filename: "src/server/auth.ts",
      language: "typescript",
      before: "const x = 1\nconst y = 2\nconsole.log(x, y)",
      after: "const x = 1\nconst y = 3\nconst z = 4\nconsole.log(x, y, z)",
      mode: "split",
    };
    expect(roundTrip(data)).toEqual(data);
  });

  it("round-trips losslessly when optional fields are absent", () => {
    const data: DiffData = {
      before: "old line",
      after: "new line",
    };
    // No optional attributes are emitted, so the decode yields `undefined`.
    expect(roundTrip(data)).toEqual({
      filename: undefined,
      language: undefined,
      mode: undefined,
      before: data.before,
      after: data.after,
    });
  });

  it("decodes missing before/after attributes to empty strings", () => {
    expect(diffMdx.fromAttrs(reader({}), "")).toEqual({
      filename: undefined,
      language: undefined,
      mode: undefined,
      before: "",
      after: "",
    });
  });
});
