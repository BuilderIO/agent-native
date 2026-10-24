import { randomUUID } from "node:crypto";

import { ActionContractError } from "@agent-native/core";
import {
  appStateCompareAndSet,
  appStateGet,
  appStateGetManyEntries,
} from "@agent-native/core/application-state";
import {
  AGENT_CLIENT_ID,
  loadAwarenessRowsStrict,
} from "@agent-native/core/collab";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

import { parseDocumentRevisionToken } from "../server/lib/document-revision.js";
import {
  isLiveBodyWriterPage,
  liveBodyWriterPageIds,
} from "../server/lib/live-body-writer.js";
import {
  DOCUMENT_FLUSH_PROTOCOL,
  flushAckKey,
  matchingFlushAck,
  type DocumentFlushAck,
  type DocumentFlushClaim,
  type DocumentFlushRequest,
  type FlushEditorIdentity,
} from "../shared/document-flush-protocol.js";
import { claimedEditorSave } from "../shared/editor-save-state.js";
import {
  createDocumentFlushCapture,
  editorSaveIsInSql,
  readDocumentTitleRow,
  type DocumentFlushSnapshot,
} from "./_document-save-row.js";

const FLUSH_POLL_INTERVAL_MS = 200;
// The required-editor budget covers acquisition and both handshake phases.
export const FLUSH_TIMEOUT_MS = 20_000;
const BEST_EFFORT_FLUSH_TIMEOUT_MS = 4_000;
const TITLE_DISCOVERY_CONCURRENCY = 10;
// Each title handshake polls its acknowledgements every interval, so a large
// subtree runs only this many at once, under its one deadline.
const TITLE_SAVE_CONCURRENCY = 4;

function expiredMailbox(value: Record<string, unknown> | null): boolean {
  return (
    !!value &&
    ((typeof value.expiresAt === "number" && value.expiresAt <= Date.now()) ||
      (value.expiresAt === undefined &&
        (value.status === "success" || value.status === "error") &&
        typeof value.ts === "number" &&
        Date.now() - value.ts >= FLUSH_TIMEOUT_MS))
  );
}

export type OpenEditorFlushOutcome =
  | (FlushEditorIdentity & {
      flush: "answered";
      prepareToken: string;
      verifyToken: string;
    })
  | { clientId: number; flush: "unconfirmed"; reason: "legacy_editor" };
/**
 * What the open editors of pages whose bodies are their live copies answered
 * when asked to save their titles. An editor that doesn't advertise
 * `canFlushTitle` isn't asked and stays unconfirmed.
 */
export type OpenEditorTitleFlush = {
  pages: Array<{
    documentId: string;
    // The title SQL held when the asked editors confirmed theirs was saved.
    confirmedTitle?: string;
    editors: OpenEditorFlushOutcome[];
  }>;
};
export type OpenEditorFlushResult =
  | { status: "no_open_editor" }
  | { status: "live_copy"; titleFlush?: OpenEditorTitleFlush }
  | {
      status: "flushed";
      editors: OpenEditorFlushOutcome[];
      snapshot?: DocumentFlushSnapshot;
    };
type Candidate = {
  clientId: number;
  required: boolean;
  canFlushTitle: boolean;
  email: string | null;
  editorSessionId: string | null;
  protocol: unknown;
};

function candidate(entry: {
  clientId: number;
  state: string;
}): Candidate | null {
  if (entry.clientId === AGENT_CLIENT_ID) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(entry.state);
  } catch {
    console.warn("Skipping malformed document editor awareness", {
      clientId: entry.clientId,
    });
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const state = parsed as Record<string, unknown>;
  const user =
    state.user && typeof state.user === "object"
      ? (state.user as { email?: unknown })
      : null;
  const email = user?.email;
  if (state.canFlushDocument === false) return null;
  const required = state.canFlushDocument === true;
  // A known writer stays in the cohort even when hidden; legacy presence is best effort.
  if (!required && (state.visible === false || !state.user)) return null;
  return {
    clientId: entry.clientId,
    required,
    canFlushTitle: state.canFlushTitle === true,
    email: typeof email === "string" && email.trim() ? email.trim() : null,
    editorSessionId:
      typeof state.editorSessionId === "string" && state.editorSessionId
        ? state.editorSessionId
        : null,
    protocol: state.documentFlushProtocol,
  };
}
async function openEditors(
  documentId: string,
  bounded: <T>(promise: Promise<T>) => Promise<T>,
): Promise<Candidate[]> {
  return (await bounded(loadAwarenessRowsStrict(documentId)))
    .map(candidate)
    .filter((value): value is Candidate => value !== null);
}
function failure(
  errorCode: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  return new ActionContractError(message, { errorCode, details });
}

export type OpenEditorTitleNotSavedReason =
  | "timeout"
  | "editor_error"
  | "request_not_delivered"
  | "request_not_received"
  | "acknowledgement_unreadable"
  | "editors_unreadable"
  | "write_path_unreadable";

function titleNotSavedMessage(
  documentId: string,
  reason: OpenEditorTitleNotSavedReason,
) {
  switch (reason) {
    case "timeout":
      return `An open editor didn't confirm in time that it saved the title of page ${documentId}.`;
    case "editor_error":
      return `An open editor couldn't save the title of page ${documentId}.`;
    case "request_not_delivered":
      return `Couldn't ask the open editor of page ${documentId} to save its title.`;
    case "request_not_received":
      return `An open editor of page ${documentId} never picked up the request to save its title.`;
    case "acknowledgement_unreadable":
      return `Couldn't read whether the open editor of page ${documentId} saved its title.`;
    case "editors_unreadable":
      return `Couldn't read which editors have page ${documentId} open.`;
    case "write_path_unreadable":
      return `Couldn't read whether page ${documentId} takes body writes through its live copy.`;
  }
}

/**
 * The caller has written nothing when this is thrown, so it can retry. Titles
 * the open editors saved meanwhile stay saved: they're the editors' own edits.
 */
function titleNotSaved(
  documentId: string,
  reason: OpenEditorTitleNotSavedReason,
  extra: { code?: string; cause?: unknown } = {},
) {
  return new ActionContractError(
    `${titleNotSavedMessage(documentId, reason)} The request didn't go ahead, and any titles the open editors saved stay saved. Try again.`,
    {
      errorCode: "OPEN_EDITOR_TITLE_NOT_SAVED",
      statusCode: 409,
      details: {
        documentId,
        reason,
        ...(extra.code ? { code: extra.code } : {}),
        ...(extra.cause !== undefined
          ? {
              cause:
                extra.cause instanceof Error
                  ? extra.cause.message
                  : String(extra.cause),
            }
          : {}),
        retryable: true,
      },
    },
  );
}

type FlushBudget = {
  deadline: number;
  timeout: () => Error;
  bounded: <T>(promise: Promise<T>) => Promise<T>;
  pause: () => Promise<void>;
  finishCleanup: (
    cleanup: Promise<unknown>,
    requestId: string,
  ) => Promise<void>;
};

function flushBudget(deadline: number, timeout: () => Error): FlushBudget {
  async function bounded<T>(promise: Promise<T>): Promise<T> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      // The caller gets the timeout, as from the race below, so a late
      // failure of the operation must not surface as an unhandled rejection.
      promise.catch(() => {});
      throw timeout();
    }
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(timeout()), remaining);
        }),
      ]);
    } finally {
      clearTimeout(timer!);
    }
  }
  async function finishCleanup(cleanup: Promise<unknown>, requestId: string) {
    const settled = cleanup.catch((error) =>
      console.warn("Document flush cleanup failed", { requestId, error }),
    );
    if (Date.now() < deadline) {
      try {
        await bounded(settled);
      } catch (error) {
        console.warn("Document flush cleanup exceeded its deadline", {
          requestId,
          error,
        });
      }
    }
  }
  const pause = () =>
    bounded(
      new Promise<void>((resolve) =>
        setTimeout(
          resolve,
          Math.min(FLUSH_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())),
        ),
      ),
    );
  return { deadline, timeout, bounded, pause, finishCleanup };
}

type HandshakeState = {
  phase: string;
  waitingEditors: FlushEditorIdentity[];
  lastEditorError?: { clientId: number; errorCode: string };
  // The title scope's failure reasons: the step the handshake is on, which
  // editors have answered any of its requests, whether a read of the
  // acknowledgements is still running, and why they couldn't be read, while
  // no read has succeeded since.
  operation: "publish" | "acknowledge" | "capture" | null;
  reached: Set<number>;
  readingAcknowledgements: boolean;
  unreadAcknowledgements?: { cause: unknown };
};

function handshakeState(): HandshakeState {
  return {
    phase: "discovery",
    waitingEditors: [],
    operation: null,
    reached: new Set(),
    readingAcknowledgements: false,
  };
}

function editorIdentity(editor: Candidate): FlushEditorIdentity {
  return {
    clientId: editor.clientId,
    editorSessionId: editor.editorSessionId!,
  };
}

/**
 * Runs the prepare and verify handshake with `editors`, each of which has an
 * email, an editor session and protocol 2, until every one has a claim that
 * the snapshot `capture` reads holds and has stayed unchanged across it.
 */
async function confirmEditors<S>(args: {
  documentId: string;
  propertyId?: string;
  scope?: "title";
  editors: Candidate[];
  budget: FlushBudget;
  state: HandshakeState;
  capture: () => Promise<S | null>;
  inSql: (snapshot: S, claim: DocumentFlushClaim) => boolean;
}): Promise<{ snapshot: S; prepareToken: string; verifyToken: string }> {
  const { documentId, propertyId, scope, editors: required, state } = args;
  const { deadline, timeout, bounded, pause, finishCleanup } = args.budget;
  const sessions = [...new Set(required.map((editor) => editor.email!))].sort();
  state.waitingEditors = required.map(editorIdentity);
  const targetsFor = (email: string) =>
    required.filter((editor) => editor.email === email).map(editorIdentity);
  const requestId = randomUUID();
  const mailbox = `flush-request-${documentId}`;
  const owned = new Map<string, DocumentFlushRequest>();
  const leaves = new Map<string, Set<string>>();
  const requests = (
    phaseName: "prepare" | "verify",
    phaseToken: string,
    prepareToken: string,
  ): Map<string, DocumentFlushRequest> =>
    new Map(
      sessions.map((email) => {
        const request: DocumentFlushRequest = {
          protocol: DOCUMENT_FLUSH_PROTOCOL,
          id: documentId,
          requestId,
          phase: phaseName,
          phaseToken,
          prepareToken,
          expiresAt: deadline,
          targets: targetsFor(email),
          ...(propertyId ? { propertyId } : {}),
          ...(scope ? { scope } : {}),
        };
        const known = leaves.get(email) ?? new Set<string>();
        request.targets.forEach((target) =>
          known.add(flushAckKey(request, target.clientId)),
        );
        leaves.set(email, known);
        return [email, request];
      }),
    );
  async function cas(
    email: string,
    expected: DocumentFlushRequest | Record<string, unknown> | null,
    next: DocumentFlushRequest,
  ) {
    const operation = appStateCompareAndSet(email, mailbox, expected, next, {
      requestSource: "agent",
    });
    // A database operation can finish after our deadline. It may only release its own value.
    void operation
      .then((changed) => {
        if (changed && Date.now() >= deadline)
          return appStateCompareAndSet(email, mailbox, next, null, {
            requestSource: "agent",
          });
      })
      .catch((error) =>
        console.warn("Document flush late acquisition cleanup failed", {
          requestId,
          error,
        }),
      );
    const changed = await bounded(operation);
    if (changed) owned.set(email, next);
    return changed;
  }
  async function publish(
    next: Map<string, DocumentFlushRequest>,
    acquire: boolean,
  ) {
    for (const email of sessions) {
      const request = next.get(email)!;
      if (!acquire) {
        if (!(await cas(email, owned.get(email)!, request)))
          throw failure(
            "open_editor_flush_contention",
            "The open editor flush request changed before confirmation.",
          );
        continue;
      }
      while (true) {
        const occupied = await bounded(appStateGet(email, mailbox));
        // Expiry permits mailbox acquisition, never save confirmation.
        // Legacy terminal values use ts and the same twenty-second budget.
        const expired = expiredMailbox(occupied);
        if ((!occupied || expired) && (await cas(email, occupied, request)))
          break;
        await pause();
      }
    }
  }
  async function acknowledgments(
    requestsByEmail: Map<string, DocumentFlushRequest>,
  ): Promise<Map<number, DocumentFlushAck>> {
    const answers = new Map<number, DocumentFlushAck>();
    state.waitingEditors = required.map(editorIdentity);
    while (true) {
      let reads: Array<{
        email: string;
        entries: Awaited<ReturnType<typeof appStateGetManyEntries>>;
      }>;
      // Past the deadline no read starts, so one running when it passes was
      // cut short and says nothing about whether an editor answered.
      if (Date.now() >= deadline) throw timeout();
      state.readingAcknowledgements = true;
      try {
        reads = await bounded(
          Promise.all(
            sessions.map(async (email) => {
              const request = requestsByEmail.get(email)!;
              const keys = request.targets.map((target) =>
                flushAckKey(request, target.clientId),
              );
              const known = leaves.get(email) ?? new Set<string>();
              keys.forEach((key) => known.add(key));
              leaves.set(email, known);
              return {
                email,
                entries: await appStateGetManyEntries(email, keys),
              };
            }),
          ),
        );
      } catch (error) {
        state.readingAcknowledgements = false;
        // A title save's answer can still be read after a failed read, so
        // only reads that fail up to the deadline refuse it.
        if (scope !== "title" || error instanceof ActionContractError)
          throw error;
        if (!state.unreadAcknowledgements)
          console.warn("Document title save acknowledgements unreadable", {
            requestId,
            error,
          });
        state.unreadAcknowledgements = { cause: error };
        await pause();
        continue;
      }
      state.readingAcknowledgements = false;
      state.unreadAcknowledgements = undefined;
      let retry = false;
      for (const { email, entries } of reads) {
        const request = requestsByEmail.get(email)!;
        for (const { key, value } of entries) {
          if (value === null) continue;
          const target = request.targets.find(
            (target) => flushAckKey(request, target.clientId) === key,
          );
          if (
            !target ||
            !value ||
            typeof value !== "object" ||
            Array.isArray(value) ||
            !matchingFlushAck(value, request, target)
          )
            throw failure(
              "open_editor_flush_invalid_ack",
              "The open editor returned an unrelated save confirmation.",
              { key },
            );
          if (scope === "title") {
            state.reached.add(target.clientId);
            if (request.phase === "prepare" && value.status === "taken")
              continue;
            // A title save that failed is the editor's to report; asking
            // again would only wait out the deadline.
            if (value.status === "error") {
              if (typeof value.errorCode !== "string")
                throw failure(
                  "open_editor_flush_invalid_ack",
                  "The open editor returned an unreadable save confirmation.",
                  { clientId: target.clientId },
                );
              throw titleNotSaved(documentId, "editor_error", {
                code: value.errorCode,
              });
            }
          }
          if (value.status === "error") {
            if (typeof value.errorCode !== "string")
              throw failure(
                "open_editor_flush_invalid_ack",
                "The open editor returned an unreadable save confirmation.",
                { clientId: target.clientId },
              );
            state.lastEditorError = {
              clientId: target.clientId,
              errorCode: value.errorCode,
            };
            answers.set(target.clientId, value as DocumentFlushAck);
            retry = true;
            continue;
          }
          if (value.status === "changed") {
            answers.set(target.clientId, value as DocumentFlushAck);
            retry = true;
            continue;
          }
          const valid =
            typeof value.stabilityToken === "string" &&
            (request.phase === "prepare"
              ? value.status === "prepared" &&
                validClaim(value.claim, propertyId, scope)
              : value.status === "verified");
          if (!valid)
            throw failure(
              "open_editor_flush_invalid_ack",
              "The open editor returned an unreadable save confirmation.",
              { clientId: target.clientId },
            );
          answers.set(target.clientId, value as DocumentFlushAck);
        }
      }
      state.waitingEditors = state.waitingEditors.filter(
        (editor) => !answers.has(editor.clientId),
      );
      if (retry || answers.size === required.length) return answers;
      await pause();
    }
  }
  try {
    let acquire = true;
    while (true) {
      if (!acquire) await pause();
      if (Date.now() >= deadline) throw timeout();
      state.phase = "prepare";
      const prepareToken = randomUUID();
      const prepare = requests("prepare", prepareToken, prepareToken);
      state.operation = "publish";
      await publish(prepare, acquire);
      acquire = false;
      state.operation = "acknowledge";
      const prepared = await acknowledgments(prepare);
      if (
        [...prepared.values()].some(
          (ack) => ack.status === "changed" || ack.status === "error",
        )
      )
        continue;
      state.phase = "capture";
      state.operation = "capture";
      const snapshot = await bounded(args.capture());
      if (!snapshot)
        throw failure(
          "open_editor_flush_missing_document",
          "The document was removed before save confirmation.",
        );
      if (
        ![...prepared.values()].every(
          (ack) => ack.status === "prepared" && args.inSql(snapshot, ack.claim),
        )
      )
        continue;
      // This token is created only after S exists. Every unchanged prepare-to-verify interval spans S.
      state.phase = "verify";
      const verifyToken = randomUUID();
      const verify = requests("verify", verifyToken, prepareToken);
      state.operation = "publish";
      await publish(verify, false);
      state.operation = "acknowledge";
      const verified = await acknowledgments(verify);
      if (
        ![...verified.values()].every(
          (ack) =>
            ack.status === "verified" &&
            prepared.get(ack.clientId)?.status === "prepared" &&
            ack.stabilityToken ===
              (
                prepared.get(ack.clientId) as Extract<
                  DocumentFlushAck,
                  { status: "prepared" }
                >
              ).stabilityToken,
        )
      )
        continue;
      if (Date.now() >= deadline) throw timeout();
      return { snapshot, prepareToken, verifyToken };
    }
  } finally {
    const cleanup = Promise.all(
      sessions.map(async (email) => {
        const own = owned.get(email);
        if (own)
          await appStateCompareAndSet(email, mailbox, own, null, {
            requestSource: "agent",
          });
        const keys = [...(leaves.get(email) ?? [])];
        for (const { key, value } of await appStateGetManyEntries(
          email,
          keys,
        )) {
          if (value?.requestId === requestId)
            await appStateCompareAndSet(email, key, value, null, {
              requestSource: "agent",
            });
        }
      }),
    );
    // Cleanup cannot extend the confirmation deadline or delete a successor's nonce.
    await finishCleanup(cleanup, requestId);
  }
}

function documentClaimIsInSql(
  snapshot: DocumentFlushSnapshot,
  claim: DocumentFlushClaim,
): boolean {
  return claim.kind === "property"
    ? snapshot.kind === "property" &&
        snapshot.propertyId === claim.propertyId &&
        snapshot.contentHash === claim.contentHash
    : claim.kind === "document" &&
        snapshot.kind === "document" &&
        editorSaveIsInSql(snapshot, claim.save, snapshot.contentHash);
}

function titleTimeoutReason(
  state: HandshakeState,
): OpenEditorTitleNotSavedReason {
  if (state.operation === "publish") return "request_not_delivered";
  if (state.operation !== "acknowledge") return "timeout";
  if (state.readingAcknowledgements || state.unreadAcknowledgements)
    return "acknowledgement_unreadable";
  // An editor marks a title request taken before it saves, so one that never
  // answered any of this handshake's requests never picked it up. One that
  // did has the request, though not yet the prepare the server asked again.
  if (
    state.phase === "prepare" &&
    state.waitingEditors.some((editor) => !state.reached.has(editor.clientId))
  )
    return "request_not_received";
  return "timeout";
}

/**
 * Asks the editors of `documentId` that advertise `canFlushTitle` to save its
 * title alone, by `deadline`. Throws OPEN_EDITOR_TITLE_NOT_SAVED when any of
 * them doesn't confirm it.
 */
async function saveEditorTitle(
  documentId: string,
  candidates: Candidate[],
  deadline: number,
): Promise<OpenEditorTitleFlush["pages"][number]> {
  const unconfirmed = (editor: Candidate): OpenEditorFlushOutcome => ({
    clientId: editor.clientId,
    flush: "unconfirmed",
    reason: "legacy_editor",
  });
  const asked = candidates.filter((editor) => editor.canFlushTitle);
  if (asked.length === 0)
    return { documentId, editors: candidates.map(unconfirmed) };
  const state = handshakeState();
  const budget = flushBudget(deadline, () =>
    titleNotSaved(documentId, titleTimeoutReason(state), {
      cause: state.unreadAcknowledgements?.cause,
    }),
  );
  try {
    if (
      asked.some(
        (editor) =>
          !editor.email ||
          !editor.editorSessionId ||
          editor.protocol !== DOCUMENT_FLUSH_PROTOCOL,
      )
    )
      throw titleNotSaved(documentId, "request_not_delivered");
    const { snapshot, prepareToken, verifyToken } = await confirmEditors({
      documentId,
      scope: "title",
      editors: asked,
      budget,
      state,
      capture: () => readDocumentTitleRow(documentId),
      // Only the title itself confirms it: `updatedAt` also moves on with
      // every body write.
      inSql: (row, claim) =>
        claim.kind === "title" && row.title === claim.title,
    });
    return {
      documentId,
      confirmedTitle: snapshot.title,
      editors: candidates.map((editor) =>
        editor.canFlushTitle
          ? {
              ...editorIdentity(editor),
              flush: "answered",
              prepareToken,
              verifyToken,
            }
          : unconfirmed(editor),
      ),
    };
  } catch (error) {
    if (!(error instanceof ActionContractError))
      throw titleNotSaved(
        documentId,
        state.operation === "acknowledge" || state.operation === "capture"
          ? "acknowledgement_unreadable"
          : "request_not_delivered",
        { cause: error },
      );
    switch (error.errorCode) {
      case "open_editor_flush_contention":
        throw titleNotSaved(documentId, "request_not_delivered");
      case "open_editor_flush_invalid_ack":
        throw titleNotSaved(documentId, "acknowledgement_unreadable");
      case "open_editor_flush_missing_document":
        throw new ActionContractError(
          `Page ${documentId} was deleted while its open editors saved its title.`,
          {
            errorCode: "DOCUMENT_NOT_FOUND",
            statusCode: 404,
            details: { documentId },
          },
        );
      default:
        throw error;
    }
  }
}

/**
 * Asks the open editors of the pages among `documentIds` whose bodies are
 * their live copies to save their titles, under one deadline, before a write
 * that would lose a title an editor hasn't saved. Their bodies need no save:
 * each tab's commit already wrote them. Undefined when none of those pages
 * has an editor that advertises `canFlushTitle`, so the caller returns what
 * main does. Throws OPEN_EDITOR_TITLE_NOT_SAVED, or DOCUMENT_NOT_FOUND for a
 * page deleted meanwhile, before the caller writes anything.
 */
export async function saveOpenEditorTitles(
  documentIds: readonly string[],
): Promise<OpenEditorTitleFlush | undefined> {
  let switched: Set<string>;
  try {
    switched = await liveBodyWriterPageIds(documentIds);
  } catch (error) {
    if (error instanceof ActionContractError) throw error;
    // Unreadable isn't "none switched": a switched page's editors would go
    // unasked.
    throw titleNotSaved(documentIds[0]!, "write_path_unreadable", {
      cause: error,
    });
  }
  if (switched.size === 0) return undefined;
  const ids = documentIds.filter((id) => switched.has(id));
  const open: Array<{ documentId: string; candidates: Candidate[] }> = [];
  for (
    let offset = 0;
    offset < ids.length;
    offset += TITLE_DISCOVERY_CONCURRENCY
  ) {
    const group = ids.slice(offset, offset + TITLE_DISCOVERY_CONCURRENCY);
    for (const page of await Promise.all(
      group.map(async (documentId) => {
        try {
          return {
            documentId,
            candidates: await openEditors(documentId, (read) => read),
          };
        } catch (error) {
          if (error instanceof ActionContractError) throw error;
          throw titleNotSaved(documentId, "editors_unreadable", {
            cause: error,
          });
        }
      }),
    )) {
      if (page.candidates.length > 0) open.push(page);
    }
  }
  if (
    !open.some((page) => page.candidates.some((editor) => editor.canFlushTitle))
  )
    return undefined;
  // The deadline bounds the wait on editors, not reading which are open: a
  // slow read of a subtree with no editor to ask must not refuse a move.
  const deadline = Date.now() + FLUSH_TIMEOUT_MS;
  // A refusal stops new pages being asked, and every page already asked
  // finishes before the caller refuses, so none is still being asked after
  // it returns.
  const saved: Array<
    PromiseSettledResult<OpenEditorTitleFlush["pages"][number]> | undefined
  > = [];
  let next = 0;
  let refused = false;
  await Promise.all(
    Array.from(
      { length: Math.min(TITLE_SAVE_CONCURRENCY, open.length) },
      async () => {
        while (!refused && next < open.length) {
          const index = next++;
          const page = open[index]!;
          try {
            saved[index] = {
              status: "fulfilled",
              value: await saveEditorTitle(
                page.documentId,
                page.candidates,
                deadline,
              ),
            };
          } catch (reason) {
            refused = true;
            saved[index] = { status: "rejected", reason };
          }
        }
      },
    ),
  );
  const pages: OpenEditorTitleFlush["pages"] = [];
  for (const result of saved) {
    if (result?.status === "rejected") throw result.reason;
    if (result) pages.push(result.value);
  }
  return { pages };
}

export async function flushOpenDocumentEditorToSql(args: {
  documentId: string;
  ownerEmail?: string | null;
  propertyId?: string;
}): Promise<OpenEditorFlushResult> {
  const deadline = Date.now() + FLUSH_TIMEOUT_MS;
  const state = handshakeState();
  const budget = flushBudget(deadline, () =>
    failure(
      "open_editor_flush_timeout",
      "The open document editor did not finish saving before sync timed out.",
      {
        documentId: args.documentId,
        phase: state.phase,
        waitingEditors: state.waitingEditors,
        lastEditorError: state.lastEditorError,
      },
    ),
  );
  const { bounded, pause, finishCleanup } = budget;
  try {
    const candidates = await openEditors(args.documentId, bounded);
    if (
      args.propertyId &&
      candidates.length > 0 &&
      (candidates.length !== 1 ||
        !candidates[0]!.required ||
        !candidates[0]!.email)
    ) {
      throw failure(
        "open_editor_field_ambiguous",
        "An exact fresh Blocks field value cannot be established while multiple or legacy editors are open.",
        { documentId: args.documentId, propertyId: args.propertyId },
      );
    }
    const required = candidates.filter((value) => value.required);
    if (candidates.length === 0) return { status: "no_open_editor" };
    // A switched page's body is its live copy, and each tab's commit to it
    // already wrote SQL, so its editors never answer a body save: asking
    // would wait out the deadline. Read only with an editor open, so a flush
    // with none reads nothing beyond main's. Editors that advertise
    // canFlushTitle save the title alone. A Blocks field outside the body
    // still needs its save.
    if (
      !args.propertyId &&
      (await bounded(isLiveBodyWriterPage(args.documentId)))
    ) {
      if (!candidates.some((editor) => editor.canFlushTitle))
        return { status: "live_copy" };
      return {
        status: "live_copy",
        titleFlush: {
          pages: [await saveEditorTitle(args.documentId, candidates, deadline)],
        },
      };
    }
    if (required.length === 0) {
      const sessions = [
        ...new Set(
          [
            ...candidates.map((editor) => editor.email),
            args.ownerEmail,
            getRequestUserEmail(),
          ].filter(
            (email): email is string => typeof email === "string" && !!email,
          ),
        ),
      ];
      const mailbox = `flush-request-${args.documentId}`;
      const request = {
        id: args.documentId,
        requestId: randomUUID(),
        ts: Date.now(),
        status: "pending",
      };
      const written = new Set<string>();
      try {
        const acquireUntil = Date.now() + BEST_EFFORT_FLUSH_TIMEOUT_MS;
        await Promise.allSettled(
          sessions.map(async (email) => {
            while (Date.now() < acquireUntil) {
              const occupied = await bounded(appStateGet(email, mailbox));
              if (!occupied || expiredMailbox(occupied)) {
                const operation = appStateCompareAndSet(
                  email,
                  mailbox,
                  occupied,
                  request,
                  { requestSource: "agent" },
                );
                void operation
                  .then((changed) => {
                    if (changed && Date.now() >= deadline)
                      return appStateCompareAndSet(
                        email,
                        mailbox,
                        request,
                        null,
                        { requestSource: "agent" },
                      );
                  })
                  .catch((error) =>
                    console.warn(
                      "Document flush late acquisition cleanup failed",
                      { requestId: request.requestId, error },
                    ),
                  );
                if (await bounded(operation)) {
                  written.add(email);
                  return;
                }
              }
              await pause();
            }
          }),
        );
        const answerUntil = Date.now() + BEST_EFFORT_FLUSH_TIMEOUT_MS;
        while (written.size > 0 && Date.now() < answerUntil) {
          await pause();
          const answers = await bounded(
            Promise.allSettled(
              [...written].map((email) => appStateGet(email, mailbox)),
            ),
          );
          const ownAnswers = answers
            .flatMap((answer) =>
              answer.status === "fulfilled" ? [answer.value] : [],
            )
            .filter((value) => value?.requestId === request.requestId);
          const failed = ownAnswers.find((value) => value?.status === "error");
          if (failed)
            throw failure(
              "open_editor_flush_failed",
              "The legacy document editor could not save before syncing.",
              { documentId: args.documentId },
            );
          if (ownAnswers.some((value) => value?.status === "success")) break;
        }
      } finally {
        await finishCleanup(
          Promise.all(
            [...written].map(async (email) => {
              const value = await appStateGet(email, mailbox);
              if (value?.requestId === request.requestId)
                await appStateCompareAndSet(email, mailbox, value, null, {
                  requestSource: "agent",
                });
            }),
          ),
          request.requestId,
        );
      }
      return {
        status: "flushed",
        editors: candidates.map(({ clientId }) => ({
          clientId,
          flush: "unconfirmed",
          reason: "legacy_editor",
        })),
      };
    }
    for (const editor of required) {
      if (!editor.email || !editor.editorSessionId)
        throw failure(
          "open_editor_unidentified",
          "Could not identify the open document editor to flush.",
          { clientId: editor.clientId },
        );
      if (editor.protocol !== DOCUMENT_FLUSH_PROTOCOL)
        throw failure(
          "open_editor_unsupported",
          "The open document editor does not support fresh save confirmation.",
          { clientId: editor.clientId },
        );
    }
    const capture = createDocumentFlushCapture();
    const { snapshot, prepareToken, verifyToken } = await confirmEditors({
      documentId: args.documentId,
      propertyId: args.propertyId,
      editors: required,
      budget,
      state,
      capture: () => capture(args.documentId, args.propertyId),
      inSql: documentClaimIsInSql,
    });
    return {
      status: "flushed",
      snapshot,
      editors: candidates.map((editor) =>
        editor.required
          ? {
              ...editorIdentity(editor),
              flush: "answered",
              prepareToken,
              verifyToken,
            }
          : {
              clientId: editor.clientId,
              flush: "unconfirmed",
              reason: "legacy_editor",
            },
      ),
    };
  } catch (error) {
    if (error instanceof ActionContractError) throw error;
    throw failure(
      "open_editor_flush_unreadable",
      "The open editor save confirmation could not be read or written.",
      {
        documentId: args.documentId,
        phase: state.phase,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
}
function validClaim(
  value: unknown,
  propertyId?: string,
  scope?: "title",
): boolean {
  if (!value || typeof value !== "object") return false;
  const claim = value as Record<string, unknown>;
  if (scope === "title")
    return claim.kind === "title" && typeof claim.title === "string";
  if (propertyId)
    return (
      claim.kind === "property" &&
      claim.propertyId === propertyId &&
      typeof claim.contentHash === "string" &&
      /^sha256:[a-f0-9]{64}$/.test(claim.contentHash)
    );
  const save =
    claim.save && typeof claim.save === "object"
      ? (claim.save as Record<string, unknown>)
      : null;
  return (
    claim.kind === "document" &&
    !!save &&
    typeof save.revision === "string" &&
    parseDocumentRevisionToken(save.revision) !== null &&
    claimedEditorSave({
      unsavedEdits: false,
      savedRevision: save.revision,
      savedTitle: save.title,
      savedTitleAt: save.titleUpdatedAt,
    }) !== null
  );
}
