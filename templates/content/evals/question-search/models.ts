import {
  createBuilderEmbeddingFamily,
  type EmbeddingInputPurpose,
} from "@agent-native/core/embeddings";

/**
 * Model access for the question-search bake-off. Every call is counted, so
 * the report can show what each method costs. Keys come from the environment
 * the gated evals workflow sets; nothing here reads a stored credential.
 */

export interface ModelUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  embeddedCharacters: number;
  milliseconds: number;
}

export function emptyUsage(): ModelUsage {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    embeddedCharacters: 0,
    milliseconds: 0,
  };
}

export interface BakeoffModels {
  embeddingLabel: string;
  /** Null when no chat model is configured; methods that need one skip. */
  chatLabel: string | null;
  embed(
    texts: string[],
    purpose: EmbeddingInputPurpose,
    usage: ModelUsage,
  ): Promise<number[][]>;
  chat(system: string, user: string, usage: ModelUsage): Promise<string>;
}

const OPENAI_URL = "https://api.openai.com/v1";
const OPENAI_EMBEDDING_BATCH = 64;

async function postWithRetry(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Record<string, any>> {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (response.ok) return (await response.json()) as Record<string, any>;
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 4) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new Error(`${url} answered ${response.status}: ${detail}`);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
  }
}

async function timed<T>(usage: ModelUsage, run: () => Promise<T>) {
  const started = performance.now();
  try {
    return await run();
  } finally {
    usage.calls += 1;
    usage.milliseconds += performance.now() - started;
  }
}

/**
 * Embeddings through Builder's gateway when its key pair is set (what hosted
 * Agent Native ships), else OpenAI's. Chat always goes to OpenAI.
 */
export function bakeoffModelsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BakeoffModels | null {
  const openaiKey = env.OPENAI_API_KEY?.trim();
  const builderKey = env.BUILDER_PRIVATE_KEY?.trim();
  const builderSpace = env.BUILDER_PUBLIC_KEY?.trim();
  const chatModel = env.SEARCH_BAKEOFF_CHAT_MODEL?.trim() || "gpt-6-luna";
  const openaiEmbeddingModel =
    env.SEARCH_BAKEOFF_EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
  const openaiHeaders = { Authorization: `Bearer ${openaiKey}` };

  let embeddingLabel: string;
  let embed: BakeoffModels["embed"];
  if (builderKey && builderSpace) {
    const family = createBuilderEmbeddingFamily({
      authorization: `Bearer ${builderKey}`,
      spaceId: builderSpace,
      userId: null,
    });
    embeddingLabel = `builder/${family.model}`;
    embed = (texts, purpose, usage) =>
      timed(usage, async () => {
        usage.embeddedCharacters += texts.reduce((n, t) => n + t.length, 0);
        return family.embed(
          texts.map((text) => ({ text })),
          purpose,
        );
      });
  } else if (openaiKey) {
    embeddingLabel = `openai/${openaiEmbeddingModel}`;
    embed = async (texts, _purpose, usage) => {
      const vectors: number[][] = [];
      for (let at = 0; at < texts.length; at += OPENAI_EMBEDDING_BATCH) {
        const batch = texts.slice(at, at + OPENAI_EMBEDDING_BATCH);
        const data = await timed(usage, () =>
          postWithRetry(`${OPENAI_URL}/embeddings`, openaiHeaders, {
            model: openaiEmbeddingModel,
            input: batch,
          }),
        );
        usage.embeddedCharacters += batch.reduce((n, t) => n + t.length, 0);
        usage.inputTokens += Number(data.usage?.prompt_tokens ?? 0);
        for (const row of data.data ?? []) vectors.push(row.embedding);
      }
      return vectors;
    };
  } else {
    return null;
  }

  return {
    embeddingLabel,
    chatLabel: openaiKey ? `openai/${chatModel}` : null,
    embed,
    chat: async (system, user, usage) => {
      if (!openaiKey) throw new Error("No chat model is configured.");
      const data = await timed(usage, () =>
        postWithRetry(`${OPENAI_URL}/chat/completions`, openaiHeaders, {
          model: chatModel,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0,
        }),
      );
      usage.inputTokens += Number(data.usage?.prompt_tokens ?? 0);
      usage.outputTokens += Number(data.usage?.completion_tokens ?? 0);
      return String(data.choices?.[0]?.message?.content ?? "").trim();
    },
  };
}
