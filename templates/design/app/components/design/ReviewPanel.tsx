// i18n-raw-literal-disable-file — new Design Studio panel; UI strings are localized when this feature is finalized in the follow-up PR.
/**
 * ReviewPanel — Design Studio accessibility + visual-diff review panel.
 *
 * Displays severity-dot a11y findings from `run-design-audit` /
 * `get-design-review`, and a structural visual-diff section comparing two
 * `design_versions`.
 *
 * Read-only.  The "Fix" button is rendered but kept disabled (gated) — it
 * will be wired to `apply-a11y-fix` when the capability is real-app-only and
 * the source advertises `fixA11y` capability.
 *
 * Layout matches the Review artboard in the canonical plan visual:
 *   <https://plan.agent-native.com/plans/plan-88dc4a09fb0c46bc>
 *
 * shadcn/ui primitives + Tabler icons throughout.  No emojis.
 */

import {
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowsLeftRight,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconInfoCircle,
  IconRefresh,
  IconShieldCheck,
} from "@tabler/icons-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import type {
  A11yFinding,
  A11ySeverity,
  VisualDiffChangeKind,
  VisualDiffEntry,
} from "../../../shared/design-review.js";

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
  className?: string;
}

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

interface SeverityConfig {
  dot: string;
  icon: React.ElementType;
  label: string;
}

const SEVERITY_CONFIG: Record<A11ySeverity, SeverityConfig> = {
  error: {
    dot: "bg-destructive",
    icon: IconAlertCircle,
    label: "Error",
  },
  warning: {
    dot: "bg-amber-400",
    icon: IconAlertTriangle,
    label: "Warning",
  },
  info: {
    dot: "bg-blue-400",
    icon: IconInfoCircle,
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
}: {
  finding: A11yFinding;
  onClick?: (finding: A11yFinding) => void;
}) {
  const cfg = SEVERITY_CONFIG[finding.severity];
  const Icon = cfg.icon;
  const [expanded, setExpanded] = useState(false);
  const hasDetail = !!(finding.detail ?? finding.wcag);

  return (
    <div
      className={cn(
        "group rounded px-2 py-1.5 transition-colors",
        onClick ? "cursor-pointer hover:bg-accent/60" : "cursor-default",
      )}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={() => onClick?.(finding)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick?.(finding);
      }}
      aria-label={finding.message}
    >
      <div className="flex items-start gap-2">
        {/* Severity dot */}
        <span
          className={cn("mt-[5px] size-1.5 shrink-0 rounded-full", cfg.dot)}
          aria-hidden="true"
        />

        {/* Message + expand toggle */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <Icon
              className={cn(
                "size-3.5 shrink-0",
                finding.severity === "error"
                  ? "text-destructive"
                  : finding.severity === "warning"
                    ? "text-amber-500"
                    : "text-blue-500",
              )}
              aria-hidden="true"
            />
            <span className="truncate text-[11px] text-foreground leading-snug">
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

          {/* WCAG badge */}
          {finding.wcag && (
            <span className="text-[10px] text-muted-foreground/60">
              WCAG {finding.wcag}
            </span>
          )}

          {/* Expanded detail */}
          {expanded && finding.detail && (
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              {finding.detail}
            </p>
          )}
        </div>

        {/* Fix button — disabled/gated until apply-a11y-fix is wired */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled
          className="h-5 shrink-0 px-1.5 text-[10px] opacity-40"
          title="Fix (real-app only)"
          onClick={(e) => e.stopPropagation()}
        >
          Fix
        </Button>
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
  onRunAudit,
  onFindingClick,
}: {
  findings: A11yFinding[];
  loading?: boolean;
  auditedAt?: string | null;
  auditError?: string | null;
  onRunAudit?: () => void;
  onFindingClick?: (finding: A11yFinding) => void;
}) {
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  const infos = findings.filter((f) => f.severity === "info");

  const hasFindings = findings.length > 0;
  const notRun = !auditedAt && !loading && !auditError && !hasFindings;

  return (
    <section aria-labelledby="review-a11y-heading">
      {/* Section header */}
      <div className="flex h-8 items-center justify-between px-3">
        <div className="flex items-center gap-1.5">
          <IconShieldCheck className="size-3.5 text-muted-foreground" />
          <span
            id="review-a11y-heading"
            className="text-[11px] font-semibold text-foreground"
          >
            Accessibility
          </span>
          {hasFindings && (
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
          )}
        </div>

        {/* Run audit button */}
        {onRunAudit && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={onRunAudit}
            className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
          >
            {loading ? (
              <IconRefresh className="size-3 animate-spin" />
            ) : (
              <IconRefresh className="size-3" />
            )}
            {loading ? "Running…" : "Run"}
          </Button>
        )}
      </div>

      <Separator className="mx-3" />

      <div className="px-1 py-1">
        {/* Error state */}
        {auditError && (
          <div className="flex items-center gap-2 rounded px-2 py-1.5">
            <IconAlertCircle className="size-3.5 shrink-0 text-destructive" />
            <span className="text-[11px] text-muted-foreground">
              {auditError}
            </span>
          </div>
        )}

        {/* Not yet run */}
        {notRun && (
          <div className="flex flex-col items-center gap-2 py-5 text-center">
            <IconShieldCheck className="size-5 text-muted-foreground/30" />
            <p className="text-[11px] leading-snug text-muted-foreground/60">
              No audit has been run yet.
              {onRunAudit && (
                <>
                  {" "}
                  Click <strong>Run</strong> to scan this design.
                </>
              )}
            </p>
          </div>
        )}

        {/* Loading */}
        {loading && !hasFindings && (
          <div className="flex items-center gap-2 px-2 py-3">
            <IconRefresh className="size-3.5 animate-spin text-muted-foreground/50" />
            <span className="text-[11px] text-muted-foreground/60">
              Scanning…
            </span>
          </div>
        )}

        {/* All clear */}
        {!loading && !auditError && !notRun && !hasFindings && (
          <div className="flex items-center gap-2 px-2 py-3">
            <IconCheck className="size-3.5 text-emerald-500" />
            <span className="text-[11px] text-muted-foreground">
              No issues found.
            </span>
          </div>
        )}

        {/* Findings list */}
        {hasFindings && (
          <div className="space-y-0.5">
            {[...errors, ...warnings, ...infos].map((finding) => (
              <FindingRow
                key={finding.id}
                finding={finding}
                onClick={onFindingClick}
              />
            ))}
          </div>
        )}

        {/* Audit timestamp */}
        {auditedAt && (
          <p className="mt-1.5 px-2 text-[10px] text-muted-foreground/40">
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
      className="h-6 max-w-[120px] flex-1 truncate rounded border border-border bg-transparent px-1.5 text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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
    <div className="flex items-center gap-2 rounded px-2 py-1 hover:bg-accent/40">
      <Badge
        variant="outline"
        className={cn("h-4 shrink-0 px-1 text-[9px] font-medium", cfg.badge)}
      >
        {cfg.label}
      </Badge>
      <span className="truncate text-[11px] text-foreground leading-snug">
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

  return (
    <section aria-labelledby="review-diff-heading">
      <div className="flex h-8 items-center gap-1.5 px-3">
        <IconArrowsLeftRight className="size-3.5 text-muted-foreground" />
        <span
          id="review-diff-heading"
          className="text-[11px] font-semibold text-foreground"
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

      <Separator className="mx-3" />

      <div className="px-3 py-2 space-y-2">
        {/* Version selectors */}
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

        {/* States */}
        {diffError && (
          <div className="flex items-center gap-2">
            <IconAlertCircle className="size-3.5 shrink-0 text-destructive" />
            <span className="text-[11px] text-muted-foreground">
              {diffError}
            </span>
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2">
            <IconRefresh className="size-3.5 animate-spin text-muted-foreground/50" />
            <span className="text-[11px] text-muted-foreground/60">
              Comparing…
            </span>
          </div>
        )}

        {!loading && !diffError && noVersionsSelected && !hasDiff && (
          <p className="text-[11px] text-muted-foreground/50">
            {hasVersions
              ? "Select two versions above to see what changed."
              : "No versions saved yet. Save a version to compare."}
          </p>
        )}

        {!loading && !diffError && !noVersionsSelected && !hasDiff && (
          <div className="flex items-center gap-2">
            <IconCheck className="size-3.5 text-emerald-500" />
            <span className="text-[11px] text-muted-foreground">
              No structural changes detected.
            </span>
          </div>
        )}

        {/* Diff rows */}
        {hasDiff && (
          <div className="space-y-0.5">
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
 * It is read-only: the "Fix" button is rendered but disabled (gated) until
 * `apply-a11y-fix` is wired to a real-app source that advertises the
 * `fixA11y` capability.
 */
export function ReviewPanel({
  findings,
  auditLoading,
  auditedAt,
  auditError,
  onRunAudit,
  visualDiff = [],
  versionOptions = [],
  baseVersionId,
  compareVersionId,
  onVersionChange,
  diffLoading,
  diffError,
  onFindingClick,
  className,
}: ReviewPanelProps) {
  return (
    <div
      className={cn("flex flex-col overflow-hidden text-[11px]", className)}
      data-testid="review-panel"
    >
      <ScrollArea className="flex-1">
        <div className="py-1">
          <A11ySection
            findings={findings}
            loading={auditLoading}
            auditedAt={auditedAt}
            auditError={auditError}
            onRunAudit={onRunAudit}
            onFindingClick={onFindingClick}
          />

          <div className="my-2 mx-3">
            <Separator />
          </div>

          <VisualDiffSection
            diff={visualDiff}
            versionOptions={versionOptions}
            baseVersionId={baseVersionId}
            compareVersionId={compareVersionId}
            onVersionChange={onVersionChange}
            loading={diffLoading}
            diffError={diffError}
          />
        </div>
      </ScrollArea>
    </div>
  );
}
