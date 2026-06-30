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
// Inline auto-fix mapping
// ---------------------------------------------------------------------------
//
// Some a11y findings can be repaired inline against the SQL-backed HTML design
// content using the same deterministic edit primitives the visual editor uses
// (`apply-visual-edit`: style / class / textContent). Those primitives can set
// an inline style value, add/remove/replace a class token, or rewrite leaf text
// — so the fixes we can apply purely inline are the ones that reduce to one of
// those operations on a *targeted* node:
//
//   - contrast / color   → set an inline `color` (style edit) or swap a text
//                           color class, raising the foreground contrast.
//   - tap-target         → add a min-size utility class (e.g. `min-h-[44px]`).
//   - focus-visibility   → add a `focus-visible:ring-2` utility class.
//
// Fixes that require writing a *new attribute* (alt, aria-label,
// aria-labelledby) or semantic/structural code changes are NOT expressible
// through the deterministic edit engine's exported intents, so they remain
// "real-app only" and are surfaced as informational findings (no inline Fix).
// `a11yFindingToEdit` returns `null` for those.

/**
 * A single deterministic edit that repairs an a11y finding inline. The shape is
 * a strict subset of the `apply-visual-edit` `EditIntent` union — only the kinds
 * the inline (SQL HTML) edit engine can apply without escalating: `style`,
 * `class`, and `textContent`. The `apply-a11y-fix` action forwards this verbatim
 * to the shared `applyVisualEdit` primitive.
 */
export type A11yFixEdit =
  | {
      kind: "style";
      target: { nodeId?: string; selector?: string };
      property: string;
      value: string;
    }
  | {
      kind: "class";
      target: { nodeId?: string; selector?: string };
      operation: "add" | "remove" | "replace";
      className?: string;
      classNames?: string[];
      from?: string;
      to?: string;
    }
  | {
      kind: "textContent";
      target: { nodeId?: string; selector?: string };
      value: string;
    };

/**
 * A planned inline fix for a finding: the deterministic edit to apply plus a
 * short human-readable label for the UI / agent.
 */
export interface A11yFixPlan {
  finding: A11yFinding;
  edit: A11yFixEdit;
  /** Short human summary, e.g. "Raise text contrast" or "Enlarge tap target". */
  label: string;
}

/**
 * A high-contrast foreground color used as the default contrast remediation
 * when a finding does not carry an explicit replacement color. Near-black keeps
 * ≥ 4.5:1 against typical light backgrounds; the agent can refine afterward.
 */
const DEFAULT_CONTRAST_COLOR = "#111827";

/** Categories whose default inline fix is a class addition, with the utility. */
const CLASS_ADD_FIX: Partial<Record<A11yFindingCategory, string>> = {
  "tap-target": "min-h-[44px] min-w-[44px]",
  "focus-visibility": "focus-visible:ring-2",
};

/**
 * Map an {@link A11yFinding} to a deterministic inline {@link A11yFixPlan}, or
 * `null` when the finding is not auto-fixable through the inline edit engine.
 *
 * Pure and dependency-free so both the Review panel (to decide whether to show
 * a "Fix" affordance) and the `apply-a11y-fix` action (to compute the edit)
 * share one source of truth.
 *
 * @param finding   The audit finding.
 * @param overrides Optional caller-supplied values — e.g. a chosen replacement
 *                  `color` for contrast fixes — that win over the defaults.
 */
export function a11yFindingToEdit(
  finding: A11yFinding,
  overrides?: { color?: string },
): A11yFixPlan | null {
  // A target is required for every inline edit — without a node id or selector
  // there is nothing to anchor the deterministic patch to.
  const target =
    finding.nodeId || finding.selector
      ? { nodeId: finding.nodeId, selector: finding.selector }
      : null;
  if (!target) return null;

  if (finding.category === "contrast") {
    const color = (overrides?.color ?? "").trim() || DEFAULT_CONTRAST_COLOR;
    return {
      finding,
      label: "Raise text contrast",
      edit: { kind: "style", target, property: "color", value: color },
    };
  }

  const classToAdd = CLASS_ADD_FIX[finding.category];
  if (classToAdd) {
    return {
      finding,
      label:
        finding.category === "tap-target"
          ? "Enlarge tap target"
          : "Add focus-visible ring",
      edit: {
        kind: "class",
        target,
        operation: "add",
        classNames: classToAdd.split(/\s+/).filter(Boolean),
      },
    };
  }

  // missing-alt, missing-label, reduced-motion, role, other → require new
  // attributes or semantic/structural rewrites the inline engine can't express.
  return null;
}

/**
 * Whether a finding can be auto-fixed inline (i.e. {@link a11yFindingToEdit}
 * returns a plan). Convenience wrapper for UI gating.
 */
export function isA11yFindingAutoFixable(finding: A11yFinding): boolean {
  return a11yFindingToEdit(finding) !== null;
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
