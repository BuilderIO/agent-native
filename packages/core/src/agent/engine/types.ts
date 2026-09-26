import type { ReasoningEffort } from "../../shared/reasoning-effort.js";


export class EngineError extends Error {
  readonly errorCode?: string;
  readonly upgradeUrl?: string;
  readonly statusCode?: number;
  readonly providerRetryable?: boolean;
  readonly requestId?: string;
  readonly contextOverflow?: boolean;
  readonly requestShape?: EngineRequestShape;
  readonly retryAfterMs?: number;
  constructor(
    message: string,
    opts?: {
      errorCode?: string;
      upgradeUrl?: string;
      statusCode?: number;
      providerRetryable?: boolean;
      requestId?: string;
      contextOverflow?: boolean;
      requestShape?: EngineRequestShape;
      retryAfterMs?: number;
    },
  ) {
    super(message);
    this.name = "EngineError";
    this.errorCode = opts?.errorCode;
    this.upgradeUrl = opts?.upgradeUrl;
    this.statusCode = opts?.statusCode;
    this.providerRetryable = opts?.providerRetryable;
    this.requestId = opts?.requestId;
    this.contextOverflow = opts?.contextOverflow;
    this.requestShape = opts?.requestShape;
    this.retryAfterMs = opts?.retryAfterMs;
  }
}


export interface EngineTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
  providerOptions?: Record<string, unknown>;
}


export interface EngineTextPart {
  type: "text";
  text: string;
}

export interface EngineImagePart {
  type: "image";
  data: string;
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
}

export interface EngineFilePart {
  type: "file";
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

export interface EngineToolResultImagePart {
  url?: string;
  data?: string;
  mediaType?: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  label?: string;
}

export interface EngineToolResultPart {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  toolInput: string;
  content: string;
  isError?: boolean;
  images?: EngineToolResultImagePart[];
}

export interface EngineThinkingPart {
  type: "thinking";
  text: string;
  signature?: string;
  redactedData?: string;
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


export type EngineEvent =
  | { type: "text-delta"; text: string }
  | { type: "thinking-delta"; text: string; signature?: string }
  | { type: "tool-input-start"; id?: string; name?: string }
  | { type: "tool-input-delta"; id?: string; name?: string; text?: string }
  | { type: "gateway-heartbeat" }
  | { type: "tool-call"; id: string; name: string; input: unknown }
  | {
      type: "tool-call-error";
      id: string;
      name: string;
      input: unknown;
      error: string;
    }
  | {
      /**
       * Token usage for one model call.
       *
       * `inputTokens` is the WHOLE prompt and INCLUDES `cacheReadTokens` and
       * `cacheWriteTokens` — the cache fields say how that total splits, they
       * do not add to it. Providers disagree here (OpenAI's `prompt_tokens`
       * includes cached tokens, Anthropic's `input_tokens` excludes them), so
       * every engine converts to this one convention before emitting. The AI
       * SDK settled on the same shape: `inputTokens.total` with `noCache` /
       * `cacheRead` / `cacheWrite` underneath it.
       *
       * Emitting the exclusive form instead is not a rounding difference: it
       * makes `calculateCost` bill the cached tokens twice, once at the full
       * input rate and again at the cache rate.
       */
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
      totalTokens?: number;
      reasoningTokens?: number;
      builderCreditsUsed?: number;
    }
  | {
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
      errorCode?: string;
      upgradeUrl?: string;
      statusCode?: number;
      providerRetryable?: boolean;
      requestId?: string;
      contextOverflow?: boolean;
      requestShape?: EngineRequestShape;
      retryAfterMs?: number;
    };

export interface EngineRequestShape {
  model: string;
  payloadBytes: number;
  toolCount: number;
  messageCount: number;
}


export interface EngineCapabilities {
  thinking: boolean;
  promptCaching: boolean;
  vision: boolean;
  computerUse: boolean;
  parallelToolCalls: boolean;
}


export interface EngineStreamOptions {
  model: string;
  systemPrompt: string;
  messages: EngineMessage[];
  tools: EngineTool[];
  abortSignal: AbortSignal;
  maxOutputTokens?: number;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
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


export interface AgentEngine {
  readonly name: string;
  readonly label: string;
  readonly defaultModel: string;
  readonly supportedModels: readonly string[];
  readonly acceptsCustomModels?: boolean;
  readonly preserveCustomModels?: boolean;
  readonly capabilities: EngineCapabilities;

  stream(opts: EngineStreamOptions): AsyncIterable<EngineEvent>;
}
