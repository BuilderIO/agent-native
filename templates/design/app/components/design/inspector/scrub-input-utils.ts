export interface ScrubExpressionOptions {
  unit?: string;
  min?: number;
  max?: number;
  precision?: number;
}

export interface ParsedScrubExpression {
  value: number;
  normalized: string;
}

type MathOperator = "+" | "-" | "*" | "/";

type Token =
  | { type: "number"; value: number }
  | { type: "operator"; value: MathOperator };

const NUMBER_CHAR_PATTERN = /[0-9.]/;

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

export function formatScrubValue(
  value: number,
  options: Pick<ScrubExpressionOptions, "precision" | "unit"> = {},
): string {
  const normalized = normalizeScrubNumber(value, options);
  let numeric: string;
  if (Number.isFinite(options.precision) && options.precision! >= 0) {
    const fixed = normalized.toFixed(options.precision);
    // Only strip trailing zeros when there's a fractional part. Stripping a bare
    // integer (precision 0, e.g. "100") would mangle it to "1" because the regex
    // eats the integer's own trailing zeros.
    numeric = fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
  } else {
    numeric = String(normalized);
  }
  return `${numeric}${options.unit ?? ""}`;
}

export function getScrubStepFromEvent(
  event: Pick<KeyboardEvent | PointerEvent, "altKey" | "shiftKey">,
  step: number,
): number {
  // Alt (fine-step) and Shift (coarse) are mutually exclusive — alt takes
  // priority, matching Figma's modifier convention. Applying both independently
  // would make Shift+Alt a no-op (×10 × 0.1 = ×1).
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

  if (expression.startsWith("=")) return expression.slice(1).trim();
  if (/^[+\-*/]/.test(expression)) return `${currentValue}${expression}`;
  return expression;
}

function evaluateNumericExpression(expression: string): number | null {
  const tokens = tokenizeExpression(expression);
  if (!tokens.length) return null;

  const values: number[] = [];
  const operators: MathOperator[] = [];

  for (const token of tokens) {
    if (token.type === "number") {
      values.push(token.value);
      continue;
    }

    while (
      operators.length &&
      precedence(operators[operators.length - 1]) >= precedence(token.value)
    ) {
      if (!applyTopOperator(values, operators)) return null;
    }
    operators.push(token.value);
  }

  while (operators.length) {
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

    const signedNumber =
      (char === "+" || char === "-") &&
      previousWasOperator &&
      NUMBER_CHAR_PATTERN.test(expression[index + 1] ?? "");

    if (NUMBER_CHAR_PATTERN.test(char) || signedNumber) {
      const start = index;
      index += 1;
      while (NUMBER_CHAR_PATTERN.test(expression[index] ?? "")) index += 1;
      const value = Number(expression.slice(start, index));
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

    return [];
  }

  return tokens;
}

function applyTopOperator(
  values: number[],
  operators: MathOperator[],
): boolean {
  const operator = operators.pop();
  const right = values.pop();
  const left = values.pop();
  if (!operator || right === undefined || left === undefined) return false;

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
  }
}

function precedence(operator: MathOperator): number {
  return operator === "*" || operator === "/" ? 2 : 1;
}

function isOperator(char: string): char is MathOperator {
  return char === "+" || char === "-" || char === "*" || char === "/";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
