import { useT } from "@agent-native/core/client/i18n";
import { IconMessageCircle } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { openBugReportDialog } from "@/lib/command-events";

interface SidebarFeedbackButtonProps {
  collapsed: boolean;
}

export function SidebarFeedbackButton({
  collapsed,
}: SidebarFeedbackButtonProps) {
  const t = useT();
  const label = t("bugReportRoute.sidebarCta");

  const button = (
    <Button
      type="button"
      size={collapsed ? "icon" : "sm"}
      variant="ghost"
      aria-label={collapsed ? label : undefined}
      onClick={openBugReportDialog}
      className={
        collapsed
          ? "size-9 bg-transparent text-primary hover:bg-accent/60 hover:text-primary"
          : "h-9 w-full justify-start gap-2 bg-transparent px-3 font-medium text-primary hover:bg-accent/60 hover:text-primary"
      }
    >
      <IconMessageCircle className="size-4 shrink-0 text-primary" />
      {!collapsed && <span>{label}</span>}
    </Button>
  );

  if (!collapsed) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
