import { useT } from "@agent-native/core/client/i18n";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface BreakpointOverrideIndicatorProps {
  /** True when the active breakpoint has an override for this property. */
  overridden: boolean;
  /**
   * The width (px) the override is scoped to — used only for the tooltip
   * copy ("Overridden at 810px"). Required whenever `overridden` is true.
   */
  maxWidthPx?: number | null;
  onReset?: () => void;
  className?: string;
}

export function BreakpointOverrideIndicator({
  overridden,
  maxWidthPx,
  onReset,
  className,
}: BreakpointOverrideIndicatorProps) {
  const t = useT();
  if (!overridden) return null;
  const tooltip =
    maxWidthPx != null
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
              onClick={onReset}
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
