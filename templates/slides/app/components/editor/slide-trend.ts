/**
 * A value marked `data-trend="auto"` is colored by its sign. Its inline style
 * holds the palette as `--trend-up`, `--trend-down` and an optional
 * `--trend-flat`, and paints with `--trend`, which names one of them.
 */
export const AUTO_TREND_SELECTOR = '[data-trend="auto"]';

export type Trend = "up" | "down" | "flat";

const FIRST_NUMBER = /([+\-−])?\s*[$€£¥]?\s*([+\-−])?(\d[\d,]*(?:\.\d+)?)/;

/** The sign of the first number in `text`; null when it holds no number. */
export function trendOfText(text: string): Trend | null {
  const match = FIRST_NUMBER.exec(text);
  if (!match) return null;
  const sign = match.at(1) ?? match.at(2);
  if (sign === "+") return "up";
  if (sign) return "down";
  const digits = match.at(3);
  if (digits === undefined) return null;
  return Number.parseFloat(digits.replaceAll(",", "")) === 0 ? "flat" : "up";
}

/**
 * Recolors every auto-trend value in or around `root` from its current text.
 * A value with no number keeps its color, and an unsigned zero reads as up
 * unless the value has a flat color. Only a changed color is written, so an
 * untouched value keeps its markup byte for byte.
 */
export function refreshAutoTrends(root: HTMLElement) {
  const values = new Set<HTMLElement>(
    root.querySelectorAll<HTMLElement>(AUTO_TREND_SELECTOR),
  );
  const around = root.closest<HTMLElement>(AUTO_TREND_SELECTOR);
  if (around) values.add(around);
  for (const value of values) {
    const trend = trendOfText(value.textContent);
    if (!trend) continue;
    const resolved =
      trend === "flat" && !value.style.getPropertyValue("--trend-flat").trim()
        ? "up"
        : trend;
    const next = `var(--trend-${resolved})`;
    if (value.style.getPropertyValue("--trend").trim() !== next) {
      value.style.setProperty("--trend", next);
    }
  }
}
