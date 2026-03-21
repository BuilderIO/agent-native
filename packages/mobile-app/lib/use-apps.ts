import { useState, useEffect, useCallback } from "react";
import type { AppConfig } from "@agent-native/shared-app-config";
import * as AppStore from "./app-store";

export function useApps() {
  const [apps, setApps] = useState<AppConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const loaded = await AppStore.getApps();
    setApps(loaded);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const addApp = useCallback(
    async (app: AppConfig) => {
      await AppStore.addApp(app);
      await reload();
    },
    [reload],
  );

  const removeApp = useCallback(
    async (id: string) => {
      await AppStore.removeApp(id);
      await reload();
    },
    [reload],
  );

  const updateApp = useCallback(
    async (id: string, updates: Partial<AppConfig>) => {
      await AppStore.updateApp(id, updates);
      await reload();
    },
    [reload],
  );

  const resetToDefaults = useCallback(async () => {
    await AppStore.resetToDefaults();
    await reload();
  }, [reload]);

  const enabledApps = apps.filter((a) => a.enabled);

  return {
    apps,
    enabledApps,
    loading,
    addApp,
    removeApp,
    updateApp,
    resetToDefaults,
    reload,
  };
}
