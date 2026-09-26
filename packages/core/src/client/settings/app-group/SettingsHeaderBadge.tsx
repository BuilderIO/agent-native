import { Badge } from "@agent-native/toolkit/ui/badge";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip.js";

/** The chip beside a Settings page title, with its explanation in a tooltip. */
export function SettingsHeaderBadge({
  label,
  tooltip,
}: {
  label: string;
  tooltip?: string;
}) {
  const badge = <Badge variant="outline">{label}</Badge>;
  if (!tooltip) return badge;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="inline-flex rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {badge}
          </span>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
