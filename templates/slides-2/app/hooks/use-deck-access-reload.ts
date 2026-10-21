import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { DeckReloadStatus } from "@/context/DeckContext";

/**
 * Reloads the deck list once per (deck, org) when the open deck is missing
 * from it, and returns the key of the last settled check.
 *
 * `reload` toggles `loading`, which this effect reads, so the effect re-runs
 * mid-reload. Attempts use a generation that advances with every key change,
 * so a K1 → K2 → K1 transition cannot revive the first K1 attempt. Unmount
 * advances it too, so a retry loop still receiving `stale` stops reloading.
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
  const generationRef = useRef(0);
  const startedGenerationRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    generationRef.current += 1;
    startedGenerationRef.current = null;
    return () => {
      generationRef.current += 1;
    };
  }, [accessKey]);

  useEffect(() => {
    const generation = generationRef.current;
    if (
      loading ||
      deckFound ||
      !accessKey ||
      orgLoading ||
      checkedKey === accessKey ||
      startedGenerationRef.current === generation
    ) {
      return;
    }
    startedGenerationRef.current = generation;

    if (!orgId) {
      setCheckedKey(accessKey);
      return;
    }

    void (async () => {
      let status = await reload();
      while (status === "stale" && generationRef.current === generation) {
        status = await reload();
      }
      if (generationRef.current === generation) setCheckedKey(accessKey);
    })();
  }, [accessKey, checkedKey, deckFound, loading, orgId, orgLoading, reload]);

  return checkedKey;
}
