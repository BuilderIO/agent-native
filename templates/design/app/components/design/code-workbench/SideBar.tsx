import { IconFiles, IconSearch } from "@tabler/icons-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { formatKeybinding } from "./commands";
import { ExplorerView } from "./explorer/ExplorerView";
import { SearchView } from "./search/SearchView";
import { useWorkbench, type SideView } from "./store";

export interface SideBarProps {
  designId: string;
  searchSeed: { value?: string; token: number };
  explorerFocusToken: number;
  onRequestLocalWriteConsent?: (
    connectionId: string,
    retry: () => void,
  ) => void;
}

interface SideBarTab {
  view: SideView;
  icon: typeof IconFiles;
  label: string;
  keybinding: string;
}

const VIEW_TABS: SideBarTab[] = [
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
 * Sidebar shell: top view tabs + the active view. Both the explorer
 * and search views stay mounted (hidden via CSS) so search query/results and
 * explorer scroll/expansion state survive switching between them.
 */
export function SideBar({
  designId,
  searchSeed,
  explorerFocusToken,
  onRequestLocalWriteConsent,
}: SideBarProps) {
  const { state, api } = useWorkbench();
  const view = state.sideView;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="tablist"
        aria-label="Code sidebar views" /* i18n-ignore */
        className="flex h-10 shrink-0 items-center gap-1 px-2"
      >
        {VIEW_TABS.map((item) => {
          const Icon = item.icon;
          const active = view === item.view;
          return (
            <Tooltip key={item.view}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={item.label}
                  className={cn(
                    "relative flex size-8 cursor-pointer items-center justify-center rounded-[5px] text-[var(--workbench-muted-fg)] outline-none transition-colors",
                    "hover:bg-[var(--workbench-hover-bg)] hover:text-[var(--workbench-fg)] focus-visible:ring-1 focus-visible:ring-[var(--workbench-accent)]",
                    active &&
                      "bg-[var(--workbench-list-active-bg,var(--workbench-active-bg))] text-[var(--workbench-fg)]",
                  )}
                  onClick={() => {
                    if (!active) api.setSideView(item.view);
                  }}
                >
                  <Icon className="size-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {item.label} {formatKeybinding(item.keybinding)}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <div className={cn("min-h-0 flex-1", view !== "explorer" && "hidden")}>
        <ExplorerView
          designId={designId}
          explorerFocusToken={explorerFocusToken}
          onRequestLocalWriteConsent={onRequestLocalWriteConsent}
        />
      </div>
      <div className={cn("min-h-0 flex-1", view !== "search" && "hidden")}>
        <SearchView searchSeed={searchSeed} />
      </div>
    </div>
  );
}
