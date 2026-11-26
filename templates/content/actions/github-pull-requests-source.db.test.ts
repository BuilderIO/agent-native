import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { GitHubPullRequestRecord } from "../shared/github-pull-requests.js";

// An in-memory GitHub: pull requests by key, and the keys a search finds.
const github = vi.hoisted(() => {
  const state = {
    pullRequests: new Map<string, GitHubPullRequestRecord>(),
    /** Keys the search finds, newest first. */
    found: [] as string[],
    /** How many the search says it finds in all, when not just `found`. */
    total: null as number | null,
    failure: null as Error | null,
    /** A failure for reads by number only, after the search answered. */
    readFailure: null as Error | null,
    /** Each search, and who ran it. */
    searches: [] as Array<{ search: string; user: string | undefined }>,
    /** The keys each read by number asked for. */
    reads: [] as string[][],
    /** When set, searches answer only once it settles. */
    gate: null as Promise<void> | null,
  };
  return {
    state,
    key: (ref: { owner: string; repo: string; number: number }) =>
      `${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}#${ref.number}`,
    reset() {
      state.pullRequests.clear();
      state.found = [];
      state.total = null;
      state.failure = null;
      state.readFailure = null;
      state.searches = [];
      state.reads = [];
      state.gate = null;
    },
  };
});

vi.mock("../server/lib/github-source-client.js", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../server/lib/github-source-client.js")
    >();
  const { getRequestUserEmail } =
    await import("@agent-native/core/server/request-context");
  return {
    ...original,
    searchGitHubPullRequests: async (
      _target: unknown,
      search: string,
      limit: number,
    ) => {
      github.state.searches.push({ search, user: getRequestUserEmail() });
      if (github.state.gate) await github.state.gate;
      if (github.state.failure) throw github.state.failure;
      const found = github.state.found.flatMap((key) => {
        const pr = github.state.pullRequests.get(key);
        return pr ? [pr] : [];
      });
      return {
        pullRequests: found.slice(0, limit),
        total: github.state.total ?? found.length,
      };
    },
    readGitHubPullRequests: async (
      _target: unknown,
      refs: Array<{ owner: string; repo: string; number: number }>,
    ) => {
      github.state.reads.push(refs.map(github.key));
      if (github.state.failure) throw github.state.failure;
      if (github.state.readFailure) throw github.state.readFailure;
      return refs.map(
        (ref) => github.state.pullRequests.get(github.key(ref)) ?? null,
      );
    },
  };
});

// The change events background syncs send to open pages.
const changes = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  recordChange: (event: Record<string, unknown>) => {
    changes.push(event);
  },
}));

// guard:allow-unscoped — isolated test database for the GitHub pull request source.
const path = join(
  tmpdir(),
  `content-github-pull-requests-${process.pid}-${Date.now()}.pglite`,
);
const owner = `github-prs-${Date.now()}@example.com`;
const DAY_MS = 24 * 60 * 60 * 1000;

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let createCollection: typeof import("./create-github-pull-request-collection.js").default;
let addPullRequests: typeof import("./add-github-pull-requests.js").default;
let refreshSource: typeof import("./refresh-content-database-source.js").default;
let getSource: typeof import("./get-content-database-source.js").default;
let updateDocument: typeof import("./update-document.js").default;
let getDocument: typeof import("./get-document.js").default;
let getDatabase: typeof import("./get-content-database.js").default;
let addItem: typeof import("./add-database-item.js").default;
let duplicateItem: typeof import("./duplicate-database-item.js").default;
let attachSource: typeof import("./attach-content-database-source.js").default;
let deleteDocument: typeof import("./delete-document.js").default;
let restoreDocument: typeof import("./restore-document.js").default;
let runSweep: typeof import("./_github-pull-requests-freshness.js").runGitHubPullRequestsSweep;
let refreshPage: typeof import("./_github-source-freshness.js").refreshGitHubPageBeforeRead;
let addAs: typeof import("./_github-pull-requests-source.js").addGitHubPullRequests;
let GitHubSourceError: typeof import("../server/lib/github-source-client.js").GitHubSourceError;
let GitHubSourceDeadlineError: typeof import("../server/lib/github-source-client.js").GitHubSourceDeadlineError;
let spaceId: string;

const as = async <T>(run: () => T | Promise<T>): Promise<Awaited<T>> =>
  await runWithRequestContext({ userEmail: owner }, run);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${path}`;
  const db = await import("../server/db/index.js");
  getDb = db.getDb;
  schema = db.schema;
  await (await import("../server/plugins/db.js")).default(undefined as never);
  createCollection = (
    await import("./create-github-pull-request-collection.js")
  ).default;
  addPullRequests = (await import("./add-github-pull-requests.js")).default;
  refreshSource = (await import("./refresh-content-database-source.js"))
    .default;
  getSource = (await import("./get-content-database-source.js")).default;
  updateDocument = (await import("./update-document.js")).default;
  getDocument = (await import("./get-document.js")).default;
  getDatabase = (await import("./get-content-database.js")).default;
  addItem = (await import("./add-database-item.js")).default;
  duplicateItem = (await import("./duplicate-database-item.js")).default;
  attachSource = (await import("./attach-content-database-source.js")).default;
  deleteDocument = (await import("./delete-document.js")).default;
  restoreDocument = (await import("./restore-document.js")).default;
  ({ runGitHubPullRequestsSweep: runSweep } =
    await import("./_github-pull-requests-freshness.js"));
  ({ refreshGitHubPageBeforeRead: refreshPage } =
    await import("./_github-source-freshness.js"));
  ({ addGitHubPullRequests: addAs } =
    await import("./_github-pull-requests-source.js"));
  ({ GitHubSourceError, GitHubSourceDeadlineError } =
    await import("../server/lib/github-source-client.js"));
  await as(() =>
    import("./_content-spaces.js").then((m) =>
      m.provisionContentSpaces(getDb(), owner),
    ),
  );
  const spaces = await as(async () =>
    (await import("./list-content-spaces.js")).default.run({}),
  );
  spaceId = spaces.spaces[0].id;
}, 120_000);

afterAll(() => {
  rmSync(path, { recursive: true, force: true });
});

beforeEach(() => {
  github.reset();
  changes.length = 0;
});

/** Puts a pull request in the fake GitHub and returns its key. */
function pullRequest(
  repo: string,
  number: number,
  change: Partial<GitHubPullRequestRecord> = {},
) {
  const record: GitHubPullRequestRecord = {
    owner: "acme",
    repo,
    number,
    title: `${repo} change ${number}`,
    url: `https://github.com/acme/${repo}/pull/${number}`,
    author: "octocat",
    state: "open",
    draft: false,
    review: "waiting",
    checks: "passing",
    createdAt: new Date(Date.now() - 3 * DAY_MS).toISOString(),
    updatedAt: new Date(Date.now() - DAY_MS).toISOString(),
    closedAt: null,
    ...change,
  };
  const key = github.key(record);
  github.state.pullRequests.set(key, record);
  return key;
}

function changePullRequest(
  key: string,
  change: Partial<GitHubPullRequestRecord>,
) {
  const current = github.state.pullRequests.get(key);
  if (!current) throw new Error(`No pull request ${key}.`);
  github.state.pullRequests.set(key, { ...current, ...change });
}

let collectionCount = 0;
async function newCollection(input: { search?: string; urls?: string[] } = {}) {
  collectionCount += 1;
  return await as(() =>
    createCollection.run({
      spaceId,
      title: `Pull requests ${collectionCount}`,
      idempotencyKey: `github-prs-${collectionCount}`,
      ...input,
    }),
  );
}

type Created = Extract<
  Awaited<ReturnType<typeof newCollection>>,
  { dryRun: false }
>;

function made(result: Awaited<ReturnType<typeof newCollection>>): Created {
  if (result.dryRun) throw new Error("Expected a collection.");
  return result;
}

async function rows(databaseId: string) {
  return getDb()
    .select({
      documentId: schema.documents.id,
      title: schema.documents.title,
      trashedAt: schema.documents.trashedAt,
      sourceMode: schema.documents.sourceMode,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabaseItems.documentId),
    )
    .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
}

async function liveTitles(databaseId: string) {
  return (await rows(databaseId))
    .filter((row) => !row.trashedAt)
    .map((row) => row.title)
    .sort();
}

async function columns(databaseId: string) {
  const definitions = await getDb()
    .select({
      id: schema.documentPropertyDefinitions.id,
      name: schema.documentPropertyDefinitions.name,
      type: schema.documentPropertyDefinitions.type,
      optionsJson: schema.documentPropertyDefinitions.optionsJson,
    })
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.databaseId, databaseId));
  return new Map(
    definitions.map((definition) => [definition.name, definition] as const),
  );
}

function columnId(byName: Awaited<ReturnType<typeof columns>>, name: string) {
  const column = byName.get(name);
  if (!column) throw new Error(`No ${name} column.`);
  return column.id;
}

async function value(documentId: string, propertyId: string) {
  const row = (
    await getDb()
      .select({ valueJson: schema.documentPropertyValues.valueJson })
      .from(schema.documentPropertyValues)
      .where(
        and(
          eq(schema.documentPropertyValues.documentId, documentId),
          eq(schema.documentPropertyValues.propertyId, propertyId),
        ),
      )
  ).at(0);
  return row ? JSON.parse(row.valueJson) : undefined;
}

async function optionName(propertyId: string, stored: unknown) {
  const definition = (
    await getDb()
      .select({ optionsJson: schema.documentPropertyDefinitions.optionsJson })
      .from(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.id, propertyId))
  ).at(0);
  if (!definition) throw new Error(`No column ${propertyId}.`);
  const options = JSON.parse(definition.optionsJson).options as Array<{
    id: string;
    name: string;
  }>;
  return options.find((option) => option.id === stored)?.name ?? stored;
}

async function rowByTitle(databaseId: string, title: string) {
  const row = (await rows(databaseId)).find((item) => item.title === title);
  if (!row) throw new Error(`No row titled ${title}.`);
  return row;
}

async function refresh(databaseId: string) {
  return await as(() => refreshSource.run({ databaseId }));
}

/** Changes the link's saved state, as time passing or another add would. */
async function changeLink(
  databaseId: string,
  change: (state: Record<string, unknown>) => void,
) {
  const where = eq(schema.contentDatabaseSources.databaseId, databaseId);
  const source = (
    await getDb()
      .select({ metadataJson: schema.contentDatabaseSources.metadataJson })
      .from(schema.contentDatabaseSources)
      .where(where)
  ).at(0);
  if (!source) throw new Error("The collection has no link.");
  const metadata = JSON.parse(source.metadataJson);
  change(metadata.githubPullRequests);
  await getDb()
    .update(schema.contentDatabaseSources)
    .set({ metadataJson: JSON.stringify(metadata) })
    .where(where);
}

describe("GitHub pull request collections", () => {
  it("makes a collection of the pull requests a search finds, with GitHub's columns read-only", async () => {
    pullRequest("site", 1, { title: "Fix the header" });
    pullRequest("site", 2, {
      title: "Draft the footer",
      draft: true,
      checks: "failing",
      review: "changes_requested",
    });
    github.state.found = ["acme/site#2", "acme/site#1"];

    const result = made(await newCollection());
    expect(github.state.searches).toEqual([
      { search: "is:pr is:open author:@me", user: owner },
    ]);
    expect(result.sync).toMatchObject({ state: "synced", created: 2, rows: 2 });
    expect(await liveTitles(result.database.id)).toEqual([
      "Draft the footer",
      "Fix the header",
    ]);

    const byName = await columns(result.database.id);
    expect(
      Object.fromEntries(
        [...byName].map(([name, column]) => [name, column.type]),
      ),
    ).toMatchObject({
      Repository: "select",
      Number: "number",
      Author: "text",
      State: "select",
      Review: "select",
      Checks: "select",
      "Checks failing": "checkbox",
      Opened: "date",
      Updated: "date",
      Closed: "date",
      "Days open": "number",
      Link: "url",
    });

    const draft = await rowByTitle(result.database.id, "Draft the footer");
    expect(draft.sourceMode).toBeNull();
    expect(
      await optionName(
        columnId(byName, "State"),
        await value(draft.documentId, columnId(byName, "State")),
      ),
    ).toBe("Draft");
    expect(
      await optionName(
        columnId(byName, "Review"),
        await value(draft.documentId, columnId(byName, "Review")),
      ),
    ).toBe("Changes requested");
    expect(
      await value(draft.documentId, columnId(byName, "Checks failing")),
    ).toBe(true);
    expect(await value(draft.documentId, columnId(byName, "Days open"))).toBe(
      3,
    );
    expect(await value(draft.documentId, columnId(byName, "Number"))).toBe(2);
    expect(await value(draft.documentId, columnId(byName, "Link"))).toBe(
      "https://github.com/acme/site/pull/2",
    );
    expect(
      await value(draft.documentId, columnId(byName, "Closed")),
    ).toBeUndefined();

    // Passing checks leave "Checks failing" empty, so a rollup counting
    // filled values counts only failing pull requests.
    const passing = await rowByTitle(result.database.id, "Fix the header");
    expect(
      await value(passing.documentId, columnId(byName, "Checks failing")),
    ).toBeUndefined();

    const fields = await getDb()
      .select({
        writeOwner: schema.contentDatabaseSourceFields.writeOwner,
        readOnly: schema.contentDatabaseSourceFields.readOnly,
      })
      .from(schema.contentDatabaseSourceFields)
      .innerJoin(
        schema.contentDatabaseSources,
        eq(
          schema.contentDatabaseSources.id,
          schema.contentDatabaseSourceFields.sourceId,
        ),
      )
      .where(eq(schema.contentDatabaseSources.databaseId, result.database.id));
    expect(fields).toHaveLength(13);
    expect(
      fields.every(
        (field) => field.writeOwner === "source" && field.readOnly === 1,
      ),
    ).toBe(true);

    const status = await as(() =>
      getSource.run({ databaseId: result.database.id }),
    );
    expect(status.source?.sourceType).toBe("github-pull-requests");
    expect(status.source?.metadata.githubPullRequests).toMatchObject({
      search: "is:pr is:open author:@me",
      searchUrl:
        "https://github.com/pulls?q=is%3Apr%20is%3Aopen%20author%3A%40me",
      added: 0,
      rows: 2,
      searchTotal: 2,
      problem: null,
    });
  });

  it("keeps pull requests added by link after they merge, and moves the rest to Trash when the search stops finding them", async () => {
    const searched = pullRequest("site", 10, { title: "Searched only" });
    const linked = pullRequest("docs", 7, { title: "Added by link" });
    github.state.found = [searched];

    const result = made(
      await newCollection({
        urls: ["https://github.com/acme/docs/pull/7/files"],
      }),
    );
    expect(result.addError).toBeNull();
    expect(result.added).toMatchObject([
      { key: linked, title: "Added by link", created: true },
    ]);
    expect(await liveTitles(result.database.id)).toEqual([
      "Added by link",
      "Searched only",
    ]);

    // Both merge, so the open search finds neither.
    changePullRequest(searched, {
      state: "merged",
      closedAt: new Date().toISOString(),
    });
    changePullRequest(linked, {
      state: "merged",
      closedAt: new Date().toISOString(),
    });
    github.state.found = [];
    const refreshed = await refresh(result.database.id);
    expect(refreshed).toMatchObject({ githubChanged: true });
    expect(await liveTitles(result.database.id)).toEqual(["Added by link"]);
    // The added one is read by number, and the searched one once more
    // before it moves to Trash.
    expect(github.state.reads.slice(-2)).toEqual([[linked], [searched]]);

    const byName = await columns(result.database.id);
    const kept = await rowByTitle(result.database.id, "Added by link");
    expect(
      await optionName(
        columnId(byName, "State"),
        await value(kept.documentId, columnId(byName, "State")),
      ),
    ).toBe("Merged");
    // Empty once closed, so a rollup's largest value is the oldest open one.
    expect(
      await value(kept.documentId, columnId(byName, "Days open")),
    ).toBeUndefined();
    expect(
      await value(kept.documentId, columnId(byName, "Closed")),
    ).toMatchObject({
      start: new Date().toISOString().slice(0, 10),
    });
  });

  it("returns the same row when a pull request is added again", async () => {
    const key = pullRequest("site", 21, { title: "Add search" });
    github.state.found = [key];
    const result = made(await newCollection());
    const row = (await rows(result.database.id)).at(0);
    if (!row) throw new Error("The collection has no row.");

    const first = await as(() =>
      addPullRequests.run({
        databaseId: result.database.id,
        urls: ["acme/site#21"],
      }),
    );
    expect(first.pullRequests).toEqual([
      expect.objectContaining({
        key,
        documentId: row.documentId,
        created: false,
      }),
    ]);
    // The row was there already, so GitHub wasn't asked again.
    expect(github.state.reads).toEqual([]);
    const second = await as(() =>
      addPullRequests.run({
        documentId: result.database.documentId,
        urls: ["https://github.com/ACME/Site/pull/21"],
      }),
    );
    expect(second.pullRequests.at(0)?.documentId).toBe(row.documentId);
    expect(await rows(result.database.id)).toHaveLength(1);

    // Added by link, it stays when the search stops finding it.
    github.state.found = [];
    await refresh(result.database.id);
    expect(await liveTitles(result.database.id)).toEqual(["Add search"]);
  });

  it("refuses links that aren't pull requests, and ones GitHub can't find", async () => {
    pullRequest("site", 30);
    github.state.found = ["acme/site#30"];
    const result = made(await newCollection());

    await expect(
      as(() =>
        addPullRequests.run({
          databaseId: result.database.id,
          urls: ["https://github.com/acme/site/issues/4"],
        }),
      ),
    ).rejects.toThrow("Not a GitHub pull request link");
    await expect(
      as(() =>
        addPullRequests.run({
          databaseId: result.database.id,
          urls: ["acme/site#404"],
        }),
      ),
    ).rejects.toThrow("GitHub can't find acme/site#404");
    const status = await as(() =>
      getSource.run({ databaseId: result.database.id }),
    );
    expect(status.source?.metadata.githubPullRequests?.added).toBe(0);
  });

  it("keeps every row when the search finds more than a collection follows", async () => {
    const first = pullRequest("site", 40, { title: "Kept one" });
    const second = pullRequest("site", 41, { title: "Kept two" });
    github.state.found = [first, second];
    const result = made(await newCollection());

    github.state.found = [first];
    github.state.total = 900;
    await refresh(result.database.id);
    expect(await liveTitles(result.database.id)).toEqual([
      "Kept one",
      "Kept two",
    ]);
    const status = await as(() =>
      getSource.run({ databaseId: result.database.id }),
    );
    expect(status.source?.metadata.githubPullRequests?.problem).toMatchObject({
      code: "too_many_results",
    });
  });

  it("puts GitHub's title back when a row is renamed in Content", async () => {
    const key = pullRequest("site", 50, { title: "GitHub's title" });
    github.state.found = [key];
    const result = made(await newCollection());
    const row = await rowByTitle(result.database.id, "GitHub's title");

    await as(() =>
      updateDocument.run({ id: row.documentId, title: "Renamed here" }),
    );
    await refresh(result.database.id);
    expect(await liveTitles(result.database.id)).toEqual(["GitHub's title"]);
  });

  it("records a failed check on the link and leaves the rows", async () => {
    const key = pullRequest("site", 60, { title: "Still here" });
    github.state.found = [key];
    const result = made(await newCollection());

    github.state.failure = new GitHubSourceError(
      "rate_limited",
      "GitHub's rate limit is used up until 3:00 PM.",
      403,
    );
    const failed = await refresh(result.database.id);
    expect(failed).toMatchObject({ githubChanged: true });
    expect(await liveTitles(result.database.id)).toEqual(["Still here"]);
    const status = await as(() =>
      getSource.run({ databaseId: result.database.id }),
    );
    expect(status.source?.metadata.githubPullRequests?.problem).toMatchObject({
      code: "rate_limited",
    });
  });

  it("brings a stale link up to GitHub in the background, as the person who linked it", async () => {
    const key = pullRequest("site", 70, { title: "Before" });
    github.state.found = [key];
    const result = made(await newCollection());
    await getDb()
      .update(schema.contentDatabaseSources)
      .set({ lastRefreshedAt: new Date(Date.now() - 5 * 60_000).toISOString() })
      .where(eq(schema.contentDatabaseSources.databaseId, result.database.id));

    changePullRequest(key, { title: "After" });
    github.state.searches = [];
    await runSweep({ deadlineAt: Date.now() + 60_000 });
    expect(github.state.searches).toContainEqual({
      search: "is:pr is:open author:@me",
      user: owner,
    });
    expect(await liveTitles(result.database.id)).toEqual(["After"]);
    expect(changes).toContainEqual(
      expect.objectContaining({ key: "refresh-content-database-source" }),
    );
  });

  it("follows no search when given an empty one, holding only pull requests added by link", async () => {
    pullRequest("site", 80, { title: "Only by link" });
    const result = made(
      await newCollection({ search: "", urls: ["acme/site#80"] }),
    );
    expect(github.state.searches).toEqual([]);
    expect(await liveTitles(result.database.id)).toEqual(["Only by link"]);
    const status = await as(() =>
      getSource.run({ databaseId: result.database.id }),
    );
    expect(status.source?.sourceName).toBe(
      "GitHub pull requests added by link",
    );
    expect(status.source?.metadata.githubPullRequests).toMatchObject({
      search: null,
      searchUrl: null,
      added: 1,
    });
  });

  it("keeps a search row whose pull request GitHub no longer shows, as when the linker loses access", async () => {
    const shown = pullRequest("site", 90, { title: "Still shown" });
    const hidden = pullRequest("private", 91, { title: "Lost access" });
    github.state.found = [shown, hidden];
    const result = made(await newCollection());

    // The linker can't see it any more, so neither the search nor a read by
    // number finds it.
    github.state.pullRequests.delete(hidden);
    github.state.found = [shown];
    await refresh(result.database.id);
    expect(await liveTitles(result.database.id)).toEqual([
      "Lost access",
      "Still shown",
    ]);
  });

  it("lets only the person who linked a collection add pull requests to it", async () => {
    pullRequest("site", 100);
    const result = made(await newCollection());
    const editor = "editor@example.com";
    await expect(
      runWithRequestContext({ userEmail: editor }, () =>
        addAs({
          databaseId: result.database.id,
          refs: [{ owner: "acme", repo: "site", number: 100 }],
          actor: editor,
        }),
      ),
    ).rejects.toThrow("Only the person who linked this collection");
    expect(github.state.reads).toEqual([]);
  });

  it("holds two adds at once to the cap on pull requests added by link", async () => {
    const result = made(await newCollection());
    await changeLink(result.database.id, (state) => {
      state.added = Array.from(
        { length: 499 },
        (_, index) => `acme/old#${index + 1}`,
      );
    });
    pullRequest("site", 110);
    pullRequest("site", 111);

    const adds = await Promise.allSettled(
      ["acme/site#110", "acme/site#111"].map((url) =>
        as(() =>
          addPullRequests.run({ databaseId: result.database.id, urls: [url] }),
        ),
      ),
    );
    expect(adds.filter((add) => add.status === "fulfilled")).toHaveLength(1);
    expect(adds.find((add) => add.status === "rejected")).toMatchObject({
      reason: { message: expect.stringContaining("at most 500") },
    });
    const status = await as(() =>
      getSource.run({ databaseId: result.database.id }),
    );
    expect(status.source?.metadata.githubPullRequests?.added).toBe(500);
  });

  it("brings a pull request's page up to GitHub when it's read on its own", async () => {
    const key = pullRequest("site", 120, { title: "Old title" });
    github.state.found = [key];
    const result = made(await newCollection());
    const row = await rowByTitle(result.database.id, "Old title");
    await getDb()
      .update(schema.contentDatabaseSources)
      .set({ lastRefreshedAt: new Date(Date.now() - 5 * 60_000).toISOString() })
      .where(eq(schema.contentDatabaseSources.databaseId, result.database.id));

    changePullRequest(key, { title: "New title" });
    expect(await as(() => refreshPage(row.documentId))).toBe(true);
    expect(await liveTitles(result.database.id)).toEqual(["New title"]);
  });

  it("says on the link when syncs keep running out of time, but not after one", async () => {
    const key = pullRequest("site", 130, { title: "Slow to answer" });
    github.state.found = [key];
    const result = made(await newCollection());
    const problem = async () =>
      (await as(() => getSource.run({ databaseId: result.database.id }))).source
        ?.metadata.githubPullRequests?.problem;

    github.state.failure = new GitHubSourceDeadlineError();
    await refresh(result.database.id);
    expect(await problem()).toBeNull();

    await changeLink(result.database.id, (state) => {
      state.syncedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    });
    await refresh(result.database.id);
    expect(await problem()).toMatchObject({
      code: "unavailable",
      message: expect.stringContaining("for a while"),
    });
    expect(await liveTitles(result.database.id)).toEqual(["Slow to answer"]);

    // The next sync that's answered clears it.
    github.state.failure = null;
    await refresh(result.database.id);
    expect(await problem()).toBeNull();
  });

  it("stops reading a pull request added by link once its row shows it merged with its checks done", async () => {
    const key = pullRequest("docs", 140, { title: "Merged by link" });
    const result = made(
      await newCollection({ search: "", urls: ["acme/docs#140"] }),
    );

    changePullRequest(key, {
      state: "merged",
      closedAt: new Date().toISOString(),
      checks: "running",
    });
    github.state.reads = [];
    await refresh(result.database.id);
    // Checks still running, so it's read again next time.
    changePullRequest(key, { checks: "passing" });
    await refresh(result.database.id);
    expect(github.state.reads).toEqual([[key], [key]]);

    github.state.reads = [];
    await refresh(result.database.id);
    expect(github.state.reads).toEqual([]);
    const byName = await columns(result.database.id);
    const row = await rowByTitle(result.database.id, "Merged by link");
    expect(
      await optionName(
        columnId(byName, "Checks"),
        await value(row.documentId, columnId(byName, "Checks")),
      ),
    ).toBe("Passing");
  });

  it("writes nothing when a read after the search fails", async () => {
    const staying = pullRequest("site", 150, { title: "Staying" });
    const leaving = pullRequest("site", 151, { title: "Leaving" });
    github.state.found = [staying, leaving];
    const result = made(await newCollection());

    // The search answers, with a new title and one pull request fewer, but
    // the read that checks the one it stopped finding fails.
    changePullRequest(staying, { title: "Staying, renamed" });
    github.state.found = [staying];
    github.state.readFailure = new GitHubSourceError(
      "unavailable",
      "GitHub couldn't read the pull requests.",
      502,
    );
    await refresh(result.database.id);
    expect(await liveTitles(result.database.id)).toEqual([
      "Leaving",
      "Staying",
    ]);
    const status = await as(() =>
      getSource.run({ databaseId: result.database.id }),
    );
    expect(status.source?.metadata.githubPullRequests?.problem).toMatchObject({
      code: "unavailable",
    });

    github.state.readFailure = null;
    await refresh(result.database.id);
    expect(await liveTitles(result.database.id)).toEqual(["Staying, renamed"]);
  });

  it("moves more rows to Trash in one sync than one transaction takes", async () => {
    const keys = Array.from({ length: 55 }, (_, index) =>
      pullRequest("bulk", index + 1, { title: `Bulk ${index + 1}` }),
    );
    const kept = pullRequest("bulk", 100, { title: "Kept" });
    github.state.found = [...keys, kept];
    const result = made(await newCollection());
    expect(await liveTitles(result.database.id)).toHaveLength(56);

    github.state.found = [kept];
    const refreshed = await refresh(result.database.id);
    expect(refreshed).toMatchObject({ githubChanged: true });
    expect(await liveTitles(result.database.id)).toEqual(["Kept"]);
  });

  it("refuses to add a pull request whose row is in Trash, rather than return the Trash page", async () => {
    const key = pullRequest("site", 160, { title: "Trashed by hand" });
    github.state.found = [key];
    const result = made(await newCollection());
    const row = await rowByTitle(result.database.id, "Trashed by hand");
    await getDb()
      .update(schema.documents)
      .set({ trashedAt: new Date().toISOString(), trashRootId: row.documentId })
      .where(eq(schema.documents.id, row.documentId));

    await expect(
      as(() =>
        addPullRequests.run({
          databaseId: result.database.id,
          urls: ["acme/site#160"],
        }),
      ),
    ).rejects.toThrow("The row for acme/site#160 is in Trash");
    const status = await as(() =>
      getSource.run({ databaseId: result.database.id }),
    );
    expect(status.source?.metadata.githubPullRequests?.added).toBe(0);
  });

  it("gives a pull request a new row when its page was deleted from Trash", async () => {
    const key = pullRequest("site", 170, { title: "Deleted for good" });
    const result = made(
      await newCollection({ search: "", urls: ["acme/site#170"] }),
    );
    const row = await rowByTitle(result.database.id, "Deleted for good");
    // Deleting a page from Trash takes the page and its place in the
    // collection, but not the link's record of its pull request.
    await getDb()
      .delete(schema.documentPropertyValues)
      .where(eq(schema.documentPropertyValues.documentId, row.documentId));
    await getDb()
      .delete(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.documentId, row.documentId));
    await getDb()
      .delete(schema.documents)
      .where(eq(schema.documents.id, row.documentId));

    const added = await as(() =>
      addPullRequests.run({
        databaseId: result.database.id,
        urls: ["acme/site#170"],
      }),
    );
    expect(added.pullRequests).toEqual([
      expect.objectContaining({ key, created: true }),
    ]);
    // Page ids follow the link and the pull request, so the new page takes
    // the old one's id, which deleting it freed.
    expect(await liveTitles(result.database.id)).toEqual(["Deleted for good"]);
    await refresh(result.database.id);
    expect(await liveTitles(result.database.id)).toEqual(["Deleted for good"]);
  });

  it("brings a pull request's page up to GitHub when it's opened on its own", async () => {
    const key = pullRequest("site", 180, { title: "Before opening" });
    github.state.found = [key];
    const result = made(await newCollection());
    const row = await rowByTitle(result.database.id, "Before opening");
    await getDb()
      .update(schema.contentDatabaseSources)
      .set({ lastRefreshedAt: new Date(Date.now() - 5 * 60_000).toISOString() })
      .where(eq(schema.contentDatabaseSources.databaseId, result.database.id));

    changePullRequest(key, { title: "After opening" });
    const page = await as(() => getDocument.run({ id: row.documentId }));
    expect(page).toMatchObject({ title: "After opening" });
  });

  it("leaves a link the background checked a few minutes ago, and checks it after five", async () => {
    const key = pullRequest("lately", 190, { title: "Checked lately" });
    github.state.found = [key];
    const search = "is:pr is:open repo:acme/lately";
    const result = made(await newCollection({ search }));
    // Other tests' collections may be due too; only this one counts.
    const searchedHere = () =>
      github.state.searches.filter((each) => each.search === search);
    const checkedAgo = async (ms: number) =>
      await getDb()
        .update(schema.contentDatabaseSources)
        .set({ lastRefreshedAt: new Date(Date.now() - ms).toISOString() })
        .where(
          eq(schema.contentDatabaseSources.databaseId, result.database.id),
        );

    await checkedAgo(2 * 60_000);
    github.state.searches = [];
    await runSweep({ deadlineAt: Date.now() + 60_000 });
    expect(searchedHere()).toEqual([]);

    await checkedAgo(5 * 60_000);
    await runSweep({ deadlineAt: Date.now() + 60_000 });
    expect(searchedHere()).toEqual([{ search, user: owner }]);
  });

  it("refuses rows of Content's own and another source in a pull request collection", async () => {
    const key = pullRequest("site", 200, { title: "Only from GitHub" });
    github.state.found = [key];
    const result = made(await newCollection());
    const row = await rowByTitle(result.database.id, "Only from GitHub");
    const item = (
      await getDb()
        .select({ id: schema.contentDatabaseItems.id })
        .from(schema.contentDatabaseItems)
        .where(eq(schema.contentDatabaseItems.documentId, row.documentId))
    ).at(0);
    if (!item) throw new Error("No item for the row.");

    await expect(
      as(() => duplicateItem.run({ itemId: item.id })),
    ).rejects.toThrow("its rows come from GitHub");
    const discovered = await as(() =>
      getDatabase.run({ databaseId: result.database.id }),
    );
    const contract =
      "mutationContract" in discovered ? discovered.mutationContract : null;
    if (!contract) throw new Error("The collection has no mutation contract.");
    await expect(
      as(() =>
        addItem.run({
          target: contract.target,
          expectedSchemaRevision: contract.schemaRevision,
          idempotencyKey: "github-prs-new-row",
          title: "Local draft",
        }),
      ),
    ).rejects.toThrow("its rows come from GitHub");
    await expect(
      as(() =>
        attachSource.run({
          databaseId: result.database.id,
          sourceType: "mock-local",
        }),
      ),
    ).rejects.toThrow("source settings can't change here");
    expect(await liveTitles(result.database.id)).toEqual(["Only from GitHub"]);
  });

  it("takes a restored row out of the collection once its pull request left the search, and keeps one it still follows", async () => {
    const left = pullRequest("site", 210, { title: "Left the search" });
    const stays = pullRequest("site", 211, { title: "Still found" });
    github.state.found = [left, stays];
    const result = made(await newCollection());
    const leftRow = await rowByTitle(result.database.id, "Left the search");
    const staysRow = await rowByTitle(result.database.id, "Still found");
    await as(() => deleteDocument.run({ id: leftRow.documentId }));
    await as(() => deleteDocument.run({ id: staysRow.documentId }));

    // The search stops finding the first while its row is in Trash.
    github.state.found = [stays];
    await refresh(result.database.id);
    await as(() => restoreDocument.run({ id: leftRow.documentId }));
    await as(() => restoreDocument.run({ id: staysRow.documentId }));

    // The first comes back as an ordinary page, out of the rows, and the
    // second is still its pull request's row.
    expect(await liveTitles(result.database.id)).toEqual(["Still found"]);
    const page = (
      await getDb()
        .select({ trashedAt: schema.documents.trashedAt })
        .from(schema.documents)
        .where(eq(schema.documents.id, leftRow.documentId))
    ).at(0);
    expect(page).toEqual({ trashedAt: null });
    changePullRequest(stays, { title: "Still found, renamed" });
    await refresh(result.database.id);
    expect(
      (await rowByTitle(result.database.id, "Still found, renamed")).documentId,
    ).toBe(staysRow.documentId);

    // When the search finds the first again, it gets one row, not two.
    github.state.found = [left, stays];
    await refresh(result.database.id);
    expect(await liveTitles(result.database.id)).toEqual([
      "Left the search",
      "Still found, renamed",
    ]);
    expect(
      (await rowByTitle(result.database.id, "Left the search")).documentId,
    ).not.toBe(leftRow.documentId);
  });

  it("goes on with the rows Content has when GitHub is slow, and finishes the sync after the read", async () => {
    const key = pullRequest("site", 220, { title: "Before a slow read" });
    github.state.found = [key];
    const result = made(await newCollection());
    const row = await rowByTitle(result.database.id, "Before a slow read");
    await getDb()
      .update(schema.contentDatabaseSources)
      .set({ lastRefreshedAt: new Date(Date.now() - 5 * 60_000).toISOString() })
      .where(eq(schema.contentDatabaseSources.databaseId, result.database.id));
    changePullRequest(key, { title: "After a slow read" });
    let answer = () => {};
    github.state.gate = new Promise<void>((resolve) => {
      answer = resolve;
    });

    // GitHub hasn't answered yet, so the read coming back at all shows it
    // stopped waiting for the sync.
    expect(await as(() => refreshPage(row.documentId))).toBe(false);
    expect(await liveTitles(result.database.id)).toEqual([
      "Before a slow read",
    ]);

    changes.length = 0;
    answer();
    await vi.waitFor(
      async () => {
        expect(await liveTitles(result.database.id)).toEqual([
          "After a slow read",
        ]);
        expect(changes).not.toEqual([]);
      },
      { timeout: 10_000, interval: 50 },
    );
  }, 30_000);
});
