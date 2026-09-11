import { agentNativePath } from "@agent-native/core/client/api-path";
import type { AssetsUserPrefs } from "@shared/assets-user-prefs";
import { useCallback, useEffect, useState } from "react";

const PREFS_PATH = "/_agent-native/assets/user-prefs";

export interface AssetsPrefsState {
  prefs: AssetsUserPrefs;
  loading: boolean;
  /** Applies the patch optimistically and rolls back if the write fails. */
  save: (patch: AssetsUserPrefs) => Promise<void>;
}

export function useAssetsPrefs(): AssetsPrefsState {
  const [prefs, setPrefs] = useState<AssetsUserPrefs>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(agentNativePath(PREFS_PATH));
        const json = res.ok ? await res.json() : null;
        if (cancelled) return;
        if (json && typeof json === "object" && !("error" in json)) {
          setPrefs(json as AssetsUserPrefs);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(
    async (patch: AssetsUserPrefs) => {
      const previous = prefs;
      setPrefs((current) => ({ ...current, ...patch }));
      const res = await fetch(agentNativePath(PREFS_PATH), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        setPrefs(previous);
        throw new Error(`Save failed (${res.status})`);
      }
    },
    [prefs],
  );

  return { prefs, loading, save };
}
