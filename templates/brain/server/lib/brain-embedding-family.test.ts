import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveSourceCredential = vi.hoisted(() => vi.fn());
const getCredentialContext = vi.hoisted(() => vi.fn());

vi.mock("./source-credentials.js", () => ({ resolveSourceCredential }));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getCredentialContext,
}));
vi.mock("../db/index.js", () => ({ getDb: vi.fn(), schema: {} }));

import {
  BRAIN_EMBEDDING_DIMENSIONS,
  BrainEmbeddingUnavailableError,
  createOpenAIEmbeddingFamily,
  resolveBrainEmbeddingFamily,
} from "./brain-embedding-family.js";
import { runSearchExternalLane } from "./search-index.js";

function vector(seed: number, length = BRAIN_EMBEDDING_DIMENSIONS) {
  return Array.from({ length }, () => seed);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  resolveSourceCredential.mockReset();
  getCredentialContext
    .mockReset()
    .mockReturnValue({ userEmail: "owner@example.com", orgId: "org-1" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI embedding family", () => {
  it("embeds a capture batch with one request and returns vectors in index order", async () => {
    const inputs = Array.from({ length: 13 }, (_, index) => ({
      text: `burst ${index}`,
    }));
    const data = inputs.map((_, index) => ({
      index,
      embedding: vector(index),
    }));
    fetchMock.mockResolvedValue(jsonResponse({ data: [...data].reverse() }));

    const family = createOpenAIEmbeddingFamily("test-openai-key");
    const vectors = await family.embed(inputs, "document");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    expect(init.headers.Authorization).toBe("Bearer test-openai-key");
    const body = JSON.parse(init.body);
    expect(body.input).toEqual(inputs.map((input) => input.text));
    expect(body.dimensions).toBe(1024);
    expect(body.model).toBe("text-embedding-3-small");
    expect(vectors).toHaveLength(13);
    expect(vectors.map((row) => row[0])).toEqual(inputs.map((_, i) => i));
    expect(family.id).toBe("openai:text-embedding-3-small:1024");
  });

  it("rejects non-2xx responses with the provider status", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "boom" }, 500));
    await expect(
      createOpenAIEmbeddingFamily("test-openai-key").embed(
        [{ text: "a" }],
        "document",
      ),
    ).rejects.toThrow(
      "Embedding provider openai/text-embedding-3-small failed with status 500.",
    );
  });

  it("rejects vectors with the wrong dimensions as malformed", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: [{ index: 0, embedding: vector(1, 1023) }] }),
    );
    await expect(
      createOpenAIEmbeddingFamily("test-openai-key").embed(
        [{ text: "a" }],
        "document",
      ),
    ).rejects.toThrow("Embedding response was malformed.");
  });

  it("reports an aborted request as a timeout", async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "TimeoutError" }),
    );
    await expect(
      createOpenAIEmbeddingFamily("test-openai-key").embed(
        [{ text: "a" }],
        "document",
      ),
    ).rejects.toThrow(
      "Embedding provider openai/text-embedding-3-small timed out.",
    );
  });

  it("returns no vectors without calling the provider for empty input", async () => {
    await expect(
      createOpenAIEmbeddingFamily("test-openai-key").embed([], "document"),
    ).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("resolveBrainEmbeddingFamily", () => {
  it("resolves the key through Brain source credentials", async () => {
    resolveSourceCredential.mockResolvedValue("  test-openai-key  ");
    const family = await resolveBrainEmbeddingFamily();
    expect(family.provider).toBe("openai");
    expect(resolveSourceCredential).toHaveBeenCalledWith({
      provider: "openai",
      key: "OPENAI_API_KEY",
      ctx: { userEmail: "owner@example.com", orgId: "org-1" },
    });
  });

  it("throws a typed error when the key is missing", async () => {
    resolveSourceCredential.mockResolvedValue(undefined);
    await expect(resolveBrainEmbeddingFamily()).rejects.toBeInstanceOf(
      BrainEmbeddingUnavailableError,
    );
  });

  it("throws a typed error without a credential context", async () => {
    getCredentialContext.mockReturnValue(null);
    await expect(resolveBrainEmbeddingFamily()).rejects.toBeInstanceOf(
      BrainEmbeddingUnavailableError,
    );
    expect(resolveSourceCredential).not.toHaveBeenCalled();
  });
});

describe("runSearchExternalLane", () => {
  it("rejects optional indexing failures instead of swallowing them", async () => {
    await expect(
      runSearchExternalLane(() => Promise.reject(new Error("x"))),
    ).rejects.toThrow(
      "Search index external lane failed: unexpected external search error.",
    );
  });

  it("reports a missing OpenAI credential and provider status safely", async () => {
    await expect(
      runSearchExternalLane(() =>
        Promise.reject(new BrainEmbeddingUnavailableError()),
      ),
    ).rejects.toThrow(
      "Search index external lane failed: OpenAI credential unavailable.",
    );
    await expect(
      runSearchExternalLane(
        () =>
          Promise.reject(
            new Error(
              "Embedding provider openai/text-embedding-3-small failed with status 429.",
            ),
          ),
        "openai:text-embedding-3-small:1024",
      ),
    ).rejects.toThrow(
      "Embedding backfill external lane failed: OpenAI embedding provider HTTP 429.",
    );
  });
});
