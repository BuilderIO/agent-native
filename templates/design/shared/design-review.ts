

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
