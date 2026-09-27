import { randomUUID } from "node:crypto";

import {
  appStateCompareAndSet,
  appStateGet,
} from "@agent-native/core/application-state";
import {
  AGENT_CLIENT_ID,
  hasCollabState,
  loadAwarenessRowsStrict,
} from "@agent-native/core/collab";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

const FLUSH_POLL_INTERVAL_MS = 200;
const FLUSH_TIMEOUT_MS = 4000;

function parseAwarenessState(state: string): {
  canFlushDocument?: unknown;
  visible?: boolean;
  user?: { email?: unknown };
} | null {
  try {
    return JSON.parse(state) as {
      canFlushDocument?: unknown;
      visible?: boolean;
      user?: { email?: unknown };
    };
  } catch {
    return null;
  }
}

function awarenessFlushCandidate(entry: {
  clientId: number;
  state: string;
}): { sessionEmail: string | null; required: boolean } | null {
  if (entry.clientId === AGENT_CLIENT_ID) return null;
  const state = parseAwarenessState(entry.state);
  if (!state || state.visible === false || !state.user) return null;
  if (state.canFlushDocument !== true && state.canFlushDocument !== undefined) {
    return null;
  }
  const email = state.user.email;
  return {
    sessionEmail:
      typeof email === "string" && email.trim() ? email.trim() : null,
    required: state.canFlushDocument === true,
  };
}

export async function flushOpenDocumentEditorToSql(args: {
  documentId: string;
  ownerEmail?: string | null;
  propertyId?: string;
}) {
  if (!(await hasCollabState(args.documentId))) return;

  const awarenessRows = await loadAwarenessRowsStrict(args.documentId);
  const flushCandidates = awarenessRows
    .map(awarenessFlushCandidate)
    .filter((candidate): candidate is NonNullable<typeof candidate> => {
      return candidate !== null;
    });
  if (args.propertyId && flushCandidates.length > 0) {
    const exactCandidate = flushCandidates[0];
    if (
      flushCandidates.length !== 1 ||
      exactCandidate?.required !== true ||
      !exactCandidate.sessionEmail
    ) {
      throw new Error(
        "An exact fresh Blocks field value cannot be established while multiple or legacy editors are open.",
      );
    }
  }
  if (flushCandidates.length === 0) return;
  const acknowledgementRequired = flushCandidates.some(
    (candidate) => candidate.required,
  );
  const activeSessionEmails = flushCandidates
    .map((candidate) => candidate.sessionEmail)
    .filter((email): email is string => !!email);

  const flushKey = `flush-request-${args.documentId}`;
  const callerEmail = getRequestUserEmail() || undefined;
  const targetSessions = Array.from(
    new Set(
      (args.propertyId
        ? activeSessionEmails
        : [...activeSessionEmails, args.ownerEmail ?? undefined, callerEmail]
      ).filter((s): s is string => typeof s === "string" && s.length > 0),
    ),
  );
  if (targetSessions.length === 0) {
    if (!acknowledgementRequired) return;
    throw new Error("Could not identify the open document editor to flush.");
  }

  const requestId = randomUUID();
  const flushValue = {
    id: args.documentId,
    ts: Date.now(),
    requestId,
    ...(args.propertyId ? { propertyId: args.propertyId } : {}),
    status: "pending",
  };
  const writes = await Promise.allSettled(
    targetSessions.map(async (session) => {
      const deadline = Date.now() + FLUSH_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (
          await appStateCompareAndSet(session, flushKey, null, flushValue, {
            requestSource: "agent",
          })
        ) {
          return;
        }
        const occupied = await appStateGet(session, flushKey);
        if (
          occupied &&
          (occupied.status === "success" || occupied.status === "error") &&
          typeof occupied.ts === "number" &&
          Date.now() - occupied.ts >= FLUSH_TIMEOUT_MS
        ) {
          await appStateCompareAndSet(session, flushKey, occupied, null, {
            requestSource: "agent",
          });
        }
        await new Promise((resolve) =>
          setTimeout(resolve, FLUSH_POLL_INTERVAL_MS),
        );
      }
      throw new Error("Timed out waiting to request an open-editor flush.");
    }),
  );
  const writtenSessions = targetSessions.filter(
    (_session, index) => writes[index]?.status === "fulfilled",
  );
  if (writtenSessions.length === 0) {
    if (!acknowledgementRequired) return;
    throw new Error("Could not ask the open document editor to save.");
  }

  const deadline = Date.now() + FLUSH_TIMEOUT_MS;
  let flushError: string | null = null;
  let acknowledged = false;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, FLUSH_POLL_INTERVAL_MS));
    const reads = await Promise.allSettled(
      writtenSessions.map((session) => appStateGet(session, flushKey)),
    );
    const responses = reads.flatMap((result) =>
      result.status === "fulfilled" && result.value ? [result.value] : [],
    );
    const failed = responses.find(
      (
        value,
      ): value is {
        requestId: string;
        status: "error";
        error?: string;
      } => value.requestId === requestId && value.status === "error",
    );
    if (failed) {
      flushError =
        typeof failed.error === "string" && failed.error.trim()
          ? failed.error
          : "The live document could not be saved before syncing.";
      break;
    }
    acknowledged = responses.some(
      (value) => value.requestId === requestId && value.status === "success",
    );
    if (acknowledged) break;
  }

  await Promise.all(
    writtenSessions.map(async (session) => {
      try {
        const current = await appStateGet(session, flushKey);
        if (current?.requestId === requestId) {
          await appStateCompareAndSet(session, flushKey, current, null, {
            requestSource: "agent",
          });
        }
      } catch (error) {
        console.warn("Failed to clean up a document flush mailbox value", {
          error,
          flushKey,
          requestId,
          sessionEmail: session,
        });
      }
    }),
  );

  if (flushError) {
    throw new Error(flushError);
  }
  if (!acknowledged && acknowledgementRequired) {
    throw new Error(
      "The open document editor did not finish saving before sync timed out.",
    );
  }
}
