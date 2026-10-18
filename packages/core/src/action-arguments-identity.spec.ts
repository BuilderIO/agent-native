import { describe, expect, it } from "vitest";

import {
  actionArgumentsHash,
  actionArgumentsIdentity,
  encodeActionArguments,
  UnsupportedActionArgumentError,
} from "./action-arguments-identity.js";

describe("encodeActionArguments", () => {
  it("encodes distinct supported values distinctly", () => {
    const sparse: unknown[] = [];
    sparse[1] = 1;
    const values: unknown[] = [
      undefined,
      null,
      true,
      false,
      0,
      -0,
      1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      10n,
      "10",
      "",
      "null",
      "u",
      new Date(1000),
      new Date(2000),
      new Date(1000).toISOString(),
      [],
      [undefined],
      [null],
      sparse,
      [undefined, 1],
      [1, 2],
      [2, 1],
      [[1], 2],
      [1, [2]],
      {},
      { a: undefined },
      { a: null },
      { a: 1 },
      { a: "1" },
      { a: 1n },
      { b: 1 },
      { a: { b: 1 } },
      { "a.b": 1 },
      { a: [1] },
      { a: "x,y" },
      { "a,b": "x" },
      { a: 'x"', b: "y" },
      { a: "x", b: '"y' },
    ];
    const encodings = values.map((value) => encodeActionArguments(value));
    expect(new Set(encodings).size).toBe(values.length);
    expect(
      new Set(values.map((value) => actionArgumentsHash(value))).size,
    ).toBe(values.length);
  });

  it("does not depend on object key order", () => {
    expect(encodeActionArguments({ a: 1, b: { c: 2, d: [3] } })).toBe(
      encodeActionArguments({ b: { d: [3], c: 2 }, a: 1 }),
    );
    expect(
      encodeActionArguments(Object.assign(Object.create(null), { a: 1 })),
    ).toBe(encodeActionArguments({ a: 1 }));
  });

  it("fails closed on every value it cannot encode exactly", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const withSymbol = { a: 1, [Symbol("s")]: 2 };
    const withHidden = Object.defineProperty({ a: 1 }, "b", { value: 2 });
    const arrayWithProperty = Object.assign([1], { extra: true });
    const dateWithProperty = Object.assign(new Date(0), { zone: "UTC" });
    class Money {
      constructor(readonly cents: number) {}
    }
    const cases: Array<[unknown, string, string]> = [
      [new Map([["a", 1]]), "", "Map"],
      [new Set([1]), "", "Set"],
      [{ at: new Date(Number.NaN) }, "at", "invalid Date"],
      [{ total: new Money(1) }, "total", "Money"],
      [{ run: () => 1 }, "run", "function"],
      [{ key: Symbol("k") }, "key", "symbol"],
      [{ bytes: new Uint8Array([1]) }, "bytes", "Uint8Array"],
      [{ url: new URL("https://example.com") }, "url", "URL"],
      [{ pattern: /a/ }, "pattern", "RegExp"],
      [{ boxed: new Number(1) }, "boxed", "Number"],
      [{ list: [1, new Map()] }, "list[1]", "Map"],
      [circular, "self", "circular reference"],
      [withSymbol, "", "object with hidden keys"],
      [withHidden, "", "object with hidden keys"],
      [arrayWithProperty, "", "array with properties"],
      [dateWithProperty, "", "Date"],
    ];
    for (const [value, path, kind] of cases) {
      let thrown: unknown;
      try {
        encodeActionArguments(value);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(UnsupportedActionArgumentError);
      expect(thrown).toMatchObject({ path, kind });
      expect(actionArgumentsIdentity(value)).toMatchObject({
        ok: false,
        error: { path, kind },
      });
    }
  });

  it("encodes a value shared by two branches, which is not a cycle", () => {
    const shared = { id: 1 };
    expect(actionArgumentsIdentity({ a: shared, b: shared })).toMatchObject({
      ok: true,
    });
  });
});
