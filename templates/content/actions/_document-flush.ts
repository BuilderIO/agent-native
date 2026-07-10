import { randomUUID } from "node:crypto";

import {
  appStateDelete,
  appStateGet,
  appStatePut,
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
  canFlushDocument?: boolean;
  visible?: boolean;
  user?: { email?: unknown };
} | null {
  try {
    return JSON.parse(state) as {
      canFlushDocument?: boolean;
      visible?: boolean;
      user?: { email?: unknown };
    };
  } catch {
    return null;
  }
}

function awarenessSessionEmail(entry: {
  clientId: number;
  state: string;
}): string | null {
  if (entry.clientId === AGENT_CLIENT_ID) return null;
  const state = parseAwarenessState(entry.state);
  if (!state || state.visible === false || !state.user) return null;
  const email = state.user.email;
  return typeof email === "string" && email.trim() ? email.trim() : null;
}

function isActiveFlushCapableAwareness(entry: {
  clientId: number;
  state: string;
}): boolean {
  if (entry.clientId === AGENT_CLIENT_ID) return false;
  const state = parseAwarenessState(entry.state);
  return (
    !!state?.user && state.visible !== false && state.canFlushDocument === true
  );
}

export async function flushOpenDocumentEditorToSql(args: {
  documentId: string;
  ownerEmail?: string | null;
}) {
  // If a live Yjs collab session is open, the in-memory editor doc is fresher
  // than the SQL column. Ask the open editor to serialize + save, then wait
  // for an explicit request-id-matched acknowledgement.
  if (!(await hasCollabState(args.documentId))) return;

  // Persisted Yjs state outlives browser tabs. Only require a handshake while
  // at least one non-expired human awareness row explicitly says its editor can
  // service the flush request. Viewers also publish awareness so they can see
  // live cursors, but their read-only editor never polls this request. Treating
  // viewer presence as a blocker would make pull/push/conflict actions time out
  // even though SQL is already their authoritative snapshot.
  const awarenessRows = await loadAwarenessRowsStrict(args.documentId);
  const flushCapableRows = awarenessRows.filter(isActiveFlushCapableAwareness);
  if (flushCapableRows.length === 0) return;
  const activeSessionEmails = flushCapableRows
    .map(awarenessSessionEmail)
    .filter((email): email is string => !!email);

  const flushKey = `flush-request-${args.documentId}`;
  // The editor polls `flush-request-<id>` via the framework app-state route,
  // which scopes reads to the logged-in browser user. Target every active
  // collaborator email plus owner/caller fallbacks so shared editors and
  // cross-instance actions reach the tab that can serialize the live Y.Doc.
  const callerEmail = getRequestUserEmail() || undefined;
  const targetSessions = Array.from(
    new Set(
      [
        ...activeSessionEmails,
        args.ownerEmail ?? undefined,
        callerEmail,
      ].filter((s): s is string => typeof s === "string" && s.length > 0),
    ),
  );
  if (targetSessions.length === 0) {
    throw new Error("Could not identify the open document editor to flush.");
  }

  const requestId = randomUUID();
  const flushValue = {
    id: args.documentId,
    ts: Date.now(),
    requestId,
    status: "pending",
  };
  const writes = await Promise.allSettled(
    targetSessions.map((session) =>
      appStatePut(session, flushKey, flushValue, {
        requestSource: "agent",
      }),
    ),
  );
  const writtenSessions = targetSessions.filter(
    (_session, index) => writes[index]?.status === "fulfilled",
  );
  if (writtenSessions.length === 0) {
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

  // Best-effort cleanup after success, explicit failure, or timeout.
  await Promise.all(
    writtenSessions.map((session) =>
      appStateDelete(session, flushKey, { requestSource: "agent" }).catch(
        () => {},
      ),
    ),
  );

  if (flushError) {
    throw new Error(flushError);
  }
  if (!acknowledged) {
    throw new Error(
      "The open document editor did not finish saving before sync timed out.",
    );
  }
}
