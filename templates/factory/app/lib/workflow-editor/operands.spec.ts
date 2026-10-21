import { describe, expect, it } from "vitest";

import type { RuleOp } from "./engine.js";
import {
  formatOperand,
  parseOperand,
  ruleNeedsOperand,
  ruleOps,
} from "./operands.js";

describe("ruleNeedsOperand", () => {
  it("follows the contract's schema for each operator", () => {
    const without = ruleOps().filter((op) => !ruleNeedsOperand(op));
    expect([...without].sort()).toEqual(["isEmpty", "isTrue", "pastDue"]);
  });
});

describe("parseOperand and formatOperand", () => {
  it.each<[RuleOp, string, unknown]>([
    ["equals", "false", false],
    ["equals", "true", true],
    ["equals", "42", 42],
    ["equals", "-1.5", -1.5],
    ["equals", "low", "low"],
    ["equals", '"42"', "42"],
    ["equals", '"true"', "true"],
    ["notEquals", "critical", "critical"],
    ["contains", "42", "42"],
    ["contains", "true", "true"],
    ["startsWith", "Re:", "Re:"],
    ["gt", "3", 3],
    ["lt", "{{ settings.extras.age }}", "{{ settings.extras.age }}"],
    ["inList", "patch, minor", ["patch", "minor"]],
    ["inList", "1,2,x", [1, 2, "x"]],
    ["between", "1, 5", [1, 5]],
  ])("%s %j reads as %j and reads back the same", (op, text, value) => {
    expect(parseOperand(op, text)).toEqual(value);
    expect(parseOperand(op, formatOperand(op, value))).toEqual(value);
  });

  it("keeps a numeric-looking string quoted when it is shown", () => {
    expect(formatOperand("equals", "42")).toBe('"42"');
    expect(formatOperand("equals", 42)).toBe("42");
    expect(formatOperand("contains", "42")).toBe("42");
  });

  it("shows nothing for a missing value", () => {
    expect(formatOperand("equals", undefined)).toBe("");
  });

  it("drops empty list entries", () => {
    expect(parseOperand("inList", " , a,, b ,")).toEqual(["a", "b"]);
    expect(parseOperand("inList", "")).toEqual([]);
  });
});
