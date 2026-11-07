/**
 * The segments of a funnel stage split by `config.funnelOutcomes`, in draw
 * order: what people shown the stage did there. Colors carry the meaning
 * (blue went forward, red left), so `config.colors` never repaints them.
 */
export const FUNNEL_OUTCOME_SEGMENTS = [
  "completed",
  "skipped",
  "movedOn",
  "left",
] as const;

export type FunnelOutcomeSegment = (typeof FUNNEL_OUTCOME_SEGMENTS)[number];

const SKIPPED_STRIPES =
  "repeating-linear-gradient(135deg, color-mix(in srgb, var(--brand-blue) 55%, transparent) 0 4px, color-mix(in srgb, var(--brand-blue) 25%, transparent) 4px 8px)";

/** Dashboard fills: skipped is the completed blue, striped. */
export const FUNNEL_OUTCOME_FILLS: Record<FunnelOutcomeSegment, string> = {
  completed: "var(--brand-blue)",
  skipped: SKIPPED_STRIPES,
  movedOn: "hsl(var(--muted-foreground) / 0.5)",
  left: "var(--brand-red)",
};

/** Emailed report fills, on the light report card; skipped draws striped. */
export const FUNNEL_OUTCOME_REPORT_COLORS: Record<
  FunnelOutcomeSegment,
  string
> = {
  completed: "#0284c7",
  skipped: "#0284c7",
  movedOn: "#a3a3a3",
  left: "#dc2626",
};
