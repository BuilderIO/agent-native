import { randomUUID } from "node:crypto";

import { ActionContractError } from "@agent-native/core";
import {
  appStateCompareAndSet,
  appStateGet,
  appStateGetManyEntries,
} from "@agent-native/core/application-state";
import {
  AGENT_CLIENT_ID,
  hasCollabState,
  loadAwarenessRowsStrict,
} from "@agent-native/core/collab";

import { parseDocumentRevisionToken } from "../server/lib/document-revision.js";
import {
  DOCUMENT_FLUSH_PROTOCOL,
  flushAckKey,
  matchingFlushAck,
  type DocumentFlushAck,
  type DocumentFlushRequest,
  type FlushEditorIdentity,
} from "../shared/document-flush-protocol.js";
import { claimedEditorSave } from "../shared/editor-save-state.js";
import {
  createDocumentFlushCapture,
  editorSaveIsInSql,
  type DocumentFlushSnapshot,
} from "./_document-save-row.js";

const FLUSH_POLL_INTERVAL_MS = 200;
// The required-editor budget covers acquisition and both handshake phases.
const FLUSH_TIMEOUT_MS = 20_000;
const MAX_CAPTURE_ATTEMPTS = 3;

export type OpenEditorFlushOutcome =
  | (FlushEditorIdentity & {
      flush: "answered";
      prepareToken: string;
      verifyToken: string;
    })
  | { clientId: number; flush: "unconfirmed"; reason: "legacy_editor" };
export type OpenEditorFlushResult =
  | { status: "no_open_editor" }
  | {
      status: "flushed";
      editors: OpenEditorFlushOutcome[];
      snapshot?: DocumentFlushSnapshot;
    };
type Candidate = {
  clientId: number;
  required: boolean;
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
    throw failure(
      "open_editor_unreadable",
      "The open editor identity could not be read.",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw failure(
      "open_editor_unreadable",
      "The open editor identity could not be read.",
    );
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
    email: typeof email === "string" && email.trim() ? email.trim() : null,
    editorSessionId:
      typeof state.editorSessionId === "string" && state.editorSessionId
        ? state.editorSessionId
        : null,
    protocol: state.documentFlushProtocol,
  };
}
function failure(
  errorCode: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  return new ActionContractError(message, { errorCode, details });
}

export async function flushOpenDocumentEditorToSql(args: {
  documentId: string;
  ownerEmail?: string | null;
  propertyId?: string;
}): Promise<OpenEditorFlushResult> {
  const deadline = Date.now() + FLUSH_TIMEOUT_MS;
  let phase = "discovery";
  let waitingEditors: FlushEditorIdentity[] = [];
  const timeout = () =>
    failure(
      "open_editor_flush_timeout",
      "The open document editor did not finish saving before sync timed out.",
      { documentId: args.documentId, phase, waitingEditors },
    );
  async function bounded<T>(promise: Promise<T>): Promise<T> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw timeout();
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
  const pause = () =>
    bounded(
      new Promise<void>((resolve) =>
        setTimeout(
          resolve,
          Math.min(FLUSH_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())),
        ),
      ),
    );
  try {
    if (!(await bounded(hasCollabState(args.documentId))))
      return { status: "no_open_editor" };
    const candidates = (await bounded(loadAwarenessRowsStrict(args.documentId)))
      .map(candidate)
      .filter((value): value is Candidate => value !== null);
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
    if (required.length === 0) {
      return candidates.length === 0
        ? { status: "no_open_editor" }
        : {
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
    const sessions = [
      ...new Set(required.map((editor) => editor.email!)),
    ].sort();
    waitingEditors = required.map((editor) => ({
      clientId: editor.clientId,
      editorSessionId: editor.editorSessionId!,
    }));
    const targetsFor = (email: string) =>
      required
        .filter((editor) => editor.email === email)
        .map((editor) => ({
          clientId: editor.clientId,
          editorSessionId: editor.editorSessionId!,
        }));
    const requestId = randomUUID();
    const mailbox = `flush-request-${args.documentId}`;
    const owned = new Map<string, DocumentFlushRequest>();
    const leaves = new Map<string, Set<string>>();
    const capture = createDocumentFlushCapture();
    const requests = (
      phaseName: "prepare" | "verify",
      phaseToken: string,
      prepareToken: string,
    ): Map<string, DocumentFlushRequest> =>
      new Map(
        sessions.map((email) => {
          const request: DocumentFlushRequest = {
            protocol: DOCUMENT_FLUSH_PROTOCOL,
            id: args.documentId,
            requestId,
            phase: phaseName,
            phaseToken,
            prepareToken,
            expiresAt: deadline,
            targets: targetsFor(email),
            ...(args.propertyId ? { propertyId: args.propertyId } : {}),
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
          const expired =
            occupied &&
            typeof occupied.expiresAt === "number" &&
            occupied.expiresAt <= Date.now();
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
      waitingEditors = required.map((editor) => ({
        clientId: editor.clientId,
        editorSessionId: editor.editorSessionId!,
      }));
      while (true) {
        const reads = await bounded(
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
        for (const { email, entries } of reads) {
          const request = requestsByEmail.get(email)!;
          for (const { key, value } of entries) {
            if (value === null) continue;
            const target = request.targets.find(
              (target) => flushAckKey(request, target.clientId) === key,
            );
            if (!target || !matchingFlushAck(value, request, target))
              throw failure(
                "open_editor_flush_invalid_ack",
                "The open editor returned an unrelated save confirmation.",
                { key },
              );
            if (value.status === "error")
              throw failure(
                "open_editor_flush_failed",
                "The live document could not be saved before syncing.",
                { clientId: target.clientId, editorErrorCode: value.errorCode },
              );
            if (value.status === "changed") {
              answers.set(target.clientId, value as DocumentFlushAck);
              continue;
            }
            const valid =
              typeof value.stabilityToken === "string" &&
              (request.phase === "prepare"
                ? value.status === "prepared" &&
                  validClaim(value.claim, args.propertyId)
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
        waitingEditors = waitingEditors.filter(
          (editor) => !answers.has(editor.clientId),
        );
        if (answers.size === required.length) return answers;
        await pause();
      }
    }
    try {
      for (let attempt = 0; attempt < MAX_CAPTURE_ATTEMPTS; attempt++) {
        phase = "prepare";
        const prepareToken = randomUUID();
        const prepare = requests("prepare", prepareToken, prepareToken);
        await publish(prepare, attempt === 0);
        const prepared = await acknowledgments(prepare);
        if ([...prepared.values()].some((ack) => ack.status === "changed"))
          continue;
        phase = "capture";
        const snapshot = await bounded(
          capture(args.documentId, args.propertyId),
        );
        if (!snapshot)
          throw failure(
            "open_editor_flush_missing_document",
            "The document was removed before save confirmation.",
          );
        if (
          ![...prepared.values()].every(
            (ack) =>
              ack.status === "prepared" &&
              (ack.claim.kind === "property"
                ? snapshot.kind === "property" &&
                  snapshot.propertyId === ack.claim.propertyId &&
                  snapshot.contentHash === ack.claim.contentHash
                : snapshot.kind === "document" &&
                  editorSaveIsInSql(
                    snapshot,
                    ack.claim.save,
                    snapshot.contentHash,
                  )),
          )
        )
          continue;
        // This token is created only after S exists. Every unchanged prepare-to-verify interval spans S.
        phase = "verify";
        const verifyToken = randomUUID();
        const verify = requests("verify", verifyToken, prepareToken);
        await publish(verify, false);
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
        return {
          status: "flushed",
          snapshot,
          editors: candidates.map((editor) =>
            editor.required
              ? {
                  clientId: editor.clientId,
                  editorSessionId: editor.editorSessionId!,
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
      }
      throw failure(
        "open_editor_flush_contention",
        "The document kept changing during save confirmation.",
        { documentId: args.documentId, attempts: MAX_CAPTURE_ATTEMPTS },
      );
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
      void cleanup.catch((error) =>
        console.warn("Document flush cleanup failed", { requestId, error }),
      );
      if (Date.now() < deadline) await bounded(cleanup);
    }
  } catch (error) {
    if (error instanceof ActionContractError) throw error;
    throw failure(
      "open_editor_flush_unreadable",
      "The open editor save confirmation could not be read or written.",
      {
        documentId: args.documentId,
        phase,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
}
function validClaim(value: unknown, propertyId?: string): boolean {
  if (!value || typeof value !== "object") return false;
  const claim = value as Record<string, unknown>;
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
