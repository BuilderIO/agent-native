import type {
  AgentEvent,
  AgentMessage,
  AgentTransport,
  StartRunInput,
} from "@agent-native/agentkit/protocol";

export const acceptanceSuggestionPrompt =
  "Summarize the accepted AgentKit release in one sentence.";

export const acceptanceSuggestionSourcePrompt =
  "Call the hello action with name AgentKit Browser, then report the greeting in streamed markdown.";

export const acceptanceRejectedSteerPrompt =
  "Rejected steer: prove the queued message is restored before retry.";

function messageText(message: AgentMessage | undefined): string {
  return (
    message?.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("") ?? ""
  );
}

function latestUserPrompt(input: StartRunInput): string {
  return messageText(
    [...input.messages].reverse().find((message) => message.role === "user"),
  );
}

function isTerminal(event: AgentEvent): boolean {
  return (
    event.type === "run.completed" ||
    event.type === "run.failed" ||
    event.type === "run.cancelled" ||
    (event.type === "run.status" &&
      (event.status === "completed" ||
        event.status === "failed" ||
        event.status === "cancelled"))
  );
}

export function instrumentAgentKitAcceptanceTransport<T extends AgentTransport>(
  transport: T,
): T {
  const promptByRun = new Map<string, string>();
  const suggestionSequenceByRun = new Map<string, number>();
  const originalStartRun = transport.startRun.bind(transport);
  const originalSubscribeToRun = transport.subscribeToRun.bind(transport);
  const originalQueueMessage = transport.queueMessage?.bind(transport);
  const originalSteerQueuedMessage =
    transport.steerQueuedMessage?.bind(transport);
  const originalListQueuedMessages =
    transport.listQueuedMessages?.bind(transport);
  let rejectSteerOnce = true;
  let rejectedSteerMessageId: string | undefined;

  transport.startRun = async (input, context) => {
    const prompt = latestUserPrompt(input);
    if (prompt === acceptanceRejectedSteerPrompt && rejectSteerOnce) {
      rejectSteerOnce = false;
      throw new Error("Deterministic queue steering rejection");
    }
    const result = await originalStartRun(input, context);
    promptByRun.set(result.runId, prompt);
    return result;
  };

  if (originalQueueMessage) {
    transport.queueMessage = async (input, context) => {
      const result = await originalQueueMessage(input, context);
      if (input.text === acceptanceRejectedSteerPrompt) {
        rejectedSteerMessageId = result.message.id;
      }
      return result;
    };
  }

  if (originalSteerQueuedMessage && originalListQueuedMessages) {
    transport.steerQueuedMessage = async (input, context) => {
      if (rejectSteerOnce && input.messageId === rejectedSteerMessageId) {
        rejectSteerOnce = false;
        throw new Error("Deterministic queue steering rejection");
      }
      const queued = await originalListQueuedMessages(input, context);
      if (
        rejectSteerOnce &&
        queued.some(
          (message) =>
            message.id === input.messageId &&
            message.text === acceptanceRejectedSteerPrompt,
        )
      ) {
        rejectSteerOnce = false;
        throw new Error("Deterministic queue steering rejection");
      }
      return originalSteerQueuedMessage(input, context);
    };
  }

  transport.subscribeToRun = async function* (input, context) {
    const prompt = promptByRun.get(input.runId);
    const afterSequence = input.afterSequence ?? 0;
    const suggestionSequence = suggestionSequenceByRun.get(input.runId);
    const suggestionAccepted =
      suggestionSequence !== undefined && afterSequence >= suggestionSequence;
    const sourceAfterSequence = suggestionAccepted
      ? afterSequence - 1
      : input.afterSequence;
    let injectedSuggestion = suggestionAccepted;
    let sequenceOffset = suggestionAccepted ? 1 : 0;
    const sourceInput =
      sourceAfterSequence === input.afterSequence
        ? input
        : { ...input, afterSequence: sourceAfterSequence };
    for await (const event of originalSubscribeToRun(sourceInput, context)) {
      if (
        prompt !== acceptanceSuggestionSourcePrompt ||
        prompt === undefined ||
        !isTerminal(event) ||
        injectedSuggestion ||
        (input.afterSequence ?? 0) >= event.sequence
      ) {
        yield sequenceOffset
          ? { ...event, sequence: event.sequence + sequenceOffset }
          : event;
        continue;
      }

      injectedSuggestion = true;
      sequenceOffset = 1;
      suggestionSequenceByRun.set(input.runId, event.sequence);
      yield {
        id: `${event.id}-suggestions`,
        threadId: event.threadId,
        runId: event.runId,
        sequence: event.sequence,
        occurredAt: event.occurredAt,
        type: "suggestions.updated",
        suggestions: [
          {
            id: "agentkit-acceptance-suggestion",
            label: "Summarize this release",
            prompt: acceptanceSuggestionPrompt,
          },
        ],
      };
      yield { ...event, sequence: event.sequence + sequenceOffset };
    }
  };

  return transport;
}
