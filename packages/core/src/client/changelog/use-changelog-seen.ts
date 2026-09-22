import { useCallback, useEffect, useState } from "react";

function seenStorageKey(appKey: string): string {
  return `an:changelog-seen:${appKey}`;
}

/**
 * Reads the first release heading without loading the full changelog parser.
 * The full parser stays behind the command-menu dialog's lazy boundary.
 */
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

/**
 * Tracks the latest release a user has already seen (per browser, via
 * localStorage). Returns whether there's an unseen release and a `markSeen`
 * callback to clear the indicator once the changelog is opened.
 */
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

  // Don't flag "unseen" until hydrated, and never on a first-ever visit (no
  // stored value) — only once the user has seen *something* and a newer
  // release appears. This avoids nagging brand-new users.
  const unseen =
    hydrated && !!latestId && seenId !== null && seenId !== latestId;

  return { unseen, markSeen };
}
