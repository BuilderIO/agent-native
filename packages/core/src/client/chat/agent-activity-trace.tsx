import {
  IconBrain,
  IconCheck,
  IconChevronRight,
  IconCode,
  IconFileDiff,
  IconFileText,
  IconPencil,
  IconSearch,
  IconTerminal2,
  IconTool,
} from "@tabler/icons-react";
import React, { useState } from "react";

import { cn } from "../utils.js";
import {
  AgentActivityObject,
  type AgentActivityObjectReference,
} from "./agent-activity-object.js";

export type AgentActivityVariant =
  | "steps"
  | "reasoning"
  | "search"
  | "coding"
  | "changes"
  | "command"
  | "read";
export type AgentActivityDisplayMode = "status" | "timeline" | "auto";

export type AgentActivityStatus = "running" | "complete" | "error";

export interface AgentActivityItem {
  id: string;
  label: string;
  detail?: string;
  object?: AgentActivityObjectReference;
  summary?: React.ReactNode;
  variant?: AgentActivityVariant;
  status?: AgentActivityStatus;
}

export interface AgentActivityTraceProps {
  items: AgentActivityItem[];
  summary?: string;
  activeSummary?: string;
  variant?: AgentActivityVariant;
  running?: boolean;
  displayMode?: AgentActivityDisplayMode;
  defaultOpen?: boolean;
  children?: React.ReactNode;
}

export function summarizeAgentActivityItems(
  items: readonly AgentActivityItem[],
): string {
  const labels = Array.from(
    new Set(items.map((item) => item.label.trim()).filter(Boolean)),
  );
  if (labels.length === 0) return "Working";
  const visibleLabels = labels.slice(0, 2);
  visibleLabels[0] =
    visibleLabels[0]!.charAt(0).toUpperCase() + visibleLabels[0]!.slice(1);
  const visible = visibleLabels.join(", ");
  const remaining = labels.length - 2;
  return remaining > 0 ? `${visible} +${remaining}` : visible;
}

function ActivityIcon({ item }: { item: AgentActivityItem }) {
  const iconClass = "agent-kit-activity-icon shrink-0";
  if (item.status === "error") return <IconTool className={iconClass} />;
  switch (item.variant) {
    case "reasoning":
      return <IconBrain className={iconClass} />;
    case "search":
      return <IconSearch className={iconClass} />;
    case "coding":
      return <IconCode className={iconClass} />;
    case "changes":
      return <IconFileDiff className={iconClass} />;
    case "command":
      return <IconTerminal2 className={iconClass} />;
    case "read":
      return <IconFileText className={iconClass} />;
    case "steps":
      return <IconCheck className={iconClass} />;
    default:
      return <IconPencil className={iconClass} />;
  }
}

export interface AgentActivityChipProps {
  item: AgentActivityItem;
  index?: number;
  selected?: boolean;
  onSelect?: (item: AgentActivityItem) => void;
}

export function AgentActivityChip({
  item,
  index = 0,
  selected = false,
  onSelect,
}: AgentActivityChipProps) {
  return (
    <button
      type="button"
      aria-label={`Show ${item.label} details`}
      aria-pressed={selected}
      onClick={() => onSelect?.(item)}
      className={cn(
        "agent-activity-trace__icon flex size-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground",
        index > 0 && "-ms-0.5",
        item.status === "running" && "text-primary",
        "transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-primary text-primary",
      )}
    >
      <ActivityIcon item={item} />
    </button>
  );
}

export function AgentActivityTrace({
  items,
  summary,
  activeSummary,
  variant = "steps",
  running = false,
  defaultOpen = false,
  children,
}: AgentActivityTraceProps) {
  const [open, setOpen] = useState(defaultOpen);
  const visibleSummary =
    running && activeSummary
      ? activeSummary
      : (summary ?? summarizeAgentActivityItems(items));

  return (
    <div
      className="agent-activity-trace my-1 w-full"
      data-agent-activity-variant={variant}
      data-agent-activity-running={running ? "true" : undefined}
    >
      <button
        type="button"
        aria-label={visibleSummary}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="agent-kit-activity-row flex min-w-0 items-center gap-2 rounded-md py-1 text-left text-muted-foreground transition-colors hover:text-foreground focus-visible:bg-muted/50 focus-visible:text-foreground focus-visible:outline-none"
      >
        <IconTool className="agent-kit-activity-icon shrink-0" />
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "min-w-0 truncate font-medium",
              running && "agent-running-shimmer",
            )}
            role="status"
            aria-live="polite"
          >
            {visibleSummary}
          </span>
          <IconChevronRight
            className={cn(
              "agent-kit-activity-icon shrink-0 transition-transform",
              open && "rotate-90",
            )}
          />
        </span>
      </button>
      {open ? (
        <div className="agent-activity-trace__details pt-1">
          {children ? (
            <div>{children}</div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {items.map((item) => (
                <AgentActivityDisclosureItem key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function AgentActivityDisclosureItem({ item }: { item: AgentActivityItem }) {
  const [open, setOpen] = useState(false);
  const canExpand = item.summary != null;
  const labelContent = (
    <>
      <ActivityIcon item={item} />
      <span
        className={cn(
          "min-w-0 truncate",
          item.status === "running" && "agent-running-shimmer",
        )}
      >
        {item.label}
      </span>
    </>
  );

  return (
    <div className="min-w-0">
      <div className="agent-kit-activity-row flex w-full min-w-0 items-center gap-2 text-muted-foreground">
        {canExpand ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left transition-colors hover:text-foreground focus-visible:bg-muted/50 focus-visible:text-foreground focus-visible:outline-none"
          >
            {labelContent}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
            {labelContent}
          </div>
        )}
        {item.object ? (
          <AgentActivityObject
            object={item.object}
            className="agent-kit-activity-object-boundary shrink"
          />
        ) : item.detail ? (
          <span className="agent-kit-activity-object-boundary ms-auto shrink truncate text-right text-muted-foreground/65">
            {item.detail}
          </span>
        ) : null}
        {canExpand ? (
          <IconChevronRight
            className={cn(
              "agent-kit-activity-icon shrink-0 transition-transform",
              open && "rotate-90",
            )}
          />
        ) : null}
      </div>
      {canExpand && open ? (
        <div
          data-agent-activity-item-details=""
          className="agent-kit-density py-1 text-foreground"
        >
          {item.summary}
        </div>
      ) : null}
    </div>
  );
}
