export const GOOGLE_EVENT_COLOR_OPTIONS = [
  { id: "default", label: "Default", color: "" },
  { id: "1", label: "Lavender", color: "#a4bdfc" },
  { id: "2", label: "Sage", color: "#7ae7bf" },
  { id: "3", label: "Grape", color: "#dbadff" },
  { id: "4", label: "Flamingo", color: "#ff887c" },
  { id: "5", label: "Banana", color: "#fbd75b" },
  { id: "6", label: "Tangerine", color: "#ffb878" },
  { id: "7", label: "Peacock", color: "#46d6db" },
  { id: "8", label: "Graphite", color: "#e1e1e1" },
  { id: "9", label: "Blueberry", color: "#5484ed" },
  { id: "10", label: "Basil", color: "#51b749" },
  { id: "11", label: "Tomato", color: "#dc2127" },
] as const;

export function getGoogleEventColorHex(colorId?: string): string | undefined {
  if (!colorId) return undefined;
  return GOOGLE_EVENT_COLOR_OPTIONS.find((option) => option.id === colorId)
    ?.color;
}
