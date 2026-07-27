/**
 * Design Surface Index — normalized read-model types.
 *
 * A lazy, queryable surface that UI panels and agent actions read to understand
 * what is present in a design: source metadata, selectable nodes, components,
 * tokens, motion timelines, design states, and accessibility review results.
 *
 * **Types only — no DB, no runtime code.**  The index is grown lazily from the
 * existing `code-layer.ts` projection and per-feature needs.  A persistent
 * cache table (`design_surface_indexes`) is added only when re-parsing proves
 * to be a real performance problem.
 *
 * See `DESIGN-STUDIO-PLAN.md` §4.2 for rationale.
 */

import type { CodeLayerNode } from "./code-layer";
import type { DesignCapabilityName } from "./design-source-capabilities";
import type { DesignSourceType } from "./source-mode";

// ─── Source metadata ──────────────────────────────────────────────────────────

/** Lightweight description of the source backing this index snapshot. */
export interface DesignSurfaceSourceMeta {
  sourceType: DesignSourceType;
  /** design_files.id for inline; route id or artboard id for real-app sources. */
  sourceRef: string;
  /**
   * Hash of the source content at index time (file content hash for inline;
   * git ref or build hash for real-app sources).  Used to detect staleness.
   */
  contentHash?: string;
  /** ISO-8601 timestamp when this index snapshot was built. */
  indexedAt: string;
  /** The capabilities that were `available` when this snapshot was taken. */
  availableCapabilities: DesignCapabilityName[];
}

// ─── Node summary ─────────────────────────────────────────────────────────────

/**
 * A lightweight node summary derived from `CodeLayerNode`.  The full
 * `CodeLayerProjection` is the authoritative source; this slice carries what
 * panel headers and the agent's `view-screen` response need at a glance.
 */
export interface DesignSurfaceNode {
  /** Stable `data-agent-native-node-id` value. */
  nodeId: string;
  /** Resolved human-readable layer name. */
  layerName: string;
  tag: string;
  selector: string;
  parentNodeId?: string;
  childNodeIds: string[];
  /** Whether this node is currently the edit-scope selection. */
  selected?: boolean;
}

// ─── Component entries ────────────────────────────────────────────────────────

/**
 * Kind of component: an annotated Alpine region or a fully-indexed real
 * React/TS component.
 */
export type DesignComponentKind = "alpine-annotation" | "react-component";

export interface DesignSurfaceComponentProp {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: unknown;
  /** When sourced from `cva` or `tailwind-variants`, the allowed variant keys. */
  enumValues?: string[];
}

export interface DesignSurfaceComponent {
  /** Stable component id (matches `component_index.id` when persisted). */
  componentId: string;
  kind: DesignComponentKind;
  name: string;
  /** Source file path relative to the project root (real-app only). */
  filePath?: string;
  /** Named export identifier in the source file (real-app only). */
  exportName?: string;
  props?: DesignSurfaceComponentProp[];
  /** Variant names from `cva` / `tailwind-variants` (real-app only). */
  variants?: Record<string, string[]>;
  /** `data-agent-native-node-id` values of DOM instances of this component. */
  instanceNodeIds: string[];
}

// ─── Token entries ────────────────────────────────────────────────────────────

export type DesignTokenKind =
  | "color"
  | "typography"
  | "spacing"
  | "radius"
  | "shadow"
  | "motion"
  | "other";

export interface DesignSurfaceToken {
  /** Stable token id — typically the CSS custom-property name, e.g. `--color-primary`. */
  tokenId: string;
  kind: DesignTokenKind;
  /** Friendly display label, e.g. "Primary". */
  label: string;
  /** CSS custom-property name, e.g. `--color-primary`. */
  cssVar: string;
  /** Resolved value at index time, e.g. `#3b82f6`. */
  resolvedValue: string;
  /**
   * Source file where this token is defined (real-app only; `globals.css`,
   * `tailwind.config.ts`, etc.).
   */
  sourceFile?: string;
}

// ─── Motion timeline summary ──────────────────────────────────────────────────

export interface DesignSurfaceMotionTrack {
  /** `data-agent-native-node-id` of the animated element. */
  targetNodeId: string;
  /** CSS property being animated, e.g. `opacity`, `transform`. */
  property: string;
  keyframeCount: number;
}

export interface DesignSurfaceMotionTimeline {
  /** Matches `motion_timeline.id` when persisted. */
  timelineId: string;
  /** `motion_timeline.source_ref` — the file or screen this timeline targets. */
  sourceRef: string;
  durationMs: number;
  tracks: DesignSurfaceMotionTrack[];
  /** SHA of the compiled CSS, used to detect drift from the JSON tracks. */
  compiledHash?: string;
}

// ─── Design state / capture entries ──────────────────────────────────────────

export type DesignStateKind = "state" | "fixture" | "capture";

export type DesignBreakpoint = "auto" | "desktop" | "tablet" | "mobile";

export interface DesignSurfaceState {
  /** Matches `design_state.id` when persisted. */
  stateId: string;
  kind: DesignStateKind;
  name: string;
  breakpoint: DesignBreakpoint;
  /** Route path snapped for this state (real-app captures only). */
  route?: string;
  /** Whether fixture/capture data is present. */
  hasData: boolean;
  /** URL of a preview screenshot, if captured. */
  previewRef?: string;
}

// ─── Accessibility / review summary ──────────────────────────────────────────

export type DesignReviewFindingSeverity = "error" | "warning" | "info";

export type DesignReviewFindingKind =
  | "contrast"
  | "tap-target"
  | "focus-visibility"
  | "missing-alt"
  | "missing-label"
  | "missing-role"
  | "reduced-motion"
  | "other";

export interface DesignReviewFinding {
  findingId: string;
  severity: DesignReviewFindingSeverity;
  kind: DesignReviewFindingKind;
  message: string;
  /** `data-agent-native-node-id` of the affected element, when resolvable. */
  nodeId?: string;
  /** CSS selector fallback when `nodeId` is unavailable. */
  selector?: string;
  /** Whether a `apply-a11y-fix` action is available (real-app only). */
  fixAvailable: boolean;
}

export interface DesignSurfaceReview {
  /**
   * Matches `design_review_snapshot.id` when persisted.  `null` means the
   * review has not been run yet for this index snapshot.
   */
  snapshotId: string | null;
  /**
   * ISO-8601 timestamp of the last audit run, or `null` if not yet run.
   */
  auditedAt: string | null;
  findings: DesignReviewFinding[];
  /** `design_versions.id` used as the base for the visual diff. */
  baseVersionId?: string;
  /** `design_versions.id` used as the compare target for the visual diff. */
  compareVersionId?: string;
}

// ─── Top-level index ──────────────────────────────────────────────────────────

/**
 * The normalized, queryable read-model for a single design source/screen.
 *
 * Both UI panels and agent actions read from this shape.  Each section is
 * optional so callers can build the index lazily — a panel that only needs
 * tokens doesn't have to wait for component indexing to finish.
 */
export interface DesignSurfaceIndex {
  /** Version sentinel — increment when the shape changes in a breaking way. */
  version: 1;

  /** Metadata about the source and when this snapshot was built. */
  source: DesignSurfaceSourceMeta;

  /**
   * Flat node list derived from the `CodeLayerProjection`.  Keyed by `nodeId`
   * for O(1) lookup from UI selection events.
   */
  nodes?: Record<string, DesignSurfaceNode>;

  /**
   * Component entries found in this source.
   * - Alpine designs: `alpine-annotation` entries from `data-agent-native-component`.
   * - Real apps: `react-component` entries from the component index action.
   */
  components?: DesignSurfaceComponent[];

  /**
   * Design token entries parsed from CSS vars / Tailwind config / theme JSON.
   * Available for both inline and real-app sources.
   */
  tokens?: DesignSurfaceToken[];

  /**
   * Motion timelines keyed by `timelineId`.  Both tiers support the managed
   * `<style data-agent-native-motion>` block; real apps additionally support
   * CSS module write-back.
   */
  motion?: Record<string, DesignSurfaceMotionTimeline>;

  /**
   * Design states, fixtures, and real-app captures.
   * Breakpoints and states are orthogonal axes — any state can be viewed at
   * any breakpoint.
   */
  states?: DesignSurfaceState[];

  /**
   * Most-recent accessibility audit results, or `null` if `run-design-audit`
   * has not been called yet.
   */
  review?: DesignSurfaceReview;
}
