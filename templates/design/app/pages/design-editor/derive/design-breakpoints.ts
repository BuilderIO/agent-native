import { widthToPrefix } from "@shared/responsive-classes";

export interface DesignBreakpointOption {
  id: string;
  label: string;
  widthPx: number;
}

/**
 * Optimistic client patch for add-breakpoint: insert (or no-op duplicate width)
 * into `designs.data.breakpointSet` before the mutation round-trips so the
 * overview frames and breakpoint bar update in the same click frame.
 */
export function applyOptimisticBreakpointAdd(
  designData: Record<string, unknown>,
  breakpoint: { id: string; label: string; widthPx: number },
): Record<string, unknown> {
  const raw = designData.breakpointSet;
  const existingSet =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as {
          id?: string;
          breakpoints?: Array<Record<string, unknown>>;
        })
      : null;
  const breakpoints = Array.isArray(existingSet?.breakpoints)
    ? [...existingSet.breakpoints]
    : [];
  if (
    breakpoints.some(
      (entry) =>
        typeof entry?.widthPx === "number" &&
        entry.widthPx === breakpoint.widthPx,
    )
  ) {
    return designData;
  }
  breakpoints.push({
    id: breakpoint.id,
    label: breakpoint.label,
    widthPx: breakpoint.widthPx,
    prefix: widthToPrefix(breakpoint.widthPx),
  });
  breakpoints.sort((a, b) => {
    const aWidth = typeof a.widthPx === "number" ? a.widthPx : 0;
    const bWidth = typeof b.widthPx === "number" ? b.widthPx : 0;
    return aWidth - bWidth;
  });
  return {
    ...designData,
    breakpointSet: {
      id:
        typeof existingSet?.id === "string" && existingSet.id
          ? existingSet.id
          : `optimistic-set-${breakpoint.widthPx}`,
      breakpoints,
    },
  };
}

/**
 * Optimistic client patch for remove-breakpoint: drop the matching id from
 * `designs.data.breakpointSet` before the mutation round-trips.
 */
export function applyOptimisticBreakpointRemove(
  designData: Record<string, unknown>,
  breakpointId: string,
): Record<string, unknown> {
  const raw = designData.breakpointSet;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return designData;
  const existingSet = raw as {
    id?: string;
    breakpoints?: Array<Record<string, unknown>>;
  };
  if (!Array.isArray(existingSet.breakpoints)) return designData;
  const breakpoints = existingSet.breakpoints.filter(
    (entry) => entry?.id !== breakpointId,
  );
  if (breakpoints.length === existingSet.breakpoints.length) return designData;
  return {
    ...designData,
    breakpointSet: {
      ...existingSet,
      breakpoints,
    },
  };
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
