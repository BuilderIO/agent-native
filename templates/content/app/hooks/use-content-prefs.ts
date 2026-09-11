import { agentNativePath } from "@agent-native/core/client/api-path";
import type { ContentUserPrefs } from "@shared/content-user-prefs";
import { useCallback, useEffect, useState } from "react";

const PREFS_PATH = "/_agent-native/content/user-prefs";

export interface ContentPrefsState {
  prefs: ContentUserPrefs;
  loading: boolean;
  /** Applies the patch optimistically and rolls back if the write fails. */
  save: (patch: ContentUserPrefs) => Promise<void>;
}

export function useContentPrefs(): ContentPrefsState {
  const [prefs, setPrefs] = useState<ContentUserPrefs>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(agentNativePath(PREFS_PATH));
        const json = res.ok ? await res.json() : null;
        if (cancelled) return;
        if (json && typeof json === "object" && !("error" in json)) {
          setPrefs(json as ContentUserPrefs);
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
    async (patch: ContentUserPrefs) => {
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
