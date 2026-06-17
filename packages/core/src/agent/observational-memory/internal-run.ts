/**
 * Tiny headless internal-agent-call seam for Observational Memory.
 *
 * The Observer and Reflector each need a single, tool-less LLM round-trip:
 * "here is some text, compress it". Rather than touch `production-agent.ts`,
 * this reuses the SAME pattern the evals lane built — resolve a provider-
 * agnostic engine + model from the registry (NEVER hardcode a model) and drive
 * one `engine.stream()` to completion, collecting the text. It mirrors the
 * `analyzeContext().judge` helper in `eval/agent-runner.ts`.
 *
 * Everything is injectable so tests can supply a fake engine and assert no real
 * model is ever called.
 */

import type { AgentEngine } from "../engine/types.js";
import {
  resolveEngine,
  getStoredModelForEngine,
  normalizeModelForEngine,
} from "../engine/index.js";

const DEFAULT_INTERNAL_RUN_TIMEOUT_MS = 60_000;

export interface InternalAgentRunOptions {
  systemPrompt: string;
  prompt: string;
  maxOutputTokens?: number;
  /** Pre-resolved engine; resolved from the registry when omitted. */
  engine?: AgentEngine;
  /** Pre-resolved model; resolved from the engine's stored/default when omitted. */
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Run one tool-less internal agent call and return the collected text.
 *
 * Resolution goes through `resolveEngine` / `getStoredModelForEngine` /
 * `normalizeModelForEngine` — identical to the eval runner — so the compactor
 * uses whatever provider/model the app is configured for. No model is ever
 * hardcoded here.
 */
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

/** The shape the Observer/Reflector depend on — injectable for tests. */
export type InternalAgentRunFn = (
  options: InternalAgentRunOptions,
) => Promise<string>;
