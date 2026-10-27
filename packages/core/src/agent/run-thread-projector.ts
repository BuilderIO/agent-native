import {
  CHECKPOINT_TERMINAL_EVENT_SEQ,
  getCurrentTurnRunEventsForThread,
} from "./run-store.js";
import {
  buildAssistantMessage,
  buildAssistantTurnSegments,
  foldAssistantTurn,
  type SteeredRunSegment,
} from "./thread-data-builder.js";
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
export async function buildAssistantMessageFromRunJournal(
  input: Parameters<typeof buildAssistantTurnFromRunJournal>[0],
): Promise<ReturnType<typeof buildAssistantMessage>> {
  return (await buildAssistantTurnFromRunJournal(input)).assistant;
}

/**
 * The turn's reply from the journal, split where the user sent messages into
 * it. `assistant` is the reply the run's first output folds into; `steered`
 * holds this run's delivered messages and the replies after them. After an
 * earlier run of the turn delivered one, `parentId` is that message, since the
 * turn's reply continues below it.
 */
export async function buildAssistantTurnFromRunJournal(input: {
  threadId: string;
  turnId: string;
  runId: string;
  runEvents: readonly RunEvent[];
  options?: BuildJournalAssistantMessageOptions;
}): Promise<{
  assistant: ReturnType<typeof buildAssistantMessage>;
  steered: SteeredRunSegment[];
  parentId?: string;
}> {
  const turnJournal = await getCurrentTurnRunEventsForThread(
    input.threadId,
    input.turnId,
  );
  const currentRunPersisted = turnJournal.filter(
    (event) =>
      event.runId === input.runId && event.seq < CHECKPOINT_TERMINAL_EVENT_SEQ,
  );
  const persistedSequences = new Set(currentRunPersisted.map(({ seq }) => seq));
  const missingSequences = input.runEvents
    .filter(
      ({ seq, event }) =>
        !isTerminalProjectionEvent(event) && !persistedSequences.has(seq),
    )
    .map(({ seq }) => seq);
  if (missingSequences.length > 0) {
    throw new RunTranscriptJournalGapError(input.runId, missingSequences);
  }

  const currentRunEndIndex = turnJournal.reduce(
    (lastIndex, { runId }, index) =>
      runId === input.runId ? index : lastIndex,
    -1,
  );
  const relevantJournal =
    currentRunEndIndex === -1
      ? []
      : turnJournal
          .slice(0, currentRunEndIndex + 1)
          .filter(
            ({ runId, seq }) =>
              runId !== input.runId || seq < CHECKPOINT_TERMINAL_EVENT_SEQ,
          );
  const runGroups = new Map<string, RunEvent[]>();
  for (const { runId, seq, event } of relevantJournal) {
    const events = runGroups.get(runId) ?? [];
    events.push({ seq, event });
    runGroups.set(runId, events);
  }
  if (!runGroups.has(input.runId)) runGroups.set(input.runId, []);

  let repo: { messages: unknown[] } = { messages: [] };
  let steered: SteeredRunSegment[] = [];
  let parentId: string | undefined;
  for (const [runId, persistedRunEvents] of runGroups) {
    const runEvents = persistedRunEvents.sort(
      (left, right) => left.seq - right.seq,
    );
    if (runId === input.runId) {
      for (const event of input.runEvents) {
        if (
          isTerminalProjectionEvent(event.event) &&
          !persistedSequences.has(event.seq)
        ) {
          runEvents.push(event);
        }
      }
      runEvents.sort((left, right) => left.seq - right.seq);
    }
    const segments = buildAssistantTurnSegments(
      runEvents,
      runId,
      runId === input.runId
        ? { ...input.options, turnId: input.turnId }
        : {
            suppressInternalContinuation:
              input.options?.suppressInternalContinuation,
            preserveUnknownToolOutcomes:
              input.options?.preserveUnknownToolOutcomes,
            scope: input.options?.scope,
            turnId: input.turnId,
          },
    );
    const lastSteered = segments.steered.at(-1);
    if (runId === input.runId) {
      steered = segments.steered;
    } else if (lastSteered) {
      // That run's fold saved everything up to its last delivered message;
      // only the reply after it continues into this run's output.
      const last = lastSteered;
      repo = { messages: [] };
      parentId = last.user.id;
      if (last.assistant) {
        repo = foldAssistantTurn(repo, last.assistant, {
          runId,
          turnId: input.turnId,
        });
      }
      continue;
    }
    if (!segments.assistant) continue;
    repo = foldAssistantTurn(repo, segments.assistant, {
      runId,
      turnId: input.turnId,
    });
  }
  const entry = repo.messages.at(-1);
  const message =
    entry && typeof entry === "object" && "message" in entry
      ? entry.message
      : entry;
  return {
    assistant:
      (message as ReturnType<typeof buildAssistantMessage> | undefined) ?? null,
    steered,
    ...(parentId ? { parentId } : {}),
  };
}
