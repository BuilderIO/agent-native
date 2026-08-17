import { IconAlertTriangle, IconInfoCircle, IconX } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SlideOverflowWarningProps {
  verticalOverflow: number;
  horizontalOverflow?: number;
  warningLabel: string;
  overflowDetails: string;
  overflowDetailsLabel: string;
  isAskingAgentToFix: boolean;
  dismissLabel: string;
  onFix: () => void;
  onDismiss: () => void;
}

export function SlideOverflowWarning({
  warningLabel,
  overflowDetails,
  overflowDetailsLabel,
  isAskingAgentToFix,
  dismissLabel,
  onFix,
  onDismiss,
}: SlideOverflowWarningProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      // w-max/nowrap: the containing block is the zoomed slide canvas, so at
      // low zoom the banner would otherwise wrap to a height taller than its
      // own -top-12 offset and spill down over the slide.
      className="absolute -top-12 left-0 z-20 flex w-max items-center gap-2 whitespace-nowrap rounded-md bg-card px-2 py-1 text-xs text-foreground shadow-sm"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <IconAlertTriangle
        className="h-3.5 w-3.5 flex-shrink-0 text-foreground"
        stroke={2}
      />
      <span className="leading-tight">{warningLabel}</span>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-6 cursor-help text-muted-foreground hover:bg-transparent hover:text-foreground"
              aria-label={overflowDetailsLabel}
            >
              <IconInfoCircle className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{overflowDetails}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 cursor-pointer px-1.5 text-[11px] font-medium text-foreground hover:bg-transparent hover:underline"
        onClick={onFix}
        disabled={isAskingAgentToFix}
      >
        {isAskingAgentToFix ? "Asking…" : "Fix with AI"}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-6 cursor-pointer text-foreground hover:bg-transparent hover:text-foreground/70"
        onClick={onDismiss}
        aria-label={dismissLabel}
        title={dismissLabel}
      >
        <IconX className="size-3.5" />
      </Button>
    </div>
  );
}
