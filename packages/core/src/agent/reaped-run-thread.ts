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
  isRunPrompt,
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
 * later turn started or a later prompt was saved, because the reply would
 * land under that prompt instead of its own.
 */
export async function foldReapedRunIntoThread(
  runId: string,
  terminalError?: { error: string; errorCode: string },
): Promise<void> {
  const run = await readStoppedRunForThreadFold(runId);
  if (!run || run.laterTurnStarted) return;
  const events = [...run.events];
  if (terminalError) {
    const last = events.at(-1);
    if (
      last &&
      (last.event.type === "done" ||
        last.event.type === "error" ||
        last.event.type === "missing_api_key" ||
        last.event.type === "loop_limit" ||
        last.event.type === "auto_continue")
    ) {
      events[events.length - 1] = {
        ...last,
        event: { type: "error", ...terminalError },
      };
    } else {
      events.push({
        seq: (last?.seq ?? -1) + 1,
        event: { type: "error", ...terminalError },
      });
    }
  }
  const assistant = buildAssistantMessage(events, runId, {
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
      {
        beforeUpdate: async (tx) => {
          const { rows } = await tx.execute({
            sql: `SELECT thread_data FROM chat_threads
                  WHERE id = ? AND owner_email = ? FOR UPDATE`,
            args: [run.threadId, thread.ownerEmail],
          });
          const currentThreadData = (
            rows[0] as { thread_data?: string } | undefined
          )?.thread_data;
          if (typeof currentThreadData !== "string") return false;
          const currentRepo = normalizeThreadRepository(
            JSON.parse(currentThreadData || "{}"),
          );
          const last =
            currentRepo.messages.at(-1)?.message ?? currentRepo.messages.at(-1);
          return last?.role === "user"
            ? isRunPrompt(last, { runId, ...run })
            : last?.role === "assistant" &&
                last.metadata?.custom?.turnId === run.turnId;
        },
      },
    );
  });
}
