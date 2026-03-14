import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ExplorerConfig } from "./types";
import { createDefaultConfig } from "./types";
import { getIdToken } from "@/lib/auth";

const AUTOSAVE_ID = "_autosave";
const AUTOSAVE_DELAY = 800; // ms debounce

interface SavedConfigEntry {
  id: string;
  name: string;
}

async function fetchWithAuth(url: string, options?: RequestInit) {
  const token = await getIdToken();
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options?.headers,
    },
  });
}

async function fetchSavedConfigs(): Promise<SavedConfigEntry[]> {
  const res = await fetchWithAuth("/api/explorer-configs");
  if (!res.ok) return [];
  const data = await res.json();
  return (data.configs ?? [])
    .filter((c: any) => c.id !== AUTOSAVE_ID)
    .map((c: any) => ({ id: c.id, name: c.name }));
}

async function fetchConfig(id: string): Promise<ExplorerConfig | null> {
  const res = await fetchWithAuth(`/api/explorer-configs/${id}`);
  if (!res.ok) return null;
  const data = await res.json();
  // Strip server-added fields
  const { id: _id, ...rest } = data;
  return rest as ExplorerConfig;
}

function persistConfig(id: string, config: ExplorerConfig) {
  fetchWithAuth(`/api/explorer-configs/${id}`, {
    method: "POST",
    body: JSON.stringify(config),
  }).catch(() => {});
}

export function useExplorerConfig() {
  const [config, setConfig] = useState<ExplorerConfig>(createDefaultConfig());
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout>>();

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

  const saveConfig = useCallback(async (name?: string) => {
    const id = currentId || slugify(name || config.name || "untitled");
    const toSave = { ...config, name: name || config.name };
    setIsSaving(true);
    try {
      await fetchWithAuth(`/api/explorer-configs/${id}`, {
        method: "POST",
        body: JSON.stringify(toSave),
      });
      setCurrentId(id);
      setConfig(toSave);
      refetchList();
    } finally {
      setIsSaving(false);
    }
  }, [config, currentId, refetchList]);

  const deleteConfig = useCallback(async (id: string) => {
    await fetchWithAuth(`/api/explorer-configs/${id}`, { method: "DELETE" });
    if (currentId === id) {
      setConfig(createDefaultConfig());
      setCurrentId(null);
    }
    refetchList();
  }, [currentId, refetchList]);

  const newConfig = useCallback(() => {
    setConfig(createDefaultConfig());
    setCurrentId(null);
  }, []);

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
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "untitled";
}
