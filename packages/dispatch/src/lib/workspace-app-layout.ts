import {
  orderChatFirstAppIds,
  readChatFirstAppLayout,
  writeChatFirstAppLayout,
  type ChatFirstAppLayoutPreference,
} from "@agent-native/core/client/agent-chat";
import {
  readClientAppState,
  writeClientAppState,
} from "@agent-native/core/client/application-state";
import { useCallback, useEffect, useRef, useState } from "react";

export const WORKSPACE_APP_LAYOUT_STATE_KEY = "chat-first-app-layout";

export type WorkspaceAppLayoutPersistenceError =
  | "device"
  | "workspace"
  | "both";

export function normalizeWorkspaceAppLayout(
  value: unknown,
): ChatFirstAppLayoutPreference {
  if (!value || typeof value !== "object") {
    return { pinnedIds: [], orderedIds: [] };
  }

  const candidate = value as Partial<ChatFirstAppLayoutPreference>;
  const ids = (input: unknown): string[] =>
    Array.isArray(input)
      ? input.filter(
          (id): id is string => typeof id === "string" && id.trim().length > 0,
        )
      : [];

  return {
    pinnedIds: [...new Set(ids(candidate.pinnedIds))],
    orderedIds: [...new Set(ids(candidate.orderedIds))],
  };
}

export function orderWorkspaceApps<T extends { id: string }>(
  apps: readonly T[],
  layout: ChatFirstAppLayoutPreference,
): T[] {
  const appsById = new Map(apps.map((app) => [app.id, app]));
  return orderChatFirstAppIds(
    apps.map((app) => app.id),
    layout,
  )
    .map((id) => appsById.get(id))
    .filter((app): app is T => Boolean(app));
}

export function workspaceAppMatchesQuery(
  app: { name: string; description?: string },
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return `${app.name} ${app.description ?? ""}`
    .toLowerCase()
    .includes(normalizedQuery);
}

export function toggleWorkspaceAppPinned(
  layout: ChatFirstAppLayoutPreference,
  appId: string,
): ChatFirstAppLayoutPreference {
  const pinnedIds = layout.pinnedIds.includes(appId)
    ? layout.pinnedIds.filter((id) => id !== appId)
    : [appId, ...layout.pinnedIds];
  return { ...layout, pinnedIds };
}

export function useWorkspaceAppLayout() {
  const [layout, setLayout] = useState<ChatFirstAppLayoutPreference>(() =>
    readChatFirstAppLayout(),
  );
  const [persistenceError, setPersistenceError] =
    useState<WorkspaceAppLayoutPersistenceError | null>(null);
  const hydratedRef = useRef(false);
  const localChangeRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    void readClientAppState<unknown>(WORKSPACE_APP_LAYOUT_STATE_KEY)
      .then((value) => {
        if (value !== null && !localChangeRef.current) {
          setLayout(normalizeWorkspaceAppLayout(value));
        }
      })
      .catch(() => {
        // Device-local preferences remain usable when workspace state is unavailable.
      });
  }, []);

  const persistLayout = useCallback((next: ChatFirstAppLayoutPreference) => {
    localChangeRef.current = true;
    setLayout(next);
    const deviceResult = writeChatFirstAppLayout(next);
    const deviceFailed = !deviceResult.ok;

    void writeClientAppState(WORKSPACE_APP_LAYOUT_STATE_KEY, next)
      .then(() => {
        setPersistenceError(deviceFailed ? "device" : null);
      })
      .catch(() => {
        setPersistenceError(deviceFailed ? "both" : "workspace");
      });
  }, []);

  const togglePinned = useCallback(
    (appId: string) => {
      persistLayout(toggleWorkspaceAppPinned(layout, appId));
    },
    [layout, persistLayout],
  );

  return { layout, persistenceError, persistLayout, togglePinned };
}
