import { describe, expect, it } from "vitest";
import type { BlockAttrReader } from "@agent-native/core/blocks/server";
import {
  annotatedCodeMdx,
  annotatedCodeSchema,
  type AnnotatedCodeData,
} from "./annotated-code.config.js";

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
function roundTrip(data: AnnotatedCodeData): AnnotatedCodeData {
  const attrs = annotatedCodeMdx.toAttrs(data) as Record<string, unknown>;
  return annotatedCodeMdx.fromAttrs(reader(attrs), "");
}

describe("annotated-code block config", () => {
  it("parses valid annotated-code data", () => {
    const data = {
      filename: "src/server/auth.ts",
      language: "ts",
      code: "export function resolveAuth(provider: string) {\n  const cfg = providers[provider];\n  return cfg.token;\n}",
      annotations: [
        { lines: "2", label: "Lookup", note: "Resolves the provider config." },
        { lines: "3-3", note: "Returns the token." },
      ],
    };
    expect(annotatedCodeSchema.parse(data)).toEqual(data);
  });

  it("parses with only the required code field", () => {
    const data = { code: "const x = 1" };
    expect(annotatedCodeSchema.parse(data)).toEqual(data);
  });

  it("accepts single-line and range line refs", () => {
    expect(
      annotatedCodeSchema.parse({
        code: "a\nb\nc",
        annotations: [
          { lines: "1", note: "first" },
          { lines: "2-3", note: "rest" },
          { lines: " 2 - 3 ", note: "padded" },
        ],
      }),
    ).toMatchObject({ annotations: [{}, {}, {}] });
  });

  it("rejects a malformed line ref", () => {
    expect(() =>
      annotatedCodeSchema.parse({
        code: "a",
        annotations: [{ lines: "first", note: "x" }],
      }),
    ).toThrow();
  });

  it("rejects an empty note", () => {
    expect(() =>
      annotatedCodeSchema.parse({
        code: "a",
        annotations: [{ lines: "1", note: "" }],
      }),
    ).toThrow();
  });

  it("rejects a non-string code", () => {
    expect(() => annotatedCodeSchema.parse({ code: 123 })).toThrow();
  });

  it("uses the stable AnnotatedCode MDX tag", () => {
    expect(annotatedCodeMdx.tag).toBe("AnnotatedCode");
  });

  it("round-trips all fields losslessly through toAttrs/fromAttrs", () => {
    const data: AnnotatedCodeData = {
      filename: "src/server/auth.ts",
      language: "typescript",
      code: "function add(a, b) {\n  return a + b;\n}",
      annotations: [
        { lines: "1", label: "Signature", note: "Two params." },
        { lines: "2", note: "The sum." },
      ],
    };
    expect(roundTrip(data)).toEqual(data);
  });

  it("round-trips losslessly when optional fields are absent", () => {
    const data: AnnotatedCodeData = {
      code: "const x = 1\nconst y = 2",
    };
    // No optional attributes are emitted, so the decode yields undefined
    // filename/language and an empty annotations array (the forgiving default).
    expect(roundTrip(data)).toEqual({
      filename: undefined,
      language: undefined,
      code: data.code,
      annotations: [],
    });
  });

  it("decodes a missing code attribute to an empty string", () => {
    expect(annotatedCodeMdx.fromAttrs(reader({}), "")).toEqual({
      filename: undefined,
      language: undefined,
      code: "",
      annotations: [],
    });
  });
});
