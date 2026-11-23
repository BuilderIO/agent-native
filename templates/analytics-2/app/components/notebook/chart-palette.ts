/**
 * Series colors for drawn charts. A chart without its own `colors` takes the
 * default palette by series slot. A chart split by an app column (`app` or
 * `template`) draws each Agent-Native app in one fixed color, so an app keeps
 * its color wherever it appears and when a stack is reordered; its other series
 * are muted so none reads as an app.
 *
 * Colors are concrete values, never theme variables: a variable that a page
 * does not define makes the whole color invalid and every series falls back to
 * the same accent.
 */
export const DEFAULT_SERIES_COLORS: readonly string[] = [
  "#0284c7",
  "#0d9488",
  "#06b6d4",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#14b8a6",
];

export const APP_SERIES_COLORS: Readonly<Record<string, string>> = {
  analytics: "#b2912e",
  assets: "#457d1b",
  brain: "#a035f1",
  calendar: "#0481b3",
  chat: "#ab5d2b",
  clips: "#f92917",
  content: "#33a868",
  design: "#e22cc9",
  dispatch: "#8863b0",
  forms: "#748feb",
  mail: "#4660f3",
  plan: "#cc79a9",
  slides: "#cd2e73",
};

/** The color of `unknown`, the app key of events that carry no app. */
export const UNKNOWN_APP_COLOR = "#6b939a";

/** Other series of a chart split by app, by slot. */
export const NON_APP_SERIES_COLORS: readonly string[] = ["#a0817b", "#747253"];

const APP_COLUMNS = new Set(["app", "template"]);

export function defaultSeriesColor(slot: number): string {
  const index = Math.max(0, Math.trunc(slot));
  return DEFAULT_SERIES_COLORS[index % DEFAULT_SERIES_COLORS.length]!;
}

function appKey(label: string) {
  return label.trim().toLowerCase();
}

/**
 * The color of each drawn series. `labels[i]` is the series' group label and
 * `slots[i]` its palette slot (author order first, then first-seen order).
 */
export function resolveSeriesColors({
  labels,
  slots,
  colors,
  seriesField,
}: {
  labels: readonly string[];
  slots: readonly number[];
  colors?: readonly string[] | undefined;
  seriesField?: string | null | undefined;
}): string[] {
  if (colors?.length) return slots.map((slot) => colors[slot % colors.length]!);
  const appColors = labels.map((label) =>
    Object.hasOwn(APP_SERIES_COLORS, appKey(label))
      ? APP_SERIES_COLORS[appKey(label)]
      : undefined,
  );
  const splitByApp =
    seriesField != null &&
    APP_COLUMNS.has(seriesField.trim().toLowerCase()) &&
    appColors.some((color) => color !== undefined);
  if (!splitByApp) return slots.map(defaultSeriesColor);
  const otherSlots = slots.filter(
    (_, index) =>
      !appColors[index] && appKey(labels[index] ?? "") !== "unknown",
  );
  return labels.map((label, index) => {
    const app = appColors[index];
    if (app) return app;
    if (appKey(label) === "unknown") return UNKNOWN_APP_COLOR;
    const rank = otherSlots.filter((slot) => slot < slots[index]!).length;
    return NON_APP_SERIES_COLORS[rank % NON_APP_SERIES_COLORS.length]!;
  });
}
