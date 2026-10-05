import {
  getThread,
  updateThreadData,
  withThreadDataLock,
} from "../chat-threads/store.js";
import { readStoppedRunForThreadFold } from "./run-store.js";
import {
  buildAssistantMessage,
  extractThreadMeta,
  foldAssistantTurn,
  normalizeThreadRepository,
} from "./thread-data-builder.js";

/**
 * Saves the reply of a run the server ended because its worker stopped
 * (a crash, a killed function) into the thread, the way a run that finishes
 * saves its own. That worker held the reply only in memory, so without this
 * the turn's finished tool calls exist only in the run ledger, which is
 * pruned, and the thread forgets an email already went out.
 *
 * A run continued in its turn is saved as the first part of that turn's
 * reply; one with nothing after it keeps its error. Nothing is saved once a
 * later turn started, because the reply would land after that turn's
 * messages.
 */
export async function foldReapedRunIntoThread(runId: string): Promise<void> {
  const run = await readStoppedRunForThreadFold(runId);
  if (!run || run.laterTurnStarted) return;
  const assistant = buildAssistantMessage(run.events, runId, {
    turnId: run.turnId,
    suppressInternalContinuation: run.continuedInTurn,
  });
  if (!assistant) return;
  await withThreadDataLock(run.threadId, async () => {
    const thread = await getThread(run.threadId);
    if (!thread) return;
    const repo = normalizeThreadRepository(
      JSON.parse(thread.threadData || "{}"),
    );
    const last = repo.messages.at(-1)?.message ?? repo.messages.at(-1);
    const lastTurnId = last?.metadata?.custom?.turnId;
    if (
      last?.role !== "user" &&
      !(last?.role === "assistant" && lastTurnId === run.turnId)
    ) {
      return;
    }
    const folded = foldAssistantTurn(repo, assistant, {
      runId,
      turnId: run.turnId,
    });
    const meta = extractThreadMeta(folded);
    await updateThreadData(
      run.threadId,
      JSON.stringify(folded),
      thread.title,
      meta.preview || thread.preview,
      folded.messages.length,
    );
  });
}
