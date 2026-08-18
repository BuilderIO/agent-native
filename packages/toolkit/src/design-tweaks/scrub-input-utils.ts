export interface ScrubExpressionOptions {
  unit?: string;
  min?: number;
  max?: number;
  precision?: number;
}

// ─── Scrub-drag gesture-lifecycle state machine ───────────────────────────────
//
// Pure mirror of the pointerdown/pointermove/pointerup bookkeeping in
// ScrubInput's dragRef, extracted so the "exactly one commit-phase emission
// per gesture" contract can be unit tested without simulating real DOM
// pointer events (this template has no jsdom/testing-library dependency).

/** Cumulative pointer movement (px) required before a drag start is treated
 * as a real scrub rather than jitter during a plain click. Mirrors
 * ScrubInput's DRAG_THRESHOLD_PX. */
export const SCRUB_DRAG_THRESHOLD_PX = 3;

export interface ScrubDragState {
  startX: number;
  prevX: number;
  hasDragged: boolean;
}

/** Begins tracking a new scrub gesture at the given starting pointer X. */
export function startScrubDrag(startX: number): ScrubDragState {
  return { startX, prevX: startX, hasDragged: false };
}

export interface ScrubDragTick {
  /** The updated drag state after this pointermove sample. */
  state: ScrubDragState;
  /** The incremental delta (px) to apply this tick, or null when the move
   * should be ignored (no movement, or still under the jitter threshold). */
  deltaX: number | null;
}

/**
 * Processes one pointermove sample against the in-progress drag state.
 * Mirrors ScrubInput's handlePointerMove threshold/hasDragged logic exactly:
 * a move is ignored until cumulative movement clears SCRUB_DRAG_THRESHOLD_PX,
 * after which every subsequent move (including this one) yields an
 * incremental delta and marks the gesture as a real drag.
 */
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

type MathOperator = "+" | "-" | "*" | "/";

type Token =
  | { type: "number"; value: number }
  | { type: "operator"; value: MathOperator };

const NUMBER_CHAR_PATTERN = /[0-9.]/;
// Comma is only treated as a digit character while scanning a number token
// (see tokenizeExpression) so a locale-style decimal comma ("12,5") parses as
// 12.5, without swallowing the "," that a caller might use to separate
// distinct expressions elsewhere.
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

/**
 * Whether a field's unit should snap to whole numbers while the user is
 * actively pointer-dragging (scrubbing) it. Px-type fields (padding, gap,
 * position, size, radius, etc.) read as integers in Figma-style editors even
 * though the underlying `precision` option (which also governs *typed* input
 * and keyboard nudges) allows one decimal place so a typed "12.5" still
 * commits legally. Scoped to "px" specifically — unitless fields like
 * line-height (precision-based, fractional by design) and other units (deg,
 * %) are untouched.
 */
export function scrubSnapsToInteger(unit: string | undefined): boolean {
  return unit === "px";
}

/**
 * Rounds a live scrub-drag value to a whole number when the field's unit
 * calls for integer-only scrubbing (see `scrubSnapsToInteger`), applied
 * *before* `normalizeScrubNumber`'s own min/max/precision clamp so a
 * following precision clamp (if any) can't reintroduce a fraction. Only the
 * pointer-drag scrub gesture should call this — typed input and keyboard
 * nudges keep their existing `precision`-based rounding untouched.
 */
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
      // For fields with units (px, %, °, etc.) collapse all trailing zeros
      // including the decimal point: "12.30px" → "12.3px", "10.00px" → "10px".
      // Leave integer strings alone; otherwise precision 0 turns "100" into "1".
      numeric = fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
    } else {
      // For unitless fields (e.g. line-height), preserve at least one decimal
      // digit so values like "2.0" stay "2.0" rather than collapsing to "2".
      // Only strip redundant trailing zeros beyond the first decimal digit.
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
      // Allow a single comma decimal separator within this number token
      // ("12,5" → 12.5), matching common European locale input. A second
      // comma/period is left for the caller's Number() parse to reject.
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
