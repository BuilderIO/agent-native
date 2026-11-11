import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bakeoffModelsFromEnv, emptyUsage } from "./models.js";

const OPENAI_ENV = { OPENAI_API_KEY: "test-openai" };
const BUILDER_ENV = {
  BUILDER_PRIVATE_KEY: "test-builder",
  BUILDER_PUBLIC_KEY: "test-space",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** An OpenAI embeddings answer for `count` inputs, rows in reverse order. */
const shuffledEmbeddings = (count: number) =>
  json({
    data: Array.from({ length: count }, (_, index) => ({
      index,
      embedding: [index],
    })).reverse(),
    usage: { prompt_tokens: count },
  });

/** A Builder gateway answer for `count` inputs. */
const builderEmbeddings = (count: number) =>
  json({
    data: Array.from({ length: count }, (_, index) => ({
      index,
      embedding: new Array(1024).fill(index + 1),
    })),
  });

function models(env: NodeJS.ProcessEnv) {
  const result = bakeoffModelsFromEnv(env);
  if (!result) throw new Error("Expected models to be configured.");
  return result;
}

/** Runs `pending` to completion, skipping the retry waits. */
async function settle<T>(pending: Promise<T>) {
  const outcome = pending.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  return outcome;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "performance"] });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("bake-off model client", () => {
  it("places OpenAI embeddings by the index each row names", async () => {
    fetchMock.mockResolvedValueOnce(shuffledEmbeddings(3));
    const usage = emptyUsage();
    const vectors = await models(OPENAI_ENV).embed(
      ["a", "b", "c"],
      "document",
      usage,
    );
    expect(vectors).toEqual([[0], [1], [2]]);
    expect(usage).toMatchObject({ calls: 1, inputTokens: 3 });
  });

  it("fails on embedding rows that repeat an index or hold no vector", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        data: [
          { index: 0, embedding: [0] },
          { index: 0, embedding: [1] },
        ],
      }),
    );
    await expect(
      models(OPENAI_ENV).embed(["a", "b"], "query", emptyUsage()),
    ).rejects.toThrow("Embedding row 1 of 2 is malformed.");

    fetchMock.mockResolvedValueOnce(
      json({ data: [{ index: 0, embedding: [Number.NaN] }] }),
    );
    await expect(
      models(OPENAI_ENV).embed(["a"], "query", emptyUsage()),
    ).rejects.toThrow("Embedding row 0 of 1 is malformed.");
  });

  it("retries a network error, a 503, and a body cut off mid-read", async () => {
    const cutOff = new Response("{");
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(json({ error: "busy" }, 503))
      .mockResolvedValueOnce(cutOff)
      .mockResolvedValueOnce(shuffledEmbeddings(1));
    const usage = emptyUsage();
    const outcome = await settle(
      models(OPENAI_ENV).embed(["a"], "query", usage),
    );
    expect(outcome).toEqual({ value: [[0]] });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(usage.calls).toBe(4);
    // The 12 s of waits between the four attempts aren't model time.
    expect(usage.milliseconds).toBeLessThan(1_000);
  });

  it("fails at once on an account out of quota or a 400", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: { code: "insufficient_quota" } }, 429),
    );
    const quota = await settle(
      models(OPENAI_ENV).embed(["a"], "query", emptyUsage()),
    );
    expect(quota).toMatchObject({ error: expect.any(Error) });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(json({ error: "bad request" }, 400));
    const bad = await settle(
      models(OPENAI_ENV).embed(["a"], "query", emptyUsage()),
    );
    expect(bad).toMatchObject({ error: expect.any(Error) });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses OpenRouter only when asked for by name", async () => {
    expect(bakeoffModelsFromEnv({ OPENROUTER_API_KEY: "test-router" })).toBe(
      null,
    );
    fetchMock.mockResolvedValueOnce(shuffledEmbeddings(1));
    const router = models({
      SEARCH_BAKEOFF_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "test-router",
      OPENAI_API_KEY: "test-openai",
    });
    await router.embed(["a"], "query", emptyUsage());
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://openrouter.ai/api/v1/embeddings",
    );
  });

  it("embeds through OpenRouter when asked for, even with Builder's keys", async () => {
    fetchMock.mockResolvedValueOnce(shuffledEmbeddings(1));
    const router = models({
      ...BUILDER_ENV,
      SEARCH_BAKEOFF_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "test-router",
    });
    await router.embed(["a"], "query", emptyUsage());
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://openrouter.ai/api/v1/embeddings",
    );
  });

  it("fails when OpenRouter is asked for without its key", () => {
    expect(() =>
      bakeoffModelsFromEnv({
        ...OPENAI_ENV,
        SEARCH_BAKEOFF_PROVIDER: "openrouter",
      }),
    ).toThrow("OPENROUTER_API_KEY");
  });

  it("fails on a provider it doesn't know instead of using OpenAI", () => {
    expect(() =>
      bakeoffModelsFromEnv({
        ...OPENAI_ENV,
        SEARCH_BAKEOFF_PROVIDER: "OpenRouter",
      }),
    ).toThrow("SEARCH_BAKEOFF_PROVIDER");
  });

  it("counts each Builder gateway request as a call", async () => {
    fetchMock
      .mockResolvedValueOnce(builderEmbeddings(32))
      .mockResolvedValueOnce(builderEmbeddings(8));
    const usage = emptyUsage();
    const vectors = await models(BUILDER_ENV).embed(
      Array.from({ length: 40 }, (_, index) => `text ${index}`),
      "document",
      usage,
    );
    expect(vectors).toHaveLength(40);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(usage.calls).toBe(2);
  });

  it("retries a Builder 503 and a dropped connection, but not a 400", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ error: "busy" }, 503))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(builderEmbeddings(1));
    const retried = await settle(
      models(BUILDER_ENV).embed(["a"], "query", emptyUsage()),
    );
    expect(retried).toMatchObject({ value: [expect.any(Array)] });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fetchMock.mockResolvedValueOnce(json({ error: "bad request" }, 400));
    const bad = await settle(
      models(BUILDER_ENV).embed(["a"], "query", emptyUsage()),
    );
    expect(bad).toMatchObject({ error: expect.any(Error) });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
