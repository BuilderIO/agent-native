import { fail } from "@agent-native/core/action";
import {
  compareAndSetAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";

import {
  isAiRequestLive,
  type ClipsAiRequestKind,
  type ClipsAiRequestStatus,
} from "../../shared/ai-request-status.js";

const STATUS_KEY_PREFIX = "clips-ai-request-status-";
const REQUEST_KEY_PREFIX = "clips-ai-request-";
export const AI_REQUEST_CLAIM_LEASE_MS = 30_000;

export function aiRequestStatusKey(recordingId: string): string {
  return `${STATUS_KEY_PREFIX}${recordingId}`;
}

export function aiRequestKey(recordingId: string): string {
  return `${REQUEST_KEY_PREFIX}${recordingId}`;
}

export interface AiRequestIdentity {
  recordingId: string;
  kind: ClipsAiRequestKind;
  requestedAt: string;
}

function matchesIdentity(
  value: Record<string, unknown> | null,
  identity: AiRequestIdentity,
): value is Record<string, unknown> {
  return (
    !!value &&
    value.kind === identity.kind &&
    value.requestedAt === identity.requestedAt
  );
}

export function withAiRequestStatusInstructions({
  message,
  recordingId,
  kind,
  requestedAt,
}: {
  message: string;
  recordingId: string;
  kind: ClipsAiRequestKind;
  requestedAt: string;
}): string {
  const statusCommand =
    `update-ai-request-status --recordingId=${recordingId} --kind=${kind} ` +
    `--requestedAt="${requestedAt}"`;

  return (
    `${message} ` +
    `Before starting, call \`${statusCommand} --status=working\`. ` +
    `After every requested change finishes, call \`${statusCommand} --status=completed --message="<short result>"\`. ` +
    `If the work cannot finish, call \`${statusCommand} --status=failed --message="<what went wrong>"\`. ` +
    `Do not leave the request in working state after you finish.`
  );
}

function failBusy(): never {
  fail(
    "This clip is already being processed. Wait for the current request to finish.",
    { errorCode: "request_busy", statusCode: 409 },
  );
}

export async function queueAiRequest({
  recordingId,
  kind,
  requestedAt,
  request,
}: AiRequestIdentity & {
  request: Record<string, unknown>;
}): Promise<void> {
  const statusKey = aiRequestStatusKey(recordingId);
  const previous = await readAppState(statusKey);
  if (isAiRequestLive(previous as ClipsAiRequestStatus | null)) failBusy();
  const queued = {
    kind,
    status: "queued",
    message: null,
    requestedAt,
    updatedAt: requestedAt,
  };
  if (!(await compareAndSetAppState(statusKey, previous, queued))) failBusy();

  try {
    await writeAppState(aiRequestKey(recordingId), request as any);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The request could not be queued.";
    await writeAppState(statusKey, {
      kind,
      status: "failed",
      message,
      requestedAt,
      updatedAt: new Date().toISOString(),
    });
    throw error;
  }

  try {
    await writeAppState("refresh-signal", { ts: Date.now() });
  } catch (error) {
    console.warn("[clips] failed to publish AI request refresh signal", {
      recordingId,
      kind,
      error,
    });
  }
}

export type ClaimAiRequestResult =
  | { claimed: true }
  | { claimed: false; reason: "missing" | "claimed" | "conflict" };

export async function claimAiRequest(
  identity: AiRequestIdentity,
  now = Date.now(),
): Promise<ClaimAiRequestResult> {
  const key = aiRequestKey(identity.recordingId);
  const current = await readAppState(key);
  if (!matchesIdentity(current, identity)) {
    return { claimed: false, reason: "missing" };
  }
  const claimedAt = Date.parse(String(current.claimedAt ?? ""));
  if (
    Number.isFinite(claimedAt) &&
    now - claimedAt < AI_REQUEST_CLAIM_LEASE_MS
  ) {
    return { claimed: false, reason: "claimed" };
  }
  const next = { ...current, claimedAt: new Date(now).toISOString() };
  return (await compareAndSetAppState(key, current, next))
    ? { claimed: true }
    : { claimed: false, reason: "conflict" };
}

export async function releaseAiRequest(
  identity: AiRequestIdentity,
): Promise<boolean> {
  const key = aiRequestKey(identity.recordingId);
  const current = await readAppState(key);
  if (!matchesIdentity(current, identity) || !("claimedAt" in current)) {
    return false;
  }
  const { claimedAt: _claimedAt, ...next } = current;
  return compareAndSetAppState(key, current, next);
}

/**
 * Removes a started request and moves its status from `queued` to `working`,
 * so a status that stays `queued` always means no tab ever started it.
 */
export async function consumeAiRequest(
  identity: AiRequestIdentity,
): Promise<boolean> {
  const key = aiRequestKey(identity.recordingId);
  const current = await readAppState(key);
  if (!matchesIdentity(current, identity)) return false;
  if (!(await compareAndSetAppState(key, current, null))) return false;

  const statusKey = aiRequestStatusKey(identity.recordingId);
  const status = await readAppState(statusKey);
  if (matchesIdentity(status, identity) && status.status === "queued") {
    await compareAndSetAppState(statusKey, status, {
      ...status,
      status: "working",
      updatedAt: new Date().toISOString(),
    });
  }
  return true;
}

/**
 * Writes a terminal status only while the same request is still queued or
 * working; a newer request or an agent-reported result always wins.
 */
export async function settleAiRequestStatus(
  identity: AiRequestIdentity,
  status: "completed" | "failed" | "cancelled",
  message: string | null,
): Promise<boolean> {
  const statusKey = aiRequestStatusKey(identity.recordingId);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readAppState(statusKey);
    if (
      !matchesIdentity(current, identity) ||
      !["queued", "working"].includes(String(current.status))
    ) {
      return false;
    }
    const next = {
      kind: identity.kind,
      status,
      message,
      requestedAt: identity.requestedAt,
      updatedAt: new Date().toISOString(),
    };
    if (await compareAndSetAppState(statusKey, current, next)) return true;
  }
  return false;
}
