import type { DecisionInput, DecisionQuestion } from "../types.js";

const OPENAI_DECISIONS_URL = "https://api.openai.com/v1/decisions";
export const OPENAI_DECISIONS_MODEL = "gpt-6-luna";

type OpenAiQuestion =
  | { type: "predicate"; name: string; instructions: string }
  | {
      type: "choice";
      name: string;
      instructions: string;
      choices: Array<{ value: string; description: string }>;
    }
  | {
      type: "score";
      name: string;
      instructions: string;
      levels: Array<{ label: string; description: string }>;
    };

function toOpenAiInput(input: DecisionInput): unknown {
  if (typeof input === "string") return input;
  return [
    {
      role: "user",
      content: input.map((part) => {
        if (part.type === "text")
          return { type: "input_text", text: part.text };
        if (part.type === "json") {
          return { type: "input_json", data: part.value };
        }
        return { type: "input_image", image_url: part.url };
      }),
    },
  ];
}

function toOpenAiQuestion(question: DecisionQuestion): OpenAiQuestion {
  if (question.type === "predicate") {
    return {
      type: "predicate",
      name: question.name,
      instructions: question.instructions,
    };
  }
  if (question.type === "choice") {
    return {
      type: "choice",
      name: question.name,
      instructions: question.instructions,
      choices: question.choices.map(({ value, description }) => ({
        value,
        description,
      })),
    };
  }
  return {
    type: "score",
    name: question.name,
    instructions: question.instructions,
    levels: question.levels.map(({ label, description }) => ({
      label,
      description,
    })),
  };
}

export interface OpenAiDecisionRequest {
  input: DecisionInput;
  questions: readonly DecisionQuestion[];
  apiKey: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

export class DecisionProviderRequestError extends Error {
  constructor(
    readonly reason:
      | "aborted"
      | "timeout"
      | "provider_error"
      | "invalid_response",
  ) {
    super(`Decision provider request failed: ${reason}`);
    this.name = "DecisionProviderRequestError";
  }
}

export async function requestOpenAiDecision({
  input,
  questions,
  apiKey,
  signal,
  timeoutMs,
}: OpenAiDecisionRequest): Promise<unknown> {
  const controller = new AbortController();
  const requestSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    requestSignal.throwIfAborted();
    const response = await fetch(OPENAI_DECISIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_DECISIONS_MODEL,
        input: toOpenAiInput(input),
        questions: questions.map(toOpenAiQuestion),
      }),
      signal: requestSignal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new DecisionProviderRequestError("provider_error");
    }
    try {
      return await response.json();
    } catch {
      if (signal?.aborted) throw new DecisionProviderRequestError("aborted");
      if (controller.signal.aborted) {
        throw new DecisionProviderRequestError("timeout");
      }
      throw new DecisionProviderRequestError("invalid_response");
    }
  } catch (error) {
    if (error instanceof DecisionProviderRequestError) throw error;
    if (signal?.aborted) throw new DecisionProviderRequestError("aborted");
    if (controller.signal.aborted) {
      throw new DecisionProviderRequestError("timeout");
    }
    throw new DecisionProviderRequestError("provider_error");
  } finally {
    clearTimeout(timeout);
  }
}
