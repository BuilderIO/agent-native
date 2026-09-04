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
  // New clients publish an exact boolean. `false` is a known read-only viewer
  // and must never block. A missing field is a pre-deploy client which may be
  // an editor, so offer it the old handshake on a best-effort basis. Invalid
  // values are neither a trustworthy editor capability nor a legacy omission.
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
}) {
  // If a live Yjs collab session is open, the in-memory editor doc is fresher
  // than the SQL column. Ask the open editor to serialize + save, then wait
  // for an explicit request-id-matched acknowledgement.
  if (!(await hasCollabState(args.documentId))) return;

  // Persisted Yjs state outlives browser tabs. Modern clients distinguish
  // editors (`true`) from viewers (`false`), so only the former are a hard
  // freshness barrier. Pre-deploy tabs omit the field; they still know how to
  // service this request, but may also be legacy viewers, so offer them the
  // bounded handshake without failing if they stay silent. This preserves live
  // legacy editor changes without making viewer-only tabs time out sync actions.
  const awarenessRows = await loadAwarenessRowsStrict(args.documentId);
  const flushCandidates = awarenessRows
    .map(awarenessFlushCandidate)
    .filter((candidate): candidate is NonNullable<typeof candidate> => {
      return candidate !== null;
    });
  if (flushCandidates.length === 0) return;
  const acknowledgementRequired = flushCandidates.some(
    (candidate) => candidate.required,
  );
  const activeSessionEmails = flushCandidates
    .map((candidate) => candidate.sessionEmail)
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
    if (!acknowledgementRequired) return;
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
  if (!acknowledged && acknowledgementRequired) {
    throw new Error(
      "The open document editor did not finish saving before sync timed out.",
    );
  }
}
