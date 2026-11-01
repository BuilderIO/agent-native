import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const APPROVAL_KEY_HISTORY_PREFIX = "agent-tool-approval-key-sha256:";
const HASHED_APPROVAL_KEY_PATTERN =
  /^agent-tool-approval-key-sha256:[a-f0-9]{64}$/;
const SERVER_APPROVAL_ID_PATTERN =
  /^agent-tool-approval-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export const PRIVATE_APPROVAL_UNAVAILABLE = "[Private approval unavailable]";

export function approvalKeyForPrivateHistory(
  askId: unknown,
): string | undefined {
  return typeof askId === "string" && SERVER_APPROVAL_ID_PATTERN.test(askId)
    ? askId
    : undefined;
}

export function hashAgentToolApprovalKey(approvalKey: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(approvalKey)));
}

/**
 * An approval key bound to the arguments its call runs with, for a transport
 * that echoes the key back without a server-side approval record to check
 * them against.
 */
export function approvalKeyWithArguments(
  approvalKey: string,
  argumentsHash: string,
): string {
  return `${approvalKey}#arguments=${argumentsHash}`;
}

export function approvalKeyForHistory(approvalKey: string): string {
  if (HASHED_APPROVAL_KEY_PATTERN.test(approvalKey)) return approvalKey;
  return `${APPROVAL_KEY_HISTORY_PREFIX}${hashAgentToolApprovalKey(approvalKey)}`;
}
