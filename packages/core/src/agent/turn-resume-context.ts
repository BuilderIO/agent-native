import type { EngineMessage } from "./engine/types.js";
import {
  buildAssistantMessage,
  lastUserPromptIndex,
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
      const ledgerExecutionStepIds = new Set(
        ledgerMessages.flatMap(({ content }) =>
          content.flatMap((part) =>
            (part.type === "tool-call" || part.type === "tool-result") &&
            part.executionStepId
              ? [part.executionStepId]
              : [],
          ),
        ),
      );
      const currentTurnStart = lastUserPromptIndex(messages);
      if (currentTurnStart >= 0) {
        messages = messages.flatMap((message, index) => {
          if (index < currentTurnStart) return [message];
          const content = message.content.filter((part) => {
            if (part.type === "tool-call") {
              return part.executionStepId
                ? !ledgerExecutionStepIds.has(part.executionStepId)
                : !ledgerCallIds.has(part.id);
            }
            if (part.type === "tool-result") {
              return part.executionStepId
                ? !ledgerExecutionStepIds.has(part.executionStepId)
                : !ledgerCallIds.has(part.toolCallId);
            }
            return true;
          });
          return content.length > 0 ? [{ ...message, content }] : [];
        });
      }
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
