/**
 * Design state, breakpoint, and capture types for the Design Studio
 * states/responsive panel (§6.4 + §4.3).
 *
 * States and breakpoints are orthogonal axes: any state can be viewed at any
 * breakpoint. Both persist in application state and are agent-visible via
 * `view-screen`.
 */

// ---------------------------------------------------------------------------
// Breakpoints
// ---------------------------------------------------------------------------

/**
 * Tailwind responsive prefix for a breakpoint frame.
 * `"base"` maps to unprefixed classes (the mobile-first default).
 */
export type TailwindBreakpointPrefix =
  | "base"
  | "sm"
  | "md"
  | "lg"
  | "xl"
  | "2xl";

export interface BreakpointDefinition {
  id: string;
  /** Human-readable label shown in the canvas header (e.g. "Mobile", "Tablet"). */
  label: string;
  /** Frame width in pixels (e.g. 390, 768, 1280). */
  widthPx: number;
  /**
   * The Tailwind responsive prefix this frame is the edit scope for.
   * Editing a layer in this frame writes classes with this prefix
   * (or unprefixed classes when `"base"`).
   */
  prefix: TailwindBreakpointPrefix;
}

/**
 * The ordered set of breakpoint frames rendered side-by-side for a screen.
 * Frames are ordered Mobile → Tablet → Desktop (left to right).
 */
export interface BreakpointSet {
  id: string;
  /** The breakpoints in display order. */
  breakpoints: BreakpointDefinition[];
}

// ---------------------------------------------------------------------------
// Design states
// ---------------------------------------------------------------------------

export const DESIGN_STATE_KINDS = ["state", "fixture", "capture"] as const;

export type DesignStateKind = (typeof DESIGN_STATE_KINDS)[number];

export const DESIGN_STATE_BREAKPOINTS = [
  "auto",
  "desktop",
  "tablet",
  "mobile",
] as const;

export type DesignStateBreakpoint = (typeof DESIGN_STATE_BREAKPOINTS)[number];

/**
 * A named design state, data fixture, or live capture scoped to a design.
 *
 * - `"state"` — an alternate DOM/Alpine `x-data` snapshot (e.g. logged-out,
 *   empty, loading, error).
 * - `"fixture"` — a real-app data fixture with route + props seeded from
 *   `fixtureData`.
 * - `"capture"` — a live capture of the running app's route + data taken via
 *   the bridge `captureState` operation.
 */
export interface DesignState {
  id: string;
  designId: string;
  /**
   * Opaque source reference (fileId for inline, routeId for localhost/fusion).
   * `null` when scoped to the entire design.
   */
  sourceRef: string | null;
  name: string;
  kind: DesignStateKind;
  /**
   * Which breakpoint context this state was captured or is intended for.
   * `"auto"` means it applies at all breakpoints.
   */
  breakpoint: DesignStateBreakpoint;
  /** App route path at the time of capture or fixture definition (e.g. "/dashboard"). */
  route?: string;
  /**
   * Structured fixture data (props, query params, mock API responses) for
   * `"fixture"` and `"capture"` states. Real-app only; `null` for inline states.
   */
  fixtureData: Record<string, unknown> | null;
  /**
   * Serialised DOM/Alpine snapshot for `"state"` and `"capture"` states.
   * For inline designs this is the alternate `x-data` / HTML payload.
   * For real apps this is the captured component tree or route data.
   */
  captureData: Record<string, unknown> | null;
  /**
   * Reference to the preview snapshot (image URL or snapshotRef id) produced
   * when this state was captured.
   */
  previewRef: string | null;
  createdAt: string;
  updatedAt: string;
}
