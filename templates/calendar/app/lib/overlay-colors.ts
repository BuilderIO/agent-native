import type { OverlayPerson } from "@shared/api";

export const OVERLAY_COLORS = [
  "#E07C4F", // warm orange
  "#0EA5E9", // sky blue
  "#10B981", // emerald
  "#F59E0B", // amber
  "#EC4899", // pink
  "#06B6D4", // cyan
  "#84CC16", // lime
  "#EF4444", // red
  "#FACC15", // yellow
  "#14B8A6", // teal
];

export function getNextOverlayColor(existingPeople: OverlayPerson[]): string {
  const usedColors = new Set(existingPeople.map((p) => p.color));
  for (const color of OVERLAY_COLORS) {
    if (!usedColors.has(color)) return color;
  }
  return OVERLAY_COLORS[existingPeople.length % OVERLAY_COLORS.length];
}
