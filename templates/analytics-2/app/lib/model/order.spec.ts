import { describe, expect, it } from "vitest";

import {
  FIRST_ORDER_KEY,
  OrderKeyError,
  compareOrder,
  firstOrderKey,
  isValidOrderKey,
  lastOrderKey,
  orderBetween,
  orderForInsertion,
  sortByOrder,
} from "./order.js";

describe("order keys", () => {
  it("starts a list with a key that leaves room on both sides", () => {
    expect(isValidOrderKey(FIRST_ORDER_KEY)).toBe(true);
    expect(
      compareOrder(orderBetween(null, FIRST_ORDER_KEY), FIRST_ORDER_KEY),
    ).toBe(-1);
    expect(
      compareOrder(orderBetween(FIRST_ORDER_KEY, null), FIRST_ORDER_KEY),
    ).toBe(1);
  });

  it("keeps every generated key strictly between its bounds", () => {
    let lower: string | null = null;
    const keys: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      const key = orderBetween(lower, null);
      if (lower !== null) expect(compareOrder(lower, key)).toBe(-1);
      keys.push(key);
      lower = key;
    }
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort(compareOrder)).toEqual(keys);
  });

  it("inserts repeatedly at the front without running out of room", () => {
    let upper: string | null = null;
    const keys: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      const key = orderBetween(null, upper);
      if (upper !== null) expect(compareOrder(key, upper)).toBe(-1);
      keys.push(key);
      upper = key;
    }
    expect([...keys].reverse()).toEqual([...keys].reverse().sort(compareOrder));
  });

  it("splits the same gap twenty times, always in order", () => {
    let lower = "a";
    const upper = "b";
    const keys: string[] = [];
    for (let index = 0; index < 20; index += 1) {
      const key = orderBetween(lower, upper);
      expect(compareOrder(key, lower)).toBe(1);
      expect(compareOrder(key, upper)).toBe(-1);
      expect(isValidOrderKey(key)).toBe(true);
      keys.push(key);
      lower = key;
    }
    expect(new Set(keys).size).toBe(20);
  });

  it("places a key between adjacent keys that differ by one digit", () => {
    const key = orderBetween("a", "a1");
    expect(compareOrder(key, "a")).toBe(1);
    expect(compareOrder(key, "a1")).toBe(-1);
    expect(isValidOrderKey(key)).toBe(true);
  });

  it("places a key between a key and its own prefix", () => {
    const key = orderBetween("az", "b");
    expect(compareOrder(key, "az")).toBe(1);
    expect(compareOrder(key, "b")).toBe(-1);
  });

  it("rejects keys that are out of order instead of guessing", () => {
    expect(() => orderBetween("b", "a")).toThrow(OrderKeyError);
    expect(() => orderBetween("a", "a")).toThrow(OrderKeyError);
  });

  it("rejects keys that leave no room below", () => {
    expect(isValidOrderKey("a0")).toBe(false);
    expect(isValidOrderKey("")).toBe(false);
    expect(isValidOrderKey("A")).toBe(false);
    expect(() => orderBetween("a0", null)).toThrow(OrderKeyError);
  });

  it("finds the first and last order in a list", () => {
    expect(firstOrderKey([])).toBeNull();
    expect(lastOrderKey([])).toBeNull();
    expect(firstOrderKey(["i", "a", "m"])).toBe("a");
    expect(lastOrderKey(["i", "a", "m"])).toBe("m");
    expect(firstOrderKey(["", "m"])).toBe("m");
  });

  it("sorts cells by order and leaves the input alone", () => {
    const cells = [
      { id: "c", order: "m" },
      { id: "a", order: "a" },
      { id: "b", order: "i" },
    ];
    expect(sortByOrder(cells).map((cell) => cell.id)).toEqual(["a", "b", "c"]);
    expect(cells.map((cell) => cell.id)).toEqual(["c", "a", "b"]);
  });

  it("resolves an insertion position to a key between its neighbours", () => {
    expect(orderForInsertion([], 0)).toBe(FIRST_ORDER_KEY);
    const existing = ["a", "m", "t"];
    const atStart = orderForInsertion(existing, 0);
    const middle = orderForInsertion(existing, 2);
    const atEnd = orderForInsertion(existing, 3);
    expect(compareOrder(atStart, "a")).toBe(-1);
    expect(compareOrder(middle, "m")).toBe(1);
    expect(compareOrder(middle, "t")).toBe(-1);
    expect(compareOrder(atEnd, "t")).toBe(1);
    expect(orderForInsertion(existing, 99)).toBe(
      orderForInsertion(existing, 3),
    );
    expect(orderForInsertion(existing, -5)).toBe(atStart);
  });
});
