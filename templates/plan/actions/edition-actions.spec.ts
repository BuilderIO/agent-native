/**
 * Edition actions: candidate selection, publishing, and reading back.
 *
 * The first test is the load-bearing one. Recap rows are org-visible and
 * `accessFilter` only matches the caller's ACTIVE org, so a caller in the wrong
 * org sees zero candidates — indistinguishable from a day on which nothing
 * merged. An edition written from that is confidently wrong, so selection must
 * throw rather than return an empty set.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { registerShareableResource } from "@agent-native/core/sharing";

const { PGlite } = createRequire(
  new URL("../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as planSchema from "../server/db/schema.js";
import { PLANS_TABLE_DDL } from "../server/test-support/plans-test-schema.js";

let client: PGlite;
let db: PgliteDatabase<typeof planSchema>;
let dbDir: string;

function postgresSql(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => "$" + ++index);
}

async function execute(sql: string) {
  const results = [];
  for (const statement of sql
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean))
    results.push(await client.query(postgresSql(statement)));
  return results.at(-1);
}

vi.mock("../server/db/index.js", () => ({
  getDb: () => db,
  schema: planSchema,
}));
const labs = vi.hoisted(() => ({ editionsEnabled: true }));
vi.mock("@agent-native/core/labs/server", async () => {
  const { PLAN_EDITIONS } = await import("../shared/labs.js");
  return {
    getUserLabs: async () => ({ [PLAN_EDITIONS.key]: labs.editionsEnabled }),
  };
});
vi.mock("../server/lib/local-plan-files.js", () => ({
  writePlanLocalFiles: vi.fn(async () => ({ written: false })),
  localPlansDir: () => "/tmp/plans-test",
  localPlanFolder: (id: string) => `/tmp/plans-test/${id}`,
}));
vi.mock("@agent-native/core/org", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/org")>();
  return { ...actual, resolveOrgIdForEmail: vi.fn(async () => null) };
});

type AnyAction = { run: (args: any) => Promise<any> };
let listCandidates: AnyAction;
let createEdition: AnyAction;
let getEdition: AnyAction;
let listEditions: AnyAction;
let listPlans: AnyAction;

const OWNER = "owner@example.com";
const ORG = "org-1";
const REPO = "BuilderIO/agent-native";

function asOwner<T>(fn: () => Promise<T> | T) {
  return runWithRequestContext({ userEmail: OWNER, orgId: ORG }, fn);
}

async function insertRecap(opts: {
  id: string;
  prNumber: number;
  mergedAt: string;
  repo?: string;
  ownerEmail?: string;
  visibility?: string;
  orgId?: string | null;
  content?: string;
}) {
  const repo = opts.repo ?? REPO;
  await client.query(
    `INSERT INTO plans (id, title, brief, kind, status, source, created_at, updated_at,
      source_url, source_type, source_repo, source_pr_number, source_pr_state,
      source_pr_merged_at, source_author_login, owner_email, org_id, visibility, content)
     VALUES ($1,$2,$3,'recap','review','imported',$4,$4,$5,'pull-request',$6,$7,'merged',$4,'steve8708',$8,$9,$10,$11)`,
    [
      opts.id,
      `Recap for #${opts.prNumber}`,
      `What PR ${opts.prNumber} changed.`,
      opts.mergedAt,
      `https://github.com/${repo}/pull/${opts.prNumber}`,
      repo,
      opts.prNumber,
      opts.ownerEmail ?? OWNER,
      opts.orgId === undefined ? ORG : opts.orgId,
      opts.visibility ?? "org",
      opts.content ?? null,
    ],
  );
}

async function insertUnmergedRecap(opts: {
  id: string;
  prNumber: number;
  updatedAt: string;
}) {
  await client.query(
    `INSERT INTO plans (id, title, brief, kind, status, source, created_at, updated_at,
      source_url, source_type, source_repo, source_pr_number, source_pr_state,
      source_pr_merged_at, owner_email, org_id, visibility)
     VALUES ($1,$2,$3,'recap','review','imported',$4,$4,$5,'pull-request',$6,$7,'open',NULL,$8,$9,'org')`,
    [
      opts.id,
      `Pre-merge recap for #${opts.prNumber}`,
      `Generated before PR ${opts.prNumber} merged.`,
      opts.updatedAt,
      `https://github.com/${REPO}/pull/${opts.prNumber}`,
      REPO,
      opts.prNumber,
      OWNER,
      ORG,
    ],
  );
}

const WINDOW = {
  windowStart: "2026-09-20T00:00:00.000Z",
  windowEnd: "2026-09-21T00:00:00.000Z",
  timezone: "UTC",
};

function storyFixture(overrides: Record<string, unknown> = {}) {
  return {
    storyId: "design-transactions",
    headline: "Grouped Design drops survive grids and redo",
    dek: "URL-backed multi-selection now travels as one pending Apply unit.",
    tags: ["design-transactions"],
    lead: true,
    recaps: [
      {
        recapId: "recap-aaa",
        repo: REPO,
        prNumber: 5447,
        prUrl: `https://github.com/${REPO}/pull/5447`,
        authorLogin: "steve8708",
        filesChanged: 28,
        additions: 3052,
        deletions: 277,
      },
    ],
    whatShipped: "editor-chrome.bridge.ts gains a shared transactionId.",
    why: "One missing member previously mutated a partial group.",
    ...overrides,
  };
}

beforeAll(async () => {
  process.env.PLAN_GUEST_ABUSE_DISABLED = "1";
  process.env.PLAN_LOCAL_MODE = "0";

  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-editions-"));
  client = await PGlite.create(dbDir);
  db = drizzle(client, { schema: planSchema });

  await execute(`
    ${PLANS_TABLE_DDL};
    CREATE TABLE plan_shares (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, principal_type TEXT NOT NULL, principal_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer', created_by TEXT NOT NULL, created_at TEXT NOT NULL, notified_at TEXT);
    CREATE TABLE plan_sections (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, type TEXT, sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE plan_comments (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, status TEXT, deleted_at TEXT);
    CREATE TABLE plan_edition_stories (
      id TEXT PRIMARY KEY, edition_id TEXT NOT NULL, story_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0, is_lead BOOLEAN NOT NULL DEFAULT FALSE,
      headline TEXT NOT NULL, dek TEXT NOT NULL DEFAULT '', tags_json TEXT,
      recaps_json TEXT NOT NULL, cohorts_json TEXT,
      what_shipped TEXT, why TEXT, how_it_works TEXT,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX plans_edition_series_day_unique_idx
      ON plans(owner_email, COALESCE(org_id, ''), COALESCE(edition_series, 'daily'), edition_date_key)
      WHERE kind = 'edition' AND edition_date_key IS NOT NULL;
  `);

  registerShareableResource({
    type: "plan",
    resourceTable: planSchema.plans,
    sharesTable: planSchema.planShares,
    displayName: "Plan",
    titleColumn: "title",
    getResourcePath: (p: any) => `/editions/${p.id}`,
    getDb: () => db,
  });

  listCandidates = (await import("./list-edition-candidates.js"))
    .default as AnyAction;
  createEdition = (await import("./create-edition.js")).default as AnyAction;
  getEdition = (await import("./get-edition.js")).default as AnyAction;
  listEditions = (await import("./list-editions.js")).default as AnyAction;
  listPlans = (await import("./list-visual-plans.js")).default as AnyAction;
});

afterAll(async () => {
  await client?.close();
  if (dbDir) fs.rmSync(dbDir, { recursive: true, force: true });
});

beforeEach(async () => {
  // guard:allow-unscoped -- test-only fixture cleanup resets the isolated temp DB.
  await execute(
    `DELETE FROM plan_edition_stories; DELETE FROM plan_shares; DELETE FROM plans;`,
  );
});

describe("list-edition-candidates", () => {
  it("throws instead of reporting a quiet day when no recaps are readable at all", async () => {
    await insertRecap({
      id: "recap-hidden",
      prNumber: 1,
      mergedAt: "2026-09-20T09:00:00.000Z",
      ownerEmail: "someone-else@example.com",
      orgId: "other-org",
      visibility: "private",
    });

    await expect(asOwner(() => listCandidates.run(WINDOW))).rejects.toThrow(
      /No PR recaps are readable in this access scope/,
    );
  });

  it("reports an empty window as empty when recaps exist outside it", async () => {
    await insertRecap({
      id: "recap-old",
      prNumber: 2,
      mergedAt: "2026-08-01T09:00:00.000Z",
    });

    const result = await asOwner(() => listCandidates.run(WINDOW));

    expect(result.status).toBe("empty-window");
    expect(result.candidateCount).toBe(0);
    expect(result.coverage).toBeNull();
    expect(result.coverageKnown).toBe(false);
  });

  it("scopes to the requested repos before spending the limit", async () => {
    await insertRecap({
      id: "recap-other-repo",
      prNumber: 900,
      mergedAt: "2026-09-20T23:00:00.000Z",
      repo: "BuilderIO/builder",
    });
    await insertRecap({
      id: "recap-wanted",
      prNumber: 5447,
      mergedAt: "2026-09-20T09:00:00.000Z",
    });

    const result = await asOwner(() =>
      listCandidates.run({
        ...WINDOW,
        limit: 1,
        repos: [REPO],
        mergedPrLedger: [
          {
            repo: REPO,
            prNumber: 5447,
            title: "fix(design): grouped drops",
            url: `https://github.com/${REPO}/pull/5447`,
          },
        ],
      }),
    );

    expect(
      result.candidates.map((c: { recapId: string }) => c.recapId),
    ).toEqual(["recap-wanted"]);
  });

  it("selects in-window recaps and names the merged PRs that have no recap", async () => {
    await insertRecap({
      id: "recap-in",
      prNumber: 5447,
      mergedAt: "2026-09-20T09:00:00.000Z",
    });

    const result = await asOwner(() =>
      listCandidates.run({
        ...WINDOW,
        mergedPrLedger: [
          {
            repo: REPO,
            prNumber: 5447,
            title: "fix(design): grouped drops",
            url: `https://github.com/${REPO}/pull/5447`,
          },
          {
            repo: REPO,
            prNumber: 5485,
            title: "fix(dispatch): isolate All-apps workspace resources",
            url: `https://github.com/${REPO}/pull/5485`,
          },
        ],
      }),
    );

    expect(result.status).toBe("ok");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].recapId).toBe("recap-in");
    expect(result.candidates[0].recapUrl).toBe("/recaps/recap-in");
    expect(result.coverage.mergedPrCount).toBe(2);
    expect(result.coverage.recapCount).toBe(1);
    expect(result.coverage.stalePrs).toEqual([]);
    expect(result.coverage.missingPrs).toEqual([
      {
        repo: REPO,
        prNumber: 5485,
        title: "fix(dispatch): isolate All-apps workspace resources",
        url: `https://github.com/${REPO}/pull/5485`,
      },
    ]);
  });

  it("calls a recap that was never re-published at merge stale, not missing", async () => {
    await insertRecap({
      id: "recap-merged",
      prNumber: 5447,
      mergedAt: "2026-09-20T09:00:00.000Z",
    });
    // CI stamps merged-at only on the merge-close run; a skipped one leaves the
    // recap frozen as "open" even though the PR really merged.
    await insertUnmergedRecap({
      id: "recap-premerge",
      prNumber: 5436,
      updatedAt: "2026-09-20T10:00:00.000Z",
    });

    const ledgerEntry = (prNumber: number, title: string) => ({
      repo: REPO,
      prNumber,
      title,
      url: `https://github.com/${REPO}/pull/${prNumber}`,
    });
    const result = await asOwner(() =>
      listCandidates.run({
        ...WINDOW,
        mergedPrLedger: [
          ledgerEntry(5447, "fix(design): grouped drops"),
          ledgerEntry(5436, "fix(design): bare links read-only"),
          ledgerEntry(5485, "fix(dispatch): isolate workspace resources"),
        ],
      }),
    );

    // The unmerged recap is not a candidate — it cannot be proven merged.
    expect(result.candidates.map((c: any) => c.prNumber)).toEqual([5447]);
    expect(result.coverage.recapCount).toBe(1);
    // It has readable content though, so it is reported as stale, never missing.
    expect(result.coverage.stalePrs.map((p: any) => p.prNumber)).toEqual([
      5436,
    ]);
    expect(result.coverage.missingPrs.map((p: any) => p.prNumber)).toEqual([
      5485,
    ]);
  });

  it("rejects an inverted window", async () => {
    await expect(
      asOwner(() =>
        listCandidates.run({
          windowStart: WINDOW.windowEnd,
          windowEnd: WINDOW.windowStart,
        }),
      ),
    ).rejects.toThrow(/must be after/);
  });
});

describe("create-edition", () => {
  it("publishes one edition with its stories in a single call", async () => {
    const result = await asOwner(() =>
      createEdition.run({
        title: "agent-native/daily",
        brief:
          "Design hardens its canvas while the platform closes trust gaps.",
        ...WINDOW,
        stories: [
          storyFixture(),
          storyFixture({ storyId: "also", lead: false }),
        ],
        coverage: {
          mergedPrCount: 2,
          recapCount: 1,
          missingPrs: [
            {
              repo: REPO,
              prNumber: 5485,
              title: "fix(dispatch): isolate All-apps workspace resources",
              url: `https://github.com/${REPO}/pull/5485`,
            },
          ],
          reposCovered: [REPO],
        },
      }),
    );

    expect(result.editionId).toMatch(/^edition-/);
    expect(result.dateKey).toBe("2026-09-20");
    expect(result.replaced).toBe(false);
    expect(result.storyCount).toBe(2);
    expect(result.leadCount).toBe(1);
    expect(result.missingPrCount).toBe(1);
    expect(result.url).toBe(`/editions/${result.editionId}`);
  });

  it("replaces the same window instead of publishing a second edition", async () => {
    const first = await asOwner(() =>
      createEdition.run({
        title: "first",
        brief: "first pass",
        ...WINDOW,
        stories: [storyFixture()],
      }),
    );
    const second = await asOwner(() =>
      createEdition.run({
        title: "second",
        brief: "rewritten",
        ...WINDOW,
        stories: [
          storyFixture(),
          storyFixture({ storyId: "extra", lead: false }),
        ],
      }),
    );

    expect(second.editionId).toBe(first.editionId);
    expect(second.replaced).toBe(true);
    expect(second.storyCount).toBe(2);

    const listed = await asOwner(() => listEditions.run({}));
    expect(listed.editions).toHaveLength(1);
    expect(listed.editions[0].title).toBe("second");
    expect(listed.editions[0].storyCount).toBe(2);
  });

  it("adopts the winner's row when two runs publish the same window at once", async () => {
    const publish = () =>
      asOwner(() =>
        createEdition.run({
          title: "race",
          brief: "two schedulers, one window",
          ...WINDOW,
          stories: [storyFixture()],
        }),
      );

    const results = await Promise.all([
      publish(),
      publish(),
      publish(),
      publish(),
    ]);

    const ids = new Set(results.map((result: any) => result.editionId));
    expect(ids.size).toBe(1);

    const listed = await asOwner(() => listEditions.run({}));
    expect(listed.editions).toHaveLength(1);
    expect(listed.editions[0].storyCount).toBe(1);
  });

  it("numbers issues sequentially and keeps the number across a replace", async () => {
    const first = await asOwner(() =>
      createEdition.run({
        title: "first issue",
        brief: "b",
        ...WINDOW,
        stories: [storyFixture()],
      }),
    );
    expect(first.issueNumber).toBe(1);

    const replaced = await asOwner(() =>
      createEdition.run({
        title: "rewritten",
        brief: "b",
        ...WINDOW,
        stories: [storyFixture()],
      }),
    );
    expect(replaced.replaced).toBe(true);
    expect(replaced.issueNumber).toBe(1);

    // A different window is the next issue, not a reuse of the first number.
    const second = await asOwner(() =>
      createEdition.run({
        title: "second issue",
        brief: "b",
        windowStart: "2026-09-21T00:00:00.000Z",
        windowEnd: "2026-09-22T00:00:00.000Z",
        timezone: "UTC",
        stories: [storyFixture()],
      }),
    );
    expect(second.issueNumber).toBe(2);

    // And the number survives the read path, which is where it regressed.
    const read = await asOwner(() =>
      getEdition.run({ id: replaced.editionId }),
    );
    expect(read.edition.issueNumber).toBe(1);
  });

  it("lets two series cover the same window instead of replacing each other", async () => {
    const orgWide = await asOwner(() =>
      createEdition.run({
        title: "agent-native/daily",
        brief: "everything",
        ...WINDOW,
        stories: [storyFixture()],
      }),
    );
    const perRepo = await asOwner(() =>
      createEdition.run({
        title: "builder-internal/daily",
        brief: "one repo",
        series: "internal-daily",
        ...WINDOW,
        stories: [storyFixture()],
      }),
    );

    expect(orgWide.series).toBe("daily");
    expect(perRepo.series).toBe("internal-daily");
    expect(perRepo.editionId).not.toBe(orgWide.editionId);
    expect(perRepo.replaced).toBe(false);

    const all = await asOwner(() => listEditions.run({}));
    expect(all.editions).toHaveLength(2);

    // And each series can be read on its own.
    const onlyInternal = await asOwner(() =>
      listEditions.run({ series: "internal-daily" }),
    );
    expect(onlyInternal.editions.map((e: any) => e.title)).toEqual([
      "builder-internal/daily",
    ]);
  });

  it("numbers issues per series", async () => {
    const a = await asOwner(() =>
      createEdition.run({
        title: "d1",
        brief: "b",
        ...WINDOW,
        stories: [storyFixture()],
      }),
    );
    const b = await asOwner(() =>
      createEdition.run({
        title: "i1",
        brief: "b",
        series: "internal-daily",
        ...WINDOW,
        stories: [storyFixture()],
      }),
    );
    // Both are the first issue OF THEIR OWN series.
    expect(a.issueNumber).toBe(1);
    expect(b.issueNumber).toBe(1);

    const b2 = await asOwner(() =>
      createEdition.run({
        title: "i2",
        brief: "b",
        series: "internal-daily",
        windowStart: "2026-09-21T00:00:00.000Z",
        windowEnd: "2026-09-22T00:00:00.000Z",
        timezone: "UTC",
        stories: [storyFixture()],
      }),
    );
    expect(b2.issueNumber).toBe(2);
  });

  it("treats an edition written before series existed as the daily series", async () => {
    // Simulates a row from before migration 42: edition_series IS NULL.
    await client.query(
      `INSERT INTO plans (id, title, brief, kind, status, source, created_at, updated_at,
        edition_date_key, edition_window_start, edition_window_end, edition_timezone,
        owner_email, org_id, visibility)
       VALUES ('edition-legacy','legacy','b','edition','complete','imported',$1,$1,
        '2026-09-20',$2,$3,'UTC',$4,$5,'org')`,
      [
        "2026-09-20T00:00:00.000Z",
        WINDOW.windowStart,
        WINDOW.windowEnd,
        OWNER,
        ORG,
      ],
    );

    const republished = await asOwner(() =>
      createEdition.run({
        title: "rewritten",
        brief: "b",
        ...WINDOW,
        stories: [storyFixture()],
      }),
    );

    // It must adopt the legacy row, not collide with it or duplicate it.
    expect(republished.editionId).toBe("edition-legacy");
    expect(republished.replaced).toBe(true);
    const listed = await asOwner(() => listEditions.run({}));
    expect(listed.editions).toHaveLength(1);
  });

  it("keeps an unavailable diff stat null rather than coercing it to zero", async () => {
    const created = await asOwner(() =>
      createEdition.run({
        title: "stats",
        brief: "unavailable stats stay unavailable",
        ...WINDOW,
        stories: [
          storyFixture({
            recaps: [
              {
                repo: REPO,
                prNumber: 5510,
                prUrl: `https://github.com/${REPO}/pull/5510`,
                filesChanged: null,
                additions: null,
                deletions: null,
              },
            ],
          }),
        ],
      }),
    );

    const read = await asOwner(() => getEdition.run({ id: created.editionId }));
    const ref = read.stories[0].recaps[0];
    expect(ref.filesChanged).toBeNull();
    expect(ref.additions).toBeNull();
    expect(ref.deletions).toBeNull();
  });
});

describe("get-edition block resolution", () => {
  // A recap's most useful diff usually sits inside a tab, so resolution has to
  // reach nested blocks, not just top-level ones.
  const RECAP_CONTENT = JSON.stringify({
    version: 2,
    blocks: [
      {
        id: "changed-files",
        type: "file-tree",
        data: { entries: [{ path: "a/b.ts" }] },
      },
      {
        id: "key-changes",
        type: "tabs",
        data: {
          tabs: [
            {
              id: "t1",
              label: "bridge.ts",
              blocks: [
                {
                  id: "nested-diff",
                  type: "diff",
                  data: { filename: "a/b.ts", before: "x", after: "y" },
                },
              ],
            },
          ],
        },
      },
    ],
  });

  async function publishCiting(blockIds: string[]) {
    await insertRecap({
      id: "recap-blocks",
      prNumber: 5447,
      mergedAt: "2026-09-20T09:00:00.000Z",
      content: RECAP_CONTENT,
    });
    return asOwner(() =>
      createEdition.run({
        title: "blocks",
        brief: "stories carry recap visuals",
        ...WINDOW,
        stories: [
          storyFixture({
            recaps: [
              {
                recapId: "recap-blocks",
                repo: REPO,
                prNumber: 5447,
                prUrl: `https://github.com/${REPO}/pull/5447`,
                blockIds,
              },
            ],
          }),
        ],
      }),
    );
  }

  it("lifts cited recap blocks into the story, including nested ones", async () => {
    const created = await publishCiting(["changed-files", "nested-diff"]);
    const read = await asOwner(() => getEdition.run({ id: created.editionId }));

    expect(read.unresolvedBlockRefs).toBe(0);
    expect(read.stories[0].blocks.map((b: any) => b.block.type)).toEqual([
      "file-tree",
      "diff",
    ]);
    // Referenced, not copied: the block carries the recap's live data.
    expect(read.stories[0].blocks[1].block.data.filename).toBe("a/b.ts");
    // Each block names the recap it came from, so attribution is not guessed
    // from the block id — two recaps may legitimately reuse one id.
    expect(read.stories[0].blocks.map((b: any) => b.recapId)).toEqual([
      "recap-blocks",
      "recap-blocks",
    ]);
  });

  it("counts a block reference that no longer resolves instead of dropping it", async () => {
    const created = await publishCiting(["changed-files", "deleted-block-id"]);
    const read = await asOwner(() => getEdition.run({ id: created.editionId }));

    expect(read.unresolvedBlockRefs).toBe(1);
    expect(read.stories[0].blocks).toHaveLength(1);
  });

  it("returns no blocks when a story cites none", async () => {
    const created = await asOwner(() =>
      createEdition.run({
        title: "no blocks",
        brief: "prose only",
        ...WINDOW,
        stories: [storyFixture()],
      }),
    );
    const read = await asOwner(() => getEdition.run({ id: created.editionId }));
    expect(read.unresolvedBlockRefs).toBe(0);
    expect(read.stories[0].blocks).toEqual([]);
  });
});

describe("get-edition", () => {
  it("returns stories in reading order with their recap references", async () => {
    const created = await asOwner(() =>
      createEdition.run({
        title: "ordered",
        brief: "lead first",
        ...WINDOW,
        stories: [
          storyFixture({ storyId: "lead-story", lead: true }),
          storyFixture({ storyId: "second-story", lead: false }),
        ],
      }),
    );

    const read = await asOwner(() => getEdition.run({ id: created.editionId }));

    expect(read.edition.dateKey).toBe("2026-09-20");
    expect(read.edition.timezone).toBe("UTC");
    expect(read.stories.map((s: any) => s.storyId)).toEqual([
      "lead-story",
      "second-story",
    ]);
    expect(read.stories[0].lead).toBe(true);
    expect(read.stories[1].lead).toBe(false);
    expect(read.stories[0].recaps[0].prNumber).toBe(5447);
    expect(read.stories[0].tags).toEqual(["design-transactions"]);
  });

  it("refuses to read a recap as an edition", async () => {
    await insertRecap({
      id: "recap-not-edition",
      prNumber: 9,
      mergedAt: "2026-09-20T09:00:00.000Z",
    });

    await expect(
      asOwner(() => getEdition.run({ id: "recap-not-edition" })),
    ).rejects.toThrow(/is a recap, not an edition/);
  });
});

describe("edition reader access", () => {
  it("drops a reference to a recap the reader cannot open", async () => {
    await insertRecap({
      id: "recap-not-mine",
      prNumber: 7001,
      mergedAt: "2026-09-20T10:00:00.000Z",
      ownerEmail: "someone-else@example.com",
      visibility: "private",
      orgId: null,
    });

    const created = (await asOwner(() =>
      createEdition.run({
        title: "cites a private recap",
        brief: "b",
        ...WINDOW,
        stories: [
          storyFixture({
            recaps: [
              {
                recapId: "recap-not-mine",
                repo: REPO,
                prNumber: 7001,
                prUrl: `https://github.com/${REPO}/pull/7001`,
                authorLogin: "someone-else",
                additions: 1200,
                deletions: 40,
              },
            ],
          }),
        ],
      }),
    )) as { editionId: string };

    const read = (await asOwner(() =>
      getEdition.run({ id: created.editionId }),
    )) as { stories: { recaps: unknown[] }[] };

    expect(read.stories[0].recaps).toEqual([]);
  });
});

describe("edition replacement", () => {
  it("applies the requested visibility to a republished edition", async () => {
    const first = (await asOwner(() =>
      createEdition.run({
        title: "first",
        brief: "b",
        visibility: "private",
        ...WINDOW,
        stories: [storyFixture()],
      }),
    )) as { editionId: string };

    await asOwner(() =>
      createEdition.run({
        title: "second",
        brief: "b",
        visibility: "org",
        ...WINDOW,
        stories: [storyFixture()],
      }),
    );

    const rows = await client.query(
      `SELECT visibility FROM plans WHERE id = $1`,
      [first.editionId],
    );
    expect((rows.rows[0] as { visibility: string }).visibility).toBe("org");
  });
});

describe("editions lab", () => {
  it("keeps editions out of the generic plan list while the lab is off", async () => {
    await asOwner(() =>
      createEdition.run({
        title: "hidden",
        brief: "hidden",
        ...WINDOW,
        stories: [storyFixture()],
      }),
    );

    const visible = (await asOwner(() => listPlans.run({}))) as {
      kind: string;
    }[];
    expect(visible.some((plan) => plan.kind === "edition")).toBe(true);

    labs.editionsEnabled = false;
    try {
      const gated = (await asOwner(() => listPlans.run({}))) as {
        kind: string;
      }[];
      expect(gated.some((plan) => plan.kind === "edition")).toBe(false);
    } finally {
      labs.editionsEnabled = true;
    }
  });

  it("refuses every edition action while the lab is off", async () => {
    labs.editionsEnabled = false;
    try {
      await expect(
        asOwner(() => listEditions.run({ limit: 5 })),
      ).rejects.toThrow(/turned off in Labs/);
      await expect(
        asOwner(() => getEdition.run({ id: "edition-any" })),
      ).rejects.toThrow(/turned off in Labs/);
      await expect(
        asOwner(() => listCandidates.run({ ...WINDOW, mergedPrLedger: [] })),
      ).rejects.toThrow(/turned off in Labs/);
      await expect(
        asOwner(() =>
          createEdition.run({
            title: "off",
            brief: "off",
            ...WINDOW,
            stories: [storyFixture()],
          }),
        ),
      ).rejects.toThrow(/turned off in Labs/);
    } finally {
      labs.editionsEnabled = true;
    }
  });
});

describe("edition link safety", () => {
  const parseArgs = (overrides: Record<string, unknown>) =>
    (
      createEdition as unknown as {
        schema: { parse: (value: unknown) => unknown };
      }
    ).schema.parse({
      title: "t",
      brief: "b",
      ...WINDOW,
      stories: [storyFixture()],
      ...overrides,
    });

  it("refuses story and coverage links that are not http(s)", () => {
    expect(() => parseArgs({})).not.toThrow();

    expect(() =>
      parseArgs({
        stories: [
          storyFixture({
            recaps: [
              { repo: REPO, prNumber: 5447, prUrl: "javascript:alert(1)" },
            ],
          }),
        ],
      }),
    ).toThrow(/http/i);

    expect(() =>
      parseArgs({
        coverage: {
          mergedPrCount: 1,
          recapCount: 0,
          missingPrs: [
            {
              repo: REPO,
              prNumber: 5485,
              title: "missing",
              url: "javascript:alert(1)",
            },
          ],
        },
      }),
    ).toThrow(/http/i);
  });
});
