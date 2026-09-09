import {
  normalizeWorkspaceAppConfigs,
  TEMPLATE_APPS,
  WORKSPACE_APP_LIST_FLAG_KEY,
  type AppConfig,
} from "@agent-native/shared-app-config";
import { useCallback, useEffect, useState } from "react";

import { callAppActionGet, DEFAULT_CHAT_BASE_URL } from "./agent-chat/api";

const dispatchBaseUrl =
  TEMPLATE_APPS.find((app) => app.id === "dispatch")?.url ??
  "https://dispatch.agent-native.com";

export interface WorkspaceAppsSnapshot {
  enabled: boolean;
  apps: AppConfig[];
  loading: boolean;
}

const listeners = new Set<() => void>();
let snapshot: WorkspaceAppsSnapshot = {
  enabled: false,
  apps: [],
  loading: true,
};
let refreshPromise: Promise<void> | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

function update(next: WorkspaceAppsSnapshot): void {
  snapshot = next;
  emit();
}

export function subscribeWorkspaceApps(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function refreshWorkspaceApps(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  update({ ...snapshot, loading: true });
  refreshPromise = (async () => {
    try {
      const flags = await callAppActionGet<Record<string, unknown>>(
        "get-feature-flags",
        {},
        dispatchBaseUrl || DEFAULT_CHAT_BASE_URL,
      );
      if (flags[WORKSPACE_APP_LIST_FLAG_KEY] !== true) {
        update({ enabled: false, apps: [], loading: false });
        return;
      }

      const inventory = await callAppActionGet<unknown>(
        "list-workspace-apps",
        { includeAgentCards: false, audience: "all" },
        dispatchBaseUrl,
      );
      update({
        enabled: true,
        apps: normalizeWorkspaceAppConfigs(inventory, {
          baseUrl: dispatchBaseUrl,
        }),
        loading: false,
      });
    } catch {
      update({ enabled: false, apps: [], loading: false });
    }
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export function getWorkspaceApp(id: string): AppConfig | undefined {
  return snapshot.enabled
    ? snapshot.apps.find((app) => app.id === id)
    : undefined;
}

export function useWorkspaceApps(): WorkspaceAppsSnapshot & {
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState(snapshot);
  useEffect(() => {
    const unsubscribe = subscribeWorkspaceApps(() => setState(snapshot));
    void refreshWorkspaceApps();
    return unsubscribe;
  }, []);

  const refresh = useCallback(() => refreshWorkspaceApps(), []);
  return { ...state, refresh };
}
