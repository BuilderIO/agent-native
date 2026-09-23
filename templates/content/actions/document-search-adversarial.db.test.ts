import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { closeDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-search-adversarial-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "search-adversarial@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let searchDocuments: typeof import("./search-documents.js").default;

const asOwner = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: OWNER }, run);

async function insertInBatches(rows: Record<string, unknown>[]) {
  for (let start = 0; start < rows.length; start += 100) {
    await getDb()
      .insert(schema.documents)
      .values(rows.slice(start, start + 100));
  }
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  searchDocuments = (await import("./search-documents.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);

  const scatteredOccurrences = Array.from(
    { length: 512 },
    (_, index) =>
      `${index % 2 === 0 ? "cobalt" : "marigold"} ${"gap ".repeat(70)}`,
  ).join("");
  const largeRepetitiveBody = `LARGE-HEAD ${"echo ".repeat(40_000)} LARGE-TAIL`;

  await insertInBatches([
    {
      id: "search-after-occurrence-cap",
      ownerEmail: OWNER,
      title: "Occurrence cap",
      content: `${scatteredOccurrences}DENSE-PASSAGE cobalt marigold together`,
      visibility: "private",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "search-coherent-body",
      ownerEmail: OWNER,
      title: "Older research note",
      content: `opening ${"context ".repeat(20)}COHERENT luminous orchard grows here`,
      visibility: "private",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "search-scattered-body",
      ownerEmail: OWNER,
      title: "Newer imported note",
      content: `SCATTERED luminous ${"distance ".repeat(80)}orchard`,
      visibility: "private",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
    {
      id: "search-large-repetitive",
      ownerEmail: OWNER,
      title: "Large repetitive body",
      content: largeRepetitiveBody,
      visibility: "private",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "search-reverse-order-body",
      ownerEmail: OWNER,
      title: "Reverse order body",
      content: `${"head filler ".repeat(80)}reverse-beta nearby reverse-alpha`,
      visibility: "private",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "search-distant-body",
      ownerEmail: OWNER,
      title: "Distant body",
      content: `${"head filler ".repeat(80)}distant-alpha ${"wide gap ".repeat(80)}distant-beta`,
      visibility: "private",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "search-whitespace-phrase",
      ownerEmail: OWNER,
      title: "Whitespace phrase",
      content: `${"leading context ".repeat(30)}white   space marker`,
      visibility: "private",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);

  const sizes = [400, 4_000, 40_000];
  const performanceRows = Array.from({ length: 600 }, (_, index) => {
    const targetSize = sizes[index % sizes.length]!;
    const marker = index % 211 === 0 ? " rare-saffron-marker" : "";
    const prefix = `common-harbor token ${index}${marker} `;
    return {
      id: `search-mixed-${index.toString().padStart(4, "0")}`,
      ownerEmail: OWNER,
      title: `Mixed fixture ${index}`,
      content: `${prefix}${"x".repeat(Math.max(0, targetSize - prefix.length))}`,
      visibility: "private" as const,
      updatedAt: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
    };
  });
  await insertInBatches(performanceRows);
}, 120_000);

afterAll(async () => {
  await closeDbExec();
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("adversarial document search", () => {
  it("QA-04 selects a dense passage after the 256th occurrence", async () => {
    const result = await asOwner(() =>
      searchDocuments.run({ query: "cobalt marigold", limit: 10, offset: 0 }),
    );

    expect(result.documents.map((document) => document.id)).toEqual([
      "search-after-occurrence-cap",
    ]);
    expect(result.documents[0]?.snippet).toContain("DENSE-PASSAGE");
    expect(result.documents[0]?.snippet).toContain("cobalt marigold");
  });

  it("QA-05 ranks a coherent body passage above a newer scattered match", async () => {
    const result = await asOwner(() =>
      searchDocuments.run({ query: "luminous orchard", limit: 10, offset: 0 }),
    );

    expect(result.documents.map((document) => document.id)).toEqual([
      "search-coherent-body",
      "search-scattered-body",
    ]);
    expect(result.documents[0]?.snippet).toContain("COHERENT luminous orchard");
  });

  it("keeps deep snippets anchored when terms are reversed or far apart", async () => {
    const reversed = await asOwner(() =>
      searchDocuments.run({
        query: "reverse-alpha reverse-beta",
        limit: 10,
        offset: 0,
      }),
    );
    const distant = await asOwner(() =>
      searchDocuments.run({
        query: "distant-alpha distant-beta",
        limit: 10,
        offset: 0,
      }),
    );

    expect(reversed.documents[0]?.snippet).toContain("reverse-beta");
    expect(reversed.documents[0]?.snippet).toContain("reverse-alpha");
    expect(distant.documents[0]?.snippet).toContain("distant-alpha");
  });

  it("normalizes quoted-query whitespace when anchoring snippets", async () => {
    const result = await asOwner(() =>
      searchDocuments.run({ query: '"white   space"', limit: 10, offset: 0 }),
    );

    expect(result.documents[0]?.id).toBe("search-whitespace-phrase");
    expect(result.documents[0]?.snippet).toContain("white space marker");
  });

  it("QA-05 keeps a large repetitive-body snippet and payload bounded", async () => {
    const startedAt = performance.now();
    const result = await asOwner(() =>
      searchDocuments.run({ query: "echo", limit: 10, offset: 0 }),
    );
    const elapsedMs = performance.now() - startedAt;
    console.info(
      `content 200KB repetitive-token search: ${elapsedMs.toFixed(1)}ms`,
    );
    const document = result.documents.find(
      (candidate) => candidate.id === "search-large-repetitive",
    );

    expect(document).toBeDefined();
    expect(document?.contentLength).toBe(
      `LARGE-HEAD ${"echo ".repeat(40_000)} LARGE-TAIL`.length,
    );
    expect(document?.snippet).toContain("echo");
    expect(document?.snippet.length).toBeLessThanOrEqual(250);
    expect(document?.snippet).not.toContain("LARGE-TAIL");
    expect(elapsedMs).toBeLessThanOrEqual(1_500);
  });

  it("caps snippets for quoted phrases larger than the preview budget", async () => {
    const phrase = `oversized-start-${"quoted-phrase-".repeat(500)}oversized-end`;
    await getDb()
      .insert(schema.documents)
      .values({
        id: "search-oversized-quoted-phrase",
        ownerEmail: OWNER,
        title: "Oversized quoted phrase",
        content: `${"leading context ".repeat(30)}${phrase}`,
        visibility: "private",
      });

    const result = await asOwner(() =>
      searchDocuments.run({ query: `"${phrase}"`, limit: 10, offset: 0 }),
    );

    expect(result.documents[0]?.id).toBe("search-oversized-quoted-phrase");
    expect(result.documents[0]?.snippet.length).toBeLessThanOrEqual(243);
  });

  it("QA-10 stays responsive for rare, common, and zero-result mixed-size searches", async () => {
    const cases = [
      { query: "rare-saffron-marker", expectedTotal: 3, budgetMs: 750 },
      { query: "common-harbor", expectedTotal: 600, budgetMs: 1_500 },
      { query: "absent-cerulean-marker", expectedTotal: 0, budgetMs: 500 },
    ];

    for (const searchCase of cases) {
      const run = async () => {
        const startedAt = performance.now();
        const result = await asOwner(() =>
          searchDocuments.run({
            query: searchCase.query,
            limit: 20,
            offset: 0,
          }),
        );
        return { elapsedMs: performance.now() - startedAt, result };
      };

      await run();
      const samples = [];
      for (let index = 0; index < 5; index += 1) samples.push(await run());
      const durations = samples
        .map((sample) => sample.elapsedMs)
        .sort((a, b) => a - b);
      const p95 = durations[Math.ceil(durations.length * 0.95) - 1]!;
      console.info(
        `content mixed-size search ${searchCase.query} warm p95: ${p95.toFixed(1)}ms (${durations.map((duration) => duration.toFixed(1)).join(", ")})`,
      );

      expect(samples[0]!.result.pagination.totalItems).toBe(
        searchCase.expectedTotal,
      );
      expect(p95).toBeLessThanOrEqual(searchCase.budgetMs);
    }
  }, 120_000);
});
