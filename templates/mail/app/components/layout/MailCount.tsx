import type { ReactNode } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function MailCountText({
  display,
  meaning,
}: {
  display: ReactNode;
  meaning: string;
}) {
  return (
    <>
      <span aria-hidden="true">{display}</span>
      <span className="sr-only">{meaning}</span>
    </>
  );
}

export function MailCount({
  display,
  meaning,
  className,
}: {
  display: ReactNode;
  meaning: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={className}>
          <MailCountText display={display} meaning={meaning} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">{meaning}</TooltipContent>
    </Tooltip>
  );
}
