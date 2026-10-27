import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Search answers from the core index when it is ready and falls back to
// scanning documents when it isn't (first build, backlog, older deploy).
// Both paths must return the same documents in the same order, except for
// the one intended difference: the index matches body text at word starts
// only, while the scan matches anywhere.

const mode = vi.hoisted(() => ({ fallback: false }));

vi.mock("@agent-native/core/search", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/search")>();
  return {
    ...actual,
    prepareSearchIndex: (
      ...args: Parameters<typeof actual.prepareSearchIndex>
    ) =>
      mode.fallback
        ? Promise.resolve({ ready: false as const, reason: "backlog" as const })
        : actual.prepareSearchIndex(...args),
  };
});

const TEST_DB_PATH = join(
  tmpdir(),
  `content-search-index-parity-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "search-parity-owner@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let searchDocuments: typeof import("./search-documents.js").default;

// Too many words for the index to match as one phrase.
const LONG_PHRASE = Array.from(
  { length: 10_000 },
  (_, index) => `w${index}`,
).join(" ");

const FIXTURES = [
  { id: "p1", title: "Task Priorities", description: "", content: "" },
  {
    id: "p2",
    title: "Weekly notes",
    description: "",
    content: "We discussed task priorities and prioritization.",
  },
  { id: "p3", title: "Priorities for Q3", description: "", content: "" },
  {
    id: "p4",
    title: "Roadmap",
    description: "Covers product priorities",
    content: "",
  },
  {
    id: "eng",
    title: "Engineering notes",
    description: "",
    content: "Call searchIndexState from https://docs.example.com/api/v2",
  },
  {
    id: "ja",
    title: "オンボーディングガイド",
    description: "",
    content: "新しいエンジニアのための手順",
  },
  {
    id: "phrase",
    title: "Incident review",
    description: "",
    content: "webhook retries created duplicate charges",
  },
  {
    id: "scattered",
    title: "Delivery notes",
    description: "",
    content: "webhook delivery retries; later, created duplicate charges",
  },
  {
    // Too repetitive for Postgres to keep every word position.
    id: "repetitive",
    title: "Loop log",
    description: "",
    content: `${"tick tock ".repeat(300)}bell`,
  },
  { id: "long", title: "Word list", description: "", content: LONG_PHRASE },
];

async function search(
  query: string,
  options: { fallback: boolean; searchFields?: "title" | "all" },
): Promise<string[]> {
  mode.fallback = options.fallback;
  try {
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      searchDocuments.run({
        query,
        searchFields: options.searchFields,
        limit: 50,
        offset: 0,
      }),
    );
    return result.documents.map((document) => document.id);
  } finally {
    mode.fallback = false;
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

  const start = Date.UTC(2026, 0, 1);
  await getDb()
    .insert(schema.documents)
    .values(
      FIXTURES.map((fixture, index) => ({
        ...fixture,
        ownerEmail: OWNER,
        visibility: "private" as const,
        // Distinct times, so ties in ranking fall back to a visible order.
        updatedAt: new Date(start + index * 60_000).toISOString(),
      })),
    );
}, 60_000);

afterAll(async () => {
  await closeDbExec();
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("indexed search and the fallback scan", () => {
  it.each([
    "task priorities",
    "priorities",
    "prio",
    "Q3",
    "roadmap OR engineering",
    "priorities -task",
    '"created duplicate"',
    '"retries created"',
    "intitle:priorities",
    "webhook retries created duplicate charges",
    "searchIndexState",
    "docs.example.com",
    "エンジニア",
    "オンボーディング",
    "順",
    '"tock bell"',
  ])("agree on %s", async (query) => {
    const indexed = await search(query, { fallback: false });
    expect(indexed.length).toBeGreaterThan(0);
    expect(indexed).toEqual(await search(query, { fallback: true }));
  });

  it("agree that a phrase doesn't span two fields", async () => {
    // p4's title is "Roadmap" and its description starts "Covers".
    expect(await search('"roadmap covers"', { fallback: false })).toEqual([]);
    expect(await search('"roadmap covers"', { fallback: true })).toEqual([]);
    // Nor in a document without every word position.
    expect(await search('"log tick"', { fallback: false })).toEqual([]);
    expect(await search('"log tick"', { fallback: true })).toEqual([]);
  });

  it("answer a phrase too long for the index with the scan", async () => {
    expect(await search(`"${LONG_PHRASE}"`, { fallback: false })).toEqual([
      "long",
    ]);
  });

  it("agree on title-only searches", async () => {
    const indexed = await search("priorities", {
      fallback: false,
      searchFields: "title",
    });
    expect(indexed).toEqual(
      await search("priorities", { fallback: true, searchFields: "title" }),
    );
  });

  it("differ on mid-word body text, which the index doesn't match", async () => {
    // "iorit" is inside "priorities": in titles and summaries both paths
    // find it, but in p2's body only the scan does.
    const indexed = await search("iorit", { fallback: false });
    const scanned = await search("iorit", { fallback: true });
    expect(scanned).toContain("p2");
    expect(indexed).not.toContain("p2");
    expect(indexed).toEqual(scanned.filter((id) => id !== "p2"));
  });

  it("differ where the index normalizes text and the scan matches it literally", async () => {
    // Full-width input finds p3's "Q3", and a term's punctuation separates
    // words, on the index only.
    expect(await search("Ｑ３", { fallback: false })).toEqual(["p3"]);
    expect(await search("Ｑ３", { fallback: true })).toEqual([]);
    expect(await search("docs-example", { fallback: false })).toEqual(["eng"]);
    expect(await search("docs-example", { fallback: true })).toEqual([]);
  });

  it("reflects an edit on the next search", async () => {
    await getDb()
      .update(schema.documents)
      .set({ content: "Now about the quarterly offsite." })
      .where(eq(schema.documents.id, "phrase"));
    expect(await search("offsite", { fallback: false })).toEqual(["phrase"]);
    expect(await search("webhook", { fallback: false })).toEqual(["scattered"]);
  });
});
