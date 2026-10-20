import type { Rule } from "../contract.js";
import { evaluatePath, validatePath, type Scope } from "../expressions.js";
import { deepEqual, isRecord } from "./bounds.js";
import { resolveTemplates } from "./templates.js";

type RuleOutcome =
  | { ok: true; matched: boolean }
  | { ok: false; message: string };

const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };

function instantOf(value: unknown): number | null {
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  return typeof value === "object" ? "an object" : `a ${typeof value}`;
}

const fail = (message: string): RuleOutcome => ({ ok: false, message });
const result = (matched: boolean): RuleOutcome => ({ ok: true, matched });

/** Numbers compare as numbers and ISO instants as times; anything else cannot be ordered. */
function order(
  left: unknown,
  right: unknown,
): { ok: true; sign: number } | { ok: false; message: string } {
  if (
    typeof left === "number" &&
    typeof right === "number" &&
    Number.isFinite(left) &&
    Number.isFinite(right)
  ) {
    return { ok: true, sign: Math.sign(left - right) };
  }
  const leftTime = instantOf(left);
  const rightTime = instantOf(right);
  if (leftTime !== null && rightTime !== null) {
    return { ok: true, sign: Math.sign(leftTime - rightTime) };
  }
  return {
    ok: false,
    message: `Cannot compare ${kindOf(left)} with ${kindOf(right)}: use two numbers or two ISO date-times.`,
  };
}

function durationMs(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const { amount, unit } = value;
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    typeof unit !== "string" ||
    !Object.prototype.hasOwnProperty.call(UNIT_MS, unit)
  ) {
    return null;
  }
  return amount * UNIT_MS[unit as keyof typeof UNIT_MS];
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return isRecord(value) && Object.keys(value).length === 0;
}

/**
 * One rule against one item. A path with no value is a failure for every op,
 * `isEmpty` included: a mistyped field name must not read as an empty one.
 * Optional AI fields are stored as null when omitted, so `isEmpty` still has
 * something to ask about.
 */
export function evaluateRule(rule: Rule, scope: Scope, now: Date): RuleOutcome {
  const check = validatePath(rule.left);
  if (!check.ok) return fail(check.error.message);
  const left = evaluatePath(check.path, scope);
  if (!left.found) return fail(`"${rule.left}" has no value here.`);
  let right: unknown;
  if (rule.right !== undefined) {
    const resolved = resolveTemplates(rule.right, scope);
    if (!resolved.ok) return fail(resolved.error.message);
    right = resolved.value;
  }
  const value = left.value;

  switch (rule.op) {
    case "equals":
      return result(deepEqual(value, right));
    case "notEquals":
      return result(!deepEqual(value, right));
    case "contains":
      if (typeof value === "string" && typeof right === "string") {
        return result(value.includes(right));
      }
      if (Array.isArray(value)) {
        return result(value.some((entry) => deepEqual(entry, right)));
      }
      return fail(
        `"contains" needs text or a list on the left, but "${rule.left}" is ${kindOf(value)}.`,
      );
    case "startsWith":
      return typeof value === "string" && typeof right === "string"
        ? result(value.startsWith(right))
        : fail(`"startsWith" needs text on both sides.`);
    case "isEmpty":
      return result(isEmptyValue(value));
    case "isTrue":
      return typeof value === "boolean"
        ? result(value)
        : fail(
            `"isTrue" needs true or false, but "${rule.left}" is ${kindOf(value)}.`,
          );
    case "inList":
      return Array.isArray(right)
        ? result(right.some((entry) => deepEqual(entry, value)))
        : fail(`"inList" needs a list on the right.`);
    case "gt":
    case "lt": {
      const ordered = order(value, right);
      if (!ordered.ok) return fail(ordered.message);
      return result(rule.op === "gt" ? ordered.sign > 0 : ordered.sign < 0);
    }
    case "between": {
      if (!Array.isArray(right) || right.length !== 2) {
        return fail(`"between" needs a [low, high] list on the right.`);
      }
      const low = order(value, right[0]);
      const high = order(value, right[1]);
      if (!low.ok) return fail(low.message);
      if (!high.ok) return fail(high.message);
      return result(low.sign >= 0 && high.sign <= 0);
    }
    case "olderThan": {
      const age = durationMs(right);
      const time = instantOf(value);
      if (age === null) {
        return fail(
          `"olderThan" needs a duration such as { "amount": 30, "unit": "minutes" } on the right.`,
        );
      }
      if (time === null) {
        return fail(`"olderThan" needs an ISO date-time on the left.`);
      }
      return result(now.getTime() - time > age);
    }
    case "pastDue": {
      const time = instantOf(value);
      return time === null
        ? fail(`"pastDue" needs an ISO date-time on the left.`)
        : result(time < now.getTime());
    }
  }
}

/**
 * Every rule runs, so a broken rule fails the item on every pass instead of
 * only on the passes where an earlier rule did not decide the answer.
 */
export function evaluateRules(
  combinator: "all" | "any",
  rules: readonly Rule[],
  scope: Scope,
  now: Date,
): RuleOutcome {
  const matches: boolean[] = [];
  for (const rule of rules) {
    const outcome = evaluateRule(rule, scope, now);
    if (!outcome.ok) return outcome;
    matches.push(outcome.matched);
  }
  return result(
    combinator === "all" ? matches.every(Boolean) : matches.some(Boolean),
  );
}
