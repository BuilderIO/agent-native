import { CLIP_SHARE_REF, REF_PARAM } from "./share-attribution.js";

/** Query params worth carrying from /share/:id over to /r/:id. */
const FORWARDED_PARAMS = ["t", "panel"] as const;

export interface DashboardRedirectInput {
  recordingId: string | null | undefined;
  /**
   * The server's `canOpenDirectRecordingPage` verdict, not a display role.
   * /r sends anyone it rejects back to /share, so a looser predicate here
   * bounces the viewer between the two routes forever.
   */
  canOpenDashboard: boolean;
  /** Current location search string, with or without the leading `?`. */
  search: string;
}

/**
 * Where a share-link visitor should be sent instead of rendering /share/:id,
 * or null to stay put.
 */
export function resolveDashboardRedirect(
  input: DashboardRedirectInput,
): string | null {
  if (!input.canOpenDashboard || !input.recordingId) return null;

  const params = new URLSearchParams(input.search);
  if (params.get(REF_PARAM) === CLIP_SHARE_REF) return null;

  const forwarded = new URLSearchParams();
  for (const key of FORWARDED_PARAMS) {
    const value = params.get(key);
    if (value) forwarded.set(key, value);
  }

  const query = forwarded.toString();
  return `/r/${encodeURIComponent(input.recordingId)}${query ? `?${query}` : ""}`;
}
