import type {
  AgentEvent,
  AgentMessage,
  AgentTransport,
  StartRunInput,
} from "@agent-native/agentkit-protocol";

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
    event.type === "run.cancelled"
  );
}

/**
 * Deterministic fault and event injection for the generated-app acceptance
 * harness. It wraps the production transport in place so queue rollback,
 * persistence, HTTP calls, and thread lifecycle still run through Core.
 */
export function instrumentAgentKitAcceptanceTransport<T extends AgentTransport>(
  transport: T,
): T {
  const promptByRun = new Map<string, string>();
  const originalStartRun = transport.startRun.bind(transport);
  const originalSubscribeToRun = transport.subscribeToRun.bind(transport);
  let rejectSteerOnce = true;

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

  transport.subscribeToRun = async function* (input, context) {
    const prompt = promptByRun.get(input.runId);
    for await (const event of originalSubscribeToRun(input, context)) {
      if (
        prompt !== acceptanceSuggestionSourcePrompt ||
        prompt === undefined ||
        !isTerminal(event) ||
        (input.afterSequence ?? 0) >= event.sequence
      ) {
        yield event;
        continue;
      }

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
      yield { ...event, sequence: event.sequence + 1 };
    }
  };

  return transport;
}
