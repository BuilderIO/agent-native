// /home returns to the last page opened, which it learns from application
// state one round trip after the session. This browser's copy of that page id
// lets /home start the page's reads at mount instead; resolve-content-landing
// still decides where /home goes. Only the id is kept, per person and
// organization.
export const LAST_LOCATION_HINT_STORAGE_KEY = "content-last-location-hint-v1";

function readStored(): { scope: unknown; documentId: string } | null {
  try {
    const stored = JSON.parse(
      localStorage.getItem(LAST_LOCATION_HINT_STORAGE_KEY) ?? "null",
    ) as { scope?: unknown; documentId?: unknown } | null;
    return typeof stored?.documentId === "string" && stored.documentId
      ? { scope: stored.scope, documentId: stored.documentId }
      : null;
  } catch {
    // coercion-ok: an unreadable hint only means /home waits for the saved location.
    return null;
  }
}

export function readLastLocationHint(scope: string | null): string | null {
  const stored = scope ? readStored() : null;
  return stored?.scope === scope ? stored.documentId : null;
}

// Before the session arrives nobody is signed in yet, so this is whichever
// account wrote the hint last. A read started from it for another account is
// simply never adopted; /home checks the account once it mounts.
export function readLastLocationHintForAnyAccount(): string | null {
  return readStored()?.documentId ?? null;
}

export function rememberLastLocationHint(
  scope: string | null,
  documentId: string,
) {
  if (!scope) return;
  try {
    localStorage.setItem(
      LAST_LOCATION_HINT_STORAGE_KEY,
      JSON.stringify({ scope, documentId }),
    );
  } catch {
    // coercion-ok: without storage /home waits for the saved location.
  }
}
