/** Approximate rendered width of `value` in the chart sans-serif font. */
export function estimateTextWidth(value: string, fontSize: number): number {
  let units = 0;
  for (const char of value) {
    if (char === " ") {
      units += 0.28;
    } else if (/[MW@#%&]/.test(char)) {
      units += 0.86;
    } else if (/[A-Z]/.test(char)) {
      units += 0.64;
    } else if (/[ilI.,:;|!']/u.test(char)) {
      units += 0.26;
    } else if (/[0-9]/.test(char)) {
      units += 0.56;
    } else {
      units += 0.54;
    }
  }
  return units * fontSize;
}

export function trimToWidth(
  value: string,
  fontSize: number,
  maxWidth: number,
  ellipsis = "...",
): string {
  if (estimateTextWidth(value, fontSize) <= maxWidth) return value;
  let trimmed = value;
  while (
    trimmed &&
    estimateTextWidth(`${trimmed}${ellipsis}`, fontSize) > maxWidth
  ) {
    trimmed = trimmed.slice(0, -1).trimEnd();
  }
  return trimmed ? `${trimmed}${ellipsis}` : "";
}

const ISO_DATE_VALUE = /^\d{4}-\d{2}(-\d{2})?([ T]\d{2}:\d{2}.*)?$/;

function isOrdinalAxisValue(value: unknown): boolean {
  if (value instanceof Date) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  const text = value.trim();
  return (
    ISO_DATE_VALUE.test(text) ||
    /^\d{8}$/.test(text) ||
    (text !== "" && Number.isFinite(Number(text)))
  );
}

/**
 * True when an x axis holds named categories rather than dates or numbers.
 * Date and number axes read fine with thinned ticks; a category axis loses
 * names when ticks are skipped.
 */
export function isCategoryAxis(values: readonly unknown[]): boolean {
  return values.some(
    (value) =>
      value !== null &&
      value !== undefined &&
      value !== "" &&
      !isOrdinalAxisValue(value),
  );
}

export interface CategoryAxisPlan {
  /** Tick rotation in degrees; 0 draws labels level. */
  angle: number;
  /** Labels skipped between drawn ones; 0 draws every label. */
  interval: number;
  /** Axis height that fits the drawn labels. */
  height: number;
  /** Width past which a label is cut with an ellipsis. */
  labelWidth: number;
}

const LEVEL_AXIS_HEIGHT = 30;
const LEVEL_LABEL_GAP = 6;
const AXIS_PADDING = 12;
const MAX_AXIS_HEIGHT = 96;
const MAX_LABEL_WIDTH = 120;
const ANGLES = [35, 60, 90];

/**
 * Lays out every category label under a plot: level when they fit, otherwise
 * angled as gently as their spacing allows, cut with an ellipsis past
 * `labelWidth`. `leftInset` is the room left of the plot; the first angled
 * label must not run off the chart edge.
 */
export function planCategoryAxis(
  labels: readonly string[],
  plotWidth: number,
  leftInset: number,
  fontSize: number,
): CategoryAxisPlan {
  const slot = plotWidth / Math.max(labels.length, 1);
  const widest = labels.reduce(
    (max, label) => Math.max(max, estimateTextWidth(label, fontSize)),
    0,
  );
  if (widest + LEVEL_LABEL_GAP <= slot) {
    return {
      angle: 0,
      interval: 0,
      height: LEVEL_AXIS_HEIGHT,
      labelWidth: slot,
    };
  }
  const angled = (degrees: number, interval: number): CategoryAxisPlan => {
    const radians = (degrees * Math.PI) / 180;
    const sin = Math.sin(radians);
    const cos = Math.cos(radians);
    const limits = [
      widest,
      MAX_LABEL_WIDTH,
      (MAX_AXIS_HEIGHT - AXIS_PADDING - fontSize * cos) / sin,
    ];
    if (cos > 0.05) limits.push((leftInset + slot / 2) / cos);
    const labelWidth = Math.max(fontSize, Math.min(...limits));
    return {
      angle: -degrees,
      interval,
      height: Math.ceil(labelWidth * sin + fontSize * cos + AXIS_PADDING),
      labelWidth,
    };
  };
  for (const degrees of ANGLES) {
    // Neighboring labels sit slot * sin(angle) apart; a line of text needs fontSize.
    if (slot * Math.sin((degrees * Math.PI) / 180) >= fontSize) {
      return angled(degrees, 0);
    }
  }
  return angled(90, Math.ceil(fontSize / Math.max(slot, 0.1)) - 1);
}
