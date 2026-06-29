import { callAction, useT } from "@agent-native/core/client";
import { useQuery } from "@tanstack/react-query";
import { useState, useCallback, useEffect, useRef } from "react";

import type { ExplorerConfig } from "./types";
import { createDefaultConfig } from "./types";

const AUTOSAVE_ID = "_autosave";
const AUTOSAVE_DELAY = 800; // ms debounce

interface SavedConfigEntry {
  id: string;
  name: string;
}

async function fetchSavedConfigs(): Promise<SavedConfigEntry[]> {
  try {
    const rows = await callAction(
      "list-explorer-configs",
      {},
      { method: "GET" },
    );
    return (Array.isArray(rows) ? rows : []) as SavedConfigEntry[];
  } catch {
    return [];
  }
}

async function fetchConfig(id: string): Promise<ExplorerConfig | null> {
  try {
    const data = await callAction(
      "get-explorer-config",
      { id },
      { method: "GET" },
    );
    if (!data || typeof data !== "object") return null;
    // Strip server-added id field
    const { id: _id, ...rest } = data as Record<string, unknown>;
    return rest as unknown as ExplorerConfig;
  } catch {
    return null;
  }
}

function persistConfig(id: string, config: ExplorerConfig) {
  callAction("save-explorer-config", {
    id,
    data: config as unknown as Record<string, unknown>,
  }).catch(() => {});
}

export function useExplorerConfig() {
  const t = useT();
  const defaultConfigName = t("explorer.untitled");
  const [config, setConfig] = useState<ExplorerConfig>(() =>
    createDefaultConfig(defaultConfigName),
  );
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // On mount, try to restore from autosave
  useEffect(() => {
    fetchConfig(AUTOSAVE_ID).then((saved) => {
      if (saved) {
        setConfig(saved);
      }
      setInitialized(true);
    });
  }, []);

  // Auto-save on every config change (debounced)
  useEffect(() => {
    if (!initialized) return;
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      persistConfig(AUTOSAVE_ID, config);
      // If we have a named config loaded, save it too
      if (currentId && currentId !== AUTOSAVE_ID) {
        persistConfig(currentId, config);
      }
    }, AUTOSAVE_DELAY);
    return () => clearTimeout(autosaveTimer.current);
  }, [config, currentId, initialized]);

  const { data: savedConfigs = [], refetch: refetchList } = useQuery({
    queryKey: ["explorer-configs"],
    queryFn: fetchSavedConfigs,
    staleTime: 30_000,
  });

  const loadConfig = useCallback(async (id: string) => {
    const loaded = await fetchConfig(id);
    if (loaded) {
      setConfig(loaded);
      setCurrentId(id);
    }
  }, []);

  const saveConfig = useCallback(
    async (name?: string) => {
      const id = currentId || slugify(name || config.name || "untitled");
      const toSave = { ...config, name: name || config.name };
      setIsSaving(true);
      try {
        await callAction("save-explorer-config", {
          id,
          data: toSave as unknown as Record<string, unknown>,
        });
        setCurrentId(id);
        setConfig(toSave);
        refetchList();
      } finally {
        setIsSaving(false);
      }
    },
    [config, currentId, refetchList],
  );

  const deleteConfig = useCallback(
    async (id: string) => {
      await callAction("delete-explorer-config", { id });
      if (currentId === id) {
        setConfig(createDefaultConfig(defaultConfigName));
        setCurrentId(null);
      }
      refetchList();
    },
    [currentId, defaultConfigName, refetchList],
  );

  const newConfig = useCallback(() => {
    setConfig(createDefaultConfig(defaultConfigName));
    setCurrentId(null);
  }, [defaultConfigName]);

  return {
    config,
    setConfig,
    currentId,
    savedConfigs,
    loadConfig,
    saveConfig,
    deleteConfig,
    newConfig,
    isSaving,
  };
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "untitled"
  );
}
