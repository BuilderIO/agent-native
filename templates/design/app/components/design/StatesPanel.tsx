// i18n-raw-literal-disable-file — new Design Studio panel; UI strings are localized when this feature is finalized in the follow-up PR.
/**
 * States & Responsive panel (§6.4).
 *
 * Two-part panel rendered in the right inspector:
 *  1. Breakpoint segmented control — Auto / Mobile / Tablet / Desktop
 *     Sets the active canvas frame and the responsive-class edit scope.
 *  2. State rows — Default, plus any named states/fixtures/captures.
 *     Selecting a row applies the state to the canvas preview.
 *
 * Data is loaded via useActionQuery / useActionMutation so the agent and UI
 * share the same surface (§architecture contract).
 */

import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconCamera,
  IconChevronRight,
  IconDeviceDesktop,
  IconDeviceMobile,
  IconDeviceTablet,
  IconDots,
  IconPlus,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type {
  DesignStateBreakpoint,
  DesignStateKind,
} from "../../../shared/design-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DesignStateRow {
  id: string;
  designId: string;
  name: string;
  kind: DesignStateKind;
  breakpoint: DesignStateBreakpoint;
  sourceRef?: string | null;
  route?: string | null;
  fixtureData?: Record<string, unknown> | null;
  captureData?: Record<string, unknown> | null;
  previewRef?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface StatesPanelProps {
  designId: string;
  /** Currently active state id. `null` means the Default (live) state. */
  activeStateId: string | null;
  /** Currently active breakpoint id, or `"auto"` for single-frame view. */
  activeBreakpointId: string;
  /**
   * Ordered list of breakpoint frames the canvas is currently showing.
   * Each entry must have at least an id, label, and widthPx.
   */
  breakpoints: Array<{ id: string; label: string; widthPx: number }>;
  /** Whether the design's source supports live captures. */
  canCapture?: boolean;
  onStateSelect: (stateId: string | null, row?: DesignStateRow) => void;
  onBreakpointSelect: (breakpointId: string) => void;
  onAddBreakpoint?: () => void;
  onCapture?: () => void;
}

// ---------------------------------------------------------------------------
// Breakpoint icon map
// ---------------------------------------------------------------------------

function BreakpointIcon({
  widthPx,
  className,
}: {
  widthPx: number;
  className?: string;
}) {
  if (widthPx >= 1024) {
    return <IconDeviceDesktop className={cn("size-3.5", className)} />;
  }
  if (widthPx >= 600) {
    return <IconDeviceTablet className={cn("size-3.5", className)} />;
  }
  return <IconDeviceMobile className={cn("size-3.5", className)} />;
}

// ---------------------------------------------------------------------------
// State kind badge
// ---------------------------------------------------------------------------

const KIND_LABELS: Record<DesignStateKind, string> = {
  state: "State",
  fixture: "Fixture",
  capture: "Capture",
};

const KIND_COLORS: Record<DesignStateKind, string> = {
  state: "bg-primary/10 text-primary",
  fixture: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  capture: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
};

function KindBadge({ kind }: { kind: DesignStateKind }) {
  return (
    <span
      className={cn(
        "rounded px-1 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-wide",
        KIND_COLORS[kind],
      )}
    >
      {KIND_LABELS[kind]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Single state row
// ---------------------------------------------------------------------------

function StateRow({
  row,
  isActive,
  onSelect,
  onDelete,
}: {
  row: DesignStateRow;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect();
      }}
      className={cn(
        "group flex h-7 cursor-pointer items-center gap-2 rounded-[5px] px-2 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
        isActive
          ? "bg-[var(--design-editor-active-row-color)] text-foreground"
          : "text-muted-foreground hover:bg-[var(--design-editor-layer-hover-color)] hover:text-foreground",
      )}
    >
      {/* Active indicator */}
      <div
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          isActive ? "bg-primary" : "bg-muted-foreground/30",
        )}
      />

      {/* Name */}
      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
        {row.name}
      </span>

      {/* Kind badge */}
      <KindBadge kind={row.kind} />

      {/* Overflow menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-5 shrink-0 cursor-pointer text-muted-foreground/50 opacity-0 hover:text-foreground group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
            aria-label={`Options for ${row.name}`}
          >
            <IconDots className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={onSelect}>
            <IconChevronRight className="mr-2 size-3.5" />
            Apply state
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-destructive focus:text-destructive"
          >
            <IconTrash className="mr-2 size-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function StatesPanel({
  designId,
  activeStateId,
  activeBreakpointId,
  breakpoints,
  canCapture = false,
  onStateSelect,
  onBreakpointSelect,
  onAddBreakpoint,
  onCapture,
}: StatesPanelProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newStateName, setNewStateName] = useState("");

  // --- Data ---
  const { data, isLoading, refetch } = useActionQuery<{
    count: number;
    states: DesignStateRow[];
  }>("list-design-states", { designId });

  const createState = useActionMutation("create-design-state");
  const deleteState = useActionMutation("delete-design-state");

  const states = data?.states ?? [];

  // --- Breakpoint control ---
  const handleBreakpointClick = (id: string) => {
    onBreakpointSelect(id);
  };

  // --- Create state ---
  const handleCreateState = async () => {
    const name = newStateName.trim();
    if (!name) return;
    setIsAdding(false);
    setNewStateName("");
    await createState.mutateAsync({ designId, name, kind: "state" });
    await refetch();
  };

  // --- Delete state ---
  const handleDeleteState = async (id: string) => {
    await deleteState.mutateAsync({ id, designId });
    if (activeStateId === id) onStateSelect(null);
    await refetch();
  };

  return (
    <div className="flex flex-col gap-2">
      {/* ── Responsive breakpoints ── */}
      <section aria-label="Breakpoints">
        <div className="mb-1 flex items-center justify-between">
          <span className="!text-[11px] font-medium text-muted-foreground">
            Responsive
          </span>
          {onAddBreakpoint && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 cursor-pointer rounded-md text-muted-foreground hover:text-foreground"
                  onClick={onAddBreakpoint}
                  aria-label="Add breakpoint"
                >
                  <IconPlus className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add breakpoint</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Segmented control */}
        <div className="flex h-7 min-w-0 overflow-hidden rounded-md bg-[var(--design-editor-control-bg)] p-0.5">
          {/* Auto = single-frame, all breakpoints */}
          <BreakpointButton
            id="auto"
            label="Auto"
            isActive={activeBreakpointId === "auto"}
            onClick={() => handleBreakpointClick("auto")}
          />

          {breakpoints.map((bp) => (
            <BreakpointButton
              key={bp.id}
              id={bp.id}
              label={bp.label}
              widthPx={bp.widthPx}
              isActive={activeBreakpointId === bp.id}
              onClick={() => handleBreakpointClick(bp.id)}
            />
          ))}

          {/* Default device shortcuts when no custom breakpoints are configured */}
          {breakpoints.length === 0 && (
            <>
              <BreakpointButton
                id="bp-mobile"
                label="Mobile"
                widthPx={390}
                isActive={activeBreakpointId === "bp-mobile"}
                onClick={() => handleBreakpointClick("bp-mobile")}
              />
              <BreakpointButton
                id="bp-tablet"
                label="Tablet"
                widthPx={768}
                isActive={activeBreakpointId === "bp-tablet"}
                onClick={() => handleBreakpointClick("bp-tablet")}
              />
              <BreakpointButton
                id="bp-desktop"
                label="Desktop"
                widthPx={1280}
                isActive={activeBreakpointId === "bp-desktop"}
                onClick={() => handleBreakpointClick("bp-desktop")}
              />
            </>
          )}
        </div>
      </section>

      {/* ── Design states ── */}
      <section aria-label="Design states">
        <div className="mb-1 flex items-center justify-between">
          <span className="!text-[11px] font-medium text-muted-foreground">
            States
          </span>
          <div className="flex items-center gap-0.5">
            {canCapture && onCapture && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 cursor-pointer rounded-md text-muted-foreground hover:text-foreground"
                    onClick={onCapture}
                    aria-label="Capture from running app"
                  >
                    <IconCamera className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Capture from running app</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 cursor-pointer rounded-md text-muted-foreground hover:text-foreground"
                  onClick={() => refetch()}
                  aria-label="Refresh states"
                  disabled={isLoading}
                >
                  <IconRefresh
                    className={cn("size-3.5", isLoading && "animate-spin")}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 cursor-pointer rounded-md text-muted-foreground hover:text-foreground"
                  onClick={() => setIsAdding(true)}
                  aria-label="Add state"
                >
                  <IconPlus className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add state</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Default row (always present) */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => onStateSelect(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onStateSelect(null);
          }}
          className={cn(
            "flex h-7 cursor-pointer items-center gap-2 rounded-[5px] px-2 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
            activeStateId === null
              ? "bg-[var(--design-editor-active-row-color)] text-foreground"
              : "text-muted-foreground hover:bg-[var(--design-editor-layer-hover-color)] hover:text-foreground",
          )}
        >
          <div
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              activeStateId === null ? "bg-primary" : "bg-muted-foreground/30",
            )}
          />
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
            Default
          </span>
          <span className="ml-auto text-[10px] text-muted-foreground/40">
            Live
          </span>
        </div>

        {/* Named states */}
        {states.length > 0 && (
          <div className="mt-0.5 flex flex-col gap-0.5">
            {states.map((row) => (
              <StateRow
                key={row.id}
                row={row}
                isActive={activeStateId === row.id}
                onSelect={() => onStateSelect(row.id, row)}
                onDelete={() => handleDeleteState(row.id)}
              />
            ))}
          </div>
        )}

        {/* Loading placeholder */}
        {isLoading && states.length === 0 && (
          <div className="mt-2 space-y-1">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-7 animate-pulse rounded-md bg-accent/60"
              />
            ))}
          </div>
        )}

        {/* Empty state (no user-created states yet) */}
        {!isLoading && states.length === 0 && !isAdding && (
          <div className="mt-1 flex h-7 items-center rounded-[5px] px-2 !text-[11px] text-muted-foreground/55">
            No saved states
          </div>
        )}

        {/* Inline add-state form */}
        {isAdding && (
          <form
            className="mt-1 flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreateState();
            }}
          >
            <input
              autoFocus
              value={newStateName}
              onChange={(e) => setNewStateName(e.target.value)}
              placeholder="State name…"
              className="h-6 min-w-0 flex-1 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setIsAdding(false);
                  setNewStateName("");
                }
              }}
            />
            <Button
              type="submit"
              size="sm"
              className="h-6 cursor-pointer px-2 !text-[11px]"
              disabled={!newStateName.trim() || createState.isPending}
            >
              Add
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 cursor-pointer px-2 !text-[11px]"
              onClick={() => {
                setIsAdding(false);
                setNewStateName("");
              }}
            >
              Cancel
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Breakpoint button helper
// ---------------------------------------------------------------------------

function BreakpointButton({
  id,
  label,
  widthPx,
  isActive,
  onClick,
}: {
  id: string;
  label: string;
  widthPx?: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={cn(
        "flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1 rounded-[4px] px-1 text-[10px] font-semibold transition-colors",
        isActive
          ? "bg-[var(--design-editor-panel-bg)] text-foreground shadow-[0_0_0_1px_var(--design-editor-control-border),0_1px_2px_rgba(0,0,0,0.18)]"
          : "text-muted-foreground hover:bg-[var(--design-editor-panel-raised-bg)] hover:text-foreground",
      )}
      title={widthPx ? `${label} (${widthPx}px)` : label}
    >
      {widthPx != null && (
        <BreakpointIcon widthPx={widthPx} className="shrink-0" />
      )}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
