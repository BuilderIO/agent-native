import { captureError } from "../server/capture-error.js";
import { loadPriorTurnToolCallJournal } from "./engine/tool-call-journal-seed.js";
import { getPreviousTurnNewestRun } from "./run-store.js";
import { buildResumeJournalNote } from "./tool-call-journal.js";

// i18n-ignore: Internal model context, never shown as product copy.
const STOPPED_TURN_INTRO =
  "Your previous reply in this conversation stopped before it finished, so the history above does not show the tool calls it made. Unless the user asks you to redo something, treat the record below as what already happened and do not repeat a completed step.";

// i18n-ignore: Internal model context, never shown as product copy.
const STOPPED_TURN_UNREADABLE =
  "Your previous reply in this conversation stopped before it finished, and its record of tool calls could not be read. Some of its actions may already have run: before repeating anything with a side effect (sending, charging, creating, deleting), check whether it already happened.";

// i18n-ignore: Internal model context, never shown as product copy.
const PREVIOUS_TURN_UNCHECKED =
  "Whether your previous reply in this conversation finished could not be checked. Before repeating anything with a side effect (sending, charging, creating, deleting), check whether it already happened.";

/**
 * What a new turn needs to know when the turn before it stopped unfinished.
 * A new turn sees earlier turns as text only, and a turn cut off mid-tool may
 * have no text at all, so without this a "continue" redoes every step. The
 * record comes from the run ledger, which a crash cannot lose the way it can
 * lose the thread's saved reply. Null when the previous turn finished, never
 * started, or ran no tools; a caution, not null, when that cannot be read.
 */
export async function loadStoppedPreviousTurnNote(
  threadId: string,
  turnId: string,
): Promise<string | null> {
  let previous: Awaited<ReturnType<typeof getPreviousTurnNewestRun>>;
  try {
    previous = await getPreviousTurnNewestRun(threadId, turnId);
  } catch (error) {
    captureError(error, {
      tags: { source: "agent-chat", failureClass: "previous-turn-note" },
      extra: { threadId, turnId },
    });
    return `<previous-turn-stopped>
${PREVIOUS_TURN_UNCHECKED}
</previous-turn-stopped>`;
  }
  if (
    !previous ||
    previous.status === "completed" ||
    previous.status === "running"
  ) {
    return null;
  }
  const journal = await loadPriorTurnToolCallJournal(threadId, previous.turnId);
  if (journal.status === "unreadable") {
    return `<previous-turn-stopped>\n${STOPPED_TURN_UNREADABLE}\n</previous-turn-stopped>`;
  }
  const record = journal.toolCallJournal
    ? buildResumeJournalNote(journal.toolCallJournal)
    : null;
  return record
    ? `<previous-turn-stopped>\n${STOPPED_TURN_INTRO}\n\n${record}\n</previous-turn-stopped>`
    : null;
}
