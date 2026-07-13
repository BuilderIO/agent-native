import type { H3Event } from "h3";

import type { AgentChatEvent } from "../agent/types.js";
import type { EnvKeyConfig } from "../server/create-server.js";

export type IntegrationConversationType =
  | "channel"
  | "private_channel"
  | "dm"
  | "group_dm"
  | "unknown";

export type IntegrationTriggerKind = "mention" | "dm" | "thread_reply";

export interface IntegrationActorTrust {
  memberType: "owner" | "admin" | "member" | "guest" | "external" | "unknown";
  verified: boolean;
}

export interface IntegrationContextMessage {
  senderId?: string;
  senderName?: string;
  text: string;
  timestamp: number;
  sourceUrl?: string;
  reactions?: Array<{ name: string; count: number }>;
  files?: IntegrationFileReference[];
}

export interface IntegrationFileReference {
  id: string;
  name?: string;
  mimetype?: string;
  size?: number;
  permalink?: string;
  downloadUrl?: string;
}

/**
 * Normalized incoming message from any messaging platform.
 */
export interface IncomingMessage {
  /** Platform identifier (e.g., "slack", "telegram", "whatsapp") */
  platform: string;
  /** Platform-specific thread/conversation identifier */
  externalThreadId: string;
  /** Message text content */
  text: string;
  /** Display name of the sender */
  senderName?: string;
  /** Verified sender email, when the platform can provide one */
  senderEmail?: string;
  /** Platform-specific sender ID */
  senderId?: string;
  /** How this message intentionally invoked an agent. */
  triggerKind?: IntegrationTriggerKind;
  /** Normalized provider conversation type for policy evaluation. */
  conversationType?: IntegrationConversationType;
  /** Provider tenant/workspace identifier. */
  tenantId?: string;
  /** Authorized integration scope resolved before execution. */
  integrationScopeId?: string;
  /** Normalized actor trust; unknown/unverified callers fail closed. */
  actorTrust?: IntegrationActorTrust;
  /** Bounded provider-native conversation context hydrated at run time. */
  contextMessages?: IntegrationContextMessage[];
  /** Provider file references only. Raw file bodies never belong here. */
  files?: IntegrationFileReference[];
  /** Server-verified approval grants carried by an interaction continuation. */
  approvedToolCalls?: string[];
  /**
   * Whether the platform cryptographically authenticated that the message
   * genuinely came from the claimed sender (e.g. inbound email that passed
   * DKIM, or an aligned SPF pass, for the From domain). Defaults to
   * undefined/false for platforms that don't provide sender authentication.
   *
   * Owner-resolution paths that grant a real user's identity/credentials
   * MUST treat a missing/false value as "unverified" and fail closed —
   * never derive a privileged acting identity from an unverified sender.
   */
  senderVerified?: boolean;
  /** Raw platform-specific context needed for routing responses */
  platformContext: Record<string, unknown>;
  /**
   * Short-lived delivery context needed only while the queued task is active.
   * Secrets such as Discord interaction tokens belong here, never in
   * `platformContext`, thread mappings, logs, or agent-visible context.
   */
  responseContext?: Record<string, unknown>;
  /** Provider-native thread/topic reference, when one exists. */
  threadRef?: string;
  /**
   * Canonical provider URL for the originating message thread, when the
   * provider can resolve one. This is safe agent-visible provenance (not a
   * credential) and should be preserved across A2A delegation so created
   * artifacts can link back to their request source.
   */
  sourceUrl?: string;
  /**
   * Trusted app-side routing guidance added after provider parsing. Adapters
   * should not copy this from user-controlled webhook payload fields.
   */
  routingHint?: {
    targetAgent?: string;
    instruction: string;
  };
  /**
   * Trusted app-side note about the caller's identity/visibility tier, set
   * after execution-context resolution (e.g. an anonymous org-scoped Slack
   * member). Surfaced to the agent as integration context. Adapters must not
   * copy this from user-controlled webhook payload fields.
   */
  identityNote?: string;
  /** Provider-native message/activity reference for contextual replies. */
  replyRef?: string;
  /** Message timestamp (epoch ms) */
  timestamp: number;
}

/**
 * Outgoing message to send back to a messaging platform.
 */
export interface OutgoingMessage {
  /** Text content of the response */
  text: string;
  /** Platform-specific payload (e.g., Slack blocks, Telegram parse_mode) */
  platformContext: Record<string, unknown>;
}

/**
 * Proactive outbound message target for a platform.
 * Used when the agent needs to send to a saved destination instead of replying
 * to the current inbound thread.
 */
export interface OutboundTarget {
  /** Canonical platform-specific destination id (channel, chat, thread, etc.) */
  destination: string;
  /** Optional thread reference when the destination supports threading */
  threadRef?: string | null;
  /** Optional fallback display label */
  label?: string;
  /** Provider tenant/workspace used to select an installation credential. */
  tenantId?: string;
  /** Managed installation id when the caller already resolved it. */
  installationId?: string;
}

/**
 * Connection status for a platform integration.
 */
export interface IntegrationStatus {
  platform: string;
  /** Human-readable label (e.g., "Slack", "Telegram") */
  label: string;
  /** Whether the integration is explicitly enabled */
  enabled: boolean;
  /** Whether all required credentials are configured */
  configured: boolean;
  /** Platform-specific details (workspace name, bot username, etc.) */
  details?: Record<string, unknown>;
  /** Error message if something is wrong */
  error?: string;
  /** The webhook URL that should be configured in the platform */
  webhookUrl?: string;
  /** The full list of env keys (required + optional) the adapter recognizes,
   *  including UI hints. Surfaced on the integrations status endpoint so the
   *  frontend can render fields without hard-coding them per platform. */
  requiredEnvKeys?: import("../server/create-server.js").EnvKeyConfig[];
}

export interface PlatformAdapterCapabilities {
  /** The adapter can deliver a response to the current inbound event. */
  replyText: boolean;
  /** The adapter can send without an active inbound event. */
  proactiveMessages: boolean;
  /** The adapter preserves a provider-native thread or topic reference. */
  nativeThreads: boolean;
  /** The adapter can quote/reply to a specific inbound message. */
  contextualReplies: boolean;
  /** The provider requires an immediate deferred webhook acknowledgement. */
  deferredWebhookResponse: boolean;
  /** The adapter only receives explicit interactions, not ordinary messages. */
  interactionOnly?: boolean;
  /** The adapter can hydrate bounded native thread/file/reaction context. */
  nativeContextHydration?: boolean;
  /** The adapter can surface live agent progress in the provider UI. */
  liveRunProgress?: boolean;
}

export interface PlatformRunProgress {
  /**
   * Opaque, provider-owned reference for resuming this progress surface from a
   * durable continuation. It deliberately contains no user content,
   * credentials, or provider payload.
   */
  ref?: PlatformRunProgressRef;
  /** Receive normalized agent events. Implementations should throttle writes. */
  onEvent(event: AgentChatEvent): Promise<void> | void;
  /** Finalize the provider-native progress surface with the answer. */
  complete(message: OutgoingMessage): Promise<void>;
  /** Mark the provider-native surface failed and leave a retryable explanation. */
  fail?(message: string): Promise<void>;
}

/**
 * Safe, minimal reference to a provider-native run-progress surface.
 *
 * The field values are opaque to the framework. Adapters may use `kind` to
 * distinguish their own resume strategy and `streamTs` to identify the
 * provider-side stream. No incoming message text, platform payload, or
 * credential belongs here.
 */
export interface PlatformRunProgressRef {
  kind: string;
  streamTs: string;
}

export interface ImmediateWebhookResponse {
  status: number;
  body: unknown;
}

export class UnsupportedPlatformCapabilityError extends Error {
  readonly code = "UNSUPPORTED_PLATFORM_CAPABILITY";

  constructor(
    readonly platform: string,
    readonly capability: keyof PlatformAdapterCapabilities,
  ) {
    super(`Platform ${platform} does not support ${capability}`);
    this.name = "UnsupportedPlatformCapabilityError";
  }
}

/**
 * Platform adapter interface — implement this for each messaging platform.
 *
 * Each adapter handles the platform-specific concerns:
 * - Webhook verification (HMAC signatures, challenge responses)
 * - Message parsing (platform events → normalized IncomingMessage)
 * - Response formatting (agent text → platform-specific format)
 * - Response delivery (POST back to platform API)
 */
export interface PlatformAdapter {
  /** Unique platform identifier */
  readonly platform: string;
  /** Human-readable label */
  readonly label: string;
  /** Explicit runtime behavior. Missing fields are treated as unsupported. */
  readonly capabilities?: Partial<PlatformAdapterCapabilities>;

  /** Env keys this adapter needs (tokens, secrets, etc.) */
  getRequiredEnvKeys(): EnvKeyConfig[];

  /**
   * Handle platform-specific verification challenges.
   * For example, Slack sends a `url_verification` event when setting up.
   * Return `{ handled: true, response }` to short-circuit the webhook handler.
   */
  handleVerification(event: H3Event): Promise<{
    handled: boolean;
    response?: unknown;
  }>;

  /**
   * Validate the webhook request signature.
   * Returns true if the request is authentic.
   */
  verifyWebhook(event: H3Event): Promise<boolean>;

  /**
   * Parse the webhook payload into a normalized IncomingMessage.
   * Return null to silently ignore the event (bot messages, edits, etc.).
   */
  parseIncomingMessage(event: H3Event): Promise<IncomingMessage | null>;

  /**
   * Hydrate bounded provider-native context after durable enqueue, outside the
   * provider acknowledgement budget. Implementations must return references,
   * metadata, and text only — never persist file bodies or credentials.
   */
  hydrateIncomingMessage?(incoming: IncomingMessage): Promise<IncomingMessage>;

  /**
   * Hydrate only verified sender identity before execution-context selection.
   * This runs on the provider acknowledgement path and must avoid fetching
   * conversation history or file bodies.
   */
  hydrateIncomingIdentity?(incoming: IncomingMessage): Promise<IncomingMessage>;

  /**
   * Provider-specific response returned only after a message is verified and
   * durably enqueued. Discord uses this to return a type-5 deferred response
   * within its three-second interaction deadline.
   */
  getImmediateWebhookResponse?(
    incoming: IncomingMessage,
  ): ImmediateWebhookResponse | null;

  /**
   * Return pre-canonical thread ids used by older adapter versions. The
   * integration handler checks these only when the canonical mapping is
   * missing, then aliases a match to the canonical id without forking history.
   */
  getLegacyExternalThreadIds?(incoming: IncomingMessage): string[];

  /**
   * Send the agent's response back to the messaging platform.
   *
   * If `opts.placeholderRef` is provided (returned earlier by
   * `postProcessingPlaceholder`), adapters that support in-place edits should
   * update that placeholder message rather than posting a new one. Adapters
   * without an "update message" API can ignore the ref and post fresh.
   */
  sendResponse(
    message: OutgoingMessage,
    context: IncomingMessage,
    opts?: { placeholderRef?: string },
  ): Promise<void>;

  /**
   * Send a short best-effort system notice to the conversation the incoming
   * message arrived on (polite identity declines, one-time access guidance).
   * Bypasses agent formatting. When `dedupeKey` is provided, the adapter may
   * drop the notice if the same key was sent recently. Callers must treat
   * failures as non-fatal.
   */
  sendSystemNotice?(
    incoming: IncomingMessage,
    text: string,
    opts?: {
      dedupeKey?: string;
      /** Dedupe window for `dedupeKey`. Adapters pick a default when omitted. */
      dedupeTtlMs?: number;
    },
  ): Promise<void>;

  /**
   * Optionally post a "working on it…" placeholder message immediately when a
   * webhook arrives, before the agent loop runs. Adapters that support
   * in-place message edits (Slack via `chat.update`, etc.) return an opaque
   * `placeholderRef` that the webhook flow threads through to `sendResponse`
   * so the same message is updated with the final answer once ready.
   *
   * Adapters without edit support should leave this undefined; the webhook
   * handler will skip the placeholder step entirely.
   */
  postProcessingPlaceholder?(
    incoming: IncomingMessage,
  ): Promise<{ placeholderRef: string } | null>;

  /** Start a provider-native progress/streaming surface for an agent run. */
  startRunProgress?(
    incoming: IncomingMessage,
  ): Promise<PlatformRunProgress | null>;

  /**
   * Reattach a durable continuation to a provider-native progress surface
   * previously started by this adapter. Adapters that cannot resume a native
   * surface should omit this and the continuation will use its normal reply
   * path instead.
   */
  resumeRunProgress?(
    incoming: IncomingMessage,
    ref: PlatformRunProgressRef,
  ): Promise<PlatformRunProgress | null>;

  /**
   * Send a proactive outbound message to a platform destination. Adapters that
   * only support direct replies can omit this.
   */
  sendMessageToTarget?(
    message: OutgoingMessage,
    target: OutboundTarget,
  ): Promise<void>;

  /**
   * Format plain agent response text into a platform-appropriate message.
   * Handles markdown conversion, message splitting for length limits, etc.
   *
   * `opts.threadDeepLinkUrl`, when present, is a URL back to the originating
   * thread in the dispatch UI. Adapters that support rich blocks should
   * render this as a button (Slack); adapters that don't may inline it as a
   * link or simply omit it.
   */
  formatAgentResponse(
    text: string,
    opts?: { threadDeepLinkUrl?: string },
  ): OutgoingMessage;

  /** Return current connection/configuration status for the settings UI. */
  getStatus(baseUrl?: string): Promise<IntegrationStatus>;
}

export function assertPlatformCapability(
  adapter: PlatformAdapter,
  capability: keyof PlatformAdapterCapabilities,
): void {
  if (adapter.capabilities?.[capability] !== true) {
    throw new UnsupportedPlatformCapabilityError(adapter.platform, capability);
  }
}

/**
 * Options for the integrations plugin.
 */
export interface IntegrationsPluginOptions {
  /** App identifier used by call-agent to prevent self-calls (e.g. "dispatch"). */
  appId?: string;
  /** Platform adapters to enable. Default: all built-in adapters with configured env keys. */
  adapters?: PlatformAdapter[];
  /** System prompt for the agent (same as agent-chat). Inherited from agent-chat plugin if not set. */
  systemPrompt?: string;
  /** Actions registry (same as agent-chat). */
  actions?: Record<string, import("../agent/production-agent.js").ActionEntry>;
  /** Model to use. Defaults to the resolved engine's default model. */
  model?: string;
  /** Anthropic API key. Falls back to ANTHROPIC_API_KEY env var. */
  apiKey?: string;
  /** Agent engine to use. Defaults to the same engine resolver as web chat. */
  engine?:
    | import("../agent/engine/types.js").AgentEngine
    | string
    | {
        name: string;
        config: Record<string, unknown>;
      };
  /**
   * Resolve which owner should receive personal resource context and own the
   * created chat thread for an incoming platform message.
   */
  resolveOwner?: (incoming: IncomingMessage) => string | Promise<string>;
  /**
   * Resolve the durable execution principal for an inbound provider message.
   * Shared channels should use a service principal; DMs may use a verified
   * linked user. When present this supersedes `resolveOwner`.
   */
  resolveExecutionContext?: (
    incoming: IncomingMessage,
  ) => IntegrationExecutionContext | Promise<IntegrationExecutionContext>;
  /**
   * Explicitly allow an unlinked, verified Slack workspace member to run a DM
   * with the installation organization's shared/service visibility. Disabled
   * by default: DM identity resolution fails closed unless an app deliberately
   * accepts this wider access tier.
   */
  allowAnonymousOrgScopedSlackDm?: boolean;
  /**
   * Optional preprocessor for inbound platform messages. Can intercept special
   * commands (such as `/link`) before the agent loop runs.
   */
  beforeProcess?: (
    incoming: IncomingMessage,
    adapter: PlatformAdapter,
  ) => Promise<
    | {
        handled: true;
        responseText?: string;
      }
    | { handled: false }
  >;
}

export interface IntegrationExecutionContext {
  ownerEmail: string;
  orgId: string | null;
  principalType: "user" | "service";
  installationId?: string;
  scopeId?: string;
  /**
   * True when a hydrated full workspace member could not be matched to an
   * organization member and runs with the anonymous org-scoped service
   * principal (org-wide visibility only, nothing user-private).
   */
  anonymousMember?: boolean;
}
