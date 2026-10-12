/**
 * One color per Agent-Native app for every dashboard chart and emailed report
 * image, so a series named after an app looks the same wherever it is drawn and
 * reordering a stack moves it without repainting it. Each keeps 3:1 contrast
 * on both the light and the dark card, and the set maximizes the closest pair's
 * distance; thirteen hues cannot all stay apart for every reader, so the legend
 * and tooltip still name each series.
 */
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

/**
 * Series in a chart split by app that are not an app (`unknown`, `docs`):
 * gray, so none of them reads as an app.
 */
export const NON_APP_SERIES_COLORS: readonly string[] = ["#8a94a6", "#6b7280"];

const APP_COLOR_BY_KEY = new Map(Object.entries(APP_SERIES_COLORS));

export function appSeriesColor(key: string): string | undefined {
  return APP_COLOR_BY_KEY.get(key.trim().toLowerCase());
}
