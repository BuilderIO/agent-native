import {
  getThread,
  updateThreadData,
  withThreadDataLock,
} from "../chat-threads/store.js";
import {
  buildAssistantMessage,
  buildUserMessage,
  extractThreadMeta,
  foldAssistantTurn,
  upsertUserMessage,
} from "./thread-data-builder.js";
import type { AgentChatEvent } from "./types.js";

export interface PersistAgentTurnToThreadInput {
  threadId: string;
  /** Must own the thread: this writes into a thread found only by id. */
  ownerEmail: string;
  /** When set, must match the thread's organization. */
  orgId?: string | null;
  /** The user message that started the turn. */
  prompt: string;
  runId: string;
  /** Defaults to `runId`. */
  turnId?: string;
  /** Epoch ms; stamps the reply with how long the run took. */
  startedAt?: number;
  /** What the run's `send` received, in order. */
  events: readonly AgentChatEvent[];
  /** Replaces the thread's title when non-empty. */
  threadTitle?: string;
  /** Saved as a terminal error on the reply when the run failed outside the loop. */
  persistFailure?: { message: string; errorCode: string };
}

/**
 * `runAgentLoop` streams a turn to `send` but never writes the thread, so a
 * turn run directly leaves `thread_data` empty. This saves the prompt and the
 * reply the events describe, which is what opening the thread shows.
 */
export async function persistAgentTurnToThread(
  input: PersistAgentTurnToThreadInput,
): Promise<void> {
  const turnId = input.turnId ?? input.runId;
  await withThreadDataLock(input.threadId, async () => {
    const row = await getThread(input.threadId);
    if (!row) {
      throw new Error(
        `Thread ${input.threadId} was not found while saving run ${input.runId}.`,
      );
    }
    if (
      row.ownerEmail !== input.ownerEmail ||
      (input.orgId && row.orgId !== input.orgId)
    ) {
      throw new Error(
        `Thread ${input.threadId} does not belong to the caller saving run ${input.runId}.`,
      );
    }

    let repo: unknown;
    try {
      repo = JSON.parse(row.threadData || "{}");
    } catch {
      throw new Error(`Thread ${input.threadId} has unreadable thread data.`);
    }
    if (!repo || typeof repo !== "object" || Array.isArray(repo)) {
      throw new Error(`Thread ${input.threadId} has unreadable thread data.`);
    }

    repo = upsertUserMessage(
      repo,
      buildUserMessage({ text: input.prompt, runId: turnId, turnId }),
    );
    const events = input.events.map((event, seq) => ({ seq, event }));
    if (input.persistFailure) {
      events.push({
        seq: events.length,
        event: {
          type: "error",
          error: input.persistFailure.message,
          errorCode: input.persistFailure.errorCode,
          recoverable: false,
        },
      });
    }
    const assistantMsg = buildAssistantMessage(events, input.runId, {
      suppressInternalContinuation: !input.persistFailure,
      turnId,
      runDurationMs:
        input.startedAt !== undefined && Number.isFinite(input.startedAt)
          ? Math.max(0, Date.now() - input.startedAt)
          : undefined,
    });
    if (assistantMsg) {
      repo = foldAssistantTurn(repo, assistantMsg, {
        runId: input.runId,
        turnId,
      });
    }

    const meta = extractThreadMeta(repo);
    const messages = (repo as { messages?: unknown[] }).messages;
    const saved = await updateThreadData(
      input.threadId,
      JSON.stringify(repo),
      input.threadTitle || row.title,
      meta.preview || row.preview,
      Array.isArray(messages) ? messages.length : 0,
    );
    // False means the row was gone by the time of the write.
    if (!saved) {
      throw new Error(
        `Thread ${input.threadId} was deleted while saving run ${input.runId}.`,
      );
    }
  });
}
