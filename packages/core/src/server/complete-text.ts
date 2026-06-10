import {
  getStoredModelForEngine,
  registerBuiltinEngines,
  resolveEngine,
  type AgentEngine,
  type EngineContentPart,
  type EngineMessage,
  type EngineStreamOptions,
} from "../agent/engine/index.js";
import { getOwnerActiveApiKey } from "../agent/production-agent.js";
import { EngineError } from "../agent/engine/types.js";
import type { ReasoningEffort } from "../shared/reasoning-effort.js";
import { getRequestUserEmail } from "./request-context.js";

export interface CompleteTextMessage {
  role: "user" | "assistant";
  content: string | EngineContentPart[];
}

export interface CompleteTextUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
}

export interface CompleteTextOptions {
  /** Optional system prompt for the single model call. */
  systemPrompt?: string;
  /** Convenience final user message. Appended after `messages` when both are set. */
  input?: string;
  /** Optional prior messages for narrow multi-turn transforms. */
  messages?: CompleteTextMessage[];
  /** Explicit engine name or instance. Omit to use the normal request/default engine. */
  engine?:
    | string
    | AgentEngine
    | { name: string; config: Record<string, unknown> };
  /** Explicit model. Omit to honor app/user default, then engine default. */
  model?: string;
  /** App/template id used for org-scoped model defaults. */
  appId?: string;
  /** Optional direct API key. Prefer request secrets/env resolution when possible. */
  apiKey?: string;
  maxOutputTokens?: number;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  providerOptions?: EngineStreamOptions["providerOptions"];
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface CompleteTextResult {
  text: string;
  content: EngineContentPart[];
  engine: string;
  model: string;
  stopReason?: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use";
  usage?: CompleteTextUsage;
}

function normalizeCompleteTextMessages(
  messages: readonly CompleteTextMessage[] | undefined,
  input: string | undefined,
): EngineMessage[] {
  const normalized: EngineMessage[] = [];

  for (const message of messages ?? []) {
    const content =
      typeof message.content === "string"
        ? [{ type: "text" as const, text: message.content }]
        : [...message.content];
    normalized.push({ role: message.role, content });
  }

  if (input !== undefined) {
    normalized.push({
      role: "user",
      content: [{ type: "text", text: input }],
    });
  }

  if (normalized.length === 0) {
    throw new Error("completeText requires `input` or at least one message.");
  }

  return normalized;
}

function contentText(parts: readonly EngineContentPart[]): string {
  return parts
    .filter((part): part is Extract<EngineContentPart, { type: "text" }> => {
      return part.type === "text";
    })
    .map((part) => part.text)
    .join("");
}

function createCompletionAbortSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const cleanupFns: Array<() => void> = [];

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      const onAbort = () => controller.abort(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      cleanupFns.push(() => signal.removeEventListener("abort", onAbort));
    }
  }

  if (timeoutMs !== undefined) {
    const timeout = setTimeout(() => {
      controller.abort(
        new Error(`completeText timed out after ${timeoutMs}ms`),
      );
    }, timeoutMs);
    cleanupFns.push(() => clearTimeout(timeout));
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const cleanup of cleanupFns) cleanup();
    },
  };
}

async function resolveCompletionApiKey(
  explicitApiKey: string | undefined,
): Promise<string | undefined> {
  if (explicitApiKey) return explicitApiKey;
  try {
    return await getOwnerActiveApiKey(getRequestUserEmail());
  } catch {
    return undefined;
  }
}

/**
 * Run a single server-side model completion through the framework engine layer.
 *
 * Prefer `sendToAgentChat()` or actions for product workflows where the user
 * should see, steer, or audit the agent. Use this helper only for narrow text
 * transforms that intentionally do not need tools, chat history, or run state.
 */
export async function completeText(
  options: CompleteTextOptions,
): Promise<CompleteTextResult> {
  registerBuiltinEngines();

  const apiKey = await resolveCompletionApiKey(options.apiKey);
  const engine = await resolveEngine({
    engineOption: options.engine,
    apiKey,
    model: options.model,
    appId: options.appId,
  });
  const model =
    options.model ??
    (await getStoredModelForEngine(engine, { appId: options.appId })) ??
    engine.defaultModel;
  const { signal, cleanup } = createCompletionAbortSignal(
    options.signal,
    options.timeoutMs,
  );

  let streamedText = "";
  let finalContent: EngineContentPart[] | undefined;
  let usage: CompleteTextUsage | undefined;
  let stopReason: CompleteTextResult["stopReason"] | undefined;

  try {
    for await (const event of engine.stream({
      model,
      systemPrompt: options.systemPrompt ?? "",
      messages: normalizeCompleteTextMessages(options.messages, options.input),
      tools: [],
      abortSignal: signal,
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
      reasoningEffort: options.reasoningEffort,
      providerOptions: options.providerOptions,
    })) {
      if (event.type === "text-delta") {
        streamedText += event.text;
      } else if (event.type === "assistant-content") {
        finalContent = event.parts;
      } else if (event.type === "usage") {
        usage = {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cacheReadTokens: event.cacheReadTokens,
          cacheWriteTokens: event.cacheWriteTokens,
          totalTokens: event.totalTokens,
          reasoningTokens: event.reasoningTokens,
        };
      } else if (event.type === "stop") {
        if (event.reason === "error") {
          throw new EngineError(event.error ?? "Model completion failed.", {
            errorCode: event.errorCode,
            upgradeUrl: event.upgradeUrl,
            statusCode: event.statusCode,
            providerRetryable: event.providerRetryable,
          });
        }
        stopReason = event.reason;
      }
    }
  } finally {
    cleanup();
  }

  const content = finalContent ?? [{ type: "text", text: streamedText }];
  return {
    text: contentText(content) || streamedText,
    content,
    engine: engine.name,
    model,
    stopReason,
    usage,
  };
}
