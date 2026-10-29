/**
 * One event per agent request the server accepts, carrying the turn id the
 * server stores on that request's run so the two join. A turn's continuations
 * are further requests: they repeat its `turn_id` as `initiator: "system"`, so
 * count turns by distinct `turn_id`, and the turns people started by
 * `initiator` `user` or `app`. A request refused for a busy run slot and then
 * queued is counted once when the browser promotes it, and not yet when the
 * server's inbox drain admits it. A replay is not counted, including a retry
 * the server answers with the run it already started. A send routed to
 * Builder or an MCP host never starts a local turn; it is reported with
 * `routed_to` and no `turn_id`, also when the host has not confirmed it.
 * Never the message text.
 */
export const TURN_SUBMITTED_EVENT = "agent_turn_submitted";

/**
 * `system` is a turn the chat started on its own: a recovery, continuation,
 * approval, setup replay, or background send. `app` came from app code through
 * `sendToAgentChat`, including one deferred while the thread restored. `user`
 * is everything else the person typed or picked.
 */
export type TurnInitiator = "user" | "app" | "system";

/** The surface a turn reports when nothing names one (the legacy `chat_submit` default). */
export const DEFAULT_TURN_SURFACE = "chat";

export interface TurnSubmittedReport {
  readonly turnId: string;
  readonly threadId?: string;
  readonly runId?: string;
  readonly surface: string;
  readonly initiator: TurnInitiator;
  readonly submitMessageId?: string;
  readonly recoveryOfRunId?: string;
  readonly requestMode?: string;
  /** Consumed only to derive privacy-safe metadata; never sent to analytics. */
  readonly promptForMetadata?: string;
}

export interface RoutedTurnSubmittedReport {
  readonly routedTo: "builder" | "mcp_host";
  readonly surface: string;
  readonly submitMessageId?: string;
  readonly requestMode?: string;
  /** Consumed only to derive privacy-safe metadata; never sent to analytics. */
  readonly promptForMetadata?: string;
}

/** Reads only the accepted turn's submitted user text for derived metadata. */
export function acceptedPromptForMetadata(input: {
  initiator: TurnInitiator;
  prompt?: string;
  messages?: readonly {
    role: string;
    content: readonly { type: string; text?: unknown }[];
  }[];
}): string | undefined {
  if (input.initiator === "system") return undefined;
  if (typeof input.prompt === "string") return input.prompt;
  const latestUserMessage = [...(input.messages ?? [])]
    .reverse()
    .find((message) => message.role === "user");
  if (!latestUserMessage) return undefined;
  const text = latestUserMessage.content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
  return text || undefined;
}
