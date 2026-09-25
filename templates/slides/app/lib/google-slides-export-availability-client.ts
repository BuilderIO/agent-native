import { agentNativePath } from "@agent-native/core/client/api-path";
import { useQuery, type QueryClient } from "@tanstack/react-query";

export type GoogleSlidesExportAvailability =
  | { available: true }
  | { available: false; reason: "not-configured" | "oauth-rejected" };

/**
 * The verdict is computed from the caller's organization-scoped Google
 * credentials, and this app mounts `OrgSwitcher`, so it can change while the
 * page stays up. It lives in React Query specifically so the
 * `invalidateQueries()` that `useSwitchOrg` already fires reaches it — a
 * module-local cache would silently outlive the credentials it was derived
 * from, keyed to nothing.
 */
export const GOOGLE_SLIDES_EXPORT_AVAILABILITY_KEY = [
  "slides",
  "google-slides-export-availability",
] as const;

/** Repairing the Google client is server-side and raises no client event. */
const STALE_MS = 30_000;

type StatusBody = { googleSlidesExport?: GoogleSlidesExportAvailability };

/** `unreadable` is kept distinct from a body that simply carries no verdict. */
async function readStatusBody(
  response: Response,
): Promise<{ body: StatusBody } | { unreadable: true }> {
  try {
    return { body: (await response.json()) as StatusBody };
  } catch {
    return { unreadable: true };
  }
}

async function load(): Promise<GoogleSlidesExportAvailability> {
  const response = await fetch(
    new URL(
      agentNativePath("/_agent-native/google-docs/status"),
      window.location.origin,
    ),
    { credentials: "same-origin" },
  );
  const result = await readStatusBody(response);
  // No verdict is not the same as a negative one. An older server, an auth
  // error, or an unreadable body says nothing about the integration, and
  // hiding a working export on that basis would be worse than the bug this
  // gate exists to prevent.
  if ("unreadable" in result) return { available: true };
  const reported = result.body?.googleSlidesExport;
  if (!reported || typeof reported.available !== "boolean") {
    return { available: true };
  }
  return reported;
}

const availabilityQuery = {
  queryKey: GOOGLE_SLIDES_EXPORT_AVAILABILITY_KEY,
  queryFn: load,
  staleTime: STALE_MS,
} as const;

/**
 * Resolves the verdict the export must obey. Reads through the same cache the
 * badge renders from, so a click that lands before the first response still
 * waits for the real answer instead of the optimistic default.
 */
export function fetchGoogleSlidesExportAvailability(
  queryClient: QueryClient,
): Promise<GoogleSlidesExportAvailability> {
  return queryClient
    .fetchQuery(availabilityQuery)
    .catch(() => ({ available: true }) as GoogleSlidesExportAvailability);
}

/**
 * Call after a Google Slides export fails at runtime: the failure is evidence
 * the cached "available" answer may be stale, but not proof of it, so this
 * re-checks rather than assuming the integration is broken.
 */
export function invalidateGoogleSlidesExportAvailability(
  queryClient: QueryClient,
): void {
  void queryClient.invalidateQueries({
    queryKey: GOOGLE_SLIDES_EXPORT_AVAILABILITY_KEY,
  });
}

/**
 * `enabled` keeps the probe off the deck editor's load path: the answer is only
 * needed once an export menu is open, which is still long before anyone clicks.
 */
export function useGoogleSlidesExportAvailability(
  enabled: boolean,
): GoogleSlidesExportAvailability {
  const { data } = useQuery({ ...availabilityQuery, enabled });
  // Optimistic until the first response: rendering the item disabled on every
  // menu open would be its own bug. The click path awaits the real verdict.
  return data ?? { available: true };
}
