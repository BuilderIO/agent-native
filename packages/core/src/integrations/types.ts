import type { H3Event } from "h3";
import type { EnvKeyConfig } from "../server/create-server.js";

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
  /** Platform-specific sender ID */
  senderId?: string;
  /** Raw platform-specific context needed for routing responses */
  platformContext: Record<string, unknown>;
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
   * Send the agent's response back to the messaging platform.
   */
  sendResponse(
    message: OutgoingMessage,
    context: IncomingMessage,
  ): Promise<void>;

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
   */
  formatAgentResponse(text: string): OutgoingMessage;

  /** Return current connection/configuration status for the settings UI. */
  getStatus(baseUrl?: string): Promise<IntegrationStatus>;
}

/**
 * Options for the integrations plugin.
 */
export interface IntegrationsPluginOptions {
  /** Platform adapters to enable. Default: all built-in adapters with configured env keys. */
  adapters?: PlatformAdapter[];
  /** System prompt for the agent (same as agent-chat). Inherited from agent-chat plugin if not set. */
  systemPrompt?: string;
  /** Actions registry (same as agent-chat). */
  actions?: Record<string, import("../agent/production-agent.js").ActionEntry>;
  /** Model to use. Default: claude-sonnet-4-6 */
  model?: string;
  /** Anthropic API key. Falls back to ANTHROPIC_API_KEY env var. */
  apiKey?: string;
  /**
   * Resolve which owner should receive personal resource context and own the
   * created chat thread for an incoming platform message.
   */
  resolveOwner?: (incoming: IncomingMessage) => string | Promise<string>;
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
