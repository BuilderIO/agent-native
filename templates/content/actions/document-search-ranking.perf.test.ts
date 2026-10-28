import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { closeDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-search-ranking-perf-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "search-ranking-perf@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let searchDocuments: typeof import("./search-documents.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  searchDocuments = (await import("./search-documents.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);

  const body = `A working note about task assignments. ${"bounded filler ".repeat(30)}The explicit prio marker remains available.`;
  const documents = Array.from({ length: 10_000 }, (_, index) => ({
    id: `search-ranking-perf-${index.toString().padStart(5, "0")}`,
    ownerEmail: OWNER,
    title: index === 0 ? "Task Priorities" : `Imported working note ${index}`,
    content: index === 0 ? "Current working projection." : body,
    visibility: "private" as const,
    updatedAt: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
  }));
  for (let start = 0; start < documents.length; start += 500) {
    await getDb()
      .insert(schema.documents)
      .values(documents.slice(start, start + 500));
  }
}, 120_000);

afterAll(async () => {
  await closeDbExec();
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("document search ranking performance", () => {
  it("keeps a 10k-document partial-title search within the warm budget", async () => {
    const run = async () => {
      const startedAt = performance.now();
      const result = await runWithRequestContext({ userEmail: OWNER }, () =>
        searchDocuments.run({ query: "task prio", limit: 20, offset: 0 }),
      );
      return { elapsedMs: performance.now() - startedAt, result };
    };

    await run();
    const samples: Awaited<ReturnType<typeof run>>[] = [];
    for (let index = 0; index < 10; index += 1) samples.push(await run());
    const durations = samples
      .map((sample) => sample.elapsedMs)
      .sort((a, b) => a - b);
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1]!;
    console.info(
      `content search 10k warm p95: ${p95.toFixed(1)}ms (${durations.map((value) => value.toFixed(1)).join(", ")})`,
    );

    expect(samples[0]!.result.documents[0]?.title).toBe("Task Priorities");
    expect(samples[0]!.result.pagination.totalItems).toBe(10_000);
    expect(p95).toBeLessThanOrEqual(400);
  });
});
