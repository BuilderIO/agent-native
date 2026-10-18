import { describe, expect, it } from "vitest";

import {
  actionArgumentsHash,
  copyActionArguments,
  encodeActionArguments,
  snapshotActionArguments,
  UnsupportedActionArgumentError,
} from "./action-arguments-identity.js";

function refusal(value: unknown): unknown {
  try {
    snapshotActionArguments(value);
  } catch (error) {
    return error;
  }
  return undefined;
}

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
      expect(refusal(value)).toMatchObject({ path, kind });
    }
  });

  it("encodes a value shared by two branches, which is not a cycle", () => {
    const shared = { id: 1 };
    expect(refusal({ a: shared, b: shared })).toBeUndefined();
  });
});

describe("snapshotActionArguments", () => {
  it("refuses an accessor without reading it", () => {
    let reads = 0;
    const getter = Object.defineProperty({}, "amount", {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? 1 : 100;
      },
    });
    const setter = Object.defineProperty({ note: "x" }, "amount", {
      enumerable: true,
      set() {},
    });
    const list: unknown[] = [1, 2];
    Object.defineProperty(list, 1, {
      enumerable: true,
      get() {
        reads += 1;
        return reads;
      },
    });
    class Amount {
      get amount() {
        reads += 1;
        return reads;
      }
    }
    const cases: Array<[unknown, string, string]> = [
      [getter, "amount", "accessor"],
      [setter, "amount", "accessor"],
      [{ items: list }, "items[1]", "accessor"],
      [{ total: new Amount() }, "total", "Amount"],
    ];
    for (const [value, path, kind] of cases) {
      const error = refusal(value);
      expect(error).toBeInstanceOf(UnsupportedActionArgumentError);
      expect(error).toMatchObject({ path, kind });
      expect(() => encodeActionArguments(value)).toThrow(
        UnsupportedActionArgumentError,
      );
    }
    expect(reads).toBe(0);
  });

  it("is a frozen copy the source can no longer change, hashed as encoded", () => {
    const source = {
      note: "draft",
      at: new Date(1000),
      tags: ["a", { b: 1 }],
    };
    const snapshot = snapshotActionArguments(source);
    source.note = "changed";
    source.at.setTime(2000);
    (source.tags[1] as { b: number }).b = 2;
    source.tags.push("c");

    expect(snapshot.value).toEqual({
      note: "draft",
      at: new Date(1000),
      tags: ["a", { b: 1 }],
    });
    expect(snapshot.hash).toBe(
      actionArgumentsHash({
        note: "draft",
        at: new Date(1000),
        tags: ["a", { b: 1 }],
      }),
    );
    const value = snapshot.value as typeof source;
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.tags)).toBe(true);
    expect(Object.isFrozen(value.tags[1])).toBe(true);
    expect(Object.isFrozen(value.at)).toBe(true);
    expect(() => {
      value.note = "changed";
    }).toThrow(TypeError);
  });

  it("copies a snapshot for one consumer, which changes only its copy", () => {
    const snapshot = snapshotActionArguments({
      note: "draft",
      at: new Date(1000),
      tags: ["a"],
    });
    const value = snapshot.value as {
      note: string;
      at: Date;
      tags: string[];
    };
    const copy = copyActionArguments(value) as typeof value;
    copy.note = "changed";
    copy.tags.push("b");
    copy.at.setTime(5000);
    expect(value).toEqual({ note: "draft", at: new Date(1000), tags: ["a"] });
    expect(copyActionArguments(value)).toEqual(value);
    expect(Object.isFrozen(copy)).toBe(false);
  });
});
