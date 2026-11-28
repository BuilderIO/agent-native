import { widthToPrefix } from "@shared/responsive-classes";

export interface DesignBreakpointOption {
  id: string;
  label: string;
  widthPx: number;
}

const EMPTY_DESIGN_BREAKPOINTS: DesignBreakpointOption[] = Object.freeze(
  [],
) as unknown as DesignBreakpointOption[];

export function applyOptimisticBreakpointAdd(
  designData: Record<string, unknown>,
  breakpoint: { id: string; label: string; widthPx: number },
): Record<string, unknown> {
  const id = breakpoint.id.trim();
  if (!id || !Number.isFinite(breakpoint.widthPx) || breakpoint.widthPx <= 0) {
    return designData;
  }
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
        (typeof entry.widthPx === "number" &&
          entry.widthPx === breakpoint.widthPx) ||
        (typeof entry.id === "string" && entry.id.trim() === id),
    )
  ) {
    return designData;
  }
  breakpoints.push({
    id,
    label:
      breakpoint.label.trim() || defaultBreakpointLabel(breakpoint.widthPx),
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

function defaultBreakpointLabel(widthPx: number): string {
  if (widthPx >= 1024) return "Desktop";
  if (widthPx >= 600) return "Tablet";
  return "Mobile";
}

export function deriveDesignBreakpoints(
  designDataJson: Record<string, unknown>,
): DesignBreakpointOption[] {
  if (Array.isArray(designDataJson)) {
    return EMPTY_DESIGN_BREAKPOINTS;
  }
  const raw = designDataJson.breakpointSet;
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    !Array.isArray((raw as Record<string, unknown>).breakpoints)
  ) {
    return EMPTY_DESIGN_BREAKPOINTS;
  }
  const entries = (raw as { breakpoints: unknown[] }).breakpoints;
  const seenIds = new Set<string>();
  const seenWidths = new Set<number>();
  const parsed: DesignBreakpointOption[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const bp = entry as {
      id?: unknown;
      widthPx?: unknown;
      label?: unknown;
    };
    if (typeof bp.id !== "string") continue;
    const id = bp.id.trim();
    if (!id || seenIds.has(id)) continue;
    if (
      typeof bp.widthPx !== "number" ||
      !Number.isFinite(bp.widthPx) ||
      bp.widthPx <= 0 ||
      seenWidths.has(bp.widthPx)
    ) {
      continue;
    }
    seenIds.add(id);
    seenWidths.add(bp.widthPx);
    const trimmedLabel = typeof bp.label === "string" ? bp.label.trim() : "";
    parsed.push({
      id,
      widthPx: bp.widthPx,
      label: trimmedLabel || defaultBreakpointLabel(bp.widthPx),
    });
  }
  if (parsed.length === 0) return EMPTY_DESIGN_BREAKPOINTS;
  return parsed.sort((a, b) => a.widthPx - b.widthPx);
}
