import { SLIDES_2_APP_ID } from "./app-state-tabs";

export const SLIDES_ACCESS_REQUEST_TOKEN_PREFIX = `${SLIDES_2_APP_ID}:access-request`;
export const SLIDES_ACCESS_REQUEST_FALLBACK_TOKEN_PREFIX = `${SLIDES_2_APP_ID}:access-request-fallback`;
export const SLIDES_ACCESS_REQUEST_TOKEN_TTL_SECONDS = 10 * 60;
export const SLIDES_ACCESS_REQUEST_NOTE_MAX_LENGTH = 500;

export const SLIDES_ACCESS_APPROVAL_TOKEN_PREFIX = `${SLIDES_2_APP_ID}:access-approval`;
export const SLIDES_ACCESS_APPROVAL_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
export const SLIDES_ACCESS_APPROVAL_SESSION_KEY_PREFIX = `${SLIDES_2_APP_ID}:access-approval-token:`;

export function deckAccessApprovalPath(
  deckId: string,
  approvalToken: string,
): string {
  const params = new URLSearchParams({ deckId, token: approvalToken });
  return `/access-request/approve?${params.toString()}`;
}

export function deckAccessApprovalContinuationPath(deckId: string): string {
  return `/access-request/approve?${new URLSearchParams({ deckId }).toString()}`;
}

export function deckAccessApprovalSessionKey(deckId: string): string {
  return `${SLIDES_ACCESS_APPROVAL_SESSION_KEY_PREFIX}${encodeURIComponent(deckId)}`;
}
