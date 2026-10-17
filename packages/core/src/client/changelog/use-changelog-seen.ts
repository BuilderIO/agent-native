import { useCallback, useEffect, useState } from "react";

function seenStorageKey(appKey: string): string {
  return `an:changelog-seen:${appKey}`;
}

export function getChangelogLatestId(
  markdown: string | undefined,
): string | undefined {
  if (!markdown) return undefined;

  const match = /^##\s+(?!#)(.+?)\s*$/m.exec(markdown);
  if (!match) return undefined;

  const title = match[1].replace(/^\[(.+?)\]\s*/, "$1 ").trim();
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "entry"
  );
}

export function useChangelogSeen(
  appKey: string,
  latestId: string | undefined,
): { unseen: boolean; markSeen: () => void } {
  const [seenId, setSeenId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      setSeenId(window.localStorage.getItem(seenStorageKey(appKey)));
    } catch {
      // coercion-ok: unavailable storage means no seen release is readable.
    }
    setHydrated(true);
  }, [appKey]);

  const markSeen = useCallback(() => {
    if (!latestId) return;
    setSeenId(latestId);
    try {
      window.localStorage.setItem(seenStorageKey(appKey), latestId);
    } catch {
      // coercion-ok: in-memory seen state is updated; persistence is optional.
    }
  }, [appKey, latestId]);

  const unseen =
    hydrated && !!latestId && seenId !== null && seenId !== latestId;

  return { unseen, markSeen };
}
