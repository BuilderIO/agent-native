import { appPath } from "@agent-native/core/client/api-path";
import { useAgentRouteState } from "@agent-native/core/client/navigation";

import { pathForView, viewFromPath, type CrmView } from "@/lib/navigation";
import { TAB_ID } from "@/lib/tab-id";

export interface CrmNavigationState {
  view: CrmView;
  path: string;
  recordId?: string;
  viewId?: string;
  query?: string;
}

export interface CrmNavigateCommand {
  view?: CrmView;
  recordId?: string;
  viewId?: string;
  query?: string;
}

export function useNavigationState() {
  useAgentRouteState<CrmNavigationState, CrmNavigateCommand>({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,
    getNavigationState: ({ pathname, search }) => {
      const params = new URLSearchParams(search);
      const recordMatch = pathname.match(/^\/records\/([^/?#]+)/);
      return {
        view: viewFromPath(pathname),
        path: appPath(`${pathname}${search}`),
        recordId: recordMatch?.[1]
          ? decodeURIComponent(recordMatch[1])
          : undefined,
        viewId: params.get("view") ?? undefined,
        query: params.get("q") ?? undefined,
      };
    },
    getCommandPath: (command) => {
      const params = new URLSearchParams();
      if (command.viewId) params.set("view", command.viewId);
      if (command.query) params.set("q", command.query);
      const path = pathForView(command.view, command.recordId);
      return `${path}${params.size ? `?${params}` : ""}`;
    },
  });
}
