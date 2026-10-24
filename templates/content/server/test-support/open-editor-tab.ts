import {
  appStateCompareAndSet,
  appStateGet,
} from "@agent-native/core/application-state";
import { loadAwarenessRowsStrict } from "@agent-native/core/collab";
import { getDbExec } from "@agent-native/core/db";

import { readDocumentTitleRow } from "../../actions/_document-save-row.js";
import {
  flushAckKey,
  isDocumentFlushRequest,
  type DocumentFlushAck,
  type DocumentFlushRequest,
} from "../../shared/document-flush-protocol.js";

const TAB_CLIENT_ID = 7;
const TAB = { clientId: TAB_CLIENT_ID, editorSessionId: "tab-7" };

/** A visible tab of `email`'s that can edit page `id`, as its awareness row advertises it. */
export async function openEditorTab(
  id: string,
  email: string,
  state: Record<string, unknown> = {},
): Promise<void> {
  await loadAwarenessRowsStrict(id);
  await getDbExec().execute({
    sql: "INSERT INTO _collab_awareness (doc_id, client_id, state, last_seen) VALUES (?, ?, ?, ?)",
    args: [
      id,
      TAB_CLIENT_ID,
      JSON.stringify({
        user: { email },
        visible: true,
        canFlushDocument: true,
        documentFlushProtocol: 2,
        editorSessionId: TAB.editorSessionId,
        ...state,
      }),
      Date.now(),
    ],
  });
}

async function requestFor(
  id: string,
  email: string,
  matches: (request: DocumentFlushRequest) => boolean,
): Promise<DocumentFlushRequest> {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const request = await appStateGet(email, `flush-request-${id}`);
    if (
      isDocumentFlushRequest(request) &&
      request.targets.some((target) => target.clientId === TAB.clientId) &&
      matches(request)
    )
      return request;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`No flush request for ${id} reached ${email}'s tab.`);
}

function envelope(request: DocumentFlushRequest) {
  return {
    protocol: request.protocol,
    id: request.id,
    requestId: request.requestId,
    phase: request.phase,
    phaseToken: request.phaseToken,
    ...TAB,
  };
}

/**
 * The tab's side of a title request, as the editor answers it on protocol 2:
 * it waits for the prepare request for page `id` in `email`'s mailbox, marks
 * it taken, runs `save`, and answers with the title SQL now holds, or with
 * `errorCode`. Then it verifies. It returns the prepare request. It reads the
 * mailbox itself, not through the editor's sync wake, so a test using it
 * proves nothing about a real tab hearing of the request.
 */
export async function answerTitleRequest(
  id: string,
  email: string,
  options: { save?: () => Promise<void>; errorCode?: string } = {},
): Promise<DocumentFlushRequest> {
  const prepare = await requestFor(
    id,
    email,
    (request) => request.phase === "prepare",
  );
  const key = flushAckKey(prepare, TAB.clientId);
  const taken: DocumentFlushAck = { ...envelope(prepare), status: "taken" };
  if (!(await appStateCompareAndSet(email, key, null, taken)))
    throw new Error(`Another answer holds ${key}.`);
  await options.save?.();
  if (options.errorCode) {
    await appStateCompareAndSet(email, key, taken, {
      ...envelope(prepare),
      status: "error",
      errorCode: options.errorCode,
    } satisfies DocumentFlushAck);
    return prepare;
  }
  const row = await readDocumentTitleRow(id);
  if (!row) throw new Error(`Page ${id} has no row to claim a title from.`);
  const stabilityToken = `stable-${prepare.phaseToken}`;
  await appStateCompareAndSet(email, key, taken, {
    ...envelope(prepare),
    status: "prepared",
    stabilityToken,
    claim: { kind: "title", title: row.title, titleUpdatedAt: row.updatedAt },
  } satisfies DocumentFlushAck);
  const verify = await requestFor(
    id,
    email,
    (request) =>
      request.phase === "verify" &&
      request.requestId === prepare.requestId &&
      request.prepareToken === prepare.phaseToken,
  );
  await appStateCompareAndSet(email, flushAckKey(verify, TAB.clientId), null, {
    ...envelope(verify),
    status: "verified",
    stabilityToken,
  } satisfies DocumentFlushAck);
  return prepare;
}
