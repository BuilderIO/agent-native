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
/** Builder's per-request input limit, so each embed call is one request. */
const BUILDER_EMBEDDING_BATCH = 32;
const ATTEMPTS = 4;

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
    // Without it the run would skip every model method and look complete.
    if (!key)
      throw new Error(
        "SEARCH_BAKEOFF_PROVIDER=openrouter needs OPENROUTER_API_KEY.",
      );
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

/** The fields read from an OpenAI-compatible answer. */
interface ApiAnswer {
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  data?: { index: number; embedding: number[] }[];
  choices?: { message?: { content?: string | null } }[];
}

/** Retries `run` while `retryable` says the failure may pass. */
async function withRetry<T>(
  run: () => Promise<T>,
  retryable: (error: unknown) => boolean,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt === ATTEMPTS || !retryable(error)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
  }
}

/** An HTTP answer that isn't 2xx, and whether waiting could help. */
class HttpError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

async function postWithRetry(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<ApiAnswer> {
  return withRetry(
    async () => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) {
        // coercion-ok: the body only adds detail to an error thrown either way.
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        // An account out of quota answers 429 too, but waiting won't help.
        throw new HttpError(
          `${url} answered ${response.status}: ${detail}`,
          (response.status === 429 && !detail.includes("insufficient_quota")) ||
            response.status >= 500,
        );
      }
      return (await response.json()) as ApiAnswer;
    },
    // A network error, a timeout or a body cut off mid-read is retried too.
    (error) => !(error instanceof HttpError) || error.retryable,
  );
}

/**
 * Whether a failed Builder gateway request may pass on retry: a 429 or 5xx
 * answer, a timeout, or a dropped connection (fetch's TypeError).
 */
function retryableBuilderError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const status = /failed with status (\d+)\./.exec(error.message)?.[1];
  if (status) return status === "429" || Number(status) >= 500;
  return error instanceof TypeError || error.message.endsWith("timed out.");
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
 * Agent-Native ships), else the chat provider's. Chat goes to OpenAI. Asking
 * for OpenRouter sends both there, Builder's keys or not.
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
  if (builderKey && builderSpace && provider?.name !== "openrouter") {
    const family = createBuilderEmbeddingFamily({
      authorization: `Bearer ${builderKey}`,
      spaceId: builderSpace,
      userId: null,
    });
    // The gateway reports no token counts, so its tokens show as 0.
    embeddingLabel = `builder/${family.model} (no token counts)`;
    embed = async (texts, purpose, usage) => {
      const vectors: number[][] = [];
      for (let at = 0; at < texts.length; at += BUILDER_EMBEDDING_BATCH) {
        const batch = texts.slice(at, at + BUILDER_EMBEDDING_BATCH);
        const embedded = await timed(usage, () =>
          withRetry(
            () =>
              family.embed(
                batch.map((text) => ({ text })),
                purpose,
              ),
            retryableBuilderError,
          ),
        );
        usage.embeddedCharacters += batch.reduce((n, t) => n + t.length, 0);
        vectors.push(...embedded);
      }
      return vectors;
    };
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
        usage.inputTokens += data.usage?.prompt_tokens ?? 0;
        // Each row names the input it embeds; place it by that, not by order.
        const rows = data.data ?? [];
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
      usage.inputTokens += data.usage?.prompt_tokens ?? 0;
      usage.outputTokens += data.usage?.completion_tokens ?? 0;
      return (data.choices?.[0]?.message?.content ?? "").trim();
    },
  };
}
