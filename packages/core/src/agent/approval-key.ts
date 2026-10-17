import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const APPROVAL_KEY_HISTORY_PREFIX = "agent-tool-approval-key-sha256:";
const HASHED_APPROVAL_KEY_PATTERN =
  /^agent-tool-approval-key-sha256:[a-f0-9]{64}$/;

export function hashAgentToolApprovalKey(approvalKey: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(approvalKey)));
}

export function approvalKeyForHistory(approvalKey: string): string {
  if (HASHED_APPROVAL_KEY_PATTERN.test(approvalKey)) return approvalKey;
  return `${APPROVAL_KEY_HISTORY_PREFIX}${hashAgentToolApprovalKey(approvalKey)}`;
}
