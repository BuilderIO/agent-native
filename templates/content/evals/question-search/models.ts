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

const OPENAI_EMBEDDING_BATCH = 64;

/** An OpenAI-compatible API: OpenAI's own, or OpenRouter's. */
interface ChatProvider {
  name: "openai" | "openrouter";
  url: string;
  headers: Record<string, string>;
  /** The provider's id for an OpenAI model. */
  model(id: string): string;
}

/**
 * OpenAI with OPENAI_API_KEY, or OpenRouter when
 * SEARCH_BAKEOFF_PROVIDER=openrouter and OPENROUTER_API_KEY are set. OpenRouter
 * is only used when asked for, so a run never moves to a second account's
 * spending on its own.
 */
function chatProviderFromEnv(env: NodeJS.ProcessEnv): ChatProvider | null {
  if (env.SEARCH_BAKEOFF_PROVIDER?.trim() === "openrouter") {
    const key = env.OPENROUTER_API_KEY?.trim();
    if (!key) return null;
    return {
      name: "openrouter",
      url: "https://openrouter.ai/api/v1",
      headers: { Authorization: `Bearer ${key}` },
      model: (id) => (id.includes("/") ? id : `openai/${id}`),
    };
  }
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  return {
    name: "openai",
    url: "https://api.openai.com/v1",
    headers: { Authorization: `Bearer ${key}` },
    model: (id) => id,
  };
}

async function postWithRetry(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Record<string, any>> {
  for (let attempt = 1; ; attempt += 1) {
    // A network error or timeout is retried like a 429 or 5xx answer.
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    }).catch((error: unknown) => {
      if (attempt === 4) throw error;
      return null;
    });
    if (response?.ok) return (await response.json()) as Record<string, any>;
    if (response) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      // An account out of quota answers 429 too, but waiting won't help.
      const retryable =
        (response.status === 429 && !detail.includes("insufficient_quota")) ||
        response.status >= 500;
      if (!retryable || attempt === 4)
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
 * Agent Native ships), else the chat provider's. Chat goes to OpenAI, or to
 * OpenRouter when asked for.
 */
export function bakeoffModelsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BakeoffModels | null {
  const provider = chatProviderFromEnv(env);
  const builderKey = env.BUILDER_PRIVATE_KEY?.trim();
  const builderSpace = env.BUILDER_PUBLIC_KEY?.trim();
  const chatModel = env.SEARCH_BAKEOFF_CHAT_MODEL?.trim() || "gpt-6-luna";
  const openaiEmbeddingModel =
    env.SEARCH_BAKEOFF_EMBEDDING_MODEL?.trim() || "text-embedding-3-small";

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
  } else if (provider) {
    const model = provider.model(openaiEmbeddingModel);
    embeddingLabel = `${provider.name}/${model}`;
    embed = async (texts, _purpose, usage) => {
      const vectors: number[][] = [];
      for (let at = 0; at < texts.length; at += OPENAI_EMBEDDING_BATCH) {
        const batch = texts.slice(at, at + OPENAI_EMBEDDING_BATCH);
        const data = await timed(usage, () =>
          postWithRetry(`${provider.url}/embeddings`, provider.headers, {
            model,
            input: batch,
          }),
        );
        usage.embeddedCharacters += batch.reduce((n, t) => n + t.length, 0);
        usage.inputTokens += Number(data.usage?.prompt_tokens ?? 0);
        // Each row names the input it embeds; place it by that, not by order.
        const rows = (data.data ?? []) as {
          index: number;
          embedding: number[];
        }[];
        if (rows.length !== batch.length)
          throw new Error(
            `Expected ${batch.length} embeddings, got ${rows.length}.`,
          );
        for (const row of [...rows].sort((a, b) => a.index - b.index))
          vectors.push(row.embedding);
      }
      return vectors;
    };
  } else {
    return null;
  }

  return {
    embeddingLabel,
    chatLabel: provider
      ? `${provider.name}/${provider.model(chatModel)}`
      : null,
    embed,
    chat: async (system, user, usage) => {
      if (!provider) throw new Error("No chat model is configured.");
      const data = await timed(usage, () =>
        postWithRetry(`${provider.url}/chat/completions`, provider.headers, {
          model: provider.model(chatModel),
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
