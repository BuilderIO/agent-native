import { IconFiles, IconSearch } from "@tabler/icons-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { formatKeybinding } from "./commands";
import { useWorkbench, type SideView } from "./store";

interface ActivityBarItem {
  view: SideView;
  icon: typeof IconFiles;
  label: string;
  keybinding: string;
}

const ITEMS: ActivityBarItem[] = [
  {
    view: "explorer",
    icon: IconFiles,
    label: "Explorer" /* i18n-ignore */,
    keybinding: "$mod+shift+e",
  },
  {
    view: "search",
    icon: IconSearch,
    label: "Search" /* i18n-ignore */,
    keybinding: "$mod+shift+f",
  },
];

/**
 * 40px vertical activity rail. Clicking the active view's icon toggles the
 * sidebar closed (VS Code behavior); clicking an inactive view switches to
 * it and ensures the sidebar is visible.
 */
export function ActivityBar() {
  const { state, api } = useWorkbench();

  return (
    <div
      data-testid="workbench-activity-bar"
      className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-[var(--workbench-border)] bg-[var(--workbench-activitybar-bg,var(--workbench-surface-bg))] py-1.5"
    >
      {ITEMS.map((item) => {
        const isActive = state.sideView === item.view && state.sidebarVisible;
        const Icon = item.icon;
        return (
          <Tooltip key={item.view}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={item.label}
                aria-pressed={isActive}
                className={cn(
                  "relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-[5px] text-[var(--workbench-muted-fg)] outline-none transition-colors",
                  "hover:text-[var(--workbench-fg)] focus-visible:ring-1 focus-visible:ring-[var(--workbench-accent)]",
                  isActive && "text-[var(--workbench-accent)]",
                )}
                onClick={() => {
                  if (state.sideView === item.view && state.sidebarVisible) {
                    api.toggleSidebar();
                    return;
                  }
                  api.setSideView(item.view);
                }}
              >
                {isActive ? (
                  <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-[var(--workbench-accent)]" />
                ) : null}
                <Icon className="size-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {item.label} {formatKeybinding(item.keybinding)}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
