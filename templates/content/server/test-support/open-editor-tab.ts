import {
  appStateCompareAndSet,
  appStateGet,
} from "@agent-native/core/application-state";
import { loadAwarenessRowsStrict } from "@agent-native/core/collab";
import { getDbExec } from "@agent-native/core/db";

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
      7,
      JSON.stringify({
        user: { email },
        visible: true,
        canFlushDocument: true,
        ...state,
      }),
      Date.now(),
    ],
  });
}

/**
 * The tab's side of a flush request: it waits for a request for page `id` in
 * `email`'s mailbox, runs `save`, answers with `answer`, and returns the
 * request it answered. It reads the mailbox itself, not through the editor's
 * sync wake, so a test using it proves nothing about a real tab hearing of
 * the request.
 */
export async function answerFlushRequest(
  id: string,
  email: string,
  answer: Record<string, unknown>,
  save?: () => Promise<void>,
): Promise<Record<string, unknown>> {
  const key = `flush-request-${id}`;
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const request = await appStateGet(email, key);
    if (request?.status === "pending") {
      await save?.();
      await appStateCompareAndSet(email, key, request, {
        ...request,
        ...answer,
      });
      return request;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`No flush request for ${id} reached ${email}'s tab.`);
}
