export interface DesignBreakpointOption {
  id: string;
  label: string;
  widthPx: number;
}

/**
 * Reads `designs.data.breakpointSet` (§6.4) into the sorted option list the
 * breakpoint controls render. Unlabelled widths fall back to a size bucket.
 */
export function deriveDesignBreakpoints(
  designDataJson: Record<string, unknown>,
): DesignBreakpointOption[] {
  try {
    const raw = (designDataJson as Record<string, unknown>)?.breakpointSet;
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      Array.isArray((raw as Record<string, unknown>).breakpoints)
    ) {
      const parsed = (
        raw as {
          breakpoints: Array<{
            id?: unknown;
            widthPx?: unknown;
            label?: unknown;
          }>;
        }
      ).breakpoints
        .filter(
          (bp) =>
            typeof bp?.id === "string" &&
            typeof bp?.widthPx === "number" &&
            Number.isFinite(bp.widthPx),
        )
        .map((bp) => ({
          id: bp.id as string,
          widthPx: bp.widthPx as number,
          label:
            typeof bp.label === "string" && bp.label.trim()
              ? (bp.label as string)
              : (bp.widthPx as number) >= 1024
                ? "Desktop"
                : (bp.widthPx as number) >= 600
                  ? "Tablet"
                  : "Mobile",
        }));
      return parsed.sort((a, b) => a.widthPx - b.widthPx);
    }
    // coercion-ok: an unreadable breakpointSet means "none configured", which the empty list already expresses to the caller.
  } catch {
    // ignore malformed design data
  }
  return [];
}
