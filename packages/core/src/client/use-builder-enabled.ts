import { useEffect, useState } from "react";

/**
 * Returns `true` when the server reports `ENABLE_BUILDER` is configured —
 * i.e. Builder.io integration is opted in for this deployment. When `false`,
 * callers should hide Builder-specific options (or render a waitlist CTA)
 * so users aren't shown a path that isn't turned on for their deployment.
 *
 * Fetches `/_agent-native/env-status` once on mount. Returns `false` while
 * loading or on fetch failure.
 */
export function useBuilderEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    fetch("/_agent-native/env-status")
      .then((r) => (r.ok ? r.json() : []))
      .then((keys: Array<{ key: string; configured: boolean }>) => {
        if (keys.find((k) => k.key === "ENABLE_BUILDER")?.configured) {
          setEnabled(true);
        }
      })
      .catch(() => {});
  }, []);
  return enabled;
}
