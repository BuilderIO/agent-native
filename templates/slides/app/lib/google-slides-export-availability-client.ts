import { agentNativePath } from "@agent-native/core/client/api-path";
import { useQuery, type QueryClient } from "@tanstack/react-query";

export type GoogleSlidesExportAvailability =
  | { available: true }
  | { available: false; reason: "not-configured" | "oauth-rejected" };

export type GoogleSlidesExportState = GoogleSlidesExportAvailability & {
  disconnectable: boolean;
};

export const GOOGLE_SLIDES_EXPORT_AVAILABILITY_KEY = [
  "slides",
  "google-slides-export-availability",
] as const;

const STALE_MS = 30_000;

const UNKNOWN_STATE: GoogleSlidesExportState = {
  available: true,
  disconnectable: false,
};

type StatusBody = {
  disconnectable?: boolean;
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
  if (!response.ok) {
    throw new Error(`Google Slides status check failed (${response.status}).`);
  }
  const result = await readStatusBody(response);
  if ("unreadable" in result) return UNKNOWN_STATE;
  const disconnectable = result.body?.disconnectable === true;
  const reported = result.body?.googleSlidesExport;
  if (!reported || typeof reported.available !== "boolean") {
    return { available: true, disconnectable };
  }
  return { ...reported, disconnectable };
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
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  const body = (await response.json()) as { ok?: boolean; error?: string };
  if (body.error || body.ok !== true) {
    throw new Error(
      body.error ?? "Google Drive did not confirm the disconnect.",
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
