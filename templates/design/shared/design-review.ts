/**
 * Accessibility audit and visual-diff review types for the Design Studio
 * Review panel (§6.5 + §4.3).
 *
 * Results are produced by `run-design-audit` over the rendered DOM and cached
 * in `design_review_snapshot` rows. Fix actions are capability-gated (semantic
 * code fixes are real-app only).
 */

// ---------------------------------------------------------------------------
// Accessibility findings
// ---------------------------------------------------------------------------

export const A11Y_FINDING_SEVERITIES = ["error", "warning", "info"] as const;

export type A11ySeverity = (typeof A11Y_FINDING_SEVERITIES)[number];

export const A11Y_FINDING_CATEGORIES = [
  "contrast",
  "tap-target",
  "focus-visibility",
  "missing-label",
  "missing-alt",
  "reduced-motion",
  "role",
  "other",
] as const;

export type A11yFindingCategory = (typeof A11Y_FINDING_CATEGORIES)[number];

export interface A11yFinding {
  /** Stable identifier for deduplication and navigation (e.g. `"contrast:node-42"`). */
  id: string;
  severity: A11ySeverity;
  category: A11yFindingCategory;
  /** Short human-readable summary (e.g. "Contrast ratio 2.1:1 — minimum is 4.5:1"). */
  message: string;
  /** Optional longer description or remediation guidance. */
  detail?: string;
  /**
   * The `data-agent-native-node-id` of the offending element, when available.
   * Used to navigate the canvas to the affected layer.
   */
  nodeId?: string;
  /** CSS selector as a fallback when `nodeId` is absent. */
  selector?: string;
  /** WCAG success criterion reference (e.g. "1.4.3"). */
  wcag?: string;
  /**
   * Whether a fix action is available for this finding.
   * Semantic code fixes are real-app only; contrast/alt fixes may be available
   * in Alpine via the deterministic write path.
   */
  fixAvailable: boolean;
}

// ---------------------------------------------------------------------------
// Visual diff
// ---------------------------------------------------------------------------

export const VISUAL_DIFF_CHANGE_KINDS = [
  "added",
  "removed",
  "modified",
  "moved",
] as const;

export type VisualDiffChangeKind = (typeof VISUAL_DIFF_CHANGE_KINDS)[number];

/**
 * One changed surface between two design versions.
 */
export interface VisualDiffEntry {
  id: string;
  kind: VisualDiffChangeKind;
  /**
   * The `data-agent-native-node-id` of the changed element, when resolvable.
   */
  nodeId?: string;
  /** CSS selector fallback when `nodeId` is absent. */
  selector?: string;
  /** Human-readable description of the change (e.g. "Background color changed"). */
  description?: string;
  /**
   * Bounding box of the changed region in the before/after screenshot,
   * expressed as fractions [0, 1] of the frame dimensions.
   */
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Before screenshot crop URL or data URL, when available. */
  beforeImageUrl?: string;
  /** After screenshot crop URL or data URL, when available. */
  afterImageUrl?: string;
}

// ---------------------------------------------------------------------------
// Review snapshot
// ---------------------------------------------------------------------------

export const DESIGN_REVIEW_STATUSES = [
  "pending",
  "running",
  "done",
  "error",
] as const;

export type DesignReviewStatus = (typeof DESIGN_REVIEW_STATUSES)[number];

/**
 * Cached accessibility + visual-diff results for a design, optionally scoped
 * to a base/compare version pair. Stored in `design_review_snapshot` rows.
 */
export interface DesignReviewSnapshot {
  id: string;
  designId: string;
  /**
   * Opaque source reference identifying the screen or file this snapshot
   * covers (fileId for inline, routeId for localhost/fusion).
   * `null` when the snapshot covers the entire design.
   */
  sourceRef: string | null;
  /** The older `design_versions` id used as the diff base. `null` for a11y-only runs. */
  baseVersionId: string | null;
  /** The newer `design_versions` id being compared against `baseVersionId`. */
  compareVersionId: string | null;
  a11yFindings: A11yFinding[];
  visualDiff: VisualDiffEntry[];
  status: DesignReviewStatus;
  /** Error message when `status` is `"error"`. */
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}
