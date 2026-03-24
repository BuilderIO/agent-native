import { useState, useEffect } from "react";

let cached: boolean | null = null;
let fetchPromise: Promise<boolean> | null = null;

function fetchDevMode(apiBase: string): Promise<boolean> {
  if (!fetchPromise) {
    fetchPromise = fetch(`${apiBase}/mode`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((data: { devMode: boolean }) => {
        cached = data.devMode;
        return cached;
      })
      .catch(() => {
        // Default to dev mode if endpoint unavailable (don't block features)
        cached = true;
        return true;
      });
  }
  return fetchPromise;
}

/**
 * Returns whether the app is running in dev mode.
 * Fetches /api/agent-chat/mode once and caches the result.
 */
export function useDevMode(apiBase = "/api/agent-chat"): {
  isDevMode: boolean;
  isLoading: boolean;
} {
  const [isDevMode, setIsDevMode] = useState<boolean>(cached ?? true);
  const [isLoading, setIsLoading] = useState(cached === null);

  useEffect(() => {
    if (cached !== null) {
      setIsDevMode(cached);
      setIsLoading(false);
      return;
    }
    fetchDevMode(apiBase).then((val) => {
      setIsDevMode(val);
      setIsLoading(false);
    });
  }, [apiBase]);

  return { isDevMode, isLoading };
}
