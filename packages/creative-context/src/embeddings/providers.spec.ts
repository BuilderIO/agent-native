import { afterEach, describe, expect, it, vi } from "vitest";

import { createGeminiEmbeddingFamily } from "./providers.js";

afterEach(() => vi.unstubAllGlobals());

describe("Gemini embedding request contract", () => {
  it("uses current REST dimension casing and retrieval prefixes", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({ embedding: { values: [0.1, 0.2, 0.3] } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const family = createGeminiEmbeddingFamily("test-key", 3);
    await family.embed([{ text: "pricing hero" }], "query");
    await family.embed([{ text: "three pricing cards" }], "document");
    const queryBody = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    );
    const documentBody = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit).body),
    );
    expect(queryBody.output_dimensionality).toBe(3);
    expect(queryBody).not.toHaveProperty("outputDimensionality");
    expect(queryBody.content.parts[0].text).toBe(
      "task: search result | query: pricing hero",
    );
    expect(documentBody.content.parts[0].text).toBe(
      "title: none | text: three pricing cards",
    );
    expect(family.supportedImageMimeTypes).toEqual(["image/png", "image/jpeg"]);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal).toBeDefined();
  });

  it("never echoes provider response bodies into errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("secret customer content from imported corpus", {
            status: 400,
          }),
      ),
    );
    const family = createGeminiEmbeddingFamily("test-key", 3);
    await expect(
      family.embed([{ text: "private customer phrase" }], "document"),
    ).rejects.toThrow("gemini/gemini-embedding-2 failed with status 400");
    await expect(
      family.embed([{ text: "private customer phrase" }], "document"),
    ).rejects.not.toThrow(/secret customer content|private customer phrase/);
  });

  it("rejects oversized successful provider responses before JSON parsing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", {
            status: 200,
            headers: { "content-length": "1000001" },
          }),
      ),
    );
    const family = createGeminiEmbeddingFamily("test-key", 3);
    await expect(family.embed([{ text: "pricing" }], "query")).rejects.toThrow(
      /exceeds 1000000 bytes/,
    );
  });
});
