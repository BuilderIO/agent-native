import type { AppConfig } from "@agent-native/shared-app-config";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  filterAvailableMobileTabAppIds,
  getDefaultMobileTabAppIds,
  MOBILE_BOTTOM_TAB_LIMIT,
  supportsMobileTab,
  toggleMobileTabAppId,
} from "./mobile-app-navigation";

export const MOBILE_TAB_LAYOUT_STORAGE_KEY =
  "agent-native:mobile-tab-layout:v1";

export type MobileTabLayoutReadResult =
  | { ok: true; ids: string[] | null }
  | { ok: false; ids: null; reason: string };

export type MobileTabLayoutWriteResult =
  | { ok: true; ids: string[] }
  | { ok: false; ids: string[]; reason: string };

export type MobileTabToggleResult =
  | { ok: true; changed: boolean; limitReached: boolean }
  | { ok: false; changed: false; limitReached: false; reason: string };

const listeners = new Set<(ids: string[]) => void>();

function normalizeIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.filter(
    (id): id is string => typeof id === "string" && supportsMobileTab(id),
  );
  return [...new Set(ids)].slice(0, MOBILE_BOTTOM_TAB_LIMIT);
}

export async function loadMobileTabLayout(): Promise<MobileTabLayoutReadResult> {
  try {
    const raw = await AsyncStorage.getItem(MOBILE_TAB_LAYOUT_STORAGE_KEY);
    if (raw === null) return { ok: true, ids: null };
    const ids = normalizeIds(JSON.parse(raw));
    if (ids === null) {
      return {
        ok: false,
        ids: null,
        reason: "The saved mobile tab layout is not valid.",
      };
    }
    return { ok: true, ids };
  } catch (error) {
    return {
      ok: false,
      ids: null,
      reason:
        error instanceof Error
          ? error.message
          : "The mobile tab layout could not be read.",
    };
  }
}

export async function saveMobileTabLayout(
  ids: readonly string[],
): Promise<MobileTabLayoutWriteResult> {
  const normalized = normalizeIds(ids) ?? [];
  try {
    await AsyncStorage.setItem(
      MOBILE_TAB_LAYOUT_STORAGE_KEY,
      JSON.stringify(normalized),
    );
    for (const listener of listeners) listener(normalized);
    return { ok: true, ids: normalized };
  } catch (error) {
    return {
      ok: false,
      ids: normalized,
      reason:
        error instanceof Error
          ? error.message
          : "The mobile tab layout could not be saved.",
    };
  }
}

export function subscribeMobileTabLayout(
  listener: (ids: string[]) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMobileTabLayout(apps: readonly AppConfig[]) {
  const [storedIds, setStoredIds] = useState<string[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appIdsKey = apps.map((app) => `${app.id}:${app.enabled}`).join(",");

  useEffect(() => {
    let active = true;
    void loadMobileTabLayout().then((result) => {
      if (!active) return;
      setLoaded(true);
      if (result.ok) {
        setStoredIds(result.ids);
        setError(null);
      } else {
        setStoredIds(null);
        setError("Mobile tab preferences could not be read.");
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () =>
      subscribeMobileTabLayout((ids) => {
        setStoredIds(ids);
        setLoaded(true);
        setError(null);
      }),
    [],
  );

  const defaultIds = useMemo(
    () => getDefaultMobileTabAppIds(apps),
    // The app ids and enabled state are the only inputs used to derive defaults.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appIdsKey],
  );
  const availableIds = useMemo(
    () =>
      new Set(
        apps
          .filter((app) => app.enabled && supportsMobileTab(app.id))
          .map((app) => app.id),
      ),
    [apps],
  );
  const selectedAppIds = useMemo(() => {
    const source = storedIds ?? defaultIds;
    return filterAvailableMobileTabAppIds(source, availableIds);
  }, [availableIds, defaultIds, storedIds]);

  const toggleApp = useCallback(
    async (appId: string): Promise<MobileTabToggleResult> => {
      if (!supportsMobileTab(appId)) {
        return {
          ok: false,
          changed: false,
          limitReached: false,
          reason: "That app cannot be shown as a native mobile tab.",
        };
      }
      const previousIds = storedIds;
      const currentIds = filterAvailableMobileTabAppIds(
        storedIds ?? defaultIds,
        availableIds,
      );
      const next = toggleMobileTabAppId(currentIds, appId);
      if (!next.changed) return { ok: true, ...next };

      setStoredIds(next.ids);
      setError(null);
      const result = await saveMobileTabLayout(next.ids);
      if (!result.ok) {
        setStoredIds(previousIds);
        setError("Mobile tab preferences could not be saved on this device.");
        return {
          ok: false,
          changed: false,
          limitReached: false,
          reason: "Mobile tab preferences could not be saved.",
        };
      }
      return { ok: true, ...next };
    },
    [availableIds, defaultIds, storedIds],
  );

  return {
    error,
    loaded,
    limit: MOBILE_BOTTOM_TAB_LIMIT,
    selectedAppIds,
    toggleApp,
  };
}
