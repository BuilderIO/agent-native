import { z } from "zod";

// PostgreSQL datetime offsets stop at 15:59; legacy reads must agree with search.
export const RECORDING_EXPIRY_PATTERN = new RegExp(
  `^(?!.*[+-](?:1[6-9]|2[0-3]):[0-5]\\d$)(?:${z.regexes.date.source}|${z.regexes.datetime({ offset: true, local: true }).source})$(?![\\s\\S])`,
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
