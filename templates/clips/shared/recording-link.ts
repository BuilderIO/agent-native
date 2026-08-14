/**
 * Canonical share URL for a recording, shared by every surface that hands a
 * user a link to paste: the web recorder, the desktop app, and the Chrome
 * extension.
 *
 * `/share/<id>` is the public viewer page — SSR-rendered, password/expiry
 * aware, and the shape Slack unfurls. `/r/<id>` is the owner dashboard: it
 * renders client-side only and shows a sign-in prompt to a recipient. Copying
 * `/r/<id>` produces a link that works for the author and looks broken to
 * everyone they send it to, so share flows must build URLs from here rather
 * than hand-rolling a path.
 */
import { withShareAttribution } from "./share-attribution";

/** Short-lived capability used by a private share viewer to request access. */
export const CLIPS_ACCESS_REQUEST_TOKEN_PREFIX = "clips-access-request";
export const CLIPS_ACCESS_REQUEST_TOKEN_TTL_SECONDS = 10 * 60;

/** Signed capability embedded in the owner's access-request email. */
export const CLIPS_ACCESS_APPROVAL_TOKEN_PREFIX = "clips-access-approval";
export const CLIPS_ACCESS_APPROVAL_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Public share path for a recording, relative to the app base path. */
export function recordingSharePath(recordingId: string): string {
  return `/share/${encodeURIComponent(recordingId)}`;
}

/** Owner-only route used by the one-click approval button in access emails. */
export function recordingAccessApprovalPath(
  recordingId: string,
  approvalToken: string,
): string {
  const params = new URLSearchParams({
    recordingId,
    token: approvalToken,
  });
  return `/access-request/approve?${params.toString()}`;
}

export interface RecordingShareUrlParams {
  recordingId: string;
  /** Absolute origin, e.g. `https://clips.example.com` or a desktop serverUrl. */
  origin: string;
  /** App base path when the app is mounted under a subpath. */
  basePath?: string;
  /** Non-PII owner id for viral attribution. Omitted when unknown. */
  ownerId?: string | null;
}

/**
 * Absolute, ready-to-paste share URL for a recording, carrying the same
 * attribution params the Share dialog mints so auto-copied links measure the
 * signup funnel identically.
 */
export function buildRecordingShareUrl(
  params: RecordingShareUrlParams,
): string {
  const { recordingId, origin, basePath = "", ownerId } = params;
  const trimmedOrigin = origin.trim().replace(/\/+$/, "");
  const trimmedBase = basePath.trim().replace(/\/+$/, "");
  const url = `${trimmedOrigin}${trimmedBase}${recordingSharePath(recordingId)}`;
  return withShareAttribution(url, ownerId);
}
