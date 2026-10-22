import { describe, expect, it } from "vitest";

import type { Rule } from "../contract.js";
import type { Scope } from "../expressions.js";
import { evaluateRule, evaluateRules } from "./rules.js";

const NOW = new Date("2026-10-19T12:00:00.000Z");

const scope: Scope = {
  item: {
    status: "open",
    title: "Export button does nothing",
    count: 7,
    flag: true,
    text: "yes",
    empty: "",
    nothing: null,
    list: ["a", "b"],
    none: [],
    when: "2026-10-19T11:00:00.000Z",
    later: "2026-10-19T13:00:00.000Z",
    nested: { a: 1 },
  },
  nodes: { assess: { risk: "low" } },
  settings: { limit: 5, extras: { floor: 3 } },
  run: {},
  loop: {},
};

const rule = (left: string, op: Rule["op"], right?: unknown): Rule =>
  right === undefined ? { left, op } : { left, op, right };

const matches = (r: Rule) => {
  const outcome = evaluateRule(r, scope, NOW);
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.matched;
};

const failure = (r: Rule) => {
  const outcome = evaluateRule(r, scope, NOW);
  if (outcome.ok) throw new Error("expected the rule to fail");
  return outcome.message;
};

describe("rule operators", () => {
  it("compares with equals and notEquals, deeply", () => {
    expect(matches(rule("item.status", "equals", "open"))).toBe(true);
    expect(matches(rule("item.status", "equals", "closed"))).toBe(false);
    expect(matches(rule("item.list", "equals", ["a", "b"]))).toBe(true);
    expect(matches(rule("item.nested", "equals", { a: 1 }))).toBe(true);
    expect(matches(rule("item.status", "notEquals", "closed"))).toBe(true);
    expect(matches(rule("item.count", "equals", "7"))).toBe(false);
  });

  it("finds text and list members with contains", () => {
    expect(matches(rule("item.title", "contains", "button"))).toBe(true);
    expect(matches(rule("item.list", "contains", "b"))).toBe(true);
    expect(matches(rule("item.list", "contains", "z"))).toBe(false);
    expect(failure(rule("item.count", "contains", "7"))).toMatch(
      /text or a list/,
    );
  });

  it("checks a prefix with startsWith", () => {
    expect(matches(rule("item.title", "startsWith", "Export"))).toBe(true);
    expect(matches(rule("item.title", "startsWith", "button"))).toBe(false);
    expect(failure(rule("item.count", "startsWith", "7"))).toMatch(/text/);
  });

  it("asks isEmpty of null, empty text, empty lists and empty objects", () => {
    expect(matches(rule("item.empty", "isEmpty"))).toBe(true);
    expect(matches(rule("item.nothing", "isEmpty"))).toBe(true);
    expect(matches(rule("item.none", "isEmpty"))).toBe(true);
    expect(matches(rule("item.title", "isEmpty"))).toBe(false);
    expect(matches(rule("item.count", "isEmpty"))).toBe(false);
  });

  it("asks isTrue only of a real boolean", () => {
    expect(matches(rule("item.flag", "isTrue"))).toBe(true);
    expect(failure(rule("item.text", "isTrue"))).toMatch(/true or false/);
  });

  it("checks list membership with inList", () => {
    expect(matches(rule("item.status", "inList", ["open", "new"]))).toBe(true);
    expect(matches(rule("item.status", "inList", ["closed"]))).toBe(false);
    expect(failure(rule("item.status", "inList", "open"))).toMatch(/list/);
  });

  it("orders numbers and ISO instants with gt, lt and between", () => {
    expect(matches(rule("item.count", "gt", 5))).toBe(true);
    expect(matches(rule("item.count", "lt", 5))).toBe(false);
    expect(matches(rule("item.when", "lt", "{{ item.later }}"))).toBe(true);
    expect(matches(rule("item.count", "between", [5, 7]))).toBe(true);
    expect(matches(rule("item.count", "between", [8, 9]))).toBe(false);
    expect(failure(rule("item.count", "between", [1]))).toMatch(/low, high/);
  });

  it("refuses to order values it cannot tell apart from text", () => {
    expect(failure(rule("item.status", "gt", 5))).toMatch(/Cannot compare/);
    expect(failure(rule("item.count", "gt", "5"))).toMatch(/Cannot compare/);
    expect(failure(rule("item.nothing", "gt", 1))).toMatch(/null/);
  });

  it("reads a right-hand value from the scope when it is a whole hole", () => {
    expect(matches(rule("item.count", "gt", "{{ settings.limit }}"))).toBe(
      true,
    );
    expect(
      matches(rule("item.count", "gt", "{{ settings.extras.floor }}")),
    ).toBe(true);
    expect(
      matches(rule("item.status", "equals", "{{ nodes.assess.risk }}")),
    ).toBe(false);
  });

  it("tests age with olderThan and pastDue against the clock it is given", () => {
    const hour = { amount: 30, unit: "minutes" };
    expect(matches(rule("item.when", "olderThan", hour))).toBe(true);
    expect(matches(rule("item.later", "olderThan", hour))).toBe(false);
    expect(matches(rule("item.when", "pastDue"))).toBe(true);
    expect(matches(rule("item.later", "pastDue"))).toBe(false);
    expect(failure(rule("item.when", "olderThan", 30))).toMatch(/duration/);
    expect(failure(rule("item.text", "pastDue"))).toMatch(/ISO date-time/);
  });
});

describe("rules with no value", () => {
  it("fails on a path with no value instead of reading it as empty or false", () => {
    for (const op of ["equals", "notEquals", "isEmpty", "isTrue"] as const) {
      expect(
        failure(
          rule(
            "item.missing",
            op,
            op === "isEmpty" || op === "isTrue" ? undefined : "x",
          ),
        ),
      ).toMatch(/has no value here/);
    }
  });

  it("fails on a right-hand hole with no value", () => {
    expect(failure(rule("item.count", "gt", "{{ settings.nope }}"))).toMatch(
      /has no value here/,
    );
  });

  it("fails on a malformed path instead of throwing", () => {
    expect(failure(rule("item.a b", "isEmpty"))).toMatch(/Unexpected/);
  });
});

describe("combining rules", () => {
  const yes = rule("item.flag", "isTrue");
  const no = rule("item.status", "equals", "closed");
  const broken = rule("item.missing", "isEmpty");

  it("requires every rule for all and any rule for any", () => {
    expect(evaluateRules("all", [yes, no], scope, NOW)).toEqual({
      ok: true,
      matched: false,
    });
    expect(evaluateRules("any", [yes, no], scope, NOW)).toEqual({
      ok: true,
      matched: true,
    });
    expect(evaluateRules("all", [yes, yes], scope, NOW)).toEqual({
      ok: true,
      matched: true,
    });
  });

  it("reads every rule, so a broken one fails even when another already decided", () => {
    expect(evaluateRules("any", [yes, broken], scope, NOW).ok).toBe(false);
    expect(evaluateRules("all", [no, broken], scope, NOW).ok).toBe(false);
  });
});
