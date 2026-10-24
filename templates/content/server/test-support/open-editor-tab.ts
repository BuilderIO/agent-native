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
 * it taken, runs `save`, and answers with the title SQL now holds (or
 * `claimTitle`), or with `errorCode`. It answers each prepare round the same
 * way until the server verifies, which it confirms, or gives the request up.
 * It returns the first prepare request. It reads the mailbox itself, not
 * through the editor's sync wake, so a test using it proves nothing about a
 * real tab hearing of the request.
 */
export async function answerTitleRequest(
  id: string,
  email: string,
  options: {
    save?: () => Promise<void>;
    errorCode?: string;
    claimTitle?: string;
  } = {},
): Promise<DocumentFlushRequest> {
  const first = await requestFor(
    id,
    email,
    (request) => request.phase === "prepare",
  );
  const answer = async (prepare: DocumentFlushRequest) => {
    const key = flushAckKey(prepare, TAB.clientId);
    const taken: DocumentFlushAck = { ...envelope(prepare), status: "taken" };
    if (!(await appStateCompareAndSet(email, key, null, taken)))
      throw new Error(`Another answer holds ${key}.`);
    if (prepare === first) await options.save?.();
    if (options.errorCode) {
      await appStateCompareAndSet(email, key, taken, {
        ...envelope(prepare),
        status: "error",
        errorCode: options.errorCode,
      } satisfies DocumentFlushAck);
      return;
    }
    const title = options.claimTitle ?? (await readDocumentTitleRow(id))?.title;
    if (title === undefined)
      throw new Error(`Page ${id} has no row to claim a title from.`);
    await appStateCompareAndSet(email, key, taken, {
      ...envelope(prepare),
      status: "prepared",
      stabilityToken: `stable-${prepare.phaseToken}`,
      claim: { kind: "title", title },
    } satisfies DocumentFlushAck);
  };
  await answer(first);
  if (options.errorCode) return first;
  let prepare = first;
  while (Date.now() < first.expiresAt + 1_000) {
    const request = await appStateGet(email, `flush-request-${id}`);
    if (
      !isDocumentFlushRequest(request) ||
      request.requestId !== first.requestId
    )
      return first;
    if (
      request.phase === "verify" &&
      request.prepareToken === prepare.phaseToken
    ) {
      await appStateCompareAndSet(
        email,
        flushAckKey(request, TAB.clientId),
        null,
        {
          ...envelope(request),
          status: "verified",
          stabilityToken: `stable-${prepare.phaseToken}`,
        } satisfies DocumentFlushAck,
      );
      return first;
    }
    if (
      request.phase === "prepare" &&
      request.phaseToken !== prepare.phaseToken
    ) {
      prepare = request;
      await answer(prepare);
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`The title request for page ${id} never finished.`);
}
