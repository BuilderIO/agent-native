import { useT } from "@agent-native/core/client/i18n";
import { memo } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface BreakpointOverrideIndicatorProps {
  overridden: boolean;
  maxWidthPx?: number | null;
  onReset?: () => void;
  className?: string;
}

interface BreakpointOverrideIndicatorContentProps {
  maxWidthPx?: number | null | undefined;
  onReset?: (() => void) | undefined;
  className?: string | undefined;
}

function BreakpointOverrideIndicatorContent({
  maxWidthPx,
  onReset,
  className,
}: BreakpointOverrideIndicatorContentProps) {
  const t = useT();
  const hasValidWidth =
    typeof maxWidthPx === "number" &&
    Number.isFinite(maxWidthPx) &&
    maxWidthPx > 0;
  const tooltip = hasValidWidth
    ? t("editPanel.breakpointOverride.overriddenAtTooltip", {
        width: String(Math.round(maxWidthPx)),
      })
    : t("editPanel.breakpointOverride.overriddenTooltip");
  return (
    <span className={cn("inline-flex shrink-0 items-center", className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-block size-1.5 shrink-0 rounded-full bg-[var(--design-editor-accent-color)]"
            role="img"
            aria-label={tooltip}
          />
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
      {onReset ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onReset();
              }}
              className="ml-0.5 cursor-pointer text-[10px] font-medium text-muted-foreground hover:text-foreground"
              aria-label={t("editPanel.breakpointOverride.reset")}
            >
              {t("editPanel.breakpointOverride.resetShort")}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {t("editPanel.breakpointOverride.resetTooltip")}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </span>
  );
}

export const BreakpointOverrideIndicator = memo(
  function BreakpointOverrideIndicator({
    overridden,
    maxWidthPx,
    onReset,
    className,
  }: BreakpointOverrideIndicatorProps) {
    if (!overridden) return null;
    return (
      <BreakpointOverrideIndicatorContent
        maxWidthPx={maxWidthPx}
        onReset={onReset}
        className={className}
      />
    );
  },
);
