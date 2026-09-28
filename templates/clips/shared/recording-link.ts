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

export const CLIPS_ACCESS_REQUEST_TOKEN_PREFIX = "clips-access-request";
export const CLIPS_ACCESS_REQUEST_TOKEN_TTL_SECONDS = 10 * 60;

export const CLIPS_ACCESS_APPROVAL_TOKEN_PREFIX = "clips-access-approval";
export const CLIPS_ACCESS_APPROVAL_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
export const CLIPS_ACCESS_APPROVAL_SESSION_KEY_PREFIX =
  "clips-access-approval-token:";

export function recordingSharePath(recordingId: string): string {
  return `/share/${encodeURIComponent(recordingId)}`;
}

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

export function recordingAccessApprovalContinuationPath(
  recordingId: string,
): string {
  const params = new URLSearchParams({ recordingId });
  return `/access-request/approve?${params.toString()}`;
}

export function recordingAccessApprovalSessionKey(recordingId: string): string {
  return `${CLIPS_ACCESS_APPROVAL_SESSION_KEY_PREFIX}${encodeURIComponent(recordingId)}`;
}

export interface RecordingShareUrlParams {
  recordingId: string;
  origin: string;
  basePath?: string;
  ownerId?: string | null;
}

export function buildRecordingShareUrl(
  params: RecordingShareUrlParams,
): string {
  const { recordingId, origin, basePath = "", ownerId } = params;
  const trimmedOrigin = origin.trim().replace(/\/+$/, "");
  const trimmedBase = basePath.trim().replace(/\/+$/, "");
  const url = `${trimmedOrigin}${trimmedBase}${recordingSharePath(recordingId)}`;
  return withShareAttribution(url, ownerId);
}
