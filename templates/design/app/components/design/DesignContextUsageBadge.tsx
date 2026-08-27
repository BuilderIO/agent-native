import { useActionQuery } from "@agent-native/core/client/hooks";
import { IconSparkles } from "@tabler/icons-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import type { DesignContextUsageResult } from "../../../actions/get-design-context-usage.js";

/**
 * Durable, revisitable marker for the exact Creative Context items recorded
 * for this file's most recent generation (see get-design-context-usage.ts) —
 * not a live re-check. Renders nothing when this file was never generated
 * through the recorded pipeline (`available: false`), since that is a
 * different, unknown state from a confirmed "no context used" generation.
 */
export function DesignContextUsageBadge({
  designId,
  fileId,
}: {
  designId?: string;
  fileId?: string;
}) {
  const enabled = Boolean(designId && fileId);
  const { data } = useActionQuery<DesignContextUsageResult>(
    "get-design-context-usage",
    { designId: designId ?? "", fileId: fileId ?? "" },
    { enabled },
  );

  if (!data?.available) return null;

  if (!data.usedContext) {
    return (
      <span
        data-design-context-usage="none"
        className="shrink-0 rounded-sm bg-muted-foreground/15 px-1.5 py-0.5 !text-[9px] font-medium text-muted-foreground"
      >
        {
          "No Creative Context used" /* i18n-ignore short inspector badge, mirrors other frame-chrome literals in this template */
        }
      </span>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-design-context-usage="used"
          className={cn(
            "flex h-5 shrink-0 items-center gap-1 rounded-sm border border-border bg-background/95 px-1.5",
            "!text-[9px] font-medium text-foreground shadow-sm hover:bg-accent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <IconSparkles size={11} />
          {
            "Context used" /* i18n-ignore short inspector badge, mirrors other frame-chrome literals in this template */
          }
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 text-xs">
        <p className="mb-1.5 font-medium text-foreground">
          {
            "Creative Context used for this generation" /* i18n-ignore popover heading, mirrors other frame-chrome literals in this template */
          }
        </p>
        <ul className="space-y-1">
          {data.items.map((item) => (
            <li
              key={`${item.itemId}:${item.itemVersionId}`}
              className="truncate text-muted-foreground"
              title={item.label}
            >
              {item.label}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
