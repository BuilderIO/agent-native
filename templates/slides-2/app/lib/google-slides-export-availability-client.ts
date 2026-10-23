import { useQuery, type QueryClient } from "@tanstack/react-query";

import { getGoogleDocsStatus } from "./google-docs-client";

export type GoogleSlidesExportAvailability =
  | { available: true }
  | { available: false; reason: "not-configured" | "oauth-rejected" };

export const GOOGLE_SLIDES_EXPORT_AVAILABILITY_KEY = [
  "slides",
  "google-slides-export-availability",
] as const;

const STALE_MS = 30_000;

async function load(): Promise<GoogleSlidesExportAvailability> {
  const response = await getGoogleDocsStatus();
  if (response.unreadable) return { available: true };
  const reported = response.data?.googleSlidesExport;
  if (!reported || typeof reported.available !== "boolean") {
    return { available: true };
  }
  return reported as GoogleSlidesExportAvailability;
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
