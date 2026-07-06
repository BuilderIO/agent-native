import { appPath, useAgentRouteState } from "@agent-native/core/client";

import { TAB_ID } from "@/lib/tab-id";

export interface DeliveryNavigationState {
  view: "queue" | "detail" | "routing-rules";
  path: string;
  workItemId?: string;
  filters?: {
    status?: string;
    priority?: string;
    provider?: string;
    assigneeEmail?: string;
    tag?: string;
    search?: string;
  };
}

function compactFilters(searchParams: URLSearchParams) {
  const filters = {
    status: searchParams.get("status") || undefined,
    priority: searchParams.get("priority") || undefined,
    provider: searchParams.get("provider") || undefined,
    assigneeEmail: searchParams.get("assignee") || undefined,
    tag: searchParams.get("tag") || undefined,
    search: searchParams.get("q") || undefined,
  };
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => Boolean(value)),
  ) as DeliveryNavigationState["filters"];
}

export function useNavigationState() {
  useAgentRouteState<DeliveryNavigationState>({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,
    getNavigationState: ({ pathname, search, searchParams }) => {
      const filters = compactFilters(searchParams);
      const baseState = {
        filters: Object.keys(filters ?? {}).length ? filters : undefined,
        path: appPath(`${pathname}${search}`),
      };

      if (pathname.startsWith("/work-items/")) {
        const workItemId = decodeURIComponent(
          pathname.replace("/work-items/", "").split("/")[0] ?? "",
        );
        return {
          ...baseState,
          view: "detail" as const,
          workItemId: workItemId || undefined,
        };
      }

      if (pathname === "/routing-rules") {
        return { ...baseState, view: "routing-rules" as const };
      }

      return { ...baseState, view: "queue" as const };
    },
    getCommandPath: (command) => {
      if (command.path) return command.path;
      if (command.view === "detail" && command.workItemId) {
        return `/work-items/${encodeURIComponent(command.workItemId)}`;
      }
      if (command.view === "routing-rules") return "/routing-rules";
      return "/queue";
    },
    navigateOptions: { replace: true, flushSync: true },
  });
}
