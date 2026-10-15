import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { IconClock } from "@tabler/icons-react";
import { useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SqlQueryFreshness } from "@/lib/sql-query-freshness";

import { describeFreshnessText } from "./panel-freshness";

/**
 * When the panel's data was fetched and whether it came from a cache, behind a
 * clock in the panel's hover actions. The tooltip opens on hover and focus; a
 * tap opens it too, because a tooltip alone never opens on touch.
 */
export function PanelFreshnessClock({
  freshness,
  className,
}: {
  freshness: SqlQueryFreshness;
  className?: string;
}) {
  const t = useT();
  const formatters = useFormatters();
  const [open, setOpen] = useState(false);
  const label = describeFreshnessText(t, formatters, freshness, "full");
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={className}
          aria-label={label}
          data-dashboard-report-freshness={freshness.cache}
          onClick={(event) => {
            event.preventDefault();
            setOpen(true);
          }}
        >
          <IconClock className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
