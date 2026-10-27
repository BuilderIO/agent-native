import {
  resolveEngine,
  getStoredModelForEngine,
  normalizeModelForEngine,
} from "../engine/index.js";
import type { AgentEngine } from "../engine/types.js";

const DEFAULT_INTERNAL_RUN_TIMEOUT_MS = 60_000;

export interface InternalAgentRunOptions {
  systemPrompt: string;
  prompt: string;
  maxOutputTokens?: number;
  engine?: AgentEngine;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function runInternalAgentCall(
  options: InternalAgentRunOptions,
): Promise<string> {
  const engine =
    options.engine ?? (await resolveEngine({ engineOption: undefined }));
  const modelCandidate =
    options.model ??
    (await getStoredModelForEngine(engine)) ??
    engine.defaultModel;
  const model = normalizeModelForEngine(engine, modelCandidate);

  const controller = new AbortController();
  const signal = options.signal ?? controller.signal;
  const timer = options.signal
    ? undefined
    : setTimeout(
        () => controller.abort(),
        options.timeoutMs ?? DEFAULT_INTERNAL_RUN_TIMEOUT_MS,
      );

  let out = "";
  try {
    const stream = engine.stream({
      model,
      systemPrompt: options.systemPrompt,
      messages: [
        { role: "user", content: [{ type: "text", text: options.prompt }] },
      ],
      tools: [],
      abortSignal: signal,
      maxOutputTokens: options.maxOutputTokens ?? 4_000,
      reasoningEffort: "low",
      temperature: 0,
    });
    for await (const event of stream) {
      if (event.type === "text-delta") out += event.text;
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
  return out.trim();
}

export type InternalAgentRunFn = (
  options: InternalAgentRunOptions,
) => Promise<string>;
