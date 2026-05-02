/**
 * Pluggable Agent Engine abstraction.
 *
 * AgentEngine is the thin LLM adapter that sits beneath runAgentLoop.
 * Every caller (HTTP handler, A2A, MCP, sub-agents, webhooks, jobs) uses
 * an AgentEngine instead of a raw @anthropic-ai/sdk client.
 *
 * The framework's tool dispatch loop, sub-agents, SSE event stream, and all
 * other harness features live above this layer and are unaffected by engine
 * selection.
 */

/**
 * Thrown when an engine emits a terminal stop-error event. Carries optional
 * structured fields (errorCode / upgradeUrl) that propagate up to the SSE
 * "error" event so the chat UI can render a structured CTA — e.g. an
 * Upgrade button for Builder gateway 402 quota errors.
 *
 * Lives in the engine types module (not production-agent) so run-manager and
 * other consumers can `instanceof` it without an import cycle.
 */
export class EngineError extends Error {
  readonly errorCode?: string;
  readonly upgradeUrl?: string;
  constructor(
    message: string,
    opts?: { errorCode?: string; upgradeUrl?: string },
  ) {
    super(message);
    this.name = "EngineError";
    this.errorCode = opts?.errorCode;
    this.upgradeUrl = opts?.upgradeUrl;
  }
}

// ---------------------------------------------------------------------------
// Tool / parameter types
// ---------------------------------------------------------------------------

/**
 * Engine-normalized tool definition. Structurally identical to Anthropic's
 * Tool type, with snake_case renamed to camelCase for consistency.
 */
export interface EngineTool {
  name: string;
  description: string;
  /** JSON Schema for the tool's input parameters */
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
  /**
   * Provider-specific options for this tool.
   * E.g. `{ anthropic: { cacheControl: { type: "ephemeral" } } }`
   */
  providerOptions?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Message / content part types
// ---------------------------------------------------------------------------

export interface EngineTextPart {
  type: "text";
  text: string;
}

export interface EngineImagePart {
  type: "image";
  /** Base64-encoded image data */
  data: string;
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
}

export interface EngineFilePart {
  type: "file";
  /** Base64-encoded file data */
  data: string;
  mediaType: string;
  filename?: string;
}

export interface EngineToolCallPart {
  type: "tool-call";
  id: string;
  name: string;
  input: unknown;
}

export interface EngineToolResultPart {
  type: "tool-result";
  toolCallId: string;
  /** Required by AI SDK v6+ ModelMessage. */
  toolName?: string;
  content: string;
  isError?: boolean;
}

export interface EngineThinkingPart {
  type: "thinking";
  text: string;
  /** Opaque signature for pass-through on next turn (Anthropic extended thinking) */
  signature?: string;
}

export type EngineContentPart =
  | EngineTextPart
  | EngineImagePart
  | EngineFilePart
  | EngineToolCallPart
  | EngineToolResultPart
  | EngineThinkingPart;

export type EngineMessage =
  | { role: "user"; content: EngineContentPart[] }
  | { role: "assistant"; content: EngineContentPart[] };

// ---------------------------------------------------------------------------
// Streaming event types
// ---------------------------------------------------------------------------

export type EngineEvent =
  | { type: "text-delta"; text: string }
  | { type: "thinking-delta"; text: string; signature?: string }
  | { type: "tool-call"; id: string; name: string; input: unknown }
  | {
      type: "tool-call-error";
      id: string;
      name: string;
      input: unknown;
      error: string;
    }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
      totalTokens?: number;
      reasoningTokens?: number;
    }
  | {
      /** Final assistant content for the turn. Engines MUST emit this
       *  exactly once, immediately before the terminal `stop` event. */
      type: "assistant-content";
      parts: EngineContentPart[];
    }
  | {
      type: "stop";
      reason:
        | "end_turn"
        | "tool_use"
        | "max_tokens"
        | "stop_sequence"
        | "error";
      error?: string;
      /**
       * Optional machine-readable error code for structured UI handling.
       * Used by the Builder gateway engine to signal quota/auth failures
       * (e.g. "credits-limit-monthly", "gateway_not_enabled") so the UI
       * can render an upgrade CTA instead of a plain error string.
       */
      errorCode?: string;
      /**
       * Optional URL the UI should link to when rendering the error.
       * Paired with errorCode — e.g. credits-limit-* stop events carry
       * a link to the user's Builder billing page.
       */
      upgradeUrl?: string;
    };

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export interface EngineCapabilities {
  /** Extended / adaptive thinking support */
  thinking: boolean;
  /** Anthropic-style prompt caching (cache_control blocks) */
  promptCaching: boolean;
  /** Vision / image input */
  vision: boolean;
  /** Computer use tool support */
  computerUse: boolean;
  /** Multiple tool calls in a single response */
  parallelToolCalls: boolean;
}

// ---------------------------------------------------------------------------
// Stream options
// ---------------------------------------------------------------------------

export interface EngineStreamOptions {
  model: string;
  systemPrompt: string;
  messages: EngineMessage[];
  tools: EngineTool[];
  abortSignal: AbortSignal;
  maxOutputTokens?: number;
  temperature?: number;
  /**
   * Provider-specific options passed opaquely.
   * Engines forward options they understand and ignore unknown keys.
   *
   * Example (Anthropic):
   * ```ts
   * providerOptions: {
   *   anthropic: {
   *     thinking: { type: "enabled", budgetTokens: 8000 },
   *     cacheControl: { type: "ephemeral" },
   *   }
   * }
   * ```
   */
  providerOptions?: {
    anthropic?: {
      thinking?: { type: "enabled"; budgetTokens: number };
      cacheControl?: { type: "ephemeral" } | boolean;
      topK?: number;
    };
    openai?: Record<string, unknown>;
    google?: Record<string, unknown>;
    [provider: string]: Record<string, unknown> | undefined;
  };
}

// ---------------------------------------------------------------------------
// AgentEngine interface
// ---------------------------------------------------------------------------

/**
 * The pluggable LLM adapter interface.
 *
 * Each engine performs one LLM API round-trip per `stream()` call.
 * The framework's runAgentLoop drives the tool-calling loop by calling
 * stream() repeatedly with updated messages.
 *
 * Engines yield EngineEvent items as they receive them from the LLM.
 * They MUST yield a `stop` event as the last item, even on error.
 */
export interface AgentEngine {
  /** Unique identifier, e.g. "anthropic", "ai-sdk:anthropic", "ai-sdk:openai" */
  readonly name: string;
  /** Human-readable label for UI display */
  readonly label: string;
  /** Default model for this engine */
  readonly defaultModel: string;
  /** Models this engine supports */
  readonly supportedModels: readonly string[];
  /** Capability flags used to gate provider-specific features */
  readonly capabilities: EngineCapabilities;

  /**
   * Stream a single LLM API call. Yields EngineEvent items.
   * The caller (runAgentLoop) handles retries, tool dispatch, and looping.
   */
  stream(opts: EngineStreamOptions): AsyncIterable<EngineEvent>;
}
