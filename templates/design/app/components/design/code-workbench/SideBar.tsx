import { cn } from "@/lib/utils";

import { ExplorerView } from "./explorer/ExplorerView";
import { SearchView } from "./search/SearchView";
import { useWorkbench } from "./store";

export interface SideBarProps {
  designId: string;
  searchSeed: { value?: string; token: number };
  explorerFocusToken: number;
  onRequestLocalWriteConsent?: (
    connectionId: string,
    retry: () => void,
  ) => void;
}

const VIEW_LABELS: Record<"explorer" | "search", string> = {
  explorer: "Explorer" /* i18n-ignore */,
  search: "Search" /* i18n-ignore */,
};

/**
 * Sidebar shell: 35px uppercase header + the active view. Both the explorer
 * and search views stay mounted (hidden via CSS) so search query/results and
 * explorer scroll/expansion state survive switching between them.
 */
export function SideBar({
  designId,
  searchSeed,
  explorerFocusToken,
  onRequestLocalWriteConsent,
}: SideBarProps) {
  const { state } = useWorkbench();
  const view = state.sideView;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[35px] shrink-0 items-center px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--workbench-muted-fg)]">
        {VIEW_LABELS[view]}
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
