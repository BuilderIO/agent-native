import {
  appBasePath,
  appPath,
  useAgentRouteState,
} from "@agent-native/core/client";
import { parseIncludeDoneParam } from "@shared/boolean-param";
import {
  type NavigateCommand,
  type NavigationState,
  buildNavigatePath,
  pathForView,
  viewForPath,
} from "@shared/navigation";
import { useLocation } from "react-router";

import { TAB_ID } from "@/lib/tab-id";

export type { NavigateCommand, NavigationState };

export function useNavigationState() {
  const location = useLocation();

  useAgentRouteState<NavigationState, NavigateCommand & { _writeId?: string }>({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,
    getNavigationState: ({ pathname, search }) => {
      const params = new URLSearchParams(search);
      return {
        view: viewForPath(pathname),
        path: appPath(pathname),
        includeDone: parseIncludeDoneParam(params.get("includeDone")),
        taskId: params.get("task") ?? undefined,
        inboxItemId: params.get("inboxItem") ?? undefined,
        fieldId: params.get("field") ?? undefined,
      };
    },
    getCommandPath: (command) => {
      const currentParams = new URLSearchParams(location.search);
      return routerPath(
        buildNavigatePath(command.path || pathForView(command.view), command, {
          includeDone: parseIncludeDoneParam(currentParams.get("includeDone")),
        }),
      );
    },
  });
}

function routerPath(path: string): string {
  const basePath = appBasePath();
  if (!basePath) return path;
  if (path === basePath) return "/";
  if (path.startsWith(`${basePath}/`)) {
    return path.slice(basePath.length) || "/";
  }
  return path;
}
