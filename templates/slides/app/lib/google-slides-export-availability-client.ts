import { agentNativePath } from "@agent-native/core/client/api-path";
import { useQuery, type QueryClient } from "@tanstack/react-query";

export type GoogleSlidesExportAvailability =
  | { available: true }
  | { available: false; reason: "not-configured" | "oauth-rejected" };

export const GOOGLE_SLIDES_EXPORT_AVAILABILITY_KEY = [
  "slides",
  "google-slides-export-availability",
] as const;

const STALE_MS = 30_000;

type StatusBody = { googleSlidesExport?: GoogleSlidesExportAvailability };

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

export function fetchGoogleSlidesExportAvailability(
  queryClient: QueryClient,
): Promise<GoogleSlidesExportAvailability> {
  return queryClient
    .fetchQuery(availabilityQuery)
    .catch(() => ({ available: true }) as GoogleSlidesExportAvailability);
}

export function invalidateGoogleSlidesExportAvailability(
  queryClient: QueryClient,
): void {
  void queryClient.invalidateQueries({
    queryKey: GOOGLE_SLIDES_EXPORT_AVAILABILITY_KEY,
  });
}

export function useGoogleSlidesExportAvailability(
  enabled: boolean,
): GoogleSlidesExportAvailability {
  const { data } = useQuery({ ...availabilityQuery, enabled });
  return data ?? { available: true };
}
