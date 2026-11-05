import { agentNativePath } from "@agent-native/core/client/api-path";
import { useQuery, type QueryClient } from "@tanstack/react-query";

export type GoogleSlidesExportAvailability =
  | { available: true }
  | { available: false; reason: "not-configured" | "oauth-rejected" };

export type GoogleSlidesExportState = GoogleSlidesExportAvailability & {
  connected: boolean;
};

export const GOOGLE_SLIDES_EXPORT_AVAILABILITY_KEY = [
  "slides",
  "google-slides-export-availability",
] as const;

const STALE_MS = 30_000;

const UNKNOWN_STATE: GoogleSlidesExportState = {
  available: true,
  connected: false,
};

type StatusBody = {
  connected?: boolean;
  googleSlidesExport?: GoogleSlidesExportAvailability;
};

async function readStatusBody(
  response: Response,
): Promise<{ body: StatusBody } | { unreadable: true }> {
  try {
    return { body: (await response.json()) as StatusBody };
  } catch {
    return { unreadable: true };
  }
}

async function load(): Promise<GoogleSlidesExportState> {
  const response = await fetch(
    new URL(
      agentNativePath("/_agent-native/google-docs/status"),
      window.location.origin,
    ),
    { credentials: "same-origin" },
  );
  const result = await readStatusBody(response);
  if ("unreadable" in result) return UNKNOWN_STATE;
  const connected = result.body?.connected === true;
  const reported = result.body?.googleSlidesExport;
  if (!reported || typeof reported.available !== "boolean") {
    return { available: true, connected };
  }
  return { ...reported, connected };
}

const availabilityQuery = {
  queryKey: GOOGLE_SLIDES_EXPORT_AVAILABILITY_KEY,
  queryFn: load,
  staleTime: STALE_MS,
} as const;

export function fetchGoogleSlidesExportAvailability(
  queryClient: QueryClient,
): Promise<GoogleSlidesExportState> {
  return queryClient.fetchQuery(availabilityQuery).catch(() => UNKNOWN_STATE);
}

export function invalidateGoogleSlidesExportAvailability(
  queryClient: QueryClient,
): void {
  void queryClient.invalidateQueries({
    queryKey: GOOGLE_SLIDES_EXPORT_AVAILABILITY_KEY,
  });
}

export async function disconnectGoogleDocs(
  queryClient: QueryClient,
): Promise<void> {
  const response = await fetch(
    new URL(
      agentNativePath("/_agent-native/google-docs/disconnect"),
      window.location.origin,
    ),
    { method: "POST", credentials: "same-origin" },
  );
  const body = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok || body.error || body.ok !== true) {
    throw new Error(
      body.error ?? `Request failed with status ${response.status}`,
    );
  }
  invalidateGoogleSlidesExportAvailability(queryClient);
}

export function useGoogleSlidesExportAvailability(
  enabled: boolean,
): GoogleSlidesExportState {
  const { data } = useQuery({ ...availabilityQuery, enabled });
  return data ?? UNKNOWN_STATE;
}
