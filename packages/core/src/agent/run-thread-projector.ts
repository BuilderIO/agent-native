import {
  CHECKPOINT_TERMINAL_EVENT_SEQ,
  getCurrentTurnRunEventsForThread,
} from "./run-store.js";
import { buildAssistantMessage } from "./thread-data-builder.js";
import type { RunEvent } from "./types.js";

interface BuildJournalAssistantMessageOptions {
  suppressInternalContinuation?: boolean;
  preserveUnknownToolOutcomes?: boolean;
  scope?: { type: string; id: string } | null;
  runDurationMs?: number;
}

export class RunTranscriptJournalGapError extends Error {
  constructor(
    readonly runId: string,
    readonly missingSequences: number[],
  ) {
    super(
      `Run transcript journal is missing events for ${runId}: ${missingSequences.join(", ")}`,
    );
    this.name = "RunTranscriptJournalGapError";
  }
}

function isTerminalProjectionEvent(event: RunEvent["event"]): boolean {
  return (
    event.type === "done" ||
    event.type === "error" ||
    event.type === "missing_api_key" ||
    event.type === "loop_limit" ||
    event.type === "auto_continue"
  );
}

/** Builds assistant content from the durable event journal and verifies that
 * every published nonterminal event reached that journal before projection.
 */
export async function buildAssistantMessageFromRunJournal(input: {
  threadId: string;
  turnId: string;
  runId: string;
  runEvents: readonly RunEvent[];
  options?: BuildJournalAssistantMessageOptions;
}): Promise<ReturnType<typeof buildAssistantMessage>> {
  const persisted = (
    await getCurrentTurnRunEventsForThread(input.threadId, input.turnId)
  ).filter(
    (event) =>
      event.runId === input.runId && event.seq < CHECKPOINT_TERMINAL_EVENT_SEQ,
  );
  const persistedSequences = new Set(persisted.map(({ seq }) => seq));
  const missingSequences = input.runEvents
    .filter(
      ({ seq, event }) =>
        !isTerminalProjectionEvent(event) && !persistedSequences.has(seq),
    )
    .map(({ seq }) => seq);
  if (missingSequences.length > 0) {
    throw new RunTranscriptJournalGapError(input.runId, missingSequences);
  }

  const events: RunEvent[] = persisted.map(({ seq, event }) => ({
    seq,
    event,
  }));
  for (const event of input.runEvents) {
    if (
      isTerminalProjectionEvent(event.event) &&
      !persistedSequences.has(event.seq)
    ) {
      events.push(event);
    }
  }
  events.sort((left, right) => left.seq - right.seq);

  return buildAssistantMessage(events, input.runId, {
    ...input.options,
    turnId: input.turnId,
  });
}
