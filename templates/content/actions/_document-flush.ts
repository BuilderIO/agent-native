import { randomUUID } from "node:crypto";

import { ActionContractError } from "@agent-native/core";
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

import {
  claimedEditorSave,
  type ClaimedEditorSave,
} from "../shared/editor-save-state.js";
import {
  editorSaveIsInSql,
  readDocumentSaveRow,
} from "./_document-save-row.js";

const FLUSH_POLL_INTERVAL_MS = 200;
const FLUSH_TIMEOUT_MS = 4000;

// The flush mailbox is keyed by user session, not by tab, so "answered" means
// the session of that editor answered the request.
export type OpenEditorFlushOutcome =
  | { clientId: number; flush: "skipped_saved" }
  | { clientId: number; flush: "answered" }
  | { clientId: number; flush: "reported_saved" }
  | {
      clientId: number;
      flush: "unconfirmed";
      reason: "legacy_editor" | "another_session_answered";
    };

export type OpenEditorFlushResult =
  | { status: "no_open_editor" }
  | { status: "flushed"; editors: OpenEditorFlushOutcome[] };

type AwarenessState = {
  canFlushDocument?: unknown;
  visible?: boolean;
  user?: { email?: unknown };
  unsavedEdits?: unknown;
  savedRevision?: unknown;
  savedTitle?: unknown;
  savedTitleAt?: unknown;
};

function parseAwarenessState(state: string): AwarenessState | null {
  try {
    return JSON.parse(state) as AwarenessState;
  } catch {
    return null;
  }
}

type FlushCandidate = {
  clientId: number;
  sessionEmail: string | null;
  required: boolean;
  claimedSave: ClaimedEditorSave | null;
};

function awarenessFlushCandidate(entry: {
  clientId: number;
  state: string;
}): FlushCandidate | null {
  if (entry.clientId === AGENT_CLIENT_ID) return null;
  const state = parseAwarenessState(entry.state);
  if (!state || state.visible === false || !state.user) return null;
  if (state.canFlushDocument !== true && state.canFlushDocument !== undefined) {
    return null;
  }
  const email = state.user.email;
  const required = state.canFlushDocument === true;
  return {
    clientId: entry.clientId,
    sessionEmail:
      typeof email === "string" && email.trim() ? email.trim() : null,
    required,
    claimedSave: required ? claimedEditorSave(state) : null,
  };
}

function isFlushCandidate(
  candidate: FlushCandidate | null,
): candidate is FlushCandidate {
  return candidate !== null;
}

async function editorsSavedInSql(
  documentId: string,
  candidates: FlushCandidate[],
): Promise<Set<number>> {
  const claims = candidates.filter((candidate) => candidate.claimedSave);
  if (claims.length === 0) return new Set();
  const row = await readDocumentSaveRow(documentId);
  if (!row) return new Set();
  return new Set(
    claims
      .filter((candidate) => editorSaveIsInSql(row, candidate.claimedSave!))
      .map((candidate) => candidate.clientId),
  );
}

function flushFailure(
  errorCode: string,
  message: string,
  details: Record<string, unknown>,
): ActionContractError {
  return new ActionContractError(message, { errorCode, details });
}

export async function flushOpenDocumentEditorToSql(args: {
  documentId: string;
  ownerEmail?: string | null;
  propertyId?: string;
}): Promise<OpenEditorFlushResult> {
  if (!(await hasCollabState(args.documentId))) {
    return { status: "no_open_editor" };
  }

  const awarenessRows = await loadAwarenessRowsStrict(args.documentId);
  const flushCandidates = awarenessRows
    .map(awarenessFlushCandidate)
    .filter(isFlushCandidate);
  if (args.propertyId && flushCandidates.length > 0) {
    const exactCandidate = flushCandidates[0];
    if (
      flushCandidates.length !== 1 ||
      exactCandidate?.required !== true ||
      !exactCandidate.sessionEmail
    ) {
      throw flushFailure(
        "open_editor_field_ambiguous",
        "An exact fresh Blocks field value cannot be established while multiple or legacy editors are open.",
        { documentId: args.documentId, propertyId: args.propertyId },
      );
    }
  }
  if (flushCandidates.length === 0) return { status: "no_open_editor" };

  // A Blocks field keeps its own save state, so only whole-page requests can
  // trust what an editor reports about its saves.
  let savedInSql = args.propertyId
    ? new Set<number>()
    : await editorsSavedInSql(args.documentId, flushCandidates);
  const initiallySkipped = new Set(savedInSql);
  const requiredEditors = flushCandidates.filter(
    (candidate) => candidate.required,
  );
  const askedEditors = flushCandidates.filter(
    (candidate) => !savedInSql.has(candidate.clientId),
  );
  const outcomes = (
    resolve: (candidate: FlushCandidate) => OpenEditorFlushOutcome,
  ): OpenEditorFlushResult => ({
    status: "flushed",
    editors: flushCandidates.map((candidate) =>
      initiallySkipped.has(candidate.clientId) &&
      savedInSql.has(candidate.clientId)
        ? { clientId: candidate.clientId, flush: "skipped_saved" }
        : resolve(candidate),
    ),
  });
  const unconfirmed = (candidate: FlushCandidate): OpenEditorFlushOutcome => ({
    clientId: candidate.clientId,
    flush: "unconfirmed",
    reason: candidate.required ? "another_session_answered" : "legacy_editor",
  });
  if (askedEditors.length === 0) return outcomes(unconfirmed);

  const acknowledgementRequired = askedEditors.some(
    (candidate) => candidate.required,
  );
  const activeSessionEmails = askedEditors
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
    if (!acknowledgementRequired) return outcomes(unconfirmed);
    throw flushFailure(
      "open_editor_unidentified",
      "Could not identify the open document editor to flush.",
      { documentId: args.documentId },
    );
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
    if (!acknowledgementRequired) return outcomes(unconfirmed);
    throw flushFailure(
      "open_editor_flush_request_failed",
      "Could not ask the open document editor to save.",
      { documentId: args.documentId },
    );
  }

  // An editor answers through its session mailbox, or by saving on its own
  // and reporting that save, which the server checks against SQL again.
  const waitingEditors = requiredEditors.filter(
    (candidate) => candidate.required && !args.propertyId,
  );
  const answeredSessions = new Set<string>();
  const deadline = Date.now() + FLUSH_TIMEOUT_MS;
  let flushError: string | null = null;
  try {
    while (Date.now() < deadline) {
      await new Promise((resolve) =>
        setTimeout(resolve, FLUSH_POLL_INTERVAL_MS),
      );
      const reads = await Promise.allSettled(
        writtenSessions.map((session) => appStateGet(session, flushKey)),
      );
      for (const [index, result] of reads.entries()) {
        const value = result.status === "fulfilled" ? result.value : null;
        if (value?.requestId !== requestId) continue;
        if (value.status === "error" && flushError === null) {
          flushError =
            typeof value.error === "string" && value.error.trim()
              ? value.error
              : "The live document could not be saved before syncing.";
        } else if (value.status === "success") {
          answeredSessions.add(writtenSessions[index]!);
        }
      }
      if (flushError !== null || answeredSessions.size > 0) break;
      if (waitingEditors.length > 0) {
        const fresh = (await loadAwarenessRowsStrict(args.documentId))
          .map(awarenessFlushCandidate)
          .filter(isFlushCandidate)
          .filter((candidate) =>
            waitingEditors.some(
              (waiting) => waiting.clientId === candidate.clientId,
            ),
          );
        savedInSql = await editorsSavedInSql(args.documentId, fresh);
        if (
          waitingEditors.every((candidate) =>
            savedInSql.has(candidate.clientId),
          )
        ) {
          break;
        }
      }
    }
  } finally {
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
  }

  if (flushError !== null) {
    throw flushFailure("open_editor_flush_failed", flushError, {
      documentId: args.documentId,
    });
  }
  const resolved = (candidate: FlushCandidate): OpenEditorFlushOutcome => {
    if (candidate.sessionEmail && answeredSessions.has(candidate.sessionEmail))
      return { clientId: candidate.clientId, flush: "answered" };
    if (savedInSql.has(candidate.clientId))
      return { clientId: candidate.clientId, flush: "reported_saved" };
    return unconfirmed(candidate);
  };
  const settled =
    answeredSessions.size > 0 ||
    (waitingEditors.length > 0 &&
      waitingEditors.every((candidate) => savedInSql.has(candidate.clientId)));
  if (!settled && requiredEditors.length > 0) {
    throw flushFailure(
      "open_editor_flush_timeout",
      "The open document editor did not finish saving before sync timed out.",
      {
        documentId: args.documentId,
        waitingEditors: requiredEditors.map((candidate) => candidate.clientId),
      },
    );
  }
  return outcomes(resolved);
}
