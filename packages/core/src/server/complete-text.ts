import { withoutWriteObservation } from "../action-frame.js";
import {
  getStoredModelForEngine,
  normalizeModelForEngine,
  registerBuiltinEngines,
  resolveEngine,
  type AgentEngine,
  type EngineContentPart,
  type EngineMessage,
  type EngineStreamOptions,
} from "../agent/engine/index.js";
import {
  PrivateCompletionError,
  toPrivateCompletionError,
} from "../agent/engine/private-completion-error.js";
import { EngineError } from "../agent/engine/types.js";
import {
  resolveOwnerEngineApiKey,
  type ResolvedOwnerApiKey,
} from "../agent/production-agent.js";
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
  systemPrompt?: string;
  input?: string;
  messages?: CompleteTextMessage[];
  engine?:
    | string
    | AgentEngine
    | { name: string; config: Record<string, unknown> };
  model?: string;
  appId?: string;
  apiKey?: string;
  maxOutputTokens?: number;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  privateContent?: boolean;
  providerOptions?: EngineStreamOptions["providerOptions"];
  beforeModelDispatch?: EngineStreamOptions["beforeModelDispatch"];
  onModelDispatchStarted?: EngineStreamOptions["onModelDispatchStarted"];
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
): {
  signal: AbortSignal;
  cleanup: () => void;
  getTimeoutError: () => EngineError | undefined;
} {
  const controller = new AbortController();
  const cleanupFns: Array<() => void> = [];
  let timeoutError: EngineError | undefined;

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
      timeoutError = new EngineError(
        `completeText timed out after ${timeoutMs}ms`,
        { errorCode: "complete_text_timeout" },
      );
      controller.abort(timeoutError);
    }, timeoutMs);
    cleanupFns.push(() => clearTimeout(timeout));
  }

  return {
    signal: controller.signal,
    getTimeoutError: () => timeoutError,
    cleanup: () => {
      for (const cleanup of cleanupFns) cleanup();
    },
  };
}

async function resolveCompletionApiKey(
  options: CompleteTextOptions,
): Promise<ResolvedOwnerApiKey> {
  if (options.apiKey) {
    return { apiKey: options.apiKey, apiKeyEnvVar: undefined };
  }
  return resolveOwnerEngineApiKey({
    engineOption: options.engine,
    ownerEmail: getRequestUserEmail(),
  });
}

async function runCompleteText(
  options: CompleteTextOptions,
  beforeStream?: (engine: AgentEngine) => void,
): Promise<CompleteTextResult> {
  registerBuiltinEngines();

  const {
    apiKey,
    apiKeyEnvVar,
    credentialProvenance: apiKeyProvenance,
  } = await resolveCompletionApiKey(options);
  const engine = await resolveEngine({
    engineOption: options.engine,
    apiKey,
    apiKeyEnvVar,
    apiKeyProvenance,
    model: options.model,
    appId: options.appId,
  });
  beforeStream?.(engine);
  const modelCandidate =
    options.model ??
    (await getStoredModelForEngine(engine, { appId: options.appId })) ??
    engine.defaultModel;
  const model = normalizeModelForEngine(engine, modelCandidate);
  const completionAbort = createCompletionAbortSignal(
    options.signal,
    options.timeoutMs,
  );
  const { signal } = completionAbort;

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
      // Forward privateContent only when supplied so the ordinary stream
      // options keep their existing exact shape.
      ...(options.privateContent !== undefined
        ? { privateContent: options.privateContent }
        : {}),
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
      reasoningEffort: options.reasoningEffort,
      providerOptions: options.providerOptions,
      // Forward the dispatch hooks only when supplied so the ordinary
      // (hookless) stream options keep their existing exact shape.
      ...(options.beforeModelDispatch !== undefined
        ? { beforeModelDispatch: options.beforeModelDispatch }
        : {}),
      ...(options.onModelDispatchStarted !== undefined
        ? { onModelDispatchStarted: options.onModelDispatchStarted }
        : {}),
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
          if (options.privateContent === true) {
            throw new PrivateCompletionError(engine.name, {
              ...(engine.name === "builder" &&
              event.errorCode === "builder_auth_error"
                ? { code: "builder_auth_error" }
                : {}),
              ...(event.statusCode !== undefined
                ? { status: event.statusCode }
                : {}),
            });
          }
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
  } catch (error) {
    const timeoutError = completionAbort.getTimeoutError();
    if (timeoutError) throw timeoutError;
    throw error;
  } finally {
    completionAbort.cleanup();
  }

  const timeoutError = completionAbort.getTimeoutError();
  if (timeoutError) throw timeoutError;

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

async function completePrivateText(
  options: CompleteTextOptions,
): Promise<CompleteTextResult> {
  let provider = "model";
  try {
    return await runCompleteText(options, (engine) => {
      provider = engine.name;
      if (engine.supportsPrivateContent !== true) {
        throw new PrivateCompletionError(provider);
      }
    });
  } catch (error) {
    throw toPrivateCompletionError(error, provider);
  }
}

// A completion is an answer, not a write: an action that fails after asking
// for one may be retried.
export function completeText(
  options: CompleteTextOptions,
): Promise<CompleteTextResult> {
  return withoutWriteObservation(() =>
    options.privateContent === true
      ? completePrivateText(options)
      : runCompleteText(options),
  );
}
