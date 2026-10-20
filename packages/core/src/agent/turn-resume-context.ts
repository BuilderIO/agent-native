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
  let messages = [...options.messages];
  if (options.events) {
    const assistant = buildAssistantMessage(
      options.events.map((event, seq) => ({ seq, event })),
      "durable-resume",
      { suppressInternalContinuation: true, preserveUnknownToolOutcomes: true },
    );
    if (assistant) {
      const ledgerMessages = threadDataToEngineMessages(
        { messages: [{ message: assistant }] },
        { includeToolCalls: true },
      );
      const ledgerCallIds = new Set(
        ledgerMessages.flatMap(({ content }) =>
          content.flatMap((part) =>
            part.type === "tool-call" ? [part.id] : [],
          ),
        ),
      );
      messages = messages.flatMap((message) => {
        const content = message.content.filter((part) =>
          part.type === "tool-call"
            ? !ledgerCallIds.has(part.id)
            : part.type === "tool-result"
              ? !ledgerCallIds.has(part.toolCallId)
              : true,
        );
        return content.length > 0 ? [{ ...message, content }] : [];
      });
      messages.push(...ledgerMessages);
    }
  }
  return {
    messages,
    journalNote: options.journal
      ? buildResumeJournalNote(options.journal)
      : null,
  };
}
