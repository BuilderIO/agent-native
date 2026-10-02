import { useEffect, useRef, useState } from "react";

import type { DeckReloadStatus } from "@/context/DeckContext";

/**
 * Reloads the deck list once per (deck, org) when the open deck is missing
 * from it, and returns the key of the last settled check.
 *
 * `reload` toggles `loading`, which this effect reads, so the effect re-runs
 * mid-reload. The once-per-key guard is a ref for that reason: gating on a
 * cleanup `cancelled` flag drops the settled key whenever `loading` flips,
 * so a deck the viewer cannot open reloads forever.
 */
export function useDeckAccessReload({
  accessKey,
  deckFound,
  loading,
  orgId,
  orgLoading,
  reload,
}: {
  accessKey: string | null;
  deckFound: boolean;
  loading: boolean;
  orgId: string | null | undefined;
  orgLoading: boolean;
  reload: () => Promise<DeckReloadStatus>;
}): string | null {
  const [checkedKey, setCheckedKey] = useState<string | null>(null);
  const startedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      loading ||
      deckFound ||
      !accessKey ||
      orgLoading ||
      checkedKey === accessKey ||
      startedKeyRef.current === accessKey
    ) {
      return;
    }
    startedKeyRef.current = accessKey;

    if (!orgId) {
      setCheckedKey(accessKey);
      return;
    }

    void (async () => {
      let status = await reload();
      while (status === "stale" && startedKeyRef.current === accessKey) {
        status = await reload();
      }
      setCheckedKey(accessKey);
    })();
  }, [accessKey, checkedKey, deckFound, loading, orgId, orgLoading, reload]);

  return checkedKey;
}
