import type { EngineContentPart, EngineMessage } from "./engine/types.js";
import {
  buildAssistantTurnSegments,
  lastUserPromptIndex,
  threadDataToEngineMessages,
} from "./thread-data-builder.js";
import {
  buildResumeJournalNote,
  type ToolCallJournal,
} from "./tool-call-journal.js";
import type { AgentChatEvent, AgentChatSteeredUserMessage } from "./types.js";

/** Reaper recovery uses ledger events because a hard kill cannot save thread history. */
export function buildTurnResumeContext(
  options: {
    messages: EngineMessage[];
    journal: ToolCallJournal | null;
  } & (
    | {
        events: AgentChatEvent[];
        /** The content the run delivered a Send now message as, attachments included. */
        steeredUserContent: (
          message: AgentChatSteeredUserMessage,
        ) => EngineContentPart[];
      }
    | { events?: undefined }
  ),
): { messages: EngineMessage[]; journalNote: string | null } {
  let messages = [...options.messages];
  if (options.events) {
    const { assistant, steered } = buildAssistantTurnSegments(
      options.events.map((event, seq) => ({ seq, event })),
      "durable-resume",
      { suppressInternalContinuation: true, preserveUnknownToolOutcomes: true },
    );
    if (assistant || steered.length > 0) {
      const replay = (message: NonNullable<typeof assistant>) =>
        threadDataToEngineMessages(
          { messages: [{ message }] },
          { includeToolCalls: true },
        );
      // A message sent into the run was read after the tool results before
      // it, so the resumed model sees it in the same place.
      const ledgerMessages: EngineMessage[] = [
        ...(assistant ? replay(assistant) : []),
        ...steered.flatMap(({ delivered, assistant: reply }) => [
          {
            role: "user" as const,
            content: options.steeredUserContent(delivered),
          },
          ...(reply ? replay(reply) : []),
        ]),
      ];
      const ledgerCallIds = new Set(
        ledgerMessages.flatMap(({ content }) =>
          content.flatMap((part) =>
            part.type === "tool-call" && !part.executionStepId ? [part.id] : [],
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
