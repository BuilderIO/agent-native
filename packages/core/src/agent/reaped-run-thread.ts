import {
  getThread,
  updateThreadData,
  withThreadDataLock,
} from "../chat-threads/store.js";
import { RUN_NOT_STARTED_METADATA_KEY } from "../shared/agent-chat-run-not-started.js";
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
): Promise<"projected" | "superseded" | "retry"> {
  const run = await readStoppedRunForThreadFold(runId);
  if (!run || run.laterTurnStarted) return "superseded";
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
  const { overlayCompletedExecutionStepOutcomes } =
    await import("./engine/tool-call-journal-seed.js");
  const projectedEvents = await overlayCompletedExecutionStepOutcomes(
    run.threadId,
    run.turnId,
    events.map(({ event }) => event),
  );
  const assistant = buildAssistantMessage(
    projectedEvents.map((event, seq) => ({ seq, event })),
    runId,
    {
      turnId: run.turnId,
      suppressInternalContinuation: run.continuedInTurn,
    },
  );
  if (!assistant) return "projected";
  return withThreadDataLock(run.threadId, async () => {
    const thread = await getThread(run.threadId);
    if (!thread) return "superseded";
    const repo = normalizeThreadRepository(
      JSON.parse(thread.threadData || "{}"),
    );
    const folded = foldAssistantTurn(repo, assistant, {
      runId,
      turnId: run.turnId,
    });
    const meta = extractThreadMeta(folded);
    let rejectedDisposition: "superseded" | "retry" = "superseded";
    const updated = await updateThreadData(
      run.threadId,
      JSON.stringify(folded),
      thread.title,
      meta.preview || thread.preview,
      folded.messages.length,
      {
        beforeUpdate: async (tx) => {
          await tx.execute({
            sql: "SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))",
            args: [
              `agent-native:turn-execution-lease:${run.threadId}:${run.turnId}`,
            ],
          });
          const leaseResult = await tx.execute({
            sql: `SELECT owner_run_id, generation
                  FROM agent_execution_leases
                  WHERE thread_id = ? AND turn_id = ? FOR UPDATE`,
            args: [run.threadId, run.turnId],
          });
          const lease = leaseResult.rows[0] as
            | { owner_run_id?: string; generation?: number | string }
            | undefined;
          if (
            (run.workerGeneration !== null && !lease) ||
            (lease &&
              (lease.owner_run_id !== runId ||
                (run.workerGeneration !== null &&
                  String(lease.generation) !== run.workerGeneration)))
          ) {
            return false;
          }
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
          const ownsPrompt =
            last?.role === "user"
              ? isRunPrompt(last, { runId, ...run })
              : last?.role === "assistant" &&
                last.metadata?.custom?.turnId === run.turnId;
          const unstartedTurnId =
            last?.role === "user"
              ? last.metadata?.custom?.submittedTurnId
              : last?.role === "assistant"
                ? last.metadata?.custom?.turnId
                : undefined;
          const isRefusedNewerTurn =
            last?.metadata?.custom?.[RUN_NOT_STARTED_METADATA_KEY] === true &&
            typeof unstartedTurnId === "string" &&
            unstartedTurnId !== run.turnId;
          if (!ownsPrompt && !isRefusedNewerTurn) {
            rejectedDisposition = "retry";
          }
          return ownsPrompt;
        },
      },
    );
    return updated ? "projected" : rejectedDisposition;
  });
}
