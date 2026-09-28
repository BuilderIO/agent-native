import {
  isCodeAgentRunActive,
  type CodeAgentRunStateLike,
} from "@agent-native/core/client/agent-chat";
import type {
  AgentChatRuntime,
  AgentChatRuntimeDataPart,
  AgentChatRuntimeEvent,
  AgentChatRuntimeMessage,
  AgentChatRuntimeSession,
  AgentChatRuntimeSessionSnapshot,
  AgentChatRuntimeTurn,
} from "@agent-native/core/client/chat";
import {
  normalizeCodeAgentTranscriptForConversation,
  type AgentConversationMessage,
  type CodeAgentConversationTranscriptEvent,
} from "@agent-native/core/client/conversation";

import type { CodeAgentReasoningEffort } from "./types.js";

export const CODE_AGENT_CONVERSATION_MEDIA_TYPE =
  "application/x-agent-native-code-agent-conversation-message";

export const CODE_AGENT_CHAT_METADATA_KEY = "codeAgentChat";

export type CodeAgentChatFollowUpMode = "immediate" | "queued";
export type CodeAgentChatTranscriptEvent = CodeAgentConversationTranscriptEvent;

export interface CodeAgentChatControlResult {
  ok: boolean;
  run?: CodeAgentRunStateLike | null;
  queued?: boolean;
  message?: string;
  error?: string;
}

export interface CodeAgentChatController {
  get(runId: string): Promise<CodeAgentRunStateLike | null>;
  transcript(runId: string): Promise<CodeAgentChatTranscriptEvent[]>;
  sendFollowUp(input: {
    runId: string;
    prompt: string;
    mode?: CodeAgentChatFollowUpMode;
    permissionMode?: string;
    engine?: string;
    model?: string;
    reasoningEffort?: CodeAgentReasoningEffort;
    source?: string;
    metadata?: Record<string, unknown>;
  }): Promise<CodeAgentChatControlResult>;
  control(input: {
    runId: string;
    command: "stop" | "approve";
  }): Promise<CodeAgentChatControlResult>;
}

export interface CodeAgentAgentKitRuntimeOptions {
  controller: CodeAgentChatController;
  isChatBlocked?: () => boolean;
  hideCredentialMessages?: boolean;
  pollIntervalMs?: number;
  idlePollIntervalMs?: number;
  terminalIdlePolls?: number;
}

export function startCodeAgentExternalTranscriptBridge(options: {
  hasAgentKitRun: () => boolean;
  refresh: () => Promise<unknown>;
  intervalMs?: number;
}): () => void {
  const intervalMs = options.intervalMs ?? 1_000;
  let stopped = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const poll = () => {
    if (stopped) return;
    if (!options.hasAgentKitRun()) void options.refresh();
    timeout = setTimeout(poll, intervalMs);
  };
  timeout = setTimeout(poll, intervalMs);
  return () => {
    stopped = true;
    if (timeout !== undefined) clearTimeout(timeout);
  };
}

interface CodeAgentChatTurnMetadata extends Record<string, unknown> {
  attachments?: unknown;
  engine?: string;
  followUpMode?: "immediate" | "queued";
  permissionMode?: string;
  reasoningEffort?: CodeAgentReasoningEffort;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function codeAgentMessage(
  message: AgentConversationMessage,
): AgentChatRuntimeMessage {
  const content: AgentChatRuntimeMessage["content"][number][] = [];
  if (message.text) {
    content.push({ type: "text", text: message.text, format: "markdown" });
  }
  content.push({
    type: "data",
    mediaType: CODE_AGENT_CONVERSATION_MEDIA_TYPE,
    data: { message },
  } satisfies AgentChatRuntimeDataPart);
  return {
    id: message.id,
    role: message.role,
    content,
    ...(message.createdAt ? { createdAt: message.createdAt } : {}),
  };
}

function toConversationEvents(
  events: readonly CodeAgentChatTranscriptEvent[],
): CodeAgentConversationTranscriptEvent[] {
  return events.map((event) => ({
    id: event.id,
    runId: event.runId,
    type: (event.kind ?? event.type ?? "status") as
      | "user"
      | "system"
      | "artifact"
      | "status"
      | "note",
    message: event.message ?? event.text,
    createdAt: event.createdAt,
    ...(event.artifactPath ? { artifactPath: event.artifactPath } : {}),
    ...(event.artifactUrl ? { artifactUrl: event.artifactUrl } : {}),
    ...(event.metadata ? { metadata: event.metadata } : {}),
  }));
}

function conversationMessages(
  events: readonly CodeAgentChatTranscriptEvent[],
  hideCredentialMessages = false,
): AgentConversationMessage[] {
  return normalizeCodeAgentTranscriptForConversation(
    toConversationEvents(events),
    { hideCredentialMessages },
  );
}

function waitForPoll(
  delayMs: number,
  abortSignal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (timeout !== undefined) clearTimeout(timeout);
      abortSignal?.removeEventListener("abort", finish);
      resolve();
    };
    timeout = setTimeout(finish, delayMs);
    abortSignal?.addEventListener("abort", finish, { once: true });
    if (abortSignal?.aborted) finish();
  });
}

function messageKey(message: AgentChatRuntimeMessage): string {
  return JSON.stringify(message);
}

function chatMetadata(
  metadata: Record<string, unknown> | undefined,
): CodeAgentChatTurnMetadata {
  const direct = isRecord(metadata?.[CODE_AGENT_CHAT_METADATA_KEY])
    ? metadata[CODE_AGENT_CHAT_METADATA_KEY]
    : metadata;
  return (direct ?? {}) as CodeAgentChatTurnMetadata;
}

function messageText(message: AgentChatRuntimeMessage | undefined): string {
  return (
    message?.content
      .filter(
        (part): part is Extract<typeof part, { type: "text" }> =>
          part.type === "text",
      )
      .map((part) => part.text)
      .join("\n") ?? ""
  );
}

function pendingApproval(run: CodeAgentRunStateLike | null): boolean {
  return Boolean(
    run?.needsApproval ||
    run?.status === "needs-approval" ||
    run?.phase === "approval-required",
  );
}

function terminalReason(
  run: CodeAgentRunStateLike | null,
): "complete" | "cancelled" | "error" {
  if (
    run?.status === "errored" ||
    run?.phase === "error" ||
    run?.metadata?.runnerState === "failed"
  ) {
    return "error";
  }
  if (
    run?.phase === "stopped" ||
    run?.metadata?.runnerState === "stopped" ||
    run?.metadata?.runnerState === "interrupted"
  ) {
    return "cancelled";
  }
  return "complete";
}

export function createCodeAgentAgentKitRuntime(
  options: CodeAgentAgentKitRuntimeOptions,
): AgentChatRuntime {
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const idlePollIntervalMs = options.idlePollIntervalMs ?? 5_000;
  const terminalIdlePolls = options.terminalIdlePolls ?? 3;
  const sessions = new Map<string, AgentChatRuntimeSession>();

  const getSession = (sessionId: string): AgentChatRuntimeSession => {
    const existing = sessions.get(sessionId);
    if (existing) return existing;

    const session: AgentChatRuntimeSession = {
      id: sessionId,
      runtimeId: "agent-native-code",
      threadId: sessionId,
      capabilities: {
        messages: { streaming: true, history: true, attachments: true },
        sessions: { create: false, persistent: true, fork: false },
        models: { selectable: true, reasoningEffort: true },
      },
      async snapshot(): Promise<AgentChatRuntimeSessionSnapshot> {
        const [events, run] = await Promise.all([
          options.controller.transcript(sessionId),
          options.controller.get(sessionId),
        ]);
        return {
          id: sessionId,
          runtimeId: "agent-native-code",
          threadId: sessionId,
          status: run
            ? isCodeAgentRunActive(run)
              ? "running"
              : pendingApproval(run)
                ? "waiting"
                : terminalReason(run) === "error"
                  ? "error"
                  : terminalReason(run) === "cancelled"
                    ? "cancelled"
                    : "completed"
            : "idle",
          messages: conversationMessages(
            events,
            options.hideCredentialMessages,
          ).map(codeAgentMessage),
        };
      },
      async startTurn(input): Promise<AgentChatRuntimeTurn> {
        if (options.isChatBlocked?.()) {
          throw new Error(
            "Connect Builder.io or add custom keys before chatting.",
          );
        }
        const transcriptBeforeTurn =
          await options.controller.transcript(sessionId);
        const beforeIds = new Set(
          transcriptBeforeTurn.map((event) => event.id),
        );
        const metadata = chatMetadata(input.metadata);
        const attachments = Array.isArray(metadata.attachments)
          ? metadata.attachments
          : undefined;
        const lastUserMessage = [...(input.messages ?? [])]
          .reverse()
          .find((message) => message.role === "user");
        const prompt =
          (input.prompt ?? messageText(lastUserMessage)).trim() ||
          (attachments?.length ? "Use the attached context." : "");
        if (!prompt) throw new Error("Enter a follow-up prompt.");

        const runBeforeTurn = await options.controller.get(sessionId);
        const followUp = await options.controller.sendFollowUp({
          runId: sessionId,
          prompt,
          mode:
            metadata.followUpMode ??
            (runBeforeTurn && isCodeAgentRunActive(runBeforeTurn)
              ? "queued"
              : "immediate"),
          permissionMode: metadata.permissionMode,
          engine: metadata.engine,
          model: input.model,
          reasoningEffort: metadata.reasoningEffort ?? input.reasoningEffort,
          source: "code-agent-chat",
          ...(attachments ? { metadata: { attachments } } : {}),
        });
        if (!followUp.ok) {
          throw new Error(
            followUp.error ?? followUp.message ?? "Could not send follow-up.",
          );
        }

        const events: AsyncIterable<AgentChatRuntimeEvent> = {
          async *[Symbol.asyncIterator]() {
            const emittedMessages = new Map<string, string>();
            for (const message of conversationMessages(
              transcriptBeforeTurn,
              options.hideCredentialMessages,
            )) {
              const runtimeMessage = codeAgentMessage(message);
              emittedMessages.set(
                runtimeMessage.id,
                messageKey(runtimeMessage),
              );
            }
            const seenEventIds = new Set(beforeIds);
            let skippedPromptEcho = false;
            let idlePolls = 0;

            while (!input.abortSignal?.aborted) {
              const [transcript, run] = await Promise.all([
                options.controller.transcript(sessionId),
                options.controller.get(sessionId),
              ]);
              const newEvents = transcript.filter((event) => {
                if (seenEventIds.has(event.id)) return false;
                seenEventIds.add(event.id);
                return true;
              });
              const currentMessages = conversationMessages(
                transcript,
                options.hideCredentialMessages,
              );
              for (const message of currentMessages) {
                const runtimeMessage = codeAgentMessage(message);
                const nextKey = messageKey(runtimeMessage);
                const previousKey = emittedMessages.get(runtimeMessage.id);
                if (
                  previousKey === undefined &&
                  !skippedPromptEcho &&
                  message.role === "user" &&
                  message.text?.trim() === prompt
                ) {
                  skippedPromptEcho = true;
                  emittedMessages.set(runtimeMessage.id, nextKey);
                  continue;
                }
                if (previousKey === nextKey) continue;
                if (previousKey === undefined) {
                  yield {
                    type: "message-start",
                    message: runtimeMessage,
                  };
                }
                yield { type: "message-done", message: runtimeMessage };
                emittedMessages.set(runtimeMessage.id, nextKey);
              }

              if (run && isCodeAgentRunActive(run)) {
                idlePolls = 0;
              } else if (pendingApproval(run)) {
                idlePolls = 0;
              } else if (newEvents.length === 0) {
                idlePolls += 1;
              } else {
                idlePolls = 0;
              }

              if (idlePolls >= terminalIdlePolls) {
                yield { type: "done", reason: terminalReason(run) };
                return;
              }

              await waitForPoll(
                run && isCodeAgentRunActive(run)
                  ? pollIntervalMs
                  : pendingApproval(run)
                    ? pollIntervalMs
                    : idlePollIntervalMs,
                input.abortSignal,
              );
            }
          },
        };

        return {
          id: `code-agent-turn:${sessionId}:${Date.now()}`,
          sessionId,
          events,
        };
      },
      async cancelTurn() {
        // Stopping a Code run is a host-authorized action. AgentKit lifecycle
        // cancellation must not stop local execution when a panel is released.
        return { status: "unsupported" };
      },
    };
    sessions.set(sessionId, session);
    return session;
  };

  return {
    id: "agent-native-code",
    kind: "code-agent",
    label: "Agent-Native Code",
    capabilities: {
      messages: { streaming: true, history: true, attachments: true },
      sessions: { create: false, persistent: true, fork: false },
      models: { selectable: true, reasoningEffort: true },
    },
    createSession(input) {
      const sessionId = input?.threadId ?? input?.id;
      if (!sessionId) throw new Error("Code Agent session id is required.");
      return getSession(sessionId);
    },
    getSession({ sessionId }) {
      return getSession(sessionId);
    },
  };
}
