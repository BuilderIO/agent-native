import { createHash } from "node:crypto";

const APPROVAL_KEY_HISTORY_PREFIX = "agent-tool-approval-key-sha256:";
const HASHED_APPROVAL_KEY_PATTERN =
  /^agent-tool-approval-key-sha256:[a-f0-9]{64}$/;

export function hashAgentToolApprovalKey(approvalKey: string): string {
  return createHash("sha256").update(approvalKey).digest("hex");
}

export function approvalKeyForHistory(approvalKey: string): string {
  if (HASHED_APPROVAL_KEY_PATTERN.test(approvalKey)) return approvalKey;
  return `${APPROVAL_KEY_HISTORY_PREFIX}${hashAgentToolApprovalKey(approvalKey)}`;
}
