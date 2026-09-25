import { appPath } from "@agent-native/core/client/api-path";
import { useAgentRouteState } from "@agent-native/core/client/navigation";

import {
  crmNavigationPath,
  parseCrmNavigationSelection,
  viewFromPath,
  type CrmNavigationTarget,
  type CrmSettingsSection,
  type CrmView,
} from "@/lib/navigation";
import { TAB_ID } from "@/lib/tab-id";

export interface CrmNavigationState {
  view: CrmView;
  path: string;
  recordId?: string;
  viewId?: string;
  query?: string;
  settingsSection?: CrmSettingsSection;
  dashboardId?: string;
}

/** Exactly what `navigate` accepts, so no destination is dropped in between. */
export type CrmNavigateCommand = CrmNavigationTarget;

export function useNavigationState() {
  useAgentRouteState<CrmNavigationState, CrmNavigateCommand>({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,
    getNavigationState: ({ pathname, search }) => {
      const params = new URLSearchParams(search);
      const recordMatch = pathname.match(/^\/records\/([^/?#]+)/);
      const parsed = parseCrmNavigationSelection(`${pathname}${search}`);
      return {
        view: viewFromPath(pathname),
        path: appPath(`${pathname}${search}`),
        recordId: recordMatch?.[1]
          ? decodeURIComponent(recordMatch[1])
          : undefined,
        viewId: params.get("view") ?? undefined,
        dashboardId: params.get("id") ?? undefined,
        query: params.get("q") ?? undefined,
        settingsSection: parsed?.settingsSection,
      };
    },
    getCommandPath: (command) => crmNavigationPath(command),
  });
}
