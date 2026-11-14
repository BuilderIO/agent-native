import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
} from "@tabler/icons-react";
import { useId, useState, type CSSProperties, type ReactNode } from "react";

import { COMPOSER_POPOVER_SURFACE_CLASS } from "../../../composer/popover-surface.js";
import {
  fallbackContextTranslate,
  type ContextTranslate,
} from "../../../context-ui/types.js";
import { Button } from "../../../ui/button.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../ui/popover.js";
import { Spinner } from "../../../ui/spinner.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../ui/tooltip.js";

export const CONTEXT_USAGE_WARNING_FRACTION = 0.8;

export interface ContextUsageSegmentView {
  kind: string;
  label: string;
  tokens: number;
  color?: string | undefined;
  colorClass?: string | undefined;
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

export function contextRingDashOffset(fraction: number): number {
  const share = Math.min(1, Math.max(0, fraction));
  return CONTEXT_RING_CIRCUMFERENCE * (1 - share);
}

function segmentStyle(
  segment: Pick<ContextUsageSegmentView, "color">,
  width?: string,
): CSSProperties | undefined {
  if (!segment.color && !width) return undefined;
  return {
    ...(segment.color ? { background: segment.color } : {}),
    ...(width ? { width } : {}),
  };
}

// Never pad a small share or round the caps: a short dash on a track reads as a spinner.
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
      className="agentkit-context-ring"
      data-context-ring=""
    >
      <circle
        cx="10"
        cy="10"
        r={CONTEXT_RING_RADIUS}
        fill="none"
        strokeWidth="3"
        className="agentkit-context-ring-track"
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
        className="agentkit-context-ring-fill"
        data-warning={warning ? "true" : undefined}
        data-context-ring-fill=""
      />
    </svg>
  );
}

/** Opens `children`, usually `ContextUsagePanel`, in a popover. */
export function ContextUsageRing({
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
                data-state={open ? "open" : "closed"}
                className="agentkit-context-ring-trigger"
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
          // Portaled outside the chat, so it needs `agentkit-tokens` itself.
          className={`agentkit-tokens w-[min(calc(100vw-2rem),22rem)] ${COMPOSER_POPOVER_SURFACE_CLASS}`}
        >
          {children}
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}

export function ContextUsagePanel({
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
  const breakdownLabel = translate("agentChat.contextRing.breakdown", {
    defaultValue: "Breakdown",
  });
  const rows: ContextUsageSegmentView[] = [
    ...segments,
    {
      kind: "free-space",
      label: translate("agentChat.contextRing.freeSpace", {
        defaultValue: "Free space",
      }),
      tokens: Math.max(0, windowTokens - usedTokens),
    },
  ];
  return (
    <div className="agentkit-context-usage" data-context-usage-panel="">
      <div className="agentkit-context-usage-header">
        <span className="agentkit-context-usage-title">
          {translate("agentChat.contextRing.title", {
            defaultValue: "Context window",
          })}
        </span>
        <span className="agentkit-context-usage-total">
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
          className="agentkit-context-usage-toggle rounded-[var(--agent-kit-radius-xs,0.25rem)]"
          aria-label={breakdownLabel}
          aria-expanded={expanded}
          aria-controls={breakdownId}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? (
            <IconChevronDown aria-hidden="true" className="agentkit-icon" />
          ) : (
            <IconChevronRight aria-hidden="true" className="agentkit-icon" />
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
        className="agentkit-context-usage-bar"
        data-context-usage-bar=""
      >
        {segments.map((segment) => (
          <span
            key={segment.kind}
            data-context-usage-segment={segment.kind}
            className={segment.colorClass}
            style={segmentStyle(
              segment,
              `${(segment.tokens / barTotal) * 100}%`,
            )}
          />
        ))}
      </div>
      <div
        id={breakdownId}
        hidden={!expanded}
        className="agentkit-context-usage-breakdown"
        data-context-usage-breakdown=""
      >
        <table>
          <tbody>
            {rows.map((row) => (
              <tr key={row.kind} data-context-usage-row={row.kind}>
                <td>
                  <span
                    aria-hidden="true"
                    data-context-usage-swatch=""
                    className={
                      row.colorClass
                        ? `agentkit-context-usage-swatch ${row.colorClass}`
                        : "agentkit-context-usage-swatch"
                    }
                    style={segmentStyle(row)}
                  />
                </td>
                <td>{row.label}</td>
                <td>{formatContextWindowTokens(row.tokens)}</td>
                <td>{formatWindowShare(row.tokens, windowTokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tokensUntilAutoCompact !== undefined ? (
        <p
          className="agentkit-context-usage-caption"
          data-warning={warning ? "true" : undefined}
        >
          {warning ? (
            <IconAlertTriangle aria-hidden="true" className="agentkit-icon" />
          ) : null}
          {translate("agentChat.contextRing.untilAutoCompact", {
            defaultValue: "{{tokens}} until auto-compact",
            tokens: formatContextWindowTokens(tokensUntilAutoCompact),
          })}
        </p>
      ) : null}
      {compact.state === "done" ? (
        <p role="status" className="agentkit-context-usage-caption">
          {compact.message}
        </p>
      ) : null}
      {compact.state === "error" ? (
        <p
          role="alert"
          className="agentkit-context-usage-caption"
          data-warning="true"
        >
          <IconAlertTriangle aria-hidden="true" className="agentkit-icon" />
          <span>{compact.message}</span>
        </p>
      ) : null}
      {onCompact ? (
        <div className="agentkit-context-usage-actions">
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="rounded-[var(--agent-kit-radius-xs,0.25rem)]"
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
