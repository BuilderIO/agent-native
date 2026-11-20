import { answerToText, isEmptyAnswer } from "./answers.js";
import { evaluateCondition } from "./logic.js";
import { deriveQuestions } from "./questions.js";
import type {
  Answers,
  AnswerValue,
  Block,
  Condition,
  LogicAction,
} from "./types.js";

export type HiddenField = { id: string; name: string };
export type CalculatedField = {
  id: string;
  name: string;
  type?: "number" | "text" | undefined;
  initialValue?: string | undefined;
};

export const MAX_HIDDEN_VALUE_LENGTH = 2000;

/** Fields with a name; a calculated field also needs a type to take part. */
export function hiddenFieldsOf(blocks: readonly Block[]): HiddenField[] {
  return blocks.flatMap((block) =>
    block.type === "HIDDEN_FIELDS"
      ? block.payload.fields.filter((field) => field.name.trim() !== "")
      : [],
  );
}

export function calculatedFieldsOf(
  blocks: readonly Block[],
): CalculatedField[] {
  return blocks.flatMap((block) =>
    block.type === "CALCULATED_FIELDS"
      ? block.payload.fields.filter(
          (field) => field.name.trim() !== "" && field.type !== undefined,
        )
      : [],
  );
}

/** Answers for hidden fields: only query parameters named like a field are taken. */
export function hiddenFieldAnswers(
  blocks: readonly Block[],
  search: string,
): Answers {
  const params = new URLSearchParams(search);
  const answers: Answers = {};
  for (const field of hiddenFieldsOf(blocks)) {
    const value = params.get(field.name);
    if (value !== null)
      answers[field.id] = value.slice(0, MAX_HIDDEN_VALUE_LENGTH);
  }
  return answers;
}

const round = (value: number) => Math.round(value * 1e10) / 1e10;

type Lookup = (id: string) => number | string;
type Token =
  | { kind: "value"; value: number | string }
  | { kind: "ref"; id: string }
  | { kind: "op"; op: string };

const TOKEN =
  /\s*(?:(\d+(?:\.\d+)?|\.\d+)|"([^"]*)"|\{\{answer:([^{}\s]+)\}\}|([-+*/()]))/y;

function tokenize(source: string): Token[] | null {
  const tokens: Token[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.trimEnd().length) {
    const match = TOKEN.exec(source);
    if (!match) return null;
    if (match[1] !== undefined)
      tokens.push({ kind: "value", value: Number(match[1]) });
    else if (match[2] !== undefined)
      tokens.push({ kind: "value", value: match[2] });
    else if (match[3] !== undefined) tokens.push({ kind: "ref", id: match[3] });
    else tokens.push({ kind: "op", op: match[4] ?? "" });
  }
  return tokens;
}

const text = (value: number | string) =>
  typeof value === "number" ? String(round(value)) : value;

function toNumber(value: number | string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(number)) throw new Error("not a number");
  return number;
}

/**
 * Evaluates `+ - * /` with parentheses over numbers, "quoted text" and
 * `{{answer:id}}` references. `+` joins when either side is text.
 * Returns null for anything malformed, or a division by zero.
 */
export function evaluateFormula(
  source: string,
  lookup: Lookup,
): number | string | null {
  const tokens = tokenize(source);
  if (!tokens || tokens.length === 0) return null;
  let at = 0;
  const peekOp = () => {
    const token = tokens[at];
    return token?.kind === "op" ? token.op : null;
  };

  function primary(): number | string {
    const token = tokens?.[at++];
    if (token?.kind === "value") return token.value;
    if (token?.kind === "ref") return lookup(token.id);
    if (token?.kind === "op" && token.op === "(") {
      const inner = sum();
      if (peekOp() !== ")") throw new Error("missing )");
      at += 1;
      return inner;
    }
    throw new Error("unexpected token");
  }
  function unary(): number | string {
    if (peekOp() === "-") {
      at += 1;
      return -toNumber(unary());
    }
    return primary();
  }
  function product(): number | string {
    let left = unary();
    for (let op = peekOp(); op === "*" || op === "/"; op = peekOp()) {
      at += 1;
      const right = toNumber(unary());
      if (op === "/" && right === 0) throw new Error("divide by zero");
      left = op === "*" ? toNumber(left) * right : toNumber(left) / right;
    }
    return left;
  }
  function sum(): number | string {
    let left = product();
    for (let op = peekOp(); op === "+" || op === "-"; op = peekOp()) {
      at += 1;
      const right = product();
      if (op === "-") left = toNumber(left) - toNumber(right);
      else if (typeof left === "number" && typeof right === "number")
        left += right;
      else left = text(left) + text(right);
    }
    return left;
  }

  try {
    const result = sum();
    return at === tokens.length ? result : null;
    // coercion-ok: a malformed formula leaves the field at its current value.
  } catch {
    return null;
  }
}

type LogicPayload = { condition?: Condition | null; actions?: LogicAction[] };

/**
 * Values of every calculated field for these answers. Starts each field at its
 * initial value and applies matched CALCULATE actions in form order, so the
 * result is a pure function of the answers and never accumulates.
 */
export function calculateFields(
  blocks: readonly Block[],
  answers: Answers,
): Answers {
  const fields = calculatedFieldsOf(blocks);
  if (fields.length === 0) return {};
  const questions = new Map(deriveQuestions(blocks).map((q) => [q.id, q]));
  const values: Answers = { ...answers };
  for (const field of fields)
    values[field.id] =
      field.type === "number"
        ? toInitialNumber(field.initialValue)
        : (field.initialValue ?? "");

  const asText = (id: string): string => {
    const question = questions.get(id);
    const value = values[id];
    return question && value != null ? answerToText(question, value) : "";
  };
  const asNumber = (id: string): number | string => {
    const value = values[id];
    if (isEmptyAnswer(value)) return 0;
    if (typeof value === "number") return value;
    const shown = asText(id);
    return shown.trim() !== "" && !Number.isNaN(Number(shown))
      ? Number(shown)
      : shown;
  };

  for (const block of blocks) {
    if (block.type !== "CONDITIONAL_LOGIC") continue;
    const { condition, actions = [] } = block.payload as LogicPayload;
    if (!condition || !evaluateCondition(condition, values)) continue;
    for (const action of actions) {
      if (action.type !== "calculate") continue;
      const field = fields.find((candidate) => candidate.id === action.fieldId);
      if (!field) continue;
      const next =
        field.type === "number"
          ? applyNumber(values[field.id], action, asNumber)
          : applyText(values[field.id], action, asText);
      if (next !== null) values[field.id] = next;
    }
  }
  return Object.fromEntries(
    fields.map((field) => [field.id, values[field.id]]),
  );
}

function toInitialNumber(initial: string | undefined): number {
  const number = Number(initial);
  return initial === undefined || initial.trim() === "" || Number.isNaN(number)
    ? 0
    : number;
}

function applyNumber(
  current: AnswerValue,
  action: Extract<LogicAction, { type: "calculate" }>,
  lookup: Lookup,
): number | null {
  const operand = evaluateFormula(String(action.value ?? ""), lookup);
  if (typeof operand !== "number") return null;
  const now = typeof current === "number" ? current : 0;
  switch (action.operator) {
    case "add":
      return round(now + operand);
    case "subtract":
      return round(now - operand);
    case "multiply":
      return round(now * operand);
    case "divide":
      return operand === 0 ? null : round(now / operand);
    case "set":
    case "formula":
      return round(operand);
  }
}

function applyText(
  current: AnswerValue,
  action: Extract<LogicAction, { type: "calculate" }>,
  asText: (id: string) => string,
): string | null {
  const literal = String(action.value ?? "").replace(
    /\{\{answer:([^{}\s]+)\}\}/g,
    (_, id: string) => asText(id),
  );
  const now = typeof current === "string" ? current : "";
  switch (action.operator) {
    case "add":
      return now + literal;
    case "set":
      return literal;
    case "formula": {
      const result = evaluateFormula(String(action.value ?? ""), asText);
      return result === null ? null : text(result);
    }
    case "subtract":
    case "multiply":
    case "divide":
      return null;
  }
}
