// i18n-raw-literal-disable-file — new Design Studio panel; UI strings are localized when this feature is finalized in the follow-up PR.
/**
 * ReviewPanel — Design Studio accessibility + visual-diff review panel.
 *
 * Displays severity-dot a11y findings from `run-design-audit` /
 * `get-design-review`, and a structural visual-diff section comparing two
 * `design_versions`.
 *
 * The "Fix" button is wired to the `apply-a11y-fix` action for findings that
 * are auto-fixable inline (contrast/color, tap-target, focus-visibility) — the
 * fix reduces to a deterministic style/class edit against the SQL-backed HTML,
 * and the canvas re-renders from the written content.  Findings that need a new
 * attribute (alt / aria-label) or a semantic rewrite stay informational with no
 * Fix affordance.  When no design source (`designId`/`fileId`) is provided the
 * panel falls back to read-only.
 *
 * Layout matches the Review artboard in the canonical plan visual:
 *   <https://plan.agent-native.com/plans/plan-88dc4a09fb0c46bc>
 *
 * shadcn/ui primitives + Tabler icons throughout.  No emojis.
 */

import { useActionMutation } from "@agent-native/core/client";
import {
  IconAlertCircle,
  IconArrowsLeftRight,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconRefresh,
  IconShieldCheck,
  IconTool,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import {
  isA11yFindingAutoFixable,
  type A11yFinding,
  type A11ySeverity,
  type VisualDiffChangeKind,
  type VisualDiffEntry,
} from "../../../shared/design-review.js";

// ---------------------------------------------------------------------------
// Inline a11y fix wiring
// ---------------------------------------------------------------------------

/**
 * Identifies the inline design source a fix should be applied to.  Required for
 * the "Fix" affordance to be enabled — without it the panel is read-only.
 */
export interface ReviewFixSource {
  designId?: string;
  fileId?: string;
  filename?: string;
}

export interface ReviewFixResult {
  applied?: boolean;
  fileId?: string;
  patchedContent?: string;
}

/** Per-finding state for the optimistic Fix flow. */
type FixStatus = "idle" | "pending" | "fixed" | "error";

// ---------------------------------------------------------------------------
// Shared sub-types
// ---------------------------------------------------------------------------

export interface ReviewVersionOption {
  id: string;
  label: string;
  createdAt?: string;
}

export interface ReviewPanelProps {
  /** The a11y findings to show. Pass `[]` if audit has not been run yet. */
  findings: A11yFinding[];
  /** `true` while the audit is running. */
  auditLoading?: boolean;
  /** ISO-8601 timestamp of the last audit run. */
  auditedAt?: string | null;
  /** Error message if the last audit run failed. */
  auditError?: string | null;
  /** Called when the user clicks "Run audit". */
  onRunAudit?: () => void;
  /** Visual diff entries between base and compare versions. */
  visualDiff?: VisualDiffEntry[];
  /** All available design_versions for the base/compare selectors. */
  versionOptions?: ReviewVersionOption[];
  /** Currently selected base version id. */
  baseVersionId?: string | null;
  /** Currently selected compare version id. */
  compareVersionId?: string | null;
  /** Called when the user changes either version selector. */
  onVersionChange?: (
    kind: "base" | "compare",
    versionId: string | null,
  ) => void;
  /** `true` while the diff is loading. */
  diffLoading?: boolean;
  /** Error message if the diff failed. */
  diffError?: string | null;
  /** Called when a finding row is clicked — navigates the canvas to the node. */
  onFindingClick?: (finding: A11yFinding) => void;
  /**
   * Inline design source for the "Fix" affordance.  When provided (and a
   * finding is auto-fixable), a "Fix" button applies `apply-a11y-fix` against
   * this source.  Omit to keep the panel read-only.
   */
  fixSource?: ReviewFixSource;
  /**
   * Called after a fix is successfully applied — e.g. to refetch the audit so
   * the resolved finding drops out of the list.  The applied finding is passed.
   */
  onFixApplied?: (finding: A11yFinding, result?: ReviewFixResult) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

interface SeverityConfig {
  dot: string;
  label: string;
}

const SEVERITY_CONFIG: Record<A11ySeverity, SeverityConfig> = {
  error: {
    dot: "bg-destructive",
    label: "Error",
  },
  warning: {
    dot: "bg-amber-400",
    label: "Warning",
  },
  info: {
    dot: "bg-blue-400",
    label: "Info",
  },
};

const DIFF_KIND_CONFIG: Record<
  VisualDiffChangeKind,
  { badge: string; label: string }
> = {
  added: {
    badge:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    label: "Added",
  },
  removed: {
    badge:
      "border-destructive/40 bg-destructive/10 text-destructive dark:text-red-400",
    label: "Removed",
  },
  modified: {
    badge:
      "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    label: "Modified",
  },
  moved: {
    badge: "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400",
    label: "Moved",
  },
};

// ---------------------------------------------------------------------------
// Finding row
// ---------------------------------------------------------------------------

function FindingRow({
  finding,
  onClick,
  fixSource,
  onFixApplied,
}: {
  finding: A11yFinding;
  onClick?: (finding: A11yFinding) => void;
  fixSource?: ReviewFixSource;
  onFixApplied?: (finding: A11yFinding, result?: ReviewFixResult) => void;
}) {
  const cfg = SEVERITY_CONFIG[finding.severity];
  const [expanded, setExpanded] = useState(false);
  const hasDetail = !!(finding.detail ?? finding.wcag);

  const applyFix = useActionMutation("apply-a11y-fix");
  const [fixStatus, setFixStatus] = useState<FixStatus>("idle");

  // `finding.id` is stable across audit runs (`"category:node-id"`), so a
  // parent refetch that still includes the same id — e.g. the fix didn't
  // fully resolve the issue and a fresh audit re-detected it — reuses this
  // same row instance. Without this, a stale "Fixed" checkmark would keep
  // showing even though the finding is live again. Only reset when a
  // genuinely new `finding` object arrives (a fresh audit pass), not on our
  // own optimistic `setFixStatus` calls, which don't touch the prop.
  const lastFindingRef = useRef(finding);
  useEffect(() => {
    if (lastFindingRef.current !== finding) {
      lastFindingRef.current = finding;
      setFixStatus("idle");
    }
  }, [finding]);

  // A Fix affordance is shown only when (a) the finding maps to a deterministic
  // inline edit and (b) a design source is available to write to.  Everything
  // else stays informational.
  const hasSource = !!(fixSource?.designId ?? fixSource?.fileId);
  const canFix = hasSource && isA11yFindingAutoFixable(finding);

  const handleFix = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canFix || fixStatus === "pending" || fixStatus === "fixed") return;
    // Optimistic: flip to "fixed" immediately; the canvas re-renders from the
    // written content and the parent can refetch to drop the resolved finding.
    setFixStatus("pending");
    try {
      const res = (await applyFix.mutateAsync({
        designId: fixSource?.designId,
        fileId: fixSource?.fileId,
        filename: fixSource?.filename,
        includeContent: true,
        finding: {
          id: finding.id,
          severity: finding.severity,
          category: finding.category,
          message: finding.message,
          detail: finding.detail,
          nodeId: finding.nodeId,
          selector: finding.selector,
          wcag: finding.wcag,
          fixAvailable: finding.fixAvailable,
        },
      })) as ReviewFixResult | undefined;
      if (res?.applied) {
        setFixStatus("fixed");
        onFixApplied?.(finding, res);
      } else {
        // The engine could not apply it (e.g. selector no longer resolves).
        setFixStatus("error");
      }
    } catch {
      setFixStatus("error");
    }
  };

  return (
    <div
      className={cn(
        "group rounded-[5px] px-2 py-1.5 transition-colors",
        onClick
          ? "cursor-pointer hover:bg-[var(--design-editor-layer-hover-color)]"
          : "cursor-default",
      )}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={() => onClick?.(finding)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          // This is a `role="button"` div, not a native <button>, so the
          // browser's default Space behavior (page scroll) isn't suppressed
          // automatically — prevent it before activating.
          e.preventDefault();
          onClick?.(finding);
        }
      }}
      aria-label={finding.message}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn("mt-[5px] size-1.5 shrink-0 rounded-full", cfg.dot)}
          aria-hidden="true"
        />

        <div className="min-w-0 flex-1">
          <div className="flex min-h-5 items-center gap-1">
            <span className="truncate !text-[11px] font-medium leading-snug text-foreground">
              {finding.message}
            </span>
            {hasDetail && (
              <button
                type="button"
                className="ml-auto shrink-0 text-muted-foreground/50 hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((v) => !v);
                }}
                aria-label={expanded ? "Collapse detail" : "Expand detail"}
                aria-expanded={expanded}
              >
                {expanded ? (
                  <IconChevronDown className="size-3" />
                ) : (
                  <IconChevronRight className="size-3" />
                )}
              </button>
            )}
          </div>

          {(finding.wcag || expanded) && (
            <span className="text-[10px] capitalize text-muted-foreground/55">
              {cfg.label}
              {finding.wcag ? ` · WCAG ${finding.wcag}` : ""}
            </span>
          )}

          {expanded && finding.detail && (
            <p className="mt-1 !text-[11px] leading-snug text-muted-foreground">
              {finding.detail}
            </p>
          )}
        </div>

        {/* Fix button — enabled only for inline auto-fixable findings with a
            design source. Non-fixable findings render nothing (informational). */}
        {canFix &&
          (fixStatus === "fixed" ? (
            <span
              className="flex h-5 shrink-0 items-center gap-1 px-1.5 text-[10px] text-emerald-500"
              title="Fix applied"
            >
              <IconCheck className="size-3" />
              Fixed
            </span>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={fixStatus === "pending"}
              className={cn(
                "h-5 shrink-0 gap-1 px-1.5 text-[10px]",
                fixStatus === "error"
                  ? "text-destructive hover:text-destructive"
                  : "text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100",
              )}
              title={
                fixStatus === "error"
                  ? "Fix could not be applied — retry"
                  : "Apply this fix inline"
              }
              onClick={handleFix}
            >
              {fixStatus === "pending" ? (
                <IconRefresh className="size-3 animate-spin" />
              ) : (
                <IconTool className="size-3" />
              )}
              {fixStatus === "error" ? "Retry" : "Fix"}
            </Button>
          ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A11y findings section
// ---------------------------------------------------------------------------

function A11ySection({
  findings,
  loading,
  auditedAt,
  auditError,
  onFindingClick,
  fixSource,
  onFixApplied,
}: {
  findings: A11yFinding[];
  loading?: boolean;
  auditedAt?: string | null;
  auditError?: string | null;
  onFindingClick?: (finding: A11yFinding) => void;
  fixSource?: ReviewFixSource;
  onFixApplied?: (finding: A11yFinding, result?: ReviewFixResult) => void;
}) {
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  const infos = findings.filter((f) => f.severity === "info");

  const hasFindings = findings.length > 0;
  const notRun = !auditedAt && !loading && !auditError && !hasFindings;
  const statusLabel = loading
    ? "Scanning..."
    : auditError
      ? "Could not scan"
      : notRun
        ? "Not checked"
        : hasFindings
          ? `${findings.length} ${findings.length === 1 ? "issue" : "issues"}`
          : "No issues";

  return (
    <section aria-labelledby="review-a11y-heading">
      <div className="flex h-7 items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <IconShieldCheck className="size-3.5 text-muted-foreground" />
          <span
            id="review-a11y-heading"
            className="!text-[11px] font-semibold text-foreground"
          >
            Accessibility
          </span>
          <span
            className={cn(
              "rounded px-1 py-0.5 text-[10px] font-medium text-muted-foreground/65",
              !loading && !auditError && !notRun && !hasFindings
                ? "text-emerald-500"
                : "",
            )}
          >
            {statusLabel}
          </span>
          {hasFindings ? (
            <div className="flex items-center gap-1">
              {errors.length > 0 && (
                <Badge
                  variant="outline"
                  className="h-4 border-destructive/40 bg-destructive/10 px-1 text-[9px] text-destructive"
                >
                  {errors.length}
                </Badge>
              )}
              {warnings.length > 0 && (
                <Badge
                  variant="outline"
                  className="h-4 border-amber-500/40 bg-amber-500/10 px-1 text-[9px] text-amber-600 dark:text-amber-400"
                >
                  {warnings.length}
                </Badge>
              )}
              {infos.length > 0 && (
                <Badge
                  variant="outline"
                  className="h-4 border-blue-500/40 bg-blue-500/10 px-1 text-[9px] text-blue-600 dark:text-blue-400"
                >
                  {infos.length}
                </Badge>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="py-1">
        {auditError && (
          <div className="flex min-h-7 items-center gap-2 rounded-[5px] px-2 text-muted-foreground">
            <IconAlertCircle className="size-3.5 shrink-0 text-destructive" />
            <span className="!text-[11px]">{auditError}</span>
          </div>
        )}

        {notRun && (
          <div className="flex h-7 items-center rounded-[5px] px-2 text-muted-foreground/55">
            <span className="truncate !text-[11px]">
              Run a quick accessibility check.
            </span>
          </div>
        )}

        {loading && !hasFindings && (
          <div className="flex h-7 items-center gap-2 rounded-[5px] px-2">
            <IconRefresh className="size-3.5 animate-spin text-muted-foreground/50" />
            <span className="!text-[11px] text-muted-foreground/60">
              Scanning…
            </span>
          </div>
        )}

        {!loading && !auditError && !notRun && !hasFindings && (
          <div className="flex h-7 items-center gap-2 rounded-[5px] px-2">
            <IconCheck className="size-3.5 text-emerald-500" />
            <span className="!text-[11px] text-muted-foreground">
              No issues found.
            </span>
          </div>
        )}

        {hasFindings && (
          <div className="flex flex-col gap-0.5">
            {[...errors, ...warnings, ...infos].map((finding) => (
              <FindingRow
                key={finding.id}
                finding={finding}
                onClick={onFindingClick}
                fixSource={fixSource}
                onFixApplied={onFixApplied}
              />
            ))}
          </div>
        )}

        {auditedAt && (
          <p className="mt-1 px-2 text-[10px] text-muted-foreground/40">
            Last audited{" "}
            {new Date(auditedAt).toLocaleString(undefined, {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </p>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Visual diff section
// ---------------------------------------------------------------------------

function VersionLabel({
  options,
  value,
  placeholder,
  onChange,
}: {
  options: ReviewVersionOption[];
  value: string | null | undefined;
  placeholder: string;
  onChange: (id: string | null) => void;
}) {
  // Native <select> keeps bundle small; matches design-editor's compact inputs.
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="h-6 max-w-[120px] flex-1 truncate rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]"
      aria-label={placeholder}
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function DiffRow({ entry }: { entry: VisualDiffEntry }) {
  const cfg = DIFF_KIND_CONFIG[entry.kind];
  return (
    <div className="flex h-7 items-center gap-2 rounded-[5px] px-2 hover:bg-[var(--design-editor-layer-hover-color)]">
      <Badge
        variant="outline"
        className={cn("h-4 shrink-0 px-1 text-[9px] font-medium", cfg.badge)}
      >
        {cfg.label}
      </Badge>
      <span className="truncate !text-[11px] text-foreground leading-snug">
        {entry.description ?? entry.id}
      </span>
    </div>
  );
}

function VisualDiffSection({
  diff,
  versionOptions,
  baseVersionId,
  compareVersionId,
  onVersionChange,
  loading,
  diffError,
}: {
  diff: VisualDiffEntry[];
  versionOptions: ReviewVersionOption[];
  baseVersionId?: string | null;
  compareVersionId?: string | null;
  onVersionChange?: (kind: "base" | "compare", id: string | null) => void;
  loading?: boolean;
  diffError?: string | null;
}) {
  const hasDiff = diff.length > 0;
  const hasVersions = versionOptions.length > 0;
  const noVersionsSelected = !baseVersionId && !compareVersionId;
  const shouldRender =
    hasVersions || hasDiff || loading || !!diffError || !noVersionsSelected;

  if (!shouldRender) return null;

  return (
    <section aria-labelledby="review-diff-heading">
      <div className="flex h-7 items-center gap-1.5">
        <IconArrowsLeftRight className="size-3.5 text-muted-foreground" />
        <span
          id="review-diff-heading"
          className="!text-[11px] font-semibold text-foreground"
        >
          Visual diff
        </span>
        {hasDiff && (
          <Badge
            variant="outline"
            className="h-4 border-border px-1 text-[9px] text-muted-foreground"
          >
            {diff.length}
          </Badge>
        )}
      </div>

      <div className="space-y-1.5 py-1">
        {hasVersions && (
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-[10px] text-muted-foreground/70">
              Base
            </span>
            <VersionLabel
              options={versionOptions}
              value={baseVersionId}
              placeholder="Select…"
              onChange={(id) => onVersionChange?.("base", id)}
            />
            <IconArrowsLeftRight className="size-3 shrink-0 text-muted-foreground/40" />
            <VersionLabel
              options={versionOptions}
              value={compareVersionId}
              placeholder="Select…"
              onChange={(id) => onVersionChange?.("compare", id)}
            />
          </div>
        )}

        {diffError && (
          <div className="flex h-7 items-center gap-2 rounded-[5px] px-2">
            <IconAlertCircle className="size-3.5 shrink-0 text-destructive" />
            <span className="!text-[11px] text-muted-foreground">
              {diffError}
            </span>
          </div>
        )}

        {loading && (
          <div className="flex h-7 items-center gap-2 rounded-[5px] px-2">
            <IconRefresh className="size-3.5 animate-spin text-muted-foreground/50" />
            <span className="!text-[11px] text-muted-foreground/60">
              Comparing…
            </span>
          </div>
        )}

        {!loading && !diffError && noVersionsSelected && !hasDiff && (
          <div className="flex h-7 items-center rounded-[5px] px-2 !text-[11px] text-muted-foreground/55">
            {hasVersions ? "Choose versions to diff" : "No versions yet"}
          </div>
        )}

        {!loading && !diffError && !noVersionsSelected && !hasDiff && (
          <div className="flex h-7 items-center gap-2 rounded-[5px] px-2">
            <IconCheck className="size-3.5 text-emerald-500" />
            <span className="!text-[11px] text-muted-foreground">
              No structural changes detected.
            </span>
          </div>
        )}

        {hasDiff && (
          <div className="flex flex-col gap-0.5">
            {diff.map((entry) => (
              <DiffRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Top-level ReviewPanel
// ---------------------------------------------------------------------------

/**
 * ReviewPanel renders the accessibility audit results and visual-diff section
 * for the Design Studio's Review inspector tab / bottom dock.
 *
 * When a `fixSource` is supplied, auto-fixable findings (contrast/color,
 * tap-target, focus-visibility) show an inline "Fix" button wired to the
 * `apply-a11y-fix` action; the canvas re-renders from the written content.
 * Findings that need a new attribute or a semantic rewrite remain
 * informational.  Without a `fixSource` the panel is read-only.
 */
export function ReviewPanel({
  findings,
  auditLoading,
  auditedAt,
  auditError,
  visualDiff = [],
  versionOptions = [],
  baseVersionId,
  compareVersionId,
  onVersionChange,
  diffLoading,
  diffError,
  onFindingClick,
  fixSource,
  onFixApplied,
  className,
}: ReviewPanelProps) {
  const showDiffSection =
    versionOptions.length > 0 ||
    visualDiff.length > 0 ||
    diffLoading ||
    !!diffError ||
    !!baseVersionId ||
    !!compareVersionId;

  return (
    <div
      className={cn("flex flex-col gap-1 !text-[11px]", className)}
      data-testid="review-panel"
    >
      <A11ySection
        findings={findings}
        loading={auditLoading}
        auditedAt={auditedAt}
        auditError={auditError}
        onFindingClick={onFindingClick}
        fixSource={fixSource}
        onFixApplied={onFixApplied}
      />

      {showDiffSection ? (
        <>
          <Separator />
          <VisualDiffSection
            diff={visualDiff}
            versionOptions={versionOptions}
            baseVersionId={baseVersionId}
            compareVersionId={compareVersionId}
            onVersionChange={onVersionChange}
            loading={diffLoading}
            diffError={diffError}
          />
        </>
      ) : null}
    </div>
  );
}
