import { useT } from "@agent-native/core/client/i18n";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import { cn } from "@agent-native/toolkit/utils";
import { IconMessageReport } from "@tabler/icons-react";
import { useState } from "react";

import { ReportProblemDialog } from "./ReportProblemDialog.js";

export interface ReportProblemButtonProps {
  variant?: "sidebar" | "icon";
  className?: string;
}

export function ReportProblemButton({
  variant = "sidebar",
  className,
}: ReportProblemButtonProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const label = t("agentChat.reportProblem.menuItem");

  const button = (
    <button
      type="button"
      aria-label={variant === "icon" ? label : undefined}
      onClick={() => setOpen(true)}
      className={cn(
        variant === "icon"
          ? "flex size-9 items-center justify-center rounded-md bg-transparent text-primary hover:bg-accent/60 hover:text-primary"
          : "flex h-auto w-full items-center justify-start gap-2 rounded bg-transparent px-2 py-1.5 text-xs font-normal text-primary hover:bg-accent/60 hover:text-primary",
        className,
      )}
    >
      <IconMessageReport className="size-4 shrink-0 text-primary" />
      {variant === "sidebar" && <span>{label}</span>}
    </button>
  );

  return (
    <>
      {variant === "icon" ? (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        button
      )}
      <ReportProblemDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
