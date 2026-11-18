import type { ReactElement } from "react";

import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Keys show what Superhuman binds for the same action, not every alias Mail
 * accepts: the tooltip teaches the key a Superhuman user already knows.
 */
export const MAIL_ACTION_KEYS = {
  archive: ["E"],
  trash: ["#"],
  toggleRead: ["U"],
  star: ["S"],
  snooze: ["H"],
  reply: ["R"],
  replyAll: ["Enter"],
  forward: ["F"],
  previousConversation: ["K"],
  nextConversation: ["J"],
  back: ["Esc"],
} as const satisfies Record<string, readonly string[]>;

export function ActionTooltip({
  label,
  keys,
  side = "top",
  children,
}: {
  label: string;
  keys?: readonly string[];
  side?: "top" | "right" | "bottom" | "left";
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className="flex items-center gap-1.5">
        {label}
        {keys?.map((key) => (
          <Kbd key={key} className="h-4 min-w-4 px-1 text-[10px]">
            {key}
          </Kbd>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}
