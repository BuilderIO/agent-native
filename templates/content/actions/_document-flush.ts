import { randomUUID } from "node:crypto";

import { ActionContractError } from "@agent-native/core/action";
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
  isLiveBodyWriterPage,
  liveBodyWriterPageIds,
} from "../server/lib/live-body-writer.js";

const FLUSH_POLL_INTERVAL_MS = 200;
const FLUSH_TIMEOUT_MS = 4000;
const TITLE_FLUSH_PLAN_CONCURRENCY = 10;

// A wait that ends at the deadline rather than a poll interval past it.
function pollWait(deadline: number) {
  return new Promise((resolve) =>
    setTimeout(
      resolve,
      Math.max(0, Math.min(FLUSH_POLL_INTERVAL_MS, deadline - Date.now())),
    ),
  );
}

/**
 * What a switched page's open editors answered when asked to save its title.
 * `unconfirmed` names pages with an open editor too old to be asked: callers
 * go ahead on it and pass it on, never as `flushed`.
 */
export type OpenEditorTitleFlush =
  | { status: "flushed" }
  | { status: "no_open_editor" }
  | { status: "unconfirmed"; reason: "legacy_editor"; documentIds: string[] }
  | {
      status: "failed";
      reason: "timeout" | "editor_error" | "request_not_delivered";
      documentId: string;
      code?: string;
      error?: string;
    };

type OpenEditorTitleFlushFailure = Extract<
  OpenEditorTitleFlush,
  { status: "failed" }
>;

export type OpenEditorTitleFlushProceed = Exclude<
  OpenEditorTitleFlush,
  { status: "failed" }
>;

function parseAwarenessState(state: string): {
  canFlushDocument?: unknown;
  canFlushTitle?: unknown;
  visible?: boolean;
  user?: { email?: unknown };
} | null {
  try {
    return JSON.parse(state) as {
      canFlushDocument?: unknown;
      canFlushTitle?: unknown;
      visible?: boolean;
      user?: { email?: unknown };
    };
  } catch {
    return null;
  }
}

function awarenessSessionEmail(email: unknown): string | null {
  return typeof email === "string" && email.trim() ? email.trim() : null;
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
  return {
    sessionEmail: awarenessSessionEmail(state.user.email),
    required: state.canFlushDocument === true,
  };
}

function awarenessTitleFlushCandidate(entry: {
  clientId: number;
  state: string;
}): { sessionEmail: string | null; canFlushTitle: boolean } | null {
  if (entry.clientId === AGENT_CLIENT_ID) return null;
  const state = parseAwarenessState(entry.state);
  if (!state || state.visible === false || !state.user) return null;
  // An editor that can't edit advertises both as false; one too old to know
  // the title flush leaves canFlushTitle out.
  if (state.canFlushTitle === false) return null;
  if (
    state.canFlushTitle !== true &&
    state.canFlushDocument !== true &&
    state.canFlushDocument !== undefined
  ) {
    return null;
  }
  return {
    sessionEmail: awarenessSessionEmail(state.user.email),
    canFlushTitle: state.canFlushTitle === true,
  };
}

/** Writes a flush request into a session's mailbox; false if it stays occupied until the deadline. */
async function deliverFlushRequest(
  session: string,
  flushKey: string,
  flushValue: Record<string, unknown>,
  deadline: number,
): Promise<boolean> {
  while (Date.now() < deadline) {
    if (
      await appStateCompareAndSet(session, flushKey, null, flushValue, {
        requestSource: "agent",
      })
    ) {
      return true;
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
    await pollWait(deadline);
  }
  return false;
}

async function clearFlushRequests(
  sessions: readonly string[],
  flushKey: string,
  requestId: string,
) {
  await Promise.all(
    sessions.map(async (session) => {
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

type TitleFlushPlan = {
  documentId: string;
  sessions: string[];
  legacyEditor: boolean;
  unaddressedEditor: boolean;
};

async function planTitleFlush(
  documentId: string,
): Promise<TitleFlushPlan | null> {
  const candidates = (await loadAwarenessRowsStrict(documentId))
    .map(awarenessTitleFlushCandidate)
    .filter((candidate): candidate is NonNullable<typeof candidate> => {
      return candidate !== null;
    });
  if (candidates.length === 0) return null;
  // The mailbox holds one request per session, so a session with any tab
  // too old for the title flush gets none: that tab would run a whole save.
  const legacySessions = new Set<string>();
  let legacyEditor = false;
  for (const candidate of candidates) {
    if (candidate.canFlushTitle) continue;
    legacyEditor = true;
    if (candidate.sessionEmail) legacySessions.add(candidate.sessionEmail);
  }
  const sessions = new Set<string>();
  let unaddressedEditor = false;
  for (const candidate of candidates) {
    if (!candidate.canFlushTitle) continue;
    if (!candidate.sessionEmail) unaddressedEditor = true;
    else if (!legacySessions.has(candidate.sessionEmail)) {
      sessions.add(candidate.sessionEmail);
    }
  }
  return {
    documentId,
    sessions: [...sessions],
    legacyEditor,
    unaddressedEditor,
  };
}

async function requestTitleSave(
  plan: TitleFlushPlan,
  deadline: number,
): Promise<OpenEditorTitleFlushFailure | null> {
  const { documentId } = plan;
  if (plan.unaddressedEditor) {
    return { status: "failed", reason: "request_not_delivered", documentId };
  }
  if (Date.now() >= deadline) {
    return { status: "failed", reason: "timeout", documentId };
  }
  const flushKey = `flush-request-${documentId}`;
  const requestId = randomUUID();
  const flushValue = {
    id: documentId,
    ts: Date.now(),
    requestId,
    scope: "title",
    status: "pending",
  };
  try {
    const delivered = await Promise.allSettled(
      plan.sessions.map((session) =>
        deliverFlushRequest(session, flushKey, flushValue, deadline),
      ),
    );
    for (const delivery of delivered) {
      if (delivery.status === "rejected") {
        console.error("Failed to ask an open editor to save a page title", {
          error: delivery.reason,
          documentId,
          requestId,
        });
      }
    }
    if (
      delivered.some(
        (delivery) => delivery.status === "rejected" || !delivery.value,
      )
    ) {
      return { status: "failed", reason: "request_not_delivered", documentId };
    }
    while (Date.now() < deadline) {
      await pollWait(deadline);
      const responses = await Promise.all(
        plan.sessions.map((session) => appStateGet(session, flushKey)),
      );
      let saved = 0;
      for (const response of responses) {
        if (response?.requestId !== requestId) continue;
        if (response.status === "error") {
          return {
            status: "failed",
            reason: "editor_error",
            documentId,
            ...(typeof response.code === "string"
              ? { code: response.code }
              : {}),
            ...(typeof response.error === "string" && response.error.trim()
              ? { error: response.error }
              : {}),
          };
        }
        if (response.status === "success") saved += 1;
      }
      if (saved === plan.sessions.length) return null;
    }
    return { status: "failed", reason: "timeout", documentId };
  } finally {
    // A delivery that threw may still have written the request; this clears
    // only this request's.
    await clearFlushRequests(plan.sessions, flushKey, requestId);
  }
}

async function saveLiveBodyPageTitles(
  documentIds: readonly string[],
): Promise<OpenEditorTitleFlush> {
  const deadline = Date.now() + FLUSH_TIMEOUT_MS;
  const plans: TitleFlushPlan[] = [];
  for (
    let offset = 0;
    offset < documentIds.length;
    offset += TITLE_FLUSH_PLAN_CONCURRENCY
  ) {
    // A page whose editors weren't read in time may have one open.
    if (Date.now() >= deadline) {
      return {
        status: "failed",
        reason: "timeout",
        documentId: documentIds[offset]!,
      };
    }
    const group = documentIds.slice(
      offset,
      offset + TITLE_FLUSH_PLAN_CONCURRENCY,
    );
    for (const plan of await Promise.all(group.map(planTitleFlush))) {
      if (plan) plans.push(plan);
    }
  }
  if (plans.length === 0) return { status: "no_open_editor" };
  const asked = await Promise.allSettled(
    plans
      .filter((plan) => plan.sessions.length > 0 || plan.unaddressedEditor)
      .map((plan) => requestTitleSave(plan, deadline)),
  );
  const failures = asked.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
  const failure = failures.find((result) => result !== null);
  if (failure) return failure;
  const unconfirmed = plans
    .filter((plan) => plan.legacyEditor)
    .map((plan) => plan.documentId);
  if (unconfirmed.length > 0) {
    return {
      status: "unconfirmed",
      reason: "legacy_editor",
      documentIds: unconfirmed,
    };
  }
  return { status: "flushed" };
}

/**
 * Asks the open editors of the pages that take body writes through their
 * live copy to save their titles, under one deadline. Their bodies need no
 * save: each tab's commit already wrote it. Undefined when none of the pages
 * does, so the caller stays on main's path.
 */
export async function saveOpenEditorTitles(
  documentIds: readonly string[],
): Promise<OpenEditorTitleFlush | undefined> {
  const liveBodyIds = await liveBodyWriterPageIds(documentIds);
  if (liveBodyIds.size === 0) return undefined;
  return saveLiveBodyPageTitles(
    documentIds.filter((id) => liveBodyIds.has(id)),
  );
}

function openEditorTitleNotSavedMessage(flush: OpenEditorTitleFlushFailure) {
  switch (flush.reason) {
    case "timeout":
      return `An open editor didn't confirm in time that it saved the title of page ${flush.documentId}.`;
    case "editor_error":
      return `An open editor couldn't save the title of page ${flush.documentId}${flush.error ? `: ${flush.error}` : "."}`;
    case "request_not_delivered":
      return `Couldn't ask the open editor of page ${flush.documentId} to save its title.`;
  }
}

/** Refuses on a title an open editor didn't confirm it saved; nothing has been written yet, so the caller can retry. */
export function assertOpenEditorTitlesSaved(
  flush: OpenEditorTitleFlush,
): OpenEditorTitleFlushProceed {
  if (flush.status !== "failed") return flush;
  throw new ActionContractError(
    `${openEditorTitleNotSavedMessage(flush)} Nothing changed; try again.`,
    {
      errorCode: "OPEN_EDITOR_TITLE_NOT_SAVED",
      statusCode: 409,
      details: {
        documentId: flush.documentId,
        reason: flush.reason,
        ...(flush.code ? { code: flush.code } : {}),
        ...(flush.error ? { error: flush.error } : {}),
        retryable: true,
      },
    },
  );
}

export async function flushOpenDocumentEditorToSql(args: {
  documentId: string;
  ownerEmail?: string | null;
  propertyId?: string;
}): Promise<OpenEditorTitleFlushProceed | undefined> {
  if (!(await hasCollabState(args.documentId))) return;
  // A switched page's body is its live copy, which each tab's commit already
  // wrote, so its editors save only the title: a whole save would wait on the
  // body's collab acknowledgment. A Blocks field outside the body still needs
  // its save.
  if (!args.propertyId && (await isLiveBodyWriterPage(args.documentId))) {
    return assertOpenEditorTitlesSaved(
      await saveLiveBodyPageTitles([args.documentId]),
    );
  }

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
      if (
        await deliverFlushRequest(
          session,
          flushKey,
          flushValue,
          Date.now() + FLUSH_TIMEOUT_MS,
        )
      ) {
        return;
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

  await clearFlushRequests(writtenSessions, flushKey, requestId);

  if (flushError) {
    throw new Error(flushError);
  }
  if (!acknowledged && acknowledgementRequired) {
    throw new Error(
      "The open document editor did not finish saving before sync timed out.",
    );
  }
}
