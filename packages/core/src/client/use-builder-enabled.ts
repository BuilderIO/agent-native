import { useEffect, useState } from "react";

/**
 * Tri-state:
 *   - `null`   → still loading (env-status hasn't resolved yet)
 *   - `true`   → `ENABLE_BUILDER` is configured, show Builder flows
 *   - `false`  → not configured, hide Builder flows / show waitlist
 *
 * Callers must handle `null` (render skeleton / nothing) rather than
 * defaulting to `false` — otherwise Builder-enabled deployments briefly
 * flash the waitlist CTA before the fetch settles, and a user could
 * click "Join waitlist" when Connect Builder.io would have worked.
 *
 * Resolves to `false` on network failure so callers don't hang on
 * loading forever; transient errors gracefully degrade to the
 * conservative "Builder off" branch.
 */
export function useBuilderEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/_agent-native/env-status")
      .then((r) => (r.ok ? r.json() : []))
      .then((keys: Array<{ key: string; configured: boolean }>) => {
        if (cancelled) return;
        setEnabled(!!keys.find((k) => k.key === "ENABLE_BUILDER")?.configured);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}
