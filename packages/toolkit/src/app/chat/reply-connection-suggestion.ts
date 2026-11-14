import type { AgentThreadState } from "@agent-native/agentkit";
import { splitAgentChatContextFromMessage } from "@agent-native/core/shared";

export interface LatestReplyContext {
  /** Only the thread's newest message offers a connection. */
  isLatest: boolean;
  /** The user message it replies to; a connect started here resumes it. */
  userText: string;
  /** Providers the agent has asked to connect in this thread, one per line. */
  agentRequestedProviders: string;
}

/**
 * Primitives only: a thread selector compares this on every streamed delta.
 */
export function latestReplyContext(
  thread: Pick<AgentThreadState, "messages" | "connectionRequests">,
  messageId: string,
): LatestReplyContext {
  if (thread.messages.at(-1)?.id !== messageId) {
    return { isLatest: false, userText: "", agentRequestedProviders: "" };
  }
  const user = thread.messages.findLast((message) => message.role === "user");
  const userText = (user?.parts ?? [])
    .flatMap((part) =>
      part.type === "text"
        ? [splitAgentChatContextFromMessage(part.text).message]
        : [],
    )
    .join("\n");
  // Settled requests count too: one connected through a workspace connection
  // or declined must not come back as an MCP card.
  const agentRequestedProviders = [
    ...new Set(
      Object.values(thread.connectionRequests).map((request) =>
        request.provider.trim().toLowerCase(),
      ),
    ),
  ]
    .sort()
    .join("\n");
  return { isLatest: true, userText, agentRequestedProviders };
}

/**
 * One card, on the newest reply once it finishes: the reply's own ask, else
 * what the user asked to connect. Never mid-run: a connect resumes the user's
 * prompt, which would send it twice. Never beside the agent's own request card.
 */
export function pickReplyConnectionSuggestion<
  T extends { id: string; provider: string; name: string },
>({
  context,
  replyText,
  replyFinished,
  find,
}: {
  context: LatestReplyContext;
  replyText: string;
  replyFinished: boolean;
  find: (text: string) => T | null;
}): T | null {
  if (!context.isLatest || !replyFinished) return null;
  const agentRequested = new Set(
    context.agentRequestedProviders.split("\n").filter(Boolean),
  );
  const offered = (integration: T | null) =>
    integration &&
    !agentRequested.has(integration.id.toLowerCase()) &&
    !agentRequested.has(integration.provider.toLowerCase()) &&
    // A Jira request names the brand; the catalog id is "atlassian".
    !agentRequested.has(integration.name.toLowerCase())
      ? integration
      : null;
  return offered(find(replyText)) ?? offered(find(context.userText));
}
