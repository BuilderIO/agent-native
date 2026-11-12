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
  const { pgTable, text } = await import("drizzle-orm/pg-core");
  const drizzle = await import("drizzle-orm");
  const { createGetDb } = await import("../db/create-get-db.js");
  const pages = pgTable("pages", {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    orgId: text("org_id"),
    ownerEmail: text("owner_email").notNull(),
  });
  const db = createGetDb({ pages })();
  search = await import("./index.js");
  // An app loads it at boot; loaded here, the first drain's deadline isn't
  // spent importing it.
  await import("../org/context.js");

  await run(
    `CREATE TABLE pages (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', org_id TEXT, owner_email TEXT NOT NULL)`,
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
  it("embeds existing pages once their backfill settles, and answers questions in other words", async () => {
    expect(await pendingIds()).toEqual([
      "mine",
      "other-org",
      "refunds",
      "vacation",
    ]);
    // Changes younger than the settle window wait.
    await drain();
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
    family.embed = async (_inputs, _purpose, options) => {
      signals.push(options?.signal);
      await new Promise((resolve) => setTimeout(resolve, 30));
      throw new Error("provider down");
    };
    try {
      await search.drainSemanticIndex(registration, Date.now() + 20);
    } finally {
      family.embed = embed;
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
    // Out of time isn't a failure: the pages stay queued.
    expect(await pendingIds()).toEqual(
      expect.arrayContaining(["budget-0", "budget-1", "budget-2", "budget-3"]),
    );

    await run(`DELETE FROM pages WHERE id LIKE 'budget-%'`);
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

  describe("when two drains store one page at once", () => {
    // A second copy of the module drains like another process would.
    const secondCopy = "./semantic.js?second-drain";
    let other: typeof import("./semantic.js");

    beforeAll(async () => {
      other = (await import(
        /* @vite-ignore */ secondCopy
      )) as typeof import("./semantic.js");
    });

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
});
