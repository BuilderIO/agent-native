import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
} from "@tabler/icons-react";
import { useId, useState, type ReactNode } from "react";

import { Button } from "../ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.js";
import { Spinner } from "../ui/spinner.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip.js";
import { cn } from "../utils.js";
import { fallbackContextTranslate, type ContextTranslate } from "./types.js";

/** At or above this share of the window the ring turns amber. */
export const CONTEXT_USAGE_WARNING_FRACTION = 0.8;

/** The bar's empty track, which is also the free-space swatch. */
const CONTEXT_USAGE_TRACK_CLASS = "bg-muted";

export interface ContextUsageSegmentView {
  kind: string;
  label: string;
  tokens: number;
  /** A class from `contextGroupColor`, shared with the X-Ray treemap. */
  colorClass: string;
}

export type ContextCompactState =
  | { state: "idle" }
  | { state: "running" }
  | { state: "done"; message: string }
  | { state: "error"; message: string };

/** 779.8k, 1M, 1.05M: the window's own unit, never "1000k". */
export function formatContextWindowTokens(tokens: number): string {
  const value = Math.max(0, Math.round(tokens));
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`;
  if (value >= 1000) return `${Number((value / 1000).toFixed(1))}k`;
  return String(value);
}

export function contextUsagePercent(
  usedTokens: number,
  windowTokens: number,
): number {
  return Math.round((usedTokens / windowTokens) * 100);
}

function formatWindowShare(tokens: number, windowTokens: number): string {
  return `${((Math.max(0, tokens) / windowTokens) * 100).toFixed(1)}%`;
}

const CONTEXT_RING_RADIUS = 7;
const CONTEXT_RING_CIRCUMFERENCE = 2 * Math.PI * CONTEXT_RING_RADIUS;

/** Dash offset that fills `fraction` of the ring, clamped to [0, 1]. */
export function contextRingDashOffset(fraction: number): number {
  const share = Math.min(1, Math.max(0, fraction));
  return CONTEXT_RING_CIRCUMFERENCE * (1 - share);
}

// A thick track with a colored fill from 12 o'clock at the true share. Never
// pad a small share up to a visible minimum or round the caps: a short dark
// dash on a light track is what a loading spinner looks like.
function ContextRing({
  fraction,
  warning,
}: {
  fraction: number;
  warning: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="size-5 -rotate-90"
      data-context-ring=""
    >
      <circle
        cx="10"
        cy="10"
        r={CONTEXT_RING_RADIUS}
        fill="none"
        strokeWidth="3"
        className="stroke-muted-foreground/25"
        data-context-ring-track=""
      />
      <circle
        cx="10"
        cy="10"
        r={CONTEXT_RING_RADIUS}
        fill="none"
        strokeWidth="3"
        strokeLinecap="butt"
        strokeDasharray={CONTEXT_RING_CIRCUMFERENCE}
        strokeDashoffset={contextRingDashOffset(fraction)}
        className={cn(
          "transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none",
          warning
            ? "stroke-[hsl(var(--agent-kit-warning))]"
            : "stroke-blue-500 dark:stroke-blue-400",
        )}
        data-context-ring-fill=""
      />
    </svg>
  );
}

export function ContextUsageRingView({
  usedTokens,
  windowTokens,
  open,
  onOpenChange,
  children,
  translate = fallbackContextTranslate,
}: {
  usedTokens: number;
  windowTokens: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  translate?: ContextTranslate;
}) {
  const fraction = usedTokens / windowTokens;
  const warning = fraction >= CONTEXT_USAGE_WARNING_FRACTION;
  const label = translate("agentChat.contextRing.usedLabel", {
    defaultValue: "Context {{percent}}% used",
    percent: contextUsagePercent(usedTokens, windowTokens),
  });
  return (
    <TooltipProvider delayDuration={200}>
      <Popover open={open} onOpenChange={onOpenChange}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={label}
                data-agent-composer-slot="context-ring"
                data-warning={warning ? "true" : undefined}
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-[var(--agentkit-composer-control-radius,var(--radius-md))] text-muted-foreground hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  open && "bg-accent/60",
                )}
              >
                <ContextRing fraction={fraction} warning={warning} />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
        <PopoverContent
          side="top"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          data-agent-native-composer-popover="true"
          className="w-[min(calc(100vw-2rem),22rem)] p-3"
        >
          {children}
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}

export function ContextUsagePanelView({
  usedTokens,
  windowTokens,
  segments,
  tokensUntilAutoCompact,
  compact,
  onCompact,
  translate = fallbackContextTranslate,
}: {
  usedTokens: number;
  windowTokens: number;
  segments: readonly ContextUsageSegmentView[];
  /** Omitted when no automatic threshold applies or it could not be read. */
  tokensUntilAutoCompact?: number | undefined;
  compact: ContextCompactState;
  onCompact?: (() => void) | undefined;
  translate?: ContextTranslate;
}) {
  const [expanded, setExpanded] = useState(false);
  const breakdownId = useId();
  const percent = contextUsagePercent(usedTokens, windowTokens);
  const warning = usedTokens / windowTokens >= CONTEXT_USAGE_WARNING_FRACTION;
  const barTotal = Math.max(usedTokens, windowTokens);
  const rows = [
    ...segments,
    {
      kind: "free-space",
      label: translate("agentChat.contextRing.freeSpace", {
        defaultValue: "Free space",
      }),
      tokens: Math.max(0, windowTokens - usedTokens),
      colorClass: CONTEXT_USAGE_TRACK_CLASS,
    },
  ];
  return (
    <div className="flex flex-col gap-3" data-context-usage-panel="">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {translate("agentChat.contextRing.title", {
            defaultValue: "Context window",
          })}
        </span>
        <span className="shrink-0 text-sm tabular-nums text-foreground">
          {translate("agentChat.contextRing.usage", {
            defaultValue: "{{used}} / {{window}} ({{percent}}%)",
            used: formatContextWindowTokens(usedTokens),
            window: formatContextWindowTokens(windowTokens),
            percent,
          })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="-me-1 shrink-0"
          aria-label={translate("agentChat.contextRing.breakdown", {
            defaultValue: "Breakdown",
          })}
          aria-expanded={expanded}
          aria-controls={breakdownId}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? (
            <IconChevronDown aria-hidden="true" className="size-4" />
          ) : (
            <IconChevronRight aria-hidden="true" className="size-4" />
          )}
        </Button>
      </div>
      <div
        role="img"
        aria-label={segments
          .map(
            (segment) =>
              `${segment.label} ${formatContextWindowTokens(segment.tokens)}`,
          )
          .join(", ")}
        className={cn(
          "flex h-2 w-full overflow-hidden rounded-full",
          CONTEXT_USAGE_TRACK_CLASS,
        )}
        data-context-usage-bar=""
      >
        {segments.map((segment) => (
          <span
            key={segment.kind}
            data-context-usage-segment={segment.kind}
            className={cn("h-full", segment.colorClass)}
            style={{ width: `${(segment.tokens / barTotal) * 100}%` }}
          />
        ))}
      </div>
      <div
        id={breakdownId}
        hidden={!expanded}
        className="-my-1 max-h-48 overflow-y-auto"
        data-context-usage-breakdown=""
      >
        <table className="w-full table-fixed text-sm">
          <tbody>
            {rows.map((row) => (
              <tr key={row.kind} data-context-usage-row={row.kind}>
                <td className="w-4 py-0.5 align-middle">
                  <span
                    aria-hidden="true"
                    data-context-usage-swatch=""
                    className={cn("block size-2 rounded-[2px]", row.colorClass)}
                  />
                </td>
                <td className="truncate py-0.5 text-foreground">{row.label}</td>
                <td className="w-20 py-0.5 ps-3 text-end tabular-nums text-muted-foreground">
                  {formatContextWindowTokens(row.tokens)}
                </td>
                <td className="w-16 py-0.5 ps-3 text-end tabular-nums text-foreground">
                  {formatWindowShare(row.tokens, windowTokens)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tokensUntilAutoCompact !== undefined ? (
        <p
          className={cn(
            "agent-kit-caption-copy",
            warning ? "agent-kit-tone-warning" : "text-muted-foreground",
          )}
        >
          {translate("agentChat.contextRing.untilAutoCompact", {
            defaultValue: "{{tokens}} until auto-compact",
            tokens: formatContextWindowTokens(tokensUntilAutoCompact),
          })}
        </p>
      ) : null}
      {compact.state === "done" ? (
        <p
          role="status"
          className="agent-kit-caption-copy text-muted-foreground"
        >
          {compact.message}
        </p>
      ) : null}
      {compact.state === "error" ? (
        <p
          role="alert"
          className="flex items-start gap-1.5 agent-kit-caption-copy agent-kit-tone-warning"
        >
          <IconAlertTriangle
            aria-hidden="true"
            className="mt-px size-4 shrink-0"
          />
          <span className="min-w-0">{compact.message}</span>
        </p>
      ) : null}
      {onCompact ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={compact.state === "running"}
            aria-busy={compact.state === "running" || undefined}
            onClick={onCompact}
          >
            {compact.state === "running" ? (
              <Spinner className="size-3" />
            ) : null}
            {translate("agentChat.contextRing.compactNow", {
              defaultValue: "Compact now",
            })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
