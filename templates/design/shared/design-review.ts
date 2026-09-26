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
  "token-drift",
  "design-system-drift",
  "render-blocking-overlay",
  "other",
] as const;

export type A11yFindingCategory = (typeof A11Y_FINDING_CATEGORIES)[number];

export interface A11yFinding {
  id: string;
  severity: A11ySeverity;
  category: A11yFindingCategory;
  message: string;
  detail?: string;
  nodeId?: string;
  selector?: string;
  wcag?: string;
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

export interface A11yFixPlan {
  finding: A11yFinding;
  edit: A11yFixEdit;
  label: string;
}

const DEFAULT_CONTRAST_COLOR = "#111827";

const CLASS_ADD_FIX: Partial<Record<A11yFindingCategory, string>> = {
  "tap-target": "min-h-[44px] min-w-[44px]",
  "focus-visibility": "focus-visible:ring-2",
};

export function a11yFindingToEdit(
  finding: A11yFinding,
  overrides?: { color?: string },
): A11yFixPlan | null {
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

  return null;
}

export function isA11yFindingAutoFixable(finding: A11yFinding): boolean {
  return a11yFindingToEdit(finding) !== null;
}

export const VISUAL_DIFF_CHANGE_KINDS = [
  "added",
  "removed",
  "modified",
  "moved",
] as const;

export type VisualDiffChangeKind = (typeof VISUAL_DIFF_CHANGE_KINDS)[number];

export interface VisualDiffEntry {
  id: string;
  kind: VisualDiffChangeKind;
  nodeId?: string;
  selector?: string;
  description?: string;
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  beforeImageUrl?: string;
  afterImageUrl?: string;
}

export const DESIGN_REVIEW_STATUSES = [
  "pending",
  "running",
  "done",
  "error",
] as const;

export type DesignReviewStatus = (typeof DESIGN_REVIEW_STATUSES)[number];

export interface DesignReviewSnapshot {
  id: string;
  designId: string;
  sourceRef: string | null;
  baseVersionId: string | null;
  compareVersionId: string | null;
  a11yFindings: A11yFinding[];
  visualDiff: VisualDiffEntry[];
  status: DesignReviewStatus;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}
