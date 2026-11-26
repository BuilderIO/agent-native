import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { EmbeddingFamily } from "../embeddings/index.js";
import { createMemorySearchVectorStore } from "./memory-vector-store.js";
import type { SearchableResourceRegistration } from "./registry.js";

// Real PGlite behind getDbExec: the change feed, its triggers, and the
// embeddings table run their genuine statements. Vectors live in the
// in-memory store, since PGlite has no pgvector.

const recordUsage = vi.hoisted(() =>
  vi.fn(async (_record: unknown) => undefined),
);
vi.mock("../usage/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../usage/store.js")>()),
  recordUsage: (record: unknown) => recordUsage(record),
}));

// Lets a test pause a drain right after it reads the setting.
const afterSettingRead = vi.hoisted(() => ({
  hook: null as ((enabled: boolean) => Promise<void>) | null,
}));
vi.mock("./semantic-setting.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./semantic-setting.js")>();
  return {
    ...actual,
    async readSemanticSearchSetting(
      ...args: Parameters<typeof actual.readSemanticSearchSetting>
    ) {
      const setting = await actual.readSemanticSearchSetting(...args);
      await afterSettingRead.hook?.(setting.enabled);
      return setting;
    },
  };
});

type Client = typeof import("../db/client.js");
type Search = typeof import("./index.js");
type Context = typeof import("../server/request-context.js");

let client: Client;
let search: Search;
let context: Context;
let registration: SearchableResourceRegistration;
const store = createMemorySearchVectorStore();

/**
 * Words that mean the same thing share a dimension, so a question finds a
 * page in other words, as a real embedding model would.
 */
const CONCEPTS = [
  ["refund", "refunds", "money", "reimburse"],
  ["vacation", "holiday", "leave", "pto"],
  ["laptop", "computer", "hardware"],
  ["roadmap", "plan", "quarter"],
];

function conceptVector(text: string): number[] {
  const words = text.toLowerCase().split(/[^a-z]+/);
  return [
    ...CONCEPTS.map(
      (group) => words.filter((word) => group.includes(word)).length,
    ),
    0.01,
  ];
}

const embedCalls: { texts: string[]; purpose: string }[] = [];
let failOn: string | null = null;

const family: EmbeddingFamily = {
  id: "fake-concepts",
  provider: "fake",
  model: "fake-concepts-1",
  version: "1",
  dimensions: CONCEPTS.length + 1,
  async embed(inputs, purpose) {
    const texts = inputs.map((input) => input.text ?? "");
    if (failOn !== null && texts.some((text) => text.includes(failOn ?? ""))) {
      throw new Error("provider refused");
    }
    embedCalls.push({ texts, purpose });
    return texts.map(conceptVector);
  },
};

const exec = () => client.getDbExec();

async function run(sql: string, args: unknown[] = []) {
  // raw-sql-ok: tests pass fixed SQL and bind their values.
  return exec().execute({ sql, args });
}

async function insertPage(
  id: string,
  title: string,
  body: string,
  audience: { orgId?: string; ownerEmail?: string } = { orgId: "org-a" },
) {
  await run(
    `INSERT INTO pages (id, title, body, org_id, owner_email) VALUES (?, ?, ?, ?, ?)`,
    [
      id,
      title,
      body,
      audience.orgId ?? null,
      audience.ownerEmail ?? "owner@a.com",
    ],
  );
}

/** Ages every queued change past the settle window, as a pause in edits would. */
async function settle() {
  await run(
    `UPDATE app_resource_changes SET changed_at = changed_at - interval '5 minutes', available_at = LEAST(available_at, now())
     WHERE consumer = 'search-embeddings'`,
  );
}

async function drain() {
  await search.drainSemanticIndex(registration, Date.now() + 10_000);
}

async function pendingIds(): Promise<string[]> {
  const { rows } = await run(
    `SELECT resource_id FROM app_resource_changes WHERE consumer = 'search-embeddings' ORDER BY resource_id`,
  );
  return rows.map((row) => String(row.resource_id));
}

function searchAs(
  identity: { userEmail: string; orgId?: string },
  query: string,
  audienceIds = search.semanticSearcherAudienceIds({
    userEmail: identity.userEmail,
    orgIds: identity.orgId ? [identity.orgId] : [],
  }),
) {
  return context.runWithRequestContext(identity, () =>
    search.searchSemanticIndex(registration, { query, audienceIds, limit: 10 }),
  );
}

async function turnSemanticSearch(orgId: string, enabled: boolean) {
  await search.writeSemanticSearchSetting(orgId, {
    enabled,
    updatedBy: "admin@a.com",
  });
  if (enabled) await search.requeueSemanticSearchForOrg(orgId);
  else await search.forgetSemanticSearchForOrg(orgId);
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory");
  client = await import("../db/client.js");
  context = await import("../server/request-context.js");
  const { integer, pgTable, text } = await import("drizzle-orm/pg-core");
  const drizzle = await import("drizzle-orm");
  const { createGetDb } = await import("../db/create-get-db.js");
  const pages = pgTable("pages", {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    orgId: text("org_id"),
    ownerEmail: text("owner_email").notNull(),
    hidden: integer("hidden").notNull(),
  });
  const db = createGetDb({ pages })();
  search = await import("./index.js");
  // An app loads it at boot; loaded here, the first drain's deadline isn't
  // spent importing it.
  await import("../org/context.js");

  await run(
    `CREATE TABLE pages (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', org_id TEXT, owner_email TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0)`,
  );
  // The organization store's table, which every app has.
  await run(
    `CREATE TABLE org_members (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at BIGINT NOT NULL, federation_removal_pending_at BIGINT)`,
  );
  registration = search.registerSearchableResource({
    app: "wiki",
    type: "page",
    table: pages,
    idColumn: pages.id,
    version: 1,
    semantic: true,
    load: async (ids) => {
      const rows = await db
        .select()
        .from(pages)
        .where(drizzle.inArray(pages.id, ids));
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        audience: { orgId: row.orgId, ownerEmail: row.ownerEmail },
        semantic: row.hidden === 0,
      }));
    },
  });
  search.configureSemanticSearch({
    vectorStore: store,
    resolveEmbeddingFamily: async (identity) =>
      identity?.orgId === "org-no-provider" ? null : family,
  });

  await insertPage(
    "refunds",
    "Refund policy",
    "Ask support and they reimburse you within a week.",
  );
  await insertPage(
    "vacation",
    "Vacation",
    "Holiday requests go to your manager.",
  );
  await insertPage(
    "other-org",
    "Refunds elsewhere",
    "Money back rules for another company.",
    {
      orgId: "org-b",
    },
  );
  await insertPage("mine", "My laptop notes", "Hardware I asked for.", {
    ownerEmail: "Solo@Example.com",
  });

  for (const migration of [
    search.searchIndexMigration(registration, {
      version: 1,
      name: "search-index-wiki",
    }),
    search.semanticSearchMigration(registration, {
      version: 2,
      name: "search-embeddings-wiki",
    }),
  ]) {
    if (!migration.run) throw new Error("Expected a run migration.");
    await migration.run(exec());
  }
});

afterAll(async () => {
  search.configureSemanticSearch({});
  search.unregisterSearchableResource("wiki", "page");
  await client.closeDbExec();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  embedCalls.length = 0;
  recordUsage.mockClear();
  failOn = null;
});

describe("the meaning lane", () => {
  it("queues existing pages on its first drain, embeds them once they settle, and answers questions in other words", async () => {
    // The migration only asks for a backfill, so booting queues no page.
    expect(await pendingIds()).toEqual([]);
    // The first drain queues every page; changes younger than the settle
    // window wait.
    await drain();
    expect(await pendingIds()).toEqual([
      "mine",
      "other-org",
      "refunds",
      "vacation",
    ]);
    expect(embedCalls).toEqual([]);

    await settle();
    await drain();
    expect(await pendingIds()).toEqual([]);
    expect(store.keys()).toEqual([
      "wiki/page/mine/0",
      "wiki/page/other-org/0",
      "wiki/page/refunds/0",
      "wiki/page/vacation/0",
    ]);
    expect(embedCalls.every((call) => call.purpose === "document")).toBe(true);

    const result = await searchAs(
      { userEmail: "reader@a.com", orgId: "org-a" },
      "how do I get my money back",
    );
    expect(result).toMatchObject({ status: "used" });
    if (result.status !== "used") return;
    // The other organization's page matches too, but isn't in this reader's audiences.
    expect(result.hits.map((hit) => hit.id)[0]).toBe("refunds");
    expect(result.hits.map((hit) => hit.id)).not.toContain("other-org");
  });

  it("drops matches below the model's similarity floor", async () => {
    const reader = { userEmail: "reader@a.com", orgId: "org-a" };
    const unfloored = await searchAs(reader, "how do I get my money back");
    expect(
      unfloored.status === "used" && unfloored.hits.map((hit) => hit.id),
    ).toEqual(["refunds", "vacation"]);

    search.configureSemanticSearch({
      vectorStore: store,
      resolveEmbeddingFamily: async () => ({ ...family, minSimilarity: 0.5 }),
    });
    try {
      const close = await searchAs(reader, "how do I get my money back");
      expect(
        close.status === "used" && close.hits.map((hit) => hit.id),
      ).toEqual(["refunds"]);
      // A question no page answers finds nothing, not the nearest pages.
      expect(await searchAs(reader, "what time is lunch")).toEqual({
        status: "used",
        hits: [],
      });
    } finally {
      search.configureSemanticSearch({
        vectorStore: store,
        resolveEmbeddingFamily: async (identity) =>
          identity?.orgId === "org-no-provider" ? null : family,
      });
    }
  });

  it("matches a page with no organization only for its owner", async () => {
    const owner = await searchAs(
      { userEmail: "solo@example.com" },
      "my computer",
    );
    const stranger = await searchAs(
      { userEmail: "someone@else.com" },
      "my computer",
    );
    expect(owner.status === "used" && owner.hits.map((hit) => hit.id)).toEqual([
      "mine",
    ]);
    expect(stranger.status === "used" && stranger.hits).toEqual([]);
  });

  it("records every embedding call as usage, for documents and queries", async () => {
    await run(
      `UPDATE pages SET body = 'Ask support for money back.' WHERE id = 'refunds'`,
    );
    await settle();
    await drain();
    await searchAs(
      { userEmail: "reader@a.com", orgId: "org-a" },
      "refund timing",
    );
    expect(recordUsage.mock.calls.map(([record]) => record)).toEqual([
      expect.objectContaining({
        ownerEmail: "owner@a.com",
        orgId: "org-a",
        label: "search-index-embeddings",
        model: "fake-concepts-1",
        costSource: "unavailable",
        outputTokens: 0,
      }),
      expect.objectContaining({
        ownerEmail: "reader@a.com",
        orgId: "org-a",
        label: "search-query-embeddings",
      }),
    ]);
  });

  it("skips a page whose text didn't change, and drops chunks a shorter page no longer has", async () => {
    const long = Array.from(
      { length: 6 },
      () => `${"plan ".repeat(60)}done.`,
    ).join(" ");
    await run(`UPDATE pages SET body = ? WHERE id = 'vacation'`, [long]);
    await settle();
    await drain();
    expect(
      store.keys().filter((key) => key.startsWith("wiki/page/vacation/")),
    ).toEqual(["wiki/page/vacation/0", "wiki/page/vacation/1"]);

    embedCalls.length = 0;
    // The same text again: recorded as a change, but nothing to embed.
    await run(`UPDATE pages SET body = body WHERE id = 'vacation'`);
    await settle();
    await drain();
    expect(embedCalls).toEqual([]);
    expect(await pendingIds()).toEqual([]);

    await run(
      `UPDATE pages SET body = 'Holiday requests go to your manager.' WHERE id = 'vacation'`,
    );
    await settle();
    await drain();
    expect(
      store.keys().filter((key) => key.startsWith("wiki/page/vacation/")),
    ).toEqual(["wiki/page/vacation/0"]);
  });

  it("embeds a page again for a new version of its model, whose searches never match the old version's vectors", async () => {
    // The resolver answers with the new version from the next call on, as a
    // provider's model can change while the process runs.
    let version = "1";
    search.configureSemanticSearch({
      vectorStore: store,
      resolveEmbeddingFamily: async () => ({ ...family, version }),
    });
    const found = async () => {
      const result = await searchAs(
        { userEmail: "reader@a.com", orgId: "org-a" },
        "laptop hardware",
      );
      return result.status === "used" ? result.hits.map((hit) => hit.id) : [];
    };
    try {
      await insertPage("versioned", "Laptop policy", "Hardware goes to IT.");
      await settle();
      await drain();
      expect(await found()).toContain("versioned");

      version = "2";
      embedCalls.length = 0;
      expect(await found()).not.toContain("versioned");
      // The question is embedded again with the new version, not reused.
      expect(embedCalls).toEqual([
        { texts: ["laptop hardware"], purpose: "query" },
      ]);
      // An edit that leaves its text alone embeds it with the new version.
      await run(
        `UPDATE pages SET owner_email = 'editor@a.com' WHERE id = 'versioned'`,
      );
      expect(await pendingIds()).toContain("versioned");
      await settle();
      embedCalls.length = 0;
      await drain();
      expect(embedCalls.flatMap((call) => call.texts).join(" ")).toContain(
        "Hardware goes to IT.",
      );
      expect(await found()).toContain("versioned");

      await run(`DELETE FROM pages WHERE id = 'versioned'`);
      await settle();
      await drain();
    } finally {
      search.configureSemanticSearch({
        vectorStore: store,
        resolveEmbeddingFamily: async (identity) =>
          identity?.orgId === "org-no-provider" ? null : family,
      });
    }
  });

  it("forgets a deleted page", async () => {
    await insertPage("temp", "Temporary laptop page", "Hardware.");
    await settle();
    await drain();
    expect(store.keys()).toContain("wiki/page/temp/0");
    await run(`DELETE FROM pages WHERE id = 'temp'`);
    await settle();
    await drain();
    expect(store.keys()).not.toContain("wiki/page/temp/0");
    const { rows } = await run(
      `SELECT 1 FROM search_embeddings WHERE resource_id = 'temp'`,
    );
    expect(rows).toEqual([]);
  });

  it("sends nothing for a page search never returns, and deletes its vectors", async () => {
    try {
      await insertPage("shown", "Shown laptop", "Hardware shown.");
      await run(
        `INSERT INTO pages (id, title, body, owner_email, hidden) VALUES ('kept-out', 'Kept out', 'Hardware kept out.', 'owner@a.com', 1)`,
      );
      await settle();
      await drain();
      expect(store.keys()).toContain("wiki/page/shown/0");
      expect(store.keys()).not.toContain("wiki/page/kept-out/0");
      expect(embedCalls.flatMap((call) => call.texts).join(" ")).not.toContain(
        "kept out",
      );

      await run(`UPDATE pages SET hidden = 1 WHERE id = 'shown'`);
      await settle();
      await drain();
      expect(store.keys()).not.toContain("wiki/page/shown/0");
      const { rows } = await run(
        `SELECT 1 FROM search_embeddings WHERE resource_id IN ('shown', 'kept-out')`,
      );
      expect(rows).toEqual([]);

      await run(`UPDATE pages SET hidden = 0 WHERE id = 'kept-out'`);
      await settle();
      await drain();
      expect(store.keys()).toContain("wiki/page/kept-out/0");
    } finally {
      await run(`DELETE FROM pages WHERE id IN ('shown', 'kept-out')`);
      await settle();
      await drain();
    }
  });

  it("holds back only the page the provider refuses, and retries it", async () => {
    await insertPage("bad", "Poison laptop", "Hardware poison.");
    await insertPage("good", "Good laptop", "Hardware fine.");
    failOn = "poison";
    await settle();
    await drain();
    expect(store.keys()).toContain("wiki/page/good/0");
    expect(store.keys()).not.toContain("wiki/page/bad/0");
    expect(await pendingIds()).toEqual(["bad"]);

    failOn = null;
    await settle();
    await drain();
    expect(store.keys()).toContain("wiki/page/bad/0");
    expect(await pendingIds()).toEqual([]);
  });

  it("keeps a page's audience when its owner has no provider, so choosing one queues it", async () => {
    await insertPage("unpowered", "Roadmap", "Next quarter's plan.", {
      orgId: "org-no-provider",
    });
    await settle();
    await drain();
    expect(store.keys()).not.toContain("wiki/page/unpowered/0");
    const { rows } = await run(
      `SELECT audience_id, content_hash FROM search_embeddings WHERE resource_id = 'unpowered'`,
    );
    expect(rows).toEqual([
      { audience_id: "org:org-no-provider", content_hash: "no-provider" },
    ]);

    await search.requeueSemanticSearchForOrg("org-no-provider");
    expect(await pendingIds()).toEqual(["unpowered"]);
    await run(`DELETE FROM pages WHERE id = 'unpowered'`);
    await settle();
    await drain();
  });

  it("deletes a page's vectors when it moves to an organization with no provider", async () => {
    await insertPage("moved", "Laptop", "Hardware moving.");
    await settle();
    await drain();
    expect(store.keys()).toContain("wiki/page/moved/0");

    await run(`UPDATE pages SET org_id = 'org-no-provider' WHERE id = 'moved'`);
    await settle();
    await drain();
    // Its vectors named org-a, whose lane turning off would no longer find them.
    expect(store.keys()).not.toContain("wiki/page/moved/0");
    const { rows } = await run(
      `SELECT audience_id, dimensions, chunk_count, content_hash FROM search_embeddings WHERE resource_id = 'moved'`,
    );
    expect(rows).toMatchObject([
      {
        audience_id: "org:org-no-provider",
        dimensions: null,
        chunk_count: 0,
        content_hash: "no-provider",
      },
    ]);

    await search.requeueSemanticSearchForOrg("org-no-provider");
    expect(await pendingIds()).toEqual(["moved"]);
    await run(`DELETE FROM pages WHERE id = 'moved'`);
    await settle();
    await drain();
  });
});

describe("an organization that turns semantic search off", () => {
  it("has its vectors deleted, sends nothing, and searches report the lane off", async () => {
    expect(store.keys()).toContain("wiki/page/refunds/0");
    await turnSemanticSearch("org-a", false);
    expect(
      store.keys().some((key) => /refunds|vacation|good|bad/.test(key)),
    ).toBe(false);
    // Another organization's vectors stay.
    expect(store.keys()).toContain("wiki/page/other-org/0");

    await run(
      `UPDATE pages SET body = 'Refunds take a week.' WHERE id = 'refunds'`,
    );
    await insertPage("new-while-off", "Vacation plan", "Leave dates.");
    await settle();
    await drain();
    expect(embedCalls).toEqual([]);
    expect(store.keys()).not.toContain("wiki/page/new-while-off/0");

    const result = await searchAs(
      { userEmail: "reader@a.com", orgId: "org-a" },
      "money back",
    );
    expect(result).toEqual({ status: "off" });
    expect(embedCalls).toEqual([]);
  });

  it("embeds every page again when it turns semantic search back on", async () => {
    await turnSemanticSearch("org-a", true);
    await settle();
    await drain();
    expect(store.keys()).toEqual(
      expect.arrayContaining([
        "wiki/page/refunds/0",
        "wiki/page/vacation/0",
        "wiki/page/new-while-off/0",
      ]),
    );
    const result = await searchAs(
      { userEmail: "reader@a.com", orgId: "org-a" },
      "money back",
    );
    expect(result.status === "used" && result.hits[0]?.id).toBe("refunds");
  });

  it("never matches a searcher's other organization once that one turns it off", async () => {
    const reader = { userEmail: "reader@a.com", orgId: "org-a" };
    const audienceIds = search.semanticSearcherAudienceIds({
      userEmail: reader.userEmail,
      orgIds: ["org-a", "org-b"],
    });
    const found = async () => {
      const result = await searchAs(reader, "money back", audienceIds);
      return result.status === "used" ? result.hits.map((hit) => hit.id) : [];
    };
    expect(await found()).toContain("other-org");
    // Turned off, with its vectors not yet deleted.
    await search.writeSemanticSearchSetting("org-b", {
      enabled: false,
      updatedBy: "admin@b.com",
    });
    try {
      expect(store.keys()).toContain("wiki/page/other-org/0");
      const ids = await found();
      expect(ids).toContain("refunds");
      expect(ids).not.toContain("other-org");
    } finally {
      await search.writeSemanticSearchSetting("org-b", {
        enabled: true,
        updatedBy: "admin@b.com",
      });
    }
    expect(await found()).toContain("other-org");
  });

  it("covers the pages its members keep outside any organization", async () => {
    // A member's credentials resolve to their first organization, so org-a's
    // provider embeds Member's pages and org-b's embeds Both's.
    await run(
      `INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES
         ('m1', 'org-a', 'Member@A.com', 'member', 1),
         ('m2', 'org-b', 'both@a.com', 'member', 1),
         ('m3', 'org-a', 'both@a.com', 'member', 2)`,
    );
    await insertPage("member-notes", "Laptop notes", "Hardware I use.", {
      ownerEmail: "member@a.com",
    });
    await insertPage("both-notes", "Laptop wishes", "Hardware I want.", {
      ownerEmail: "both@a.com",
    });
    await settle();
    await drain();
    expect(store.keys()).toEqual(
      expect.arrayContaining([
        "wiki/page/member-notes/0",
        "wiki/page/both-notes/0",
      ]),
    );

    try {
      await turnSemanticSearch("org-a", false);
      expect(store.keys()).not.toContain("wiki/page/member-notes/0");
      // Solo belongs to no organization.
      expect(store.keys()).toContain("wiki/page/mine/0");

      embedCalls.length = 0;
      await insertPage("member-new", "Vacation notes", "Leave I plan.", {
        ownerEmail: "member@a.com",
      });
      await settle();
      await drain();
      expect(embedCalls.flatMap((call) => call.texts)).toEqual([
        expect.stringContaining("Hardware I want."),
      ]);
      expect(store.keys()).not.toContain("wiki/page/member-new/0");
      // org-b's switch governs Both's pages, so they are embedded again.
      expect(store.keys()).toContain("wiki/page/both-notes/0");
      expect(
        await searchAs({ userEmail: "member@a.com" }, "my computer"),
      ).toEqual({ status: "off" });
      expect(
        (await searchAs({ userEmail: "both@a.com" }, "my computer")).status,
      ).toBe("used");

      await turnSemanticSearch("org-a", true);
      await settle();
      await drain();
      expect(store.keys()).toEqual(
        expect.arrayContaining([
          "wiki/page/member-notes/0",
          "wiki/page/member-new/0",
        ]),
      );
    } finally {
      await run(
        `DELETE FROM pages WHERE id IN ('member-notes', 'member-new', 'both-notes')`,
      );
      await run(`DELETE FROM org_members`);
      await settle();
      await drain();
    }
  });

  it("stores nothing from a batch embedded while the setting turned off", async () => {
    await run(
      `UPDATE pages SET body = 'Vacation requests, now by email.' WHERE id = 'vacation'`,
    );
    await settle();
    const embed = family.embed;
    family.embed = async (inputs, purpose, options) => {
      await search.writeSemanticSearchSetting("org-a", {
        enabled: false,
        updatedBy: "admin@a.com",
      });
      return embed(inputs, purpose, options);
    };
    try {
      await drain();
    } finally {
      family.embed = embed;
    }
    // Before the action deletes the organization's vectors.
    expect(store.keys().filter((key) => key.includes("/vacation/"))).toEqual(
      [],
    );
    await turnSemanticSearch("org-a", true);
    await settle();
    await drain();
    expect(store.keys()).toContain("wiki/page/vacation/0");
  });

  it("removes what it stored when the setting turned off while it was storing", async () => {
    await run(
      `UPDATE pages SET body = 'Vacation requests, by email or chat.' WHERE id = 'vacation'`,
    );
    await settle();
    search.configureSemanticSearch({
      vectorStore: {
        ...store,
        async upsert(target, input) {
          await store.upsert(target, input);
          await search.writeSemanticSearchSetting("org-a", {
            enabled: false,
            updatedBy: "admin@a.com",
          });
        },
      },
      resolveEmbeddingFamily: async () => family,
    });
    try {
      await drain();
    } finally {
      search.configureSemanticSearch({
        vectorStore: store,
        resolveEmbeddingFamily: async (identity) =>
          identity?.orgId === "org-no-provider" ? null : family,
      });
    }
    // Before the action deletes the organization's vectors.
    expect(store.keys().filter((key) => key.includes("/vacation/"))).toEqual(
      [],
    );
    const { rows } = await run(
      `SELECT content_hash FROM search_embeddings WHERE resource_id = 'vacation'`,
    );
    expect(rows).toEqual([{ content_hash: "off" }]);
    await turnSemanticSearch("org-a", true);
    await settle();
    await drain();
    expect(store.keys()).toContain("wiki/page/vacation/0");
  });
});

describe("when something fails part way", () => {
  function keysFor(id: string) {
    return store.keys().filter((key) => key.startsWith(`wiki/page/${id}/`));
  }

  function useStore(overrides: Partial<typeof store>) {
    search.configureSemanticSearch({
      vectorStore: { ...store, ...overrides },
      resolveEmbeddingFamily: async () => family,
    });
  }

  function restoreStore() {
    search.configureSemanticSearch({
      vectorStore: store,
      resolveEmbeddingFamily: async (identity) =>
        identity?.orgId === "org-no-provider" ? null : family,
    });
  }

  function gate() {
    let open: () => void = () => {};
    const opened = new Promise<void>((resolve) => {
      open = resolve;
    });
    let reached: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      reached = resolve;
    });
    return {
      open,
      waiting,
      async pass() {
        reached();
        await opened;
      },
    };
  }

  it("sees the setting turned off by another request while it embeds", async () => {
    await run(
      `UPDATE pages SET body = 'Vacation requests go to your lead.' WHERE id = 'vacation'`,
    );
    await settle();
    let release: () => void = () => {};
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: () => void = () => {};
    const embedding = new Promise<void>((resolve) => {
      started = resolve;
    });
    const embed = family.embed;
    family.embed = async (inputs, purpose, options) => {
      started();
      await paused;
      return embed(inputs, purpose, options);
    };
    try {
      // A drain after a write runs in the writer's request.
      const draining = context.runWithRequestContext(
        { userEmail: "writer@a.com", orgId: "org-a" },
        () => drain(),
      );
      await embedding;
      await context.runWithRequestContext(
        { userEmail: "admin@a.com", orgId: "org-a" },
        () => turnSemanticSearch("org-a", false),
      );
      release();
      await draining;
    } finally {
      family.embed = embed;
    }
    const leftover = keysFor("vacation");
    await turnSemanticSearch("org-a", true);
    await settle();
    await drain();
    expect(leftover).toEqual([]);
    expect(keysFor("vacation")).toEqual(["wiki/page/vacation/0"]);
  });

  it("embeds a page again when storing its vectors failed", async () => {
    await insertPage("unstored", "Laptop requests", "They go to IT.");
    await settle();
    let failUpsert = true;
    useStore({
      async upsert(target, input) {
        if (failUpsert) {
          failUpsert = false;
          throw new Error("store down");
        }
        await store.upsert(target, input);
      },
    });
    try {
      await drain();
      expect(await pendingIds()).toEqual(["unstored"]);
      await settle();
      await drain();
    } finally {
      restoreStore();
    }
    expect(await pendingIds()).toEqual([]);
    expect(keysFor("unstored")).toEqual(["wiki/page/unstored/0"]);
  });

  it("still finds every chunk to delete when dropping a shorter page's chunks failed", async () => {
    const long = Array.from(
      { length: 6 },
      () => `${"laptop ".repeat(59)}done.`,
    ).join(" ");
    await insertPage("shrinking", "Laptop guide", long);
    await settle();
    await drain();
    expect(keysFor("shrinking")).toHaveLength(3);

    await run(`UPDATE pages SET body = 'Short now.' WHERE id = 'shrinking'`);
    await settle();
    let failRemove = true;
    useStore({
      async remove(target, input) {
        if (failRemove) {
          failRemove = false;
          throw new Error("store down");
        }
        await store.remove(target, input);
      },
    });
    try {
      await drain();
      await settle();
      await drain();
    } finally {
      restoreStore();
    }
    expect(keysFor("shrinking")).toEqual(["wiki/page/shrinking/0"]);

    await run(`DELETE FROM pages WHERE id = 'shrinking'`);
    await settle();
    await drain();
    expect(keysFor("shrinking")).toEqual([]);
  });

  it("retries a page never embedded when the organization turns semantic search back on", async () => {
    failOn = "stubborn";
    await insertPage("stubborn", "Stubborn laptop", "Hardware stubborn.");
    await settle();
    await drain();
    const waiting = () =>
      run(
        `SELECT attempts, available_at > now() AS waiting FROM app_resource_changes
         WHERE consumer = 'search-embeddings' AND resource_id = 'stubborn'`,
      );
    expect((await waiting()).rows).toEqual([{ attempts: 1, waiting: true }]);

    failOn = null;
    await search.requeueSemanticSearchForOrg("org-a");
    expect((await waiting()).rows).toEqual([{ attempts: 0, waiting: false }]);
    await settle();
    await drain();
    expect(keysFor("stubborn")).toEqual(["wiki/page/stubborn/0"]);
  });

  it("stops retrying a refused batch page by page once its time is up", async () => {
    for (const id of ["slow-1", "slow-2", "slow-3"]) {
      await insertPage(id, "Slow laptop", `Hardware ${id}.`);
    }
    await settle();
    const embed = family.embed;
    const signals: (AbortSignal | undefined)[] = [];
    let clock = Date.now();
    const restoreClock = vi.spyOn(Date, "now").mockImplementation(() => clock);
    const deadline = clock + 20;
    family.embed = async (_inputs, _purpose, options) => {
      signals.push(options?.signal);
      clock = deadline;
      throw new Error("provider down");
    };
    try {
      await search.drainSemanticIndex(registration, deadline);
    } finally {
      family.embed = embed;
      restoreClock.mockRestore();
    }
    // The batch failed after the deadline, so no page was tried alone; each
    // call can time out.
    expect(signals).toHaveLength(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);

    await run(`DELETE FROM pages WHERE id LIKE 'slow-%'`);
    await settle();
    await drain();
    expect(await pendingIds()).toEqual([]);
  });

  it("waits out a rate limit with the whole batch, counting no attempt", async () => {
    const { EmbeddingProviderError } = await import("../embeddings/index.js");
    for (const id of ["busy-1", "busy-2", "busy-3"]) {
      await insertPage(id, "Busy laptop", `Hardware ${id}.`);
    }
    await settle();
    const embed = family.embed;
    let refused = 0;
    family.embed = async () => {
      refused += 1;
      throw new EmbeddingProviderError(
        "Embedding provider fake failed with status 429.",
        429,
        90_000,
      );
    };
    try {
      await drain();
    } finally {
      family.embed = embed;
    }
    // One call met the limit, and no page was then tried alone.
    expect(refused).toBe(1);
    const { rows } = await run(
      `SELECT resource_id, attempts, available_at > now() + interval '80 seconds' AS waiting
       FROM app_resource_changes
       WHERE consumer = 'search-embeddings' AND resource_id LIKE 'busy-%'
       ORDER BY resource_id`,
    );
    expect(rows).toEqual(
      ["busy-1", "busy-2", "busy-3"].map((id) => ({
        resource_id: id,
        attempts: 0,
        waiting: true,
      })),
    );

    // Once the wait is over, the three are embedded in one call.
    await settle();
    await drain();
    const busyCalls = embedCalls.filter((call) =>
      call.texts.some((text) => text.includes("busy")),
    );
    expect(busyCalls).toHaveLength(1);
    expect(
      busyCalls[0]?.texts.filter((text) => text.includes("busy")),
    ).toHaveLength(3);
    expect(await pendingIds()).toEqual([]);
  });

  it("holds pages back when the provider refuses its credentials, the ones it was sent longest, so a page refused alone holds back no others", async () => {
    const { EmbeddingProviderError } = await import("../embeddings/index.js");
    const ids = ["refused-1", "refused-2", "refused-3"];
    for (const id of ids) {
      await insertPage(id, "Refused tablet", `Gadget ${id}.`);
    }
    await settle();
    await run(
      `UPDATE app_resource_changes SET attempts = 600
       WHERE consumer = 'search-embeddings' AND resource_id = 'refused-3'`,
    );
    const embed = family.embed;
    let refusing = "Gadget";
    let refused = 0;
    family.embed = async (inputs, purpose, options) => {
      if (inputs.some((input) => input.text?.includes(refusing))) {
        refused += 1;
        throw new EmbeddingProviderError(
          "Embedding provider fake failed with status 403.",
          403,
        );
      }
      return embed(inputs, purpose, options);
    };
    const waits = async () => {
      const { rows } = await run(
        `SELECT resource_id, attempts,
                available_at > now() + interval '3500 seconds' AS hour,
                available_at > now() + interval '7100 seconds' AS two_hours
         FROM app_resource_changes
         WHERE consumer = 'search-embeddings' AND resource_id LIKE 'refused-%'
         ORDER BY resource_id`,
      );
      return rows;
    };
    const passHour = () =>
      run(
        `UPDATE app_resource_changes SET available_at = available_at - interval '1 hour'
         WHERE consumer = 'search-embeddings' AND resource_id LIKE 'refused-%'`,
      );
    const embedded = () => ids.filter((id) => keysFor(id).length > 0);
    try {
      await drain();
      expect(refused).toBe(1);
      expect(await waits()).toEqual([
        { resource_id: "refused-1", attempts: 1, hour: true, two_hours: true },
        { resource_id: "refused-2", attempts: 1, hour: true, two_hours: true },
        {
          resource_id: "refused-3",
          attempts: 600,
          hour: true,
          two_hours: false,
        },
      ]);

      refusing = "Gadget refused-1";
      await passHour();
      await drain();
      expect(embedded()).toEqual(["refused-3"]);

      await passHour();
      await drain();
      expect(refused).toBe(2);
      expect(embedded()).toEqual(["refused-3"]);
      expect(await waits()).toEqual([
        { resource_id: "refused-1", attempts: 2, hour: true, two_hours: true },
        { resource_id: "refused-2", attempts: 1, hour: true, two_hours: false },
      ]);

      await passHour();
      await drain();
      expect(refused).toBe(2);
      expect(embedded()).toEqual(["refused-2", "refused-3"]);
      expect(await waits()).toEqual([
        {
          resource_id: "refused-1",
          attempts: 2,
          hour: true,
          two_hours: false,
        },
      ]);
    } finally {
      family.embed = embed;
      await run(`DELETE FROM pages WHERE id LIKE 'refused-%'`);
      await settle();
      await drain();
    }
    expect(await pendingIds()).toEqual([]);
  });

  it("keeps the pages it embedded before a rate limit, and finishes over later windows", async () => {
    const { EmbeddingProviderError } = await import("../embeddings/index.js");
    // Twelve chunks each, so a call takes two pages and eight take four calls.
    const long = "Quota laptop notes. ".repeat(900);
    const ids = Array.from({ length: 8 }, (_, index) => `quota-${index}`);
    for (const id of ids) await insertPage(id, "Quota laptop", long);
    await settle();
    const embed = family.embed;
    // Three calls a window, as Builder's gateway allowed.
    let allowed = 3;
    family.embed = async (inputs, purpose, options) => {
      if (allowed <= 0) {
        throw new EmbeddingProviderError(
          "Embedding provider fake failed with status 429.",
          429,
        );
      }
      allowed -= 1;
      return embed(inputs, purpose, options);
    };
    const embedded = () =>
      ids.filter((id) => store.keys().includes(`wiki/page/${id}/0`));
    try {
      await drain();
      expect(embedded()).toHaveLength(6);
      for (let window = 0; window < 3; window++) {
        if (embedded().length === ids.length) break;
        allowed = 3;
        await settle();
        await drain();
      }
    } finally {
      family.embed = embed;
    }
    expect(embedded()).toEqual(ids);
    expect(await pendingIds()).toEqual([]);
  });

  it("embeds other organizations' pages while one organization is rate limited", async () => {
    const { EmbeddingProviderError } = await import("../embeddings/index.js");
    // The limited organization's page is older, so it leads the claim.
    await insertPage("limited-page", "Limited laptop", "Hardware limited.", {
      orgId: "org-limited",
    });
    await insertPage("free-page", "Free laptop", "Hardware free.");
    await settle();
    let limitedCalls = 0;
    const limitedFamily: EmbeddingFamily = {
      ...family,
      async embed() {
        limitedCalls += 1;
        throw new EmbeddingProviderError(
          "Embedding provider fake failed with status 429.",
          429,
        );
      },
    };
    search.configureSemanticSearch({
      vectorStore: store,
      resolveEmbeddingFamily: async (identity) =>
        identity?.orgId === "org-limited" ? limitedFamily : family,
    });
    try {
      await drain();
    } finally {
      restoreStore();
    }
    expect(limitedCalls).toBe(1);
    expect(keysFor("free-page")).toEqual(["wiki/page/free-page/0"]);
    expect(keysFor("limited-page")).toEqual([]);
    const { rows } = await run(
      `SELECT resource_id, attempts, available_at > now() AS waiting
       FROM app_resource_changes
       WHERE consumer = 'search-embeddings' AND resource_id IN ('limited-page', 'free-page')`,
    );
    expect(rows).toEqual([
      { resource_id: "limited-page", attempts: 0, waiting: true },
    ]);

    await run(`DELETE FROM pages WHERE id = 'limited-page'`);
    await settle();
    await drain();
    expect(await pendingIds()).toEqual([]);
  });

  it("embeds another member's pages while one member's credentials are rate limited", async () => {
    const { EmbeddingProviderError } = await import("../embeddings/index.js");
    await insertPage("limited-member", "Limited laptop", "Hardware limited.", {
      orgId: "org-a",
      ownerEmail: "limited@a.com",
    });
    await insertPage("other-member", "Other laptop", "Hardware other.", {
      orgId: "org-a",
      ownerEmail: "other@a.com",
    });
    await settle();
    let limitedCalls = 0;
    const limitedFamily: EmbeddingFamily = {
      ...family,
      async embed() {
        limitedCalls += 1;
        throw new EmbeddingProviderError(
          "Embedding provider fake failed with status 429.",
          429,
          undefined,
          "rate_limit_exceeded",
        );
      },
    };
    search.configureSemanticSearch({
      vectorStore: store,
      // One member's personal key, and the organization's for the other.
      resolveEmbeddingFamily: async (identity) =>
        identity?.userEmail === "limited@a.com" ? limitedFamily : family,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await drain();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("The embedding provider is rate limiting"),
        "Embedding provider fake failed with status 429. The provider's code: rate_limit_exceeded.",
      );
    } finally {
      warn.mockRestore();
      restoreStore();
    }
    expect(limitedCalls).toBe(1);
    expect(keysFor("other-member")).toEqual(["wiki/page/other-member/0"]);
    expect(keysFor("limited-member")).toEqual([]);
    const { rows } = await run(
      `SELECT resource_id, attempts, available_at > now() AS waiting
       FROM app_resource_changes
       WHERE consumer = 'search-embeddings' AND resource_id IN ('limited-member', 'other-member')`,
    );
    expect(rows).toEqual([
      { resource_id: "limited-member", attempts: 0, waiting: true },
    ]);

    await run(`DELETE FROM pages WHERE id = 'limited-member'`);
    await settle();
    await drain();
    expect(await pendingIds()).toEqual([]);
  });

  it("keeps the pages embedded before a rate limit by a provider taking one input a request", async () => {
    const { EmbeddingProviderError } = await import("../embeddings/index.js");
    const ids = Array.from({ length: 8 }, (_, index) => `single-${index}`);
    for (const id of ids) await insertPage(id, "Single laptop", "Notes.");
    await settle();
    const embed = family.embed;
    // Like Gemini, each input is its own request, and three go through a
    // window.
    let allowed = 3;
    family.inputsPerRequest = 1;
    family.embed = async (inputs, purpose, options) => {
      const vectors: number[][] = [];
      for (const input of inputs) {
        if (allowed <= 0) {
          throw new EmbeddingProviderError(
            "Embedding provider fake failed with status 429.",
            429,
          );
        }
        allowed -= 1;
        vectors.push(...(await embed([input], purpose, options)));
      }
      return vectors;
    };
    const embedded = () =>
      ids.filter((id) => store.keys().includes(`wiki/page/${id}/0`));
    try {
      await drain();
      expect(embedded()).toHaveLength(3);
      for (let window = 0; window < 4; window++) {
        if (embedded().length === ids.length) break;
        allowed = 3;
        await settle();
        await drain();
      }
    } finally {
      family.embed = embed;
      delete family.inputsPerRequest;
    }
    expect(embedded()).toEqual(ids);
    expect(await pendingIds()).toEqual([]);
  });

  it("keeps a rate limit's wait when a later page runs out of time", async () => {
    const { EmbeddingProviderError } = await import("../embeddings/index.js");
    // The limited organization's page is older, so it leads the claim.
    await insertPage("waiting-page", "Waiting laptop", "Hardware waiting.", {
      orgId: "org-limited",
    });
    await insertPage("slow-page", "Slow laptop", "Hardware slow.");
    await settle();
    const limitedFamily: EmbeddingFamily = {
      ...family,
      async embed() {
        throw new EmbeddingProviderError(
          "Embedding provider fake failed with status 429.",
          429,
          900_000,
        );
      },
    };
    const slowFamily: EmbeddingFamily = {
      ...family,
      // A call still running at the deadline, cut off by its timeout.
      embed: (_inputs, _purpose, options) =>
        new Promise<number[][]>((_resolve, reject) => {
          const signal = options?.signal;
          if (!signal) return;
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    };
    search.configureSemanticSearch({
      vectorStore: store,
      resolveEmbeddingFamily: async (identity) =>
        identity?.orgId === "org-limited" ? limitedFamily : slowFamily,
    });
    try {
      await search.drainSemanticIndex(registration, Date.now() + 500);
    } finally {
      restoreStore();
    }
    const { rows } = await run(
      `SELECT resource_id, attempts,
              available_at > now() + interval '800 seconds' AS waiting
       FROM app_resource_changes
       WHERE consumer = 'search-embeddings' AND resource_id = 'waiting-page'`,
    );
    expect(rows).toEqual([
      { resource_id: "waiting-page", attempts: 0, waiting: true },
    ]);
    expect(await pendingIds()).toContain("slow-page");

    await run(`DELETE FROM pages WHERE id IN ('waiting-page', 'slow-page')`);
    await settle();
    await drain();
    expect(await pendingIds()).toEqual([]);
  });

  it("never starts an embedding call after its time is up", async () => {
    const long = "laptop ".repeat(2500);
    for (let index = 0; index < 4; index++) {
      await insertPage(`budget-${index}`, "Laptop", long);
    }
    await settle();
    const embed = family.embed;
    const starts: number[] = [];
    const signals: (AbortSignal | undefined)[] = [];
    const deadline = Date.now() + 500;
    family.embed = async (inputs, purpose, options) => {
      starts.push(Date.now() - deadline);
      signals.push(options?.signal);
      // A slow call that ignores its signal and returns late anyway.
      await new Promise((resolve) => setTimeout(resolve, 700));
      return embed(inputs, purpose, options);
    };
    try {
      await search.drainSemanticIndex(registration, deadline);
    } finally {
      family.embed = embed;
    }
    // 48 chunks take two calls; the second would start after the deadline.
    expect(starts).toHaveLength(1);
    expect(starts[0]).toBeLessThan(0);
    // The call's timeout is the time left, not the full 15 seconds.
    expect(signals[0]?.aborted).toBe(true);
    // The pages the late call returned are stored and done. Out of time isn't
    // a failure, so the rest stay queued.
    expect(keysFor("budget-0")).toHaveLength(12);
    expect(keysFor("budget-1")).toHaveLength(12);
    expect(await pendingIds()).toEqual(["budget-2", "budget-3"]);

    await run(`DELETE FROM pages WHERE id LIKE 'budget-%'`);
    await settle();
    await drain();
    expect(await pendingIds()).toEqual([]);
  });

  it("completes the pages it embedded before running out of time", async () => {
    // The quick page is older, so it leads the claim and embeds first.
    await insertPage("quick-page", "Quick laptop", "Hardware quick.");
    await insertPage("late-page", "Late laptop", "Hardware late.", {
      orgId: "org-late",
    });
    await settle();
    const slowFamily: EmbeddingFamily = {
      ...family,
      // A call still running at the deadline, cut off by its timeout.
      embed: (_inputs, _purpose, options) =>
        new Promise<number[][]>((_resolve, reject) => {
          const signal = options?.signal;
          if (!signal) return;
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    };
    search.configureSemanticSearch({
      vectorStore: store,
      resolveEmbeddingFamily: async (identity) =>
        identity?.orgId === "org-late" ? slowFamily : family,
    });
    try {
      await search.drainSemanticIndex(registration, Date.now() + 500);
    } finally {
      restoreStore();
    }
    expect(keysFor("quick-page")).toEqual(["wiki/page/quick-page/0"]);
    const pending = await pendingIds();
    expect(pending).not.toContain("quick-page");
    expect(pending).toContain("late-page");

    await run(`DELETE FROM pages WHERE id IN ('quick-page', 'late-page')`);
    await settle();
    await drain();
    expect(await pendingIds()).toEqual([]);
  });

  it("deletes vectors stored part way when the lane is turned off meanwhile", async () => {
    const long = Array.from(
      { length: 6 },
      () => `${"laptop ".repeat(59)}done.`,
    ).join(" ");
    await insertPage("partial-off", "Laptop guide", long);
    await settle();
    useStore({
      async upsert(target, input) {
        await turnSemanticSearch("org-a", false);
        await store.upsert(target, {
          ...input,
          entries: input.entries.slice(0, 1),
        });
        throw new Error("storing the second chunk failed");
      },
    });
    try {
      await drain();
    } finally {
      restoreStore();
    }
    await settle();
    await drain();
    expect(keysFor("partial-off")).toEqual([]);
    expect(
      (
        await run(
          `SELECT dimensions, chunk_count, content_hash FROM search_embeddings WHERE resource_id = 'partial-off'`,
        )
      ).rows,
    ).toEqual([{ dimensions: null, chunk_count: 0, content_hash: "off" }]);
    expect(await pendingIds()).toEqual([]);

    await run(`DELETE FROM pages WHERE id = 'partial-off'`);
    await turnSemanticSearch("org-a", true);
    await settle();
    await drain();
  });

  it("embeds pages again when semantic search is turned back on while turning it off still runs", async () => {
    await insertPage("flip", "Laptop", "Hardware to flip.");
    await settle();
    await drain();
    const deleting = gate();
    useStore({
      async removeAudience(target, input) {
        await deleting.pass();
        await store.removeAudience(target, input);
      },
    });
    try {
      await search.writeSemanticSearchSetting("org-a", {
        enabled: false,
        updatedBy: "admin@a.com",
      });
      const turningOff = search.forgetSemanticSearchForOrg("org-a");
      await deleting.waiting;
      // Another admin turns it back on before the deletion runs.
      await turnSemanticSearch("org-a", true);
      await settle();
      await drain();
      deleting.open();
      await turningOff;
    } finally {
      restoreStore();
    }
    // The late deletion cleared the page, so it's queued again.
    expect(await pendingIds()).toContain("flip");
    await settle();
    await drain();
    expect(keysFor("flip")).toEqual(["wiki/page/flip/0"]);

    await run(`DELETE FROM pages WHERE id = 'flip'`);
    await settle();
    await drain();
  });

  describe("when two drains store one page at once", () => {
    // A second copy of the module drains like another process would.
    const secondCopy = "./semantic.js?second-drain";
    let other: typeof import("./semantic.js");

    beforeAll(async () => {
      other = (await import(
        /* @vite-ignore */ secondCopy
      )) as typeof import("./semantic.js");
    });

    async function row(id: string) {
      return (
        await run(
          `SELECT dimensions, chunk_count, content_hash FROM search_embeddings WHERE resource_id = ?`,
          [id],
        )
      ).rows;
    }

    it("never deletes a later change's vectors when switching models", async () => {
      await insertPage("model-race", "Laptop", "Old hardware");
      await settle();
      await drain();
      const embedding = gate();
      const otherModel: EmbeddingFamily = {
        ...family,
        id: "other-dimensions",
        dimensions: 6,
        async embed(inputs) {
          await embedding.pass();
          return inputs.map(() => [1, 0, 0, 0, 0, 0]);
        },
      };
      search.configureSemanticSearch({
        vectorStore: store,
        resolveEmbeddingFamily: async () => otherModel,
      });
      other.configureSemanticSearch({
        vectorStore: store,
        resolveEmbeddingFamily: async () => family,
      });
      try {
        await run(
          `UPDATE pages SET body = 'Middle laptop' WHERE id = 'model-race'`,
        );
        await settle();
        const older = drain();
        await embedding.waiting;
        await run(
          `UPDATE pages SET body = 'Newest computer' WHERE id = 'model-race'`,
        );
        await settle();
        await other.drainSemanticIndex(registration, Date.now() + 10_000);
        embedding.open();
        await older;
      } finally {
        restoreStore();
        other.configureSemanticSearch({});
      }
      expect(await row("model-race")).toMatchObject([
        { dimensions: 5, chunk_count: 1 },
      ]);
      expect(keysFor("model-race")).toEqual(["wiki/page/model-race/0"]);
      expect(await pendingIds()).toEqual([]);
    });

    it("embeds a page again when an older drain finishes storing after a newer one", async () => {
      const long = Array.from(
        { length: 6 },
        () => `${"laptop ".repeat(59)}done.`,
      ).join(" ");
      await insertPage("late-store", "Laptop", long);
      await settle();
      const storing = gate();
      useStore({
        async upsert(target, input) {
          if (
            input.entries.some((entry) => entry.key.includes("/late-store/"))
          ) {
            await storing.pass();
          }
          await store.upsert(target, input);
        },
      });
      other.configureSemanticSearch({
        vectorStore: store,
        resolveEmbeddingFamily: async () => family,
      });
      try {
        const older = drain();
        await storing.waiting;
        await run(
          `UPDATE pages SET body = 'Short computer' WHERE id = 'late-store'`,
        );
        await settle();
        await other.drainSemanticIndex(registration, Date.now() + 10_000);
        storing.open();
        await older;
      } finally {
        restoreStore();
        other.configureSemanticSearch({});
      }
      // The older drain wrote three chunks over the newer one's single chunk.
      expect(keysFor("late-store")).toHaveLength(3);
      expect(await row("late-store")).toMatchObject([
        { chunk_count: 3, content_hash: "repair" },
      ]);

      embedCalls.length = 0;
      await settle();
      await drain();
      expect(embedCalls.flatMap((call) => call.texts).join(" ")).toContain(
        "Short computer",
      );
      expect(keysFor("late-store")).toEqual(["wiki/page/late-store/0"]);
      expect(await row("late-store")).toMatchObject([{ chunk_count: 1 }]);

      await run(`DELETE FROM pages WHERE id = 'late-store'`);
      await settle();
      await drain();
      expect(keysFor("late-store")).toEqual([]);
      expect(await row("late-store")).toEqual([]);
      expect(await pendingIds()).toEqual([]);
    });

    it("leaves nothing behind when a newer drain deletes the page while an older one stores it", async () => {
      await insertPage("deleted-mid-store", "Laptop", "Hardware to delete.");
      await settle();
      const storing = gate();
      useStore({
        async upsert(target, input) {
          if (
            input.entries.some((entry) =>
              entry.key.includes("/deleted-mid-store/"),
            )
          ) {
            await storing.pass();
          }
          await store.upsert(target, input);
        },
      });
      other.configureSemanticSearch({
        vectorStore: store,
        resolveEmbeddingFamily: async () => family,
      });
      try {
        const older = drain();
        await storing.waiting;
        await run(`DELETE FROM pages WHERE id = 'deleted-mid-store'`);
        await settle();
        await other.drainSemanticIndex(registration, Date.now() + 10_000);
        storing.open();
        await older;
      } finally {
        restoreStore();
        other.configureSemanticSearch({});
      }
      expect(keysFor("deleted-mid-store")).toEqual([]);
      expect(await row("deleted-mid-store")).toEqual([]);
      expect(await pendingIds()).toEqual([]);
    });

    it("keeps a repair asked for while a newer drain is still storing", async () => {
      const long = Array.from(
        { length: 6 },
        () => `${"laptop ".repeat(59)}done.`,
      ).join(" ");
      await insertPage("mid-store", "Laptop", long);
      await settle();
      const olderStoring = gate();
      useStore({
        async upsert(target, input) {
          if (
            input.entries.some((entry) => entry.key.includes("/mid-store/"))
          ) {
            await olderStoring.pass();
          }
          await store.upsert(target, input);
        },
      });
      const newerFinishing = gate();
      other.configureSemanticSearch({
        vectorStore: {
          ...store,
          async remove(target, input) {
            await store.remove(target, input);
            if (input.keys.some((key) => key.includes("/mid-store/"))) {
              await newerFinishing.pass();
            }
          },
        },
        resolveEmbeddingFamily: async () => family,
      });
      try {
        const older = drain();
        await olderStoring.waiting;
        await run(
          `UPDATE pages SET body = 'Short computer' WHERE id = 'mid-store'`,
        );
        await settle();
        // The newer drain stores its chunk and drops the old ones, then
        // pauses before recording that it finished.
        const newer = other.drainSemanticIndex(
          registration,
          Date.now() + 10_000,
        );
        await newerFinishing.waiting;
        // The older drain now writes its three chunks and asks for repair.
        olderStoring.open();
        await older;
        newerFinishing.open();
        await newer;
      } finally {
        restoreStore();
        other.configureSemanticSearch({});
      }
      expect(await row("mid-store")).toMatchObject([
        { content_hash: "repair" },
      ]);

      await settle();
      await drain();
      expect(keysFor("mid-store")).toEqual(["wiki/page/mid-store/0"]);
      expect(await row("mid-store")).toMatchObject([{ chunk_count: 1 }]);

      await run(`DELETE FROM pages WHERE id = 'mid-store'`);
      await settle();
      await drain();
      expect(keysFor("mid-store")).toEqual([]);
      expect(await pendingIds()).toEqual([]);
    });

    it("never deletes a later change's vectors when an older drain forgets a hidden page", async () => {
      await insertPage("stale-forget", "Laptop", "Hardware shown.");
      await settle();
      await drain();
      const loading = gate();
      const gated: SearchableResourceRegistration = {
        ...registration,
        async load(ids) {
          const documents = await registration.load(ids);
          if (ids.includes("stale-forget")) await loading.pass();
          return documents;
        },
      };
      other.configureSemanticSearch({
        vectorStore: store,
        resolveEmbeddingFamily: async () => family,
      });
      try {
        await run(`UPDATE pages SET hidden = 1 WHERE id = 'stale-forget'`);
        await settle();
        // The older drain reads the page hidden, then pauses before
        // forgetting it.
        const older = search.drainSemanticIndex(gated, Date.now() + 10_000);
        await loading.waiting;
        await run(
          `UPDATE pages SET hidden = 0, body = 'Computer shown again.' WHERE id = 'stale-forget'`,
        );
        await settle();
        await other.drainSemanticIndex(registration, Date.now() + 10_000);
        loading.open();
        await older;
      } finally {
        other.configureSemanticSearch({});
      }
      expect(keysFor("stale-forget")).toEqual(["wiki/page/stale-forget/0"]);
      expect(await row("stale-forget")).toMatchObject([{ chunk_count: 1 }]);
      expect(await pendingIds()).toEqual([]);

      await run(`DELETE FROM pages WHERE id = 'stale-forget'`);
      await settle();
      await drain();
      expect(keysFor("stale-forget")).toEqual([]);
      expect(await row("stale-forget")).toEqual([]);
    });

    it("never deletes a later change's vectors when an older drain read the lane as off", async () => {
      await insertPage("stale-off", "Laptop", "Old hardware");
      await settle();
      await drain();
      await run(
        `UPDATE pages SET body = 'Middle laptop' WHERE id = 'stale-off'`,
      );
      await settle();
      const reading = gate();
      afterSettingRead.hook = async (enabled) => {
        if (enabled) return;
        afterSettingRead.hook = null;
        await reading.pass();
      };
      other.configureSemanticSearch({
        vectorStore: store,
        resolveEmbeddingFamily: async () => family,
      });
      try {
        await search.writeSemanticSearchSetting("org-a", {
          enabled: false,
          updatedBy: "admin@a.com",
        });
        // The older drain reads the lane as off, then pauses before
        // recording the page off.
        const older = drain();
        await reading.waiting;
        await search.forgetSemanticSearchForOrg("org-a");
        await turnSemanticSearch("org-a", true);
        await run(
          `UPDATE pages SET body = 'Newest computer' WHERE id = 'stale-off'`,
        );
        await settle();
        await other.drainSemanticIndex(registration, Date.now() + 10_000);
        reading.open();
        await older;
      } finally {
        afterSettingRead.hook = null;
        other.configureSemanticSearch({});
      }
      expect(keysFor("stale-off")).toEqual(["wiki/page/stale-off/0"]);
      expect(await row("stale-off")).toMatchObject([{ chunk_count: 1 }]);
      expect(await pendingIds()).toEqual([]);

      await run(`DELETE FROM pages WHERE id = 'stale-off'`);
      await settle();
      await drain();
      expect(keysFor("stale-off")).toEqual([]);
    });

    it("records nothing over a later change an owner with no provider recorded", async () => {
      await insertPage("unpowered-race", "Laptop", "Old hardware");
      await settle();
      await drain();
      const [embedded] = await row("unpowered-race");
      const embedding = gate();
      const gatedFamily: EmbeddingFamily = {
        ...family,
        async embed(inputs, purpose) {
          await embedding.pass();
          return family.embed(inputs, purpose);
        },
      };
      search.configureSemanticSearch({
        vectorStore: store,
        resolveEmbeddingFamily: async () => gatedFamily,
      });
      // The newer drain finds no provider for the owner.
      other.configureSemanticSearch({
        vectorStore: store,
        resolveEmbeddingFamily: async () => null,
      });
      try {
        await run(
          `UPDATE pages SET body = 'Middle laptop' WHERE id = 'unpowered-race'`,
        );
        await settle();
        const older = drain();
        await embedding.waiting;
        await run(
          `UPDATE pages SET body = 'Newest computer' WHERE id = 'unpowered-race'`,
        );
        await settle();
        await other.drainSemanticIndex(registration, Date.now() + 10_000);
        embedding.open();
        await older;
      } finally {
        restoreStore();
        other.configureSemanticSearch({});
      }
      // The older drain's text is no newer than what's recorded, so the row
      // still names the vectors embedded before both changes.
      expect(await row("unpowered-race")).toEqual([embedded]);
      expect(await pendingIds()).toEqual([]);

      await run(`DELETE FROM pages WHERE id = 'unpowered-race'`);
      await settle();
      await drain();
      expect(keysFor("unpowered-race")).toEqual([]);
      expect(await row("unpowered-race")).toEqual([]);
    });
  });
});

describe("with an indexing budget every server shares", () => {
  let accounts = 0;

  function budgeted(
    embed: EmbeddingFamily["embed"],
    connectionId = `account-${++accounts}`,
    capacity = 2,
  ): EmbeddingFamily {
    return {
      ...family,
      documentBudget: {
        scope: {
          providerId: "fake-embeddings",
          tenantId: "space",
          connectionId,
        },
        policy: { capacity, windowMs: 60_000 },
      },
      embed,
    };
  }

  function gateway(room: { left: number }, purposes: string[]) {
    return budgeted(async (inputs, purpose, options) => {
      const { EmbeddingProviderError } = await import("../embeddings/index.js");
      purposes.push(purpose);
      if (room.left <= 0) {
        throw new EmbeddingProviderError(
          "Embedding provider fake failed with status 429.",
          429,
        );
      }
      room.left -= 1;
      return family.embed(inputs, purpose, options);
    });
  }

  function resolveTo(
    pick: (
      identity: { orgId?: string; userEmail?: string } | undefined,
    ) => EmbeddingFamily,
  ) {
    search.configureSemanticSearch({
      vectorStore: store,
      resolveEmbeddingFamily: async (identity) => pick(identity),
    });
  }

  function restore() {
    search.configureSemanticSearch({
      vectorStore: store,
      resolveEmbeddingFamily: async (identity) =>
        identity?.orgId === "org-no-provider" ? null : family,
    });
  }

  function embedded(ids: string[]) {
    return ids.filter((id) => store.keys().includes(`wiki/page/${id}/0`));
  }

  async function waiting(prefix: string, seconds: number) {
    const { rows } = await run(
      `SELECT resource_id FROM app_resource_changes
       WHERE consumer = 'search-embeddings' AND resource_id LIKE ?
         AND available_at > now() + make_interval(secs => ?)
       ORDER BY resource_id`,
      [`${prefix}%`, seconds],
    );
    return rows.map((row) => String(row.resource_id));
  }

  async function passTime() {
    await run(
      `UPDATE provider_connection_budgets
       SET window_started_at = window_started_at - 60000,
           resume_at = CASE WHEN resume_at IS NULL THEN NULL ELSE CAST(? AS BIGINT) END`,
      [Date.now() - 1],
    );
  }

  async function cleanUp(prefix: string) {
    restore();
    await passTime();
    await run(`DELETE FROM pages WHERE id LIKE ?`, [`${prefix}%`]);
    await settle();
    await drain();
    expect(await pendingIds()).toEqual([]);
  }

  it("indexes only its share of the provider's limit, so searches keep the rest", async () => {
    const long = "Paced laptop notes. ".repeat(900);
    const ids = Array.from({ length: 8 }, (_, index) => `paced-${index}`);
    for (const id of ids) await insertPage(id, "Paced laptop", long);
    await settle();
    const room = { left: 3 };
    const purposes: string[] = [];
    const paced = gateway(room, purposes);
    resolveTo(() => paced);
    try {
      await drain();
      expect(purposes).toEqual(["document", "document"]);
      expect(embedded(ids)).toHaveLength(4);
      expect(await waiting("paced-", 1)).toHaveLength(4);

      await settle();
      await drain();
      expect(purposes).toEqual(["document", "document"]);
      expect(embedded(ids)).toHaveLength(4);

      await expect(
        searchAs(
          { userEmail: "reader@a.com", orgId: "org-a" },
          "paced laptop hardware while indexing",
        ),
      ).resolves.toMatchObject({ status: "used" });
      expect(purposes).toEqual(["document", "document", "query"]);

      room.left = 3;
      await passTime();
      await settle();
      await drain();
      expect(embedded(ids)).toEqual(ids);
      expect(purposes.filter((purpose) => purpose === "document")).toHaveLength(
        4,
      );
    } finally {
      await cleanUp("paced-");
    }
  });

  it("holds indexing back on every server when a search is rate limited, so the next searches get the provider", async () => {
    for (const id of ["held-1", "held-2"]) {
      await insertPage(id, "Held laptop", `Hardware ${id}.`);
    }
    await settle();
    const room = { left: 0 };
    const purposes: string[] = [];
    const held = gateway(room, purposes);
    resolveTo(() => held);
    try {
      await expect(
        searchAs(
          { userEmail: "reader@a.com", orgId: "org-a" },
          "held laptop hardware refused",
        ),
      ).resolves.toEqual({ status: "unavailable", reason: "error" });

      room.left = 3;
      await drain();
      expect(purposes).toEqual(["query"]);
      expect(await waiting("held-", 100)).toEqual(["held-1", "held-2"]);

      await expect(
        searchAs(
          { userEmail: "reader@a.com", orgId: "org-a" },
          "held laptop hardware answered",
        ),
      ).resolves.toMatchObject({ status: "used" });
      expect(purposes).toEqual(["query", "query"]);

      await passTime();
      await settle();
      await drain();
      expect(embedded(["held-1", "held-2"])).toEqual(["held-1", "held-2"]);
    } finally {
      await cleanUp("held-");
    }
  });

  it("holds indexing back on every server for an hour when the provider refuses its credentials", async () => {
    const { EmbeddingProviderError } = await import("../embeddings/index.js");
    await insertPage("turned-away-1", "Turned away tablet", "Gadget one.");
    await settle();
    let calls = 0;
    const refusing = budgeted(async () => {
      calls += 1;
      throw new EmbeddingProviderError(
        "Embedding provider fake failed with status 401.",
        401,
      );
    });
    resolveTo(() => refusing);
    try {
      await drain();
      expect(calls).toBe(1);
      expect(await waiting("turned-away-", 3500)).toEqual(["turned-away-1"]);

      await insertPage("turned-away-2", "Turned away tablet", "Gadget two.");
      await settle();
      await drain();
      expect(calls).toBe(1);
      expect(await waiting("turned-away-", 3000)).toEqual([
        "turned-away-1",
        "turned-away-2",
      ]);
    } finally {
      await cleanUp("turned-away-");
    }
  });

  it("spends none of the budget on a call it has no time left to make", async () => {
    const long = "laptop ".repeat(2500);
    const ids = Array.from({ length: 4 }, (_, index) => `late-call-${index}`);
    for (const id of ids) await insertPage(id, "Laptop", long);
    await settle();
    let clock = Date.now();
    const deadline = clock + 500;
    let slow = true;
    const purposes: string[] = [];
    const late = budgeted(async (inputs, purpose, options) => {
      purposes.push(purpose);
      if (slow) clock = deadline;
      return family.embed(inputs, purpose, options);
    });
    resolveTo(() => late);
    try {
      const restoreClock = vi
        .spyOn(Date, "now")
        .mockImplementation(() => clock);
      try {
        await search.drainSemanticIndex(registration, deadline);
      } finally {
        restoreClock.mockRestore();
      }
      expect(purposes).toEqual(["document"]);
      expect(embedded(ids)).toHaveLength(2);

      slow = false;
      await settle();
      await drain();
      expect(purposes).toEqual(["document", "document"]);
      expect(embedded(ids)).toHaveLength(3);
      expect(await waiting("late-call-", 1)).toHaveLength(1);
    } finally {
      await cleanUp("late-call-");
    }
  });

  it("keeps pacing indexing when its budget's policy changes", async () => {
    const long = "Policy laptop notes. ".repeat(900);
    const ids = Array.from({ length: 8 }, (_, index) => `policy-${index}`);
    for (const id of ids) await insertPage(id, "Policy laptop", long);
    await settle();
    const purposes: string[] = [];
    const embed: EmbeddingFamily["embed"] = async (
      inputs,
      purpose,
      options,
    ) => {
      purposes.push(purpose);
      return family.embed(inputs, purpose, options);
    };
    resolveTo(() => budgeted(embed, "policy-account", 1));
    try {
      await drain();
      expect(embedded(ids)).toHaveLength(2);

      resolveTo(() => budgeted(embed, "policy-account", 2));
      await settle();
      await drain();
      expect(purposes).toHaveLength(3);
      expect(embedded(ids)).toHaveLength(6);
      expect(await waiting("policy-", 1)).toHaveLength(2);
    } finally {
      await cleanUp("policy-");
    }
  });

  it("shares a hold across organizations using one set of credentials, but not with other credentials", async () => {
    const { EmbeddingProviderError } = await import("../embeddings/index.js");
    await insertPage("account-first", "First laptop", "Hardware first.", {
      orgId: "org-account-1",
    });
    await insertPage("account-second", "Second laptop", "Hardware second.", {
      orgId: "org-account-2",
    });
    await insertPage("account-own", "Own laptop", "Hardware own.", {
      orgId: "org-account-1",
      ownerEmail: "own@account.com",
    });
    await settle();
    let firstCalls = 0;
    let secondCalls = 0;
    const first = budgeted(async () => {
      firstCalls += 1;
      throw new EmbeddingProviderError(
        "Embedding provider fake failed with status 429.",
        429,
      );
    }, "shared-account");
    const second = budgeted(async (inputs, purpose, options) => {
      secondCalls += 1;
      return family.embed(inputs, purpose, options);
    }, "shared-account");
    const own = budgeted(family.embed, "own-account");
    resolveTo((identity) =>
      identity?.userEmail === "own@account.com"
        ? own
        : identity?.orgId === "org-account-2"
          ? second
          : first,
    );
    try {
      await drain();
      expect(firstCalls).toBe(1);
      expect(secondCalls).toBe(0);
      expect(
        embedded(["account-first", "account-second", "account-own"]),
      ).toEqual(["account-own"]);
      expect(await waiting("account-", 1)).toEqual([
        "account-first",
        "account-second",
      ]);
    } finally {
      await cleanUp("account-");
    }
  });
});

describe("without a vector store or provider", () => {
  it("says why the lane can't answer, and never throws", async () => {
    search.configureSemanticSearch({
      vectorStore: { ...store, available: async () => false },
      resolveEmbeddingFamily: async () => family,
    });
    expect(
      await searchAs({ userEmail: "reader@a.com", orgId: "org-a" }, "money"),
    ).toEqual({
      status: "unavailable",
      reason: "no-vector-store",
    });
    search.configureSemanticSearch({
      vectorStore: store,
      resolveEmbeddingFamily: async () => null,
    });
    expect(
      await searchAs({ userEmail: "reader@a.com", orgId: "org-a" }, "money"),
    ).toEqual({
      status: "unavailable",
      reason: "no-provider",
    });
    search.configureSemanticSearch({
      vectorStore: store,
      resolveEmbeddingFamily: async () => ({
        ...family,
        embed: async () => {
          throw new Error("timeout");
        },
      }),
    });
    expect(
      await searchAs({ userEmail: "reader@a.com", orgId: "org-a" }, "money"),
    ).toEqual({
      status: "unavailable",
      reason: "error",
    });
    search.configureSemanticSearch({
      vectorStore: store,
      resolveEmbeddingFamily: async (identity) =>
        identity?.orgId === "org-no-provider" ? null : family,
    });
  });

  it("reports an error, and remembers no answer, when checking for pgvector fails", async () => {
    // No store configured, so the lane checks the database for pgvector.
    search.configureSemanticSearch({
      resolveEmbeddingFamily: async () => family,
    });
    const db = exec();
    const execute = db.execute.bind(db);
    let checks = 0;
    const spy = vi.spyOn(db, "execute").mockImplementation(async (query) => {
      if (
        typeof query === "string" &&
        query.includes("pg_available_extensions")
      ) {
        checks++;
        throw new Error("connection reset");
      }
      return execute(query);
    });
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(
          await searchAs(
            { userEmail: "reader@a.com", orgId: "org-a" },
            "money",
          ),
        ).toEqual({ status: "unavailable", reason: "error" });
      }
      // Checked on each search, not remembered as a database without it.
      expect(checks).toBe(2);
    } finally {
      spy.mockRestore();
      search.configureSemanticSearch({
        vectorStore: store,
        resolveEmbeddingFamily: async (identity) =>
          identity?.orgId === "org-no-provider" ? null : family,
      });
    }
  });
});
