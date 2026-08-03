import { IconAlertTriangle, IconX } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

interface SlideOverflowWarningProps {
  verticalOverflow: number;
  horizontalOverflow?: number;
  isAskingAgentToFix: boolean;
  dismissLabel: string;
  onFix: () => void;
  onDismiss: () => void;
}

export function SlideOverflowWarning({
  verticalOverflow,
  horizontalOverflow = 0,
  isAskingAgentToFix,
  dismissLabel,
  onFix,
  onDismiss,
}: SlideOverflowWarningProps) {
  const overflowLabel = [
    verticalOverflow > 0 ? `vertical ${verticalOverflow}px` : "",
    horizontalOverflow > 0 ? `horizontal ${horizontalOverflow}px` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const visibleOverflowLabel =
    horizontalOverflow > 0 ? overflowLabel : `${verticalOverflow}px`;
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute -top-7 left-0 z-20 flex items-center gap-2 text-xs text-amber-400"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <IconAlertTriangle className="h-3.5 w-3.5 flex-shrink-0" stroke={2} />
      <span className="leading-tight">
        Layout overflows by {visibleOverflowLabel}
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 cursor-pointer px-1.5 text-[11px] font-medium text-amber-400 hover:bg-transparent hover:text-amber-300 hover:underline"
        onClick={onFix}
        disabled={isAskingAgentToFix}
      >
        {isAskingAgentToFix ? "Asking…" : "Fix with AI"}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-6 cursor-pointer text-amber-400 hover:bg-transparent hover:text-amber-300"
        onClick={onDismiss}
        aria-label={dismissLabel}
        title={dismissLabel}
      >
        <IconX className="size-3.5" />
      </Button>
    </div>
  );
}
