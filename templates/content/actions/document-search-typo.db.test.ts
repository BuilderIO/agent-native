import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The typo pass in search-documents: when nothing matches, a mistyped word
// is also matched as the closest words in titles and descriptions the caller
// can see. Every case runs on the index and on the fallback scan.

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
  `content-search-typo-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "search-typo-owner@example.com";
const OTHER = "search-typo-other@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let searchDocuments: typeof import("./search-documents.js").default;

const FIXTURES = [
  { id: "roadmap", title: "Roadmap", content: "Plans for the year." },
  {
    id: "billing",
    title: "Billing v2 spec",
    content: "How invoices change.",
  },
  {
    id: "hangar",
    title: "Facilities",
    description: "Covers the hangar lease",
    content: "",
  },
  // Only the body says "zephyrine" and "quokka"; the titles that do are
  // another person's page, a hidden page, and a trashed page.
  {
    id: "zephyrine-body",
    title: "Launch notes",
    content: "zephyrine ships in spring, and the quokka census follows",
  },
  {
    id: "other-zephyrine",
    ownerEmail: OTHER,
    title: "Zephyrine launch plan",
    content: "",
  },
  {
    id: "hidden-quokka",
    title: "Quokka census",
    content: "",
    hideFromSearch: 1,
  },
  {
    id: "trashed-marmoset",
    title: "Marmoset survey",
    content: "",
    trashedAt: "2026-02-01T00:00:00.000Z",
  },
  {
    id: "marmoset-body",
    title: "Field notes",
    content: "marmoset sightings by the river",
  },
  // A word that exists as typed is never treated as a typo.
  { id: "literal-typo", title: "Scratch", content: "a note about roadmpa" },
  ...Array.from({ length: 5 }, (_, index) => ({
    id: `quarterly-${index + 1}`,
    title: `Quarterly report ${index + 1}`,
    content: "",
  })),
];

async function search(
  query: string,
  options: {
    fallback?: boolean;
    as?: string;
    searchFields?: "title" | "all";
    limit?: number;
    offset?: number;
  } = {},
) {
  mode.fallback = options.fallback ?? false;
  try {
    return await runWithRequestContext({ userEmail: options.as ?? OWNER }, () =>
      searchDocuments.run({
        query,
        searchFields: options.searchFields,
        limit: options.limit ?? 50,
        offset: options.offset ?? 0,
      }),
    );
  } finally {
    mode.fallback = false;
  }
}

const ids = (result: Awaited<ReturnType<typeof search>>) =>
  result.documents.map((document) => document.id);

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
        ownerEmail: OWNER,
        description: "",
        ...fixture,
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

describe.each([
  { engine: "index", fallback: false },
  { engine: "fallback scan", fallback: true },
])("search-documents typo pass ($engine)", ({ fallback }) => {
  it("finds a page whose title word is mistyped and says what it matched", async () => {
    const result = await search("billng", { fallback });

    expect(ids(result)).toEqual(["billing"]);
    expect(result.spellingCorrections).toEqual([
      { term: "billng", replacements: ["billing"] },
    ]);
  });

  it("corrects the mistyped word in a longer query and keeps the rest", async () => {
    const result = await search("billng v2 spec", { fallback });

    expect(ids(result)).toEqual(["billing"]);
    expect(result.spellingCorrections).toEqual([
      { term: "billng", replacements: ["billing"] },
    ]);
  });

  it("corrects from descriptions, unless the search is limited to titles", async () => {
    expect(ids(await search("hnagar", { fallback }))).toEqual(["hangar"]);

    const titleOnly = await search("hnagar", {
      fallback,
      searchFields: "title",
    });
    expect(ids(titleOnly)).toEqual([]);
    expect(titleOnly.spellingCorrections).toBeUndefined();
  });

  it("never corrects to a word only another person's, hidden, or trashed page has", async () => {
    for (const query of ["zepyhrine", "qoukka", "marmoste"]) {
      const result = await search(query, { fallback });
      expect(ids(result), query).toEqual([]);
      expect(result.spellingCorrections, query).toBeUndefined();
    }

    // The other person's own search does use their title.
    expect(ids(await search("zepyhrine", { fallback, as: OTHER }))).toEqual([
      "other-zephyrine",
    ]);
  });

  it("leaves a query alone when anything matches as typed", async () => {
    const literal = await search("roadmpa", { fallback });
    expect(ids(literal)).toEqual(["literal-typo"]);
    expect(literal.spellingCorrections).toBeUndefined();

    const exact = await search("roadmap", { fallback });
    expect(ids(exact)).toEqual(["roadmap"]);
    expect(exact.spellingCorrections).toBeUndefined();
  });

  it("doesn't correct phrases or words shorter than four characters", async () => {
    expect(ids(await search('"billng v2"', { fallback }))).toEqual([]);
    expect(ids(await search("bil", { fallback }))).toEqual(["billing"]);
    expect(ids(await search("bkl", { fallback }))).toEqual([]);
  });

  it("pages through corrected results exactly once each", async () => {
    const seen: string[] = [];
    for (let offset = 0; offset < 6; offset += 2) {
      const page = await search("quartrly", { fallback, limit: 2, offset });
      expect(page.pagination.totalItems).toBe(5);
      seen.push(...ids(page));
    }

    expect(seen).toEqual([
      "quarterly-5",
      "quarterly-4",
      "quarterly-3",
      "quarterly-2",
      "quarterly-1",
    ]);
  });
});
