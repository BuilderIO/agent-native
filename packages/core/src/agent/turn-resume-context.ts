import type { EngineMessage } from "./engine/types.js";
import {
  buildAssistantMessage,
  threadDataToEngineMessages,
} from "./thread-data-builder.js";
import {
  buildResumeJournalNote,
  type ToolCallJournal,
} from "./tool-call-journal.js";
import type { AgentChatEvent } from "./types.js";

/** Reaper recovery uses ledger events because a hard kill cannot save thread history. */
export function buildTurnResumeContext(options: {
  messages: EngineMessage[];
  journal: ToolCallJournal | null;
  events?: AgentChatEvent[];
}): { messages: EngineMessage[]; journalNote: string | null } {
  const messages = [...options.messages];
  if (options.events) {
    const assistant = buildAssistantMessage(
      options.events.map((event, seq) => ({ seq, event })),
      "durable-resume",
    );
    if (assistant) {
      messages.push(
        ...threadDataToEngineMessages(
          { messages: [{ message: assistant }] },
          { includeToolCalls: true },
        ),
      );
    }
  }
  return {
    messages,
    journalNote: options.journal
      ? buildResumeJournalNote(options.journal)
      : null,
  };
}
