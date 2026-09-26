export interface ScrubExpressionOptions {
  unit?: string;
  min?: number;
  max?: number;
  precision?: number;
}

export interface ScrubRelativeExpression {
  expression: string;
  unit?: string;
  min?: number;
  max?: number;
  precision?: number;
}


export const SCRUB_DRAG_THRESHOLD_PX = 3;

export interface ScrubDragState {
  startX: number;
  prevX: number;
  hasDragged: boolean;
}

export function startScrubDrag(startX: number): ScrubDragState {
  return { startX, prevX: startX, hasDragged: false };
}

export interface ScrubDragTick {
  state: ScrubDragState;
  deltaX: number | null;
}

export function updateScrubDrag(
  state: ScrubDragState,
  clientX: number,
): ScrubDragTick {
  const incr = clientX - state.prevX;
  if (incr === 0) {
    return { state, deltaX: null };
  }
  const cumulativeDelta = Math.abs(clientX - state.startX);
  if (!state.hasDragged && cumulativeDelta < SCRUB_DRAG_THRESHOLD_PX) {
    return { state: { ...state, prevX: clientX }, deltaX: null };
  }
  return {
    state: { ...state, prevX: clientX, hasDragged: true },
    deltaX: incr,
  };
}

export interface ParsedScrubExpression {
  value: number;
  normalized: string;
}

type MathOperator = "+" | "-" | "*" | "/" | "^" | "u+" | "u-";

type Token =
  | { type: "number"; value: number }
  | { type: "operator"; value: MathOperator }
  | { type: "parenthesis"; value: "open" | "close" };

const NUMBER_CHAR_PATTERN = /[0-9.]/;
// Comma is only treated as a digit character while scanning a number token
const NUMBER_OR_COMMA_CHAR_PATTERN = /[0-9.,]/;

export function parseScrubExpression(
  input: string,
  currentValue: number,
  options: ScrubExpressionOptions = {},
): ParsedScrubExpression | null {
  const raw = input.trim();
  if (!raw) return null;

  const expression = toNumericExpression(raw, currentValue, options.unit);
  const value = evaluateNumericExpression(expression);
  if (value === null) return null;

  const normalizedValue = normalizeScrubNumber(value, options);
  return {
    value: normalizedValue,
    normalized: formatScrubValue(normalizedValue, options),
  };
}

export function parseScrubRelativeExpression(
  input: string,
  currentValue: number,
  options: ScrubExpressionOptions = {},
  mixedLabel = "Mixed",
): ParsedScrubExpression | null {
  const expressionWithMixed = normalizeScrubMixedExpression(input, mixedLabel);
  if (!expressionWithMixed) return null;

  const expression = toNumericExpression(
    expressionWithMixed.replace(/\bMixed\b/i, `(${currentValue})`),
    currentValue,
    options.unit,
  );
  const value = evaluateNumericExpression(expression);
  if (value === null) return null;

  const normalizedValue = normalizeScrubNumber(value, options);
  return {
    value: normalizedValue,
    normalized: formatScrubValue(normalizedValue, options),
  };
}

export function normalizeScrubMixedExpression(
  input: string,
  mixedLabel = "Mixed",
): string | null {
  const raw = input.trim();
  const labels = [...new Set([mixedLabel.trim(), "Mixed"].filter(Boolean))];
  if (labels.length === 0) return null;
  const token = labels.map(escapeRegExp).join("|");
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9_])(${token})(?=$|[^A-Za-z0-9_])`,
    "gi",
  );
  const matches = [...raw.matchAll(pattern)];
  if (matches.length !== 1) return null;
  return raw.replace(pattern, (_match, prefix: string) => `${prefix}Mixed`);
}

export function normalizeScrubNumber(
  value: number,
  options: ScrubExpressionOptions = {},
): number {
  if (!Number.isFinite(value)) return 0;

  let next = value;
  if (Number.isFinite(options.min)) next = Math.max(options.min!, next);
  if (Number.isFinite(options.max)) next = Math.min(options.max!, next);
  if (Number.isFinite(options.precision)) {
    const scale = 10 ** Math.max(0, options.precision!);
    next = Math.round(next * scale) / scale;
  }
  return Object.is(next, -0) ? 0 : next;
}

export function scrubSnapsToInteger(unit: string | undefined): boolean {
  return unit === "px";
}

export function roundScrubDragValue(
  value: number,
  unit: string | undefined,
): number {
  return scrubSnapsToInteger(unit) ? Math.round(value) : value;
}

export function formatScrubValue(
  value: number,
  options: Pick<ScrubExpressionOptions, "precision" | "unit"> = {},
): string {
  const normalized = normalizeScrubNumber(value, options);
  let numeric: string;
  if (Number.isFinite(options.precision) && options.precision! >= 0) {
    const fixed = normalized.toFixed(options.precision!);
    if (options.unit) {
      numeric = fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
    } else {
      numeric = fixed.includes(".") ? fixed.replace(/(?<=\.\d)0+$/, "") : fixed;
    }
  } else {
    numeric = String(normalized);
  }
  return `${numeric}${options.unit ?? ""}`;
}

export function getScrubStepFromEvent(
  event: Pick<KeyboardEvent | PointerEvent, "altKey" | "shiftKey">,
  step: number,
): number {
  let multiplier = 1;
  if (event.altKey) multiplier = 0.1;
  else if (event.shiftKey) multiplier = 10;
  return step * multiplier;
}

function toNumericExpression(
  raw: string,
  currentValue: number,
  unit?: string,
): string {
  let expression = raw.trim();

  if (unit) {
    expression = expression.replace(new RegExp(escapeRegExp(unit), "gi"), "");
  }

  expression = expression.replace(/\bx\b/gi, `(${currentValue})`);

  if (expression.startsWith("=")) return expression.slice(1).trim();
  return expression;
}

function evaluateNumericExpression(expression: string): number | null {
  const tokens = tokenizeExpression(expression);
  if (!tokens.length) return null;

  const values: number[] = [];
  const operators: Array<MathOperator | "("> = [];

  for (const token of tokens) {
    if (token.type === "number") {
      values.push(token.value);
      continue;
    }

    if (token.type === "parenthesis") {
      if (token.value === "open") {
        operators.push("(");
        continue;
      }
      while (operators.length && operators[operators.length - 1] !== "(") {
        if (!applyTopOperator(values, operators)) return null;
      }
      if (operators.pop() !== "(") return null;
      continue;
    }

    if (token.value === "u+" || token.value === "u-") {
      operators.push(token.value);
      continue;
    }

    while (
      operators.length &&
      operators[operators.length - 1] !== "(" &&
      (precedence(operators[operators.length - 1]) > precedence(token.value) ||
        (precedence(operators[operators.length - 1]) ===
          precedence(token.value) &&
          token.value !== "^"))
    ) {
      if (!applyTopOperator(values, operators)) return null;
    }
    operators.push(token.value);
  }

  while (operators.length) {
    if (operators[operators.length - 1] === "(") return null;
    if (!applyTopOperator(values, operators)) return null;
  }

  if (values.length !== 1 || !Number.isFinite(values[0])) return null;
  return values[0];
}

function tokenizeExpression(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let previousWasOperator = true;

  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === "+" || char === "-") {
      if (previousWasOperator) {
        const previousToken = tokens.at(-1);
        if (previousToken?.type === "operator" && previousToken.value === "^")
          return [];
        tokens.push({
          type: "operator",
          value: char === "-" ? "u-" : "u+",
        });
      } else {
        tokens.push({ type: "operator", value: char });
      }
      previousWasOperator = true;
      index += 1;
      continue;
    }

    if (NUMBER_CHAR_PATTERN.test(char)) {
      if (!previousWasOperator) return [];
      const start = index;
      index += 1;
      while (NUMBER_OR_COMMA_CHAR_PATTERN.test(expression[index] ?? ""))
        index += 1;
      const value = Number(expression.slice(start, index).replace(",", "."));
      if (!Number.isFinite(value)) return [];
      tokens.push({ type: "number", value });
      previousWasOperator = false;
      continue;
    }

    if (isOperator(char)) {
      tokens.push({ type: "operator", value: char });
      previousWasOperator = true;
      index += 1;
      continue;
    }

    if (char === "(") {
      if (!previousWasOperator) return [];
      tokens.push({ type: "parenthesis", value: "open" });
      previousWasOperator = true;
      index += 1;
      continue;
    }

    if (char === ")") {
      if (previousWasOperator) return [];
      tokens.push({ type: "parenthesis", value: "close" });
      previousWasOperator = false;
      index += 1;
      continue;
    }

    return [];
  }

  if (previousWasOperator && tokens.at(-1)?.type === "operator") return [];
  return tokens;
}

function applyTopOperator(
  values: number[],
  operators: Array<MathOperator | "(">,
): boolean {
  const operator = operators.pop();
  if (operator === "u+" || operator === "u-") {
    const value = values.pop();
    if (value === undefined) return false;
    values.push(operator === "u-" ? -value : value);
    return true;
  }
  const right = values.pop();
  const left = values.pop();
  if (
    !operator ||
    operator === "(" ||
    right === undefined ||
    left === undefined
  ) {
    return false;
  }

  switch (operator) {
    case "+":
      values.push(left + right);
      return true;
    case "-":
      values.push(left - right);
      return true;
    case "*":
      values.push(left * right);
      return true;
    case "/":
      if (right === 0) return false;
      values.push(left / right);
      return true;
    case "^":
      values.push(left ** right);
      return Number.isFinite(values[values.length - 1]);
  }
}

function precedence(operator: MathOperator | "("): number {
  if (operator === "^") return 4;
  if (operator === "u+" || operator === "u-") return 3;
  if (operator === "*" || operator === "/") return 2;
  return 1;
}

function isOperator(char: string): char is MathOperator {
  return (
    char === "+" || char === "-" || char === "*" || char === "/" || char === "^"
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
