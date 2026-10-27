import { z } from "zod";

// SQL/JSON datetime supports at most six fractional digits and 15:59 offsets.
const expiryDate = z.regexes.date.source.slice(1, -1);
const expiryTime = "(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d{1,6})?)?";
const expiryZone = "(?:Z|[+-](?:0\\d|1[0-5]):[0-5]\\d)?";
export const RECORDING_EXPIRY_PATTERN = new RegExp(
  `^${expiryDate}(?:T${expiryTime}${expiryZone})?$(?![\\s\\S])`,
);

export type RecordingPageAccessRole =
  | "owner"
  | "admin"
  | "editor"
  | "commenter"
  | "viewer";

export function isRecordingExpired(
  expiresAt: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!expiresAt) return false;

  const expires = new Date(expiresAt).getTime();
  return (
    !RECORDING_EXPIRY_PATTERN.test(expiresAt) ||
    !Number.isFinite(expires) ||
    expires < now
  );
}

export function isRecordingExpiredForViewer(input: {
  expiresAt: string | null | undefined;
  viewerIsOwner: boolean;
  now?: number;
}): boolean {
  return !input.viewerIsOwner && isRecordingExpired(input.expiresAt, input.now);
}

export function isRecordingTrashedForViewer(input: {
  trashedAt: string | null | undefined;
  viewerIsOwner: boolean;
}): boolean {
  return Boolean(input.trashedAt) && !input.viewerIsOwner;
}

/**
 * Decide whether an authenticated request may use the editor/player route.
 * Public visibility is intentionally a share-link concern; a direct `/r/*`
 * request must either be the owner or have an explicit share grant.
 * Password-protected recordings stay on the password-aware share flow for
 * every non-owner so the authenticated action cannot mint a bypass token.
 */
export function canOpenDirectRecordingPage(input: {
  role: RecordingPageAccessRole;
  visibility: "private" | "org" | "public";
  hasPassword: boolean;
  hasExplicitShare: boolean;
}): boolean {
  if (input.role === "owner") return true;
  if (input.hasPassword) return false;
  if (input.visibility === "public") return input.hasExplicitShare;
  return true;
}

export function canReceiveRecordingActivity(input: {
  ownerEmail: string;
  recipientEmail: string;
  hasPassword: boolean;
  expiresAt?: string | null;
  trashedAt?: string | null;
  now?: number;
}): boolean {
  const viewerIsOwner =
    Boolean(input.ownerEmail && input.recipientEmail) &&
    input.ownerEmail.trim().toLowerCase() ===
      input.recipientEmail.trim().toLowerCase();
  return (
    !isRecordingExpired(input.expiresAt, input.now) &&
    !isRecordingTrashedForViewer({
      trashedAt: input.trashedAt,
      viewerIsOwner,
    }) &&
    (!input.hasPassword || viewerIsOwner)
  );
}
