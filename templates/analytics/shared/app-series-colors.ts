/**
 * One color per Agent-Native app for every dashboard chart and emailed report
 * image, so a series named after an app looks the same wherever it is drawn and
 * reordering a stack moves it without repainting it. Thirteen hues cannot all
 * stay apart for every reader, so these maximize the closest pair's distance;
 * the legend and tooltip still name each series. `unknown` is the app key's
 * fallback for events that carry no app.
 */
export const APP_SERIES_COLORS: Readonly<Record<string, string>> = {
  analytics: "#fb923c",
  assets: "#84cc16",
  brain: "#a78bfa",
  calendar: "#0284c7",
  chat: "#a16207",
  clips: "#dc2626",
  content: "#047857",
  design: "#d946ef",
  dispatch: "#16a34a",
  forms: "#06b6d4",
  mail: "#1d4ed8",
  plan: "#7e22ce",
  slides: "#f472b6",
  unknown: "#94a3b8",
};

const APP_COLOR_BY_KEY = new Map(Object.entries(APP_SERIES_COLORS));

export function appSeriesColor(key: string): string | undefined {
  return APP_COLOR_BY_KEY.get(key.trim().toLowerCase());
}
