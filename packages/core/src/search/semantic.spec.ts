import { describe, expect, it } from "vitest";

import { createMemorySearchVectorStore } from "./memory-vector-store.js";
import {
  semanticAudienceId,
  semanticChunks,
  semanticSearcherAudienceIds,
} from "./semantic.js";

const exec = {} as never;

describe("semanticChunks", () => {
  it("leads every chunk with the title and summary", () => {
    expect(
      semanticChunks({
        id: "a",
        title: "Refunds",
        summary: "How money comes back",
        body: "Ask support. They reply within a day.",
      }),
    ).toEqual([
      "Refunds\nHow money comes back\nAsk support. They reply within a day.",
    ]);
  });

  it("cuts long text at sentence ends into chunks of about 1,200 characters", () => {
    const sentence = `${"word ".repeat(59)}end.`;
    const chunks = semanticChunks({
      id: "a",
      title: "T",
      body: Array.from({ length: 10 }, () => sentence).join(" "),
    });
    expect(chunks.length).toBe(3);
    for (const chunk of chunks) {
      const text = chunk.slice("T\n".length);
      expect(text.length).toBeLessThanOrEqual(1_200);
      expect(text.endsWith("end.")).toBe(true);
    }
  });

  it("cuts a sentence longer than a chunk, and keeps at most 12 chunks", () => {
    const chunks = semanticChunks({
      id: "a",
      title: "T",
      body: "x".repeat(20_000),
    });
    expect(chunks.length).toBe(12);
    expect(chunks.every((chunk) => chunk.length <= "T\n".length + 1_200)).toBe(
      true,
    );
  });

  it("cuts a long title and summary to 400 characters in every chunk", () => {
    const chunks = semanticChunks({
      id: "a",
      title: "Notes",
      summary: "s".repeat(50_000),
      body: "x".repeat(2_400),
    });
    expect(chunks).toEqual([
      `Notes\n${"s".repeat(394)}\n${"x".repeat(1_200)}`,
      `Notes\n${"s".repeat(394)}\n${"x".repeat(1_200)}`,
    ]);
    expect(
      semanticChunks({ id: "a", title: "t".repeat(5_000), body: "" }),
    ).toEqual(["t".repeat(400)]);
  });

  it("embeds a page with only a title, and nothing for an empty page", () => {
    expect(semanticChunks({ id: "a", title: "Roadmap", body: "  " })).toEqual([
      "Roadmap",
    ]);
    expect(semanticChunks({ id: "a", title: " ", body: "" })).toEqual([]);
  });
});

describe("audiences", () => {
  it("files a resource under its organization, else its owner", () => {
    expect(semanticAudienceId({ orgId: "o1", ownerEmail: "A@x.com" })).toBe(
      "org:o1",
    );
    expect(semanticAudienceId({ orgId: null, ownerEmail: " A@X.com " })).toBe(
      "user:a@x.com",
    );
    expect(semanticAudienceId({})).toBe(null);
    expect(semanticAudienceId(undefined)).toBe(null);
  });

  it("lets a searcher match their own pages and their organizations'", () => {
    expect(
      semanticSearcherAudienceIds({
        userEmail: "Me@X.com",
        orgIds: ["o1", " ", "o2", "o1"],
      }),
    ).toEqual(["user:me@x.com", "org:o1", "org:o2"]);
    expect(semanticSearcherAudienceIds({ orgIds: [] })).toEqual([]);
  });
});

describe("the in-memory vector store", () => {
  it("returns the closest vectors among the audiences given, closest first", async () => {
    const store = createMemorySearchVectorStore();
    await store.upsert(exec, {
      embeddingSetId: "set",
      dimensions: 2,
      audienceIds: ["org:a"],
      entries: [
        { key: "near", vector: [1, 0.1] },
        { key: "far", vector: [0, 1] },
      ],
    });
    await store.upsert(exec, {
      embeddingSetId: "set",
      dimensions: 2,
      audienceIds: ["org:b"],
      entries: [{ key: "other-org", vector: [1, 0] }],
    });
    const hits = await store.query(exec, {
      embeddingSetId: "set",
      dimensions: 2,
      vector: [1, 0],
      audienceIds: ["org:a"],
      limit: 10,
    });
    expect(hits.map((hit) => hit.key)).toEqual(["near", "far"]);

    await store.removeAudience(exec, { dimensions: 2, audienceId: "org:a" });
    expect(store.keys()).toEqual(["other-org"]);
  });
});
