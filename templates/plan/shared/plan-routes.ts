import { PLAN_KINDS, type PlanKind } from "./types.js";

/**
 * The one place a plan kind maps to its route segment. Every id-to-URL call
 * site reads this; a kind added to `PLAN_KINDS` without an entry here fails to
 * compile rather than silently routing the new kind to `/plans/:id`.
 */
export const PLAN_KIND_ROUTE_SEGMENT: Record<PlanKind, string> = {
  plan: "plans",
  recap: "recaps",
  edition: "editions",
};

export function isPlanKind(value: unknown): value is PlanKind {
  return (
    typeof value === "string" &&
    (PLAN_KINDS as readonly string[]).includes(value)
  );
}

export function planRouteSegment(kind: PlanKind): string {
  return PLAN_KIND_ROUTE_SEGMENT[kind];
}

export function planPathForKind(id: string, kind: PlanKind): string {
  return `/${planRouteSegment(kind)}/${encodeURIComponent(id)}`;
}

/** Alternation for the SSR page-route matcher, e.g. `plans|recaps|editions`. */
export function planRouteSegmentPattern(): string {
  return Object.values(PLAN_KIND_ROUTE_SEGMENT).join("|");
}

/**
 * Kinds whose detail route is the immersive full-screen reader. An edition is a
 * page the reader navigates around, so it keeps the app sidebar and header; a
 * kind listed here loses both and must supply its own way back.
 */
const IMMERSIVE_READER_KINDS: readonly PlanKind[] = ["plan", "recap"];

/** Alternation for the immersive-reader route matcher, e.g. `plans|recaps`. */
export function immersiveReaderSegmentPattern(): string {
  return IMMERSIVE_READER_KINDS.map(planRouteSegment).join("|");
}

export function planKindFromRouteSegment(segment: string): PlanKind | null {
  for (const kind of PLAN_KINDS) {
    if (PLAN_KIND_ROUTE_SEGMENT[kind] === segment) return kind;
  }
  return null;
}
