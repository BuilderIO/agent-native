import { IconAlertTriangle, IconX } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

interface SlideOverflowWarningProps {
  verticalOverflow: number;
  isAskingAgentToFix: boolean;
  onFix: () => void;
  onDismiss: () => void;
}

export function SlideOverflowWarning({
  verticalOverflow,
  isAskingAgentToFix,
  onFix,
  onDismiss,
}: SlideOverflowWarningProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute top-3 left-3 z-20 flex items-center gap-2 rounded-md border border-amber-400/70 bg-amber-950/95 px-2.5 py-1.5 text-xs text-amber-50 shadow-lg"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <IconAlertTriangle className="h-3.5 w-3.5 flex-shrink-0" stroke={2} />
      <span className="leading-tight">
        Layout overflows by {verticalOverflow}px
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="ml-1 h-6 cursor-pointer px-2 text-[11px] font-medium text-amber-50 hover:bg-amber-400/20 hover:text-white"
        onClick={onFix}
        disabled={isAskingAgentToFix}
      >
        {isAskingAgentToFix ? "Asking…" : "Fix with AI"}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-6 cursor-pointer text-amber-50 hover:bg-amber-400/20 hover:text-white"
        onClick={onDismiss}
        aria-label="Dismiss layout warning"
        title="Dismiss layout warning"
      >
        <IconX className="size-3.5" />
      </Button>
    </div>
  );
}
