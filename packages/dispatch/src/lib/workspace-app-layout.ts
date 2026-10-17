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
      ? [
          ...new Set(
            input
              .filter(
                (id): id is string =>
                  typeof id === "string" && id.trim().length > 0,
              )
              .map((id) => id.trim().toLowerCase()),
          ),
        ]
      : [];

  return {
    pinnedIds: ids(candidate.pinnedIds),
    orderedIds: ids(candidate.orderedIds),
  };
}

export function orderWorkspaceApps<T extends { id: string }>(
  apps: readonly T[],
  layout: ChatFirstAppLayoutPreference,
): T[] {
  const appIds = apps.map((app) => app.id.trim().toLowerCase());
  const appsById = new Map(
    apps.map((app) => [app.id.trim().toLowerCase(), app]),
  );
  return orderChatFirstAppIds(appIds, normalizeWorkspaceAppLayout(layout))
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
  const normalizedLayout = normalizeWorkspaceAppLayout(layout);
  const normalizedAppId = appId.trim().toLowerCase();
  const pinnedIds = normalizedLayout.pinnedIds.includes(normalizedAppId)
    ? normalizedLayout.pinnedIds.filter((id) => id !== normalizedAppId)
    : [normalizedAppId, ...normalizedLayout.pinnedIds];
  return { ...normalizedLayout, pinnedIds };
}

export function useWorkspaceAppLayout() {
  const [layout, setLayout] = useState<ChatFirstAppLayoutPreference>(() =>
    normalizeWorkspaceAppLayout(readChatFirstAppLayout()),
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
    const normalizedNext = normalizeWorkspaceAppLayout(next);
    setLayout(normalizedNext);
    const deviceResult = writeChatFirstAppLayout(normalizedNext);
    const deviceFailed = !deviceResult.ok;

    void writeClientAppState(WORKSPACE_APP_LAYOUT_STATE_KEY, normalizedNext)
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
