import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The typo pass in search-documents: when nothing matches, a mistyped word
// is also matched as the closest words in titles and descriptions the caller
// can see. Every case runs on the index and on the fallback scan.

const mode = vi.hoisted(() => ({
  fallback: false,
  indexReady: undefined as boolean | undefined,
}));

vi.mock("@agent-native/core/search", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/search")>();
  return {
    ...actual,
    prepareSearchIndex: async (
      ...args: Parameters<typeof actual.prepareSearchIndex>
    ) => {
      if (mode.fallback) {
        return { ready: false as const, reason: "backlog" as const };
      }
      const state = await actual.prepareSearchIndex(...args);
      mode.indexReady = state.ready;
      return state;
    },
  };
});

const TEST_DB_PATH = join(
  tmpdir(),
  `content-search-typo-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "search-typo-owner@example.com";
const OTHER = "search-typo-other@example.com";
// Owns a library of more distinct words than the typo pass reads.
const LARGE = "search-typo-large@example.com";

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
  { id: "pre-launch", title: "Pre-launch checklist", content: "" },
  { id: "kickoff-agenda", title: "Kickoff-agenda v2", content: "" },
  // Text stored in forms the index normalizes and the fallback scan matches
  // as stored: full-width letters, circled letters, and a separate accent.
  { id: "fullwidth-gazebo", title: "Ｇａｚｅｂｏ plan", content: "" },
  { id: "fullwidth-compound", title: "pre-Ｍｅｅｔｉｎｇ notes", content: "" },
  { id: "circled-kiosk", title: "Ⓚⓘⓞⓢⓚ hours", content: "" },
  { id: "decomposed-cafeteria", title: "Caféteria menu", content: "" },
  {
    id: "billing-archive",
    parentId: "billing",
    title: "Archive index",
    content: "",
  },
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
    parentId?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  mode.fallback = options.fallback ?? false;
  mode.indexReady = undefined;
  try {
    const result = await runWithRequestContext(
      { userEmail: options.as ?? OWNER },
      () =>
        searchDocuments.run({
          query,
          searchFields: options.searchFields,
          parentId: options.parentId,
          limit: options.limit ?? 50,
          offset: options.offset ?? 0,
        }),
    );
    // The index lane must really have answered from the index.
    if (!mode.fallback) expect(mode.indexReady, query).toBe(true);
    return result;
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
  // 60,000 distinct filler words, each used once, and "roadmap" used twice.
  await getDb()
    .insert(schema.documents)
    .values([
      ...Array.from({ length: 60 }, (_, page) => ({
        id: `large-filler-${page}`,
        ownerEmail: LARGE,
        title: "Filler",
        description: Array.from(
          { length: 1000 },
          (_, word) => `aq${String(page * 1000 + word).padStart(5, "0")}`,
        ).join(" "),
        content: "",
        visibility: "private" as const,
        updatedAt: new Date(start).toISOString(),
      })),
      ...["Roadmap plan", "Roadmap notes"].map((title, index) => ({
        id: `large-roadmap-${index + 1}`,
        ownerEmail: LARGE,
        title,
        description: "",
        content: "",
        visibility: "private" as const,
        updatedAt: new Date(start + (index + 1) * 60_000).toISOString(),
      })),
    ]);
}, 120_000);

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

  it("corrects a word next to punctuation", async () => {
    const trailing = await search("billng,", { fallback });
    expect(ids(trailing)).toEqual(["billing"]);
    expect(trailing.spellingCorrections).toEqual([
      { term: "billng", replacements: ["billing"] },
    ]);

    const inner = await search("pre-lauch", { fallback });
    expect(ids(inner)).toEqual(["pre-launch"]);
    expect(inner.spellingCorrections).toEqual([
      { term: "lauch", replacements: ["launch"] },
    ]);

    // Two mistyped words in one term, and one of them again on its own.
    const both = await search("kikcoff-agneda kikcoff", { fallback });
    expect(ids(both)).toEqual(["kickoff-agenda"]);
    expect(both.spellingCorrections).toEqual([
      { term: "kikcoff", replacements: ["kickoff"] },
      { term: "agneda", replacements: ["agenda"] },
    ]);
  });

  it("finds a correction taken from text stored in another form", async () => {
    for (const [query, id, term, word] of [
      ["gazbeo", "fullwidth-gazebo", "gazbeo", "gazebo"],
      ["pre-meetnig", "fullwidth-compound", "meetnig", "meeting"],
      ["kisok", "circled-kiosk", "kisok", "kiosk"],
      ["cafétreia", "decomposed-cafeteria", "cafétreia", "caféteria"],
    ]) {
      const result = await search(query!, { fallback });
      expect(ids(result), query).toEqual([id]);
      expect(result.spellingCorrections, query).toEqual([
        { term, replacements: [word] },
      ]);
    }
  });

  it("corrects only to words of pages the filters allow", async () => {
    expect(
      ids(await search("archve", { fallback, parentId: "billing" })),
    ).toEqual(["billing-archive"]);

    const outside = await search("hnagar", { fallback, parentId: "billing" });
    expect(ids(outside)).toEqual([]);
    expect(outside.spellingCorrections).toBeUndefined();
  });

  it("keeps the most-used words when a library has more than it reads", async () => {
    // Sorting instead of hashing reads words alphabetically, so a cap that
    // kept whichever words came first would keep only filler.
    await getDb().execute(sql`set enable_hashagg = off`);
    try {
      const result = await search("roadmpa", { fallback, as: LARGE });
      expect(ids(result)).toEqual(["large-roadmap-2", "large-roadmap-1"]);
      expect(result.spellingCorrections).toEqual([
        { term: "roadmpa", replacements: ["roadmap"] },
      ]);
    } finally {
      await getDb().execute(sql`reset enable_hashagg`);
    }
  });

  it("doesn't correct an empty later page of a query that matched", async () => {
    const page = await search("roadmap", { fallback, offset: 10 });

    expect(ids(page)).toEqual([]);
    expect(page.pagination.totalItems).toBe(1);
    expect(page.spellingCorrections).toBeUndefined();
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
