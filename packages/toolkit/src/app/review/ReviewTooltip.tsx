import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import type { ReactElement } from "react";

/**
 * Names one icon button on hover and keyboard focus. It brings its own
 * provider, so the button also works outside a card frame, and the content is
 * marked `data-review-popover` so a click on it is not an outside click.
 */
export function ReviewTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactElement;
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent data-review-popover="" side="bottom">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
