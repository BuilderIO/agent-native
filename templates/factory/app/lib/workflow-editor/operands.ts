import { RULE_OPS, ruleSchema, type RuleOp } from "./engine.js";

const NUMBER = /^-?\d+(\.\d+)?$/;
const QUOTED = /^".*"$/s;

/** Operators that compare text, so what is typed is kept as typed. */
const TEXT_OPS: readonly RuleOp[] = ["contains", "startsWith"];
const LIST_OPS: readonly RuleOp[] = ["inList", "between"];

export function ruleOps(): readonly RuleOp[] {
  return RULE_OPS;
}

/** Whether a rule with this operator carries a right-hand value; the contract's schema decides. */
export function ruleNeedsOperand(op: RuleOp): boolean {
  return !ruleSchema.safeParse({ left: "item.title", op }).success;
}

function parseScalar(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (NUMBER.test(trimmed)) return Number(trimmed);
  if (QUOTED.test(trimmed)) {
    try {
      const value: unknown = JSON.parse(trimmed);
      if (typeof value === "string") return value;
    } catch {
      // coercion-ok: a quote that is not valid JSON is plain text the author typed
    }
  }
  return text;
}

function formatScalar(value: unknown): string {
  if (typeof value === "string") {
    // A string that would read back as a number or boolean keeps its quotes.
    const readsBack = parseScalar(value);
    return typeof readsBack === "string" && readsBack === value
      ? value
      : JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value) ?? "";
}

/** The text shown for a rule's right-hand value. Typing it back gives the same value. */
export function formatOperand(op: RuleOp, value: unknown): string {
  if (value === undefined) return "";
  if (TEXT_OPS.includes(op)) {
    return typeof value === "string" ? value : formatScalar(value);
  }
  if (Array.isArray(value)) return value.map(formatScalar).join(", ");
  return formatScalar(value);
}

/**
 * The value a typed operand stands for: numbers and `true`/`false` read as
 * such, a quoted string stays a string, and a list operator splits on commas.
 */
export function parseOperand(op: RuleOp, text: string): unknown {
  if (TEXT_OPS.includes(op)) return text;
  if (LIST_OPS.includes(op)) {
    return text
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map(parseScalar);
  }
  return parseScalar(text);
}
