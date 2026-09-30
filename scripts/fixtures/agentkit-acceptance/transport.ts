import type {
  AgentKitController,
  AgentThreadState,
} from "@agent-native/agentkit/client";
import type {
  AgentEvent,
  AgentMessage,
  AgentTransport,
  StartRunInput,
} from "@agent-native/agentkit/protocol";

const diagnosticLimit = 200;
const diagnosticTimeline: Array<Record<string, unknown>> = [];

function recordDiagnostic(type: string, detail: Record<string, unknown>): void {
  diagnosticTimeline.push({ type, at: Date.now(), ...detail });
  if (diagnosticTimeline.length > diagnosticLimit) diagnosticTimeline.shift();
}

export function getAcceptanceDiagnostics(): Array<Record<string, unknown>> {
  return [...diagnosticTimeline];
}

export function registerAcceptanceClientDiagnostics(
  controller: AgentKitController,
  threadId: string,
  hasActiveAgentRuns: (thread: AgentThreadState) => boolean,
): () => void {
  if (typeof window !== "undefined") {
    Object.assign(window, {
      __agentKitAcceptanceDiagnostics: getAcceptanceDiagnostics,
    });
  }
  const capture = () => {
    const thread = controller.getThread(threadId);
    recordDiagnostic("client.state", {
      threadId,
      hasActiveRuns: hasActiveAgentRuns(thread),
      activeRunIds: thread.activeRunIds.slice(-diagnosticLimit),
      runs: Object.values(thread.runs)
        .slice(-diagnosticLimit)
        .map((run) => ({
          id: run.id,
          status: run.status,
          lastSequence: run.lastSequence,
          errorCode: run.error?.code,
        })),
      queuedMessageIds: thread.queuedMessages
        .slice(-diagnosticLimit)
        .map((message) => message.id),
      events: thread.events.slice(-20).map((event) => ({
        id: event.id,
        type: event.type,
        runId: event.runId,
        sequence: event.sequence,
        ...(event.type === "run.status" ? { status: event.status } : {}),
        ...(event.type === "approval.requested"
          ? { approvalId: event.request.id }
          : {}),
        ...(event.type === "approval.resolved"
          ? { approvalId: event.approvalId }
          : {}),
      })),
    });
  };
  capture();
  return controller.subscribe(capture);
}

async function diagnose<T>(
  operation: string,
  detail: Record<string, unknown>,
  invoke: () => Promise<T>,
): Promise<T> {
  recordDiagnostic(`${operation}.started`, detail);
  try {
    const result = await invoke();
    recordDiagnostic(`${operation}.completed`, {
      ...detail,
      ...(result &&
      typeof result === "object" &&
      "runId" in result &&
      typeof result.runId === "string"
        ? { resultRunId: result.runId }
        : {}),
    });
    return result;
  } catch (error) {
    recordDiagnostic(`${operation}.failed`, {
      ...detail,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message.slice(0, 512) }
          : { type: typeof error },
    });
    throw error;
  }
}

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
  const originalResumeRun = transport.resumeRun?.bind(transport);
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
    const result = await diagnose(
      "transport.start",
      { threadId: input.threadId },
      () => originalStartRun(input, context),
    );
    promptByRun.set(result.runId, prompt);
    return result;
  };

  if (originalResumeRun) {
    transport.resumeRun = (input, context) =>
      diagnose(
        "transport.resume",
        { threadId: input.threadId, runId: input.runId },
        () => originalResumeRun(input, context),
      );
  }

  if (originalQueueMessage) {
    transport.queueMessage = async (input, context) => {
      const result = await diagnose(
        "transport.queue",
        { threadId: input.threadId },
        () => originalQueueMessage(input, context),
      );
      if (input.text === acceptanceRejectedSteerPrompt) {
        rejectedSteerMessageId = result.message.id;
      }
      return result;
    };
  }

  if (originalSteerQueuedMessage && originalListQueuedMessages) {
    transport.steerQueuedMessage = (input, context) =>
      diagnose(
        "transport.steer",
        { threadId: input.threadId, messageId: input.messageId },
        async () => {
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
        },
      );
  }

  transport.subscribeToRun = async function* (input) {
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
    for await (const event of originalSubscribeToRun(sourceInput)) {
      if (
        event.type === "run.status" ||
        isTerminal(event) ||
        event.type === "approval.requested" ||
        event.type === "approval.resolved"
      ) {
        recordDiagnostic("transport.event", {
          threadId: event.threadId,
          runId: event.runId,
          sequence: event.sequence,
          eventType: event.type,
          ...(event.type === "run.status" ? { status: event.status } : {}),
        });
      }
      // The runtime now publishes model-authored suggestions itself.
      if (event.type === "suggestions.updated" && event.suggestions.length > 0)
        injectedSuggestion = true;
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
