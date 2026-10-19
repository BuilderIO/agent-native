import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, isNull } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// An in-memory GitHub: commits are full snapshots of repository files, and
// blob SHAs come from content, so identical files share one like they do in Git.
const github = vi.hoisted(() => {
  const blobSha = (content: string) => {
    let hash = 5381;
    for (let index = 0; index < content.length; index++) {
      hash = (hash * 33 + content.charCodeAt(index)) >>> 0;
    }
    return `blob${hash.toString(16)}${content.length.toString(16)}`;
  };
  const state = {
    commits: new Map<string, Map<string, string>>(),
    head: "",
    renames: [] as Array<{ from: string; to: string }>,
    failure: null as Error | null,
    blobReads: 0,
    uploads: 0,
    noStorage: false,
    /** Runs once, during the next blob read, to race something against a sync. */
    duringBlobRead: null as null | (() => Promise<void>),
    /** Blob reads after this many wait until the sync's time runs out. */
    hangAfterBlobReads: null as number | null,
    /** Branch reads wait until the sync's time runs out. */
    hangHead: false,
  };
  let commitCount = 0;
  return {
    state,
    blobSha,
    reset() {
      state.commits.clear();
      state.head = "";
      state.renames = [];
      state.failure = null;
      state.blobReads = 0;
      state.uploads = 0;
      state.noStorage = false;
      state.duringBlobRead = null;
      state.hangAfterBlobReads = null;
      state.hangHead = false;
    },
    commit(files: Record<string, string>, renames: typeof state.renames = []) {
      commitCount += 1;
      const sha = `commit${commitCount.toString().padStart(4, "0")}`;
      state.commits.set(sha, new Map(Object.entries(files)));
      state.head = sha;
      state.renames = renames;
      return sha;
    },
  };
});

vi.mock("../server/lib/github-source-client.js", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../server/lib/github-source-client.js")
    >();
  const { GitHubSourceDeadlineError, GitHubSourceError } = original;
  // A request GitHub never answers, until the sync's deadline ends it.
  const hang = (signal?: AbortSignal) =>
    new Promise<never>((_, reject) => {
      if (!signal) {
        reject(new Error("A request GitHub never answers had no deadline."));
        return;
      }
      const stop = () => reject(new GitHubSourceDeadlineError());
      if (signal.aborted) stop();
      else signal.addEventListener("abort", stop, { once: true });
    });
  const findBlob = (sha: string) => {
    for (const files of github.state.commits.values()) {
      for (const content of files.values()) {
        if (github.blobSha(content) === sha) return content;
      }
    }
    return null;
  };
  return {
    ...original,
    readGitHubDefaultBranch: async () => "main",
    readGitHubBranchHead: async (
      target: { branch: string; signal?: AbortSignal },
      etag?: string | null,
    ) => {
      if (github.state.failure) throw github.state.failure;
      if (github.state.hangHead) await hang(target.signal);
      if (target.branch !== "main") {
        throw new GitHubSourceError("branch_not_found", "No such branch.");
      }
      const current = `"etag-${github.state.head}"`;
      if (etag === current) return { status: "not-modified" as const };
      return { status: "ok" as const, sha: github.state.head, etag: current };
    },
    readGitHubFolderTree: async (target: {
      commitSha: string;
      path: string;
    }) => {
      const files = github.state.commits.get(target.commitSha);
      if (!files) throw new GitHubSourceError("unavailable", "No commit.");
      const prefix = target.path ? `${target.path}/` : "";
      const entries = [...files]
        .filter(([path]) => path.startsWith(prefix))
        .map(([path, content]) => ({
          path: path.slice(prefix.length),
          type: "blob" as const,
          sha: github.blobSha(content),
          size: content.length,
        }));
      if (target.path && entries.length === 0) {
        throw new GitHubSourceError("folder_not_found", "No such folder.");
      }
      return entries;
    },
    readGitHubBlob: async (target: { sha: string; signal?: AbortSignal }) => {
      github.state.blobReads += 1;
      const hangAfter = github.state.hangAfterBlobReads;
      if (hangAfter !== null && github.state.blobReads > hangAfter) {
        await hang(target.signal);
      }
      const during = github.state.duringBlobRead;
      github.state.duringBlobRead = null;
      await during?.();
      const content = findBlob(target.sha);
      if (content === null)
        throw new GitHubSourceError("unavailable", "No blob.");
      // A stand-in for a file whose bytes aren't UTF-8.
      if (content.startsWith("BINARY"))
        return new Uint8Array([0xff, 0xfe, 0xfd]);
      return new TextEncoder().encode(content);
    },
    readGitHubRenames: async () => github.state.renames,
  };
});

vi.mock("@agent-native/core/file-upload", () => ({
  getActiveFileUploadProviderForRequest: async () =>
    github.state.noStorage ? null : { id: "test" },
  uploadFile: async (input: { filename: string }) => {
    if (github.state.noStorage) return null;
    github.state.uploads += 1;
    return {
      url: `https://files.example.test/${github.state.uploads}/${input.filename}`,
      provider: "test",
    };
  },
}));

// The change events background syncs and stale reads send to open pages.
const changes = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  recordChange: (event: Record<string, unknown>) => {
    changes.push(event);
  },
}));

// guard:allow-unscoped — isolated test database for the GitHub folder source.
const path = join(
  tmpdir(),
  `content-github-source-${process.pid}-${Date.now()}.pglite`,
);
const owner = `github-owner-${Date.now()}@example.com`;
const FOLDER_URL = "https://github.com/acme/site/tree/main/docs";

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let createDatabase: typeof import("./create-content-database.js").default;
let linkFolder: typeof import("./link-github-folder.js").default;
let syncFolder: typeof import("./sync-github-folder.js").default;
let getSource: typeof import("./get-content-database-source.js").default;
let editDocument: typeof import("./edit-document.js").default;
let updateDocument: typeof import("./update-document.js").default;
let duplicateItem: typeof import("./duplicate-database-item.js").default;
let getDatabase: typeof import("./get-content-database.js").default;
let addItem: typeof import("./add-database-item.js").default;
let attachSource: typeof import("./attach-content-database-source.js").default;
let bindSourceField: typeof import("./bind-content-database-source-field.js").default;
let disconnectSource: typeof import("./disconnect-content-database-source.js").default;
let deleteDocument: typeof import("./delete-document.js").default;
let restoreVersion: typeof import("./restore-document-version.js").default;
let mutateDocumentBody: typeof import("./_document-edit-mutation.js").mutateDocumentBody;
let documentRevisionToken: typeof import("./_document-edit-mutation.js").documentRevisionToken;
let syncGitHubSource: typeof import("./_github-source.js").syncGitHubSource;
let getDocument: typeof import("./get-document.js").default;
let runGitHubSourceSweep: typeof import("./_github-source-freshness.js").runGitHubSourceSweep;
let spaceId: string;

const as = async <T>(run: () => T | Promise<T>): Promise<Awaited<T>> =>
  await runWithRequestContext({ userEmail: owner }, run);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${path}`;
  const db = await import("../server/db/index.js");
  getDb = db.getDb;
  schema = db.schema;
  await (await import("../server/plugins/db.js")).default(undefined as never);
  createDatabase = (await import("./create-content-database.js")).default;
  linkFolder = (await import("./link-github-folder.js")).default;
  syncFolder = (await import("./sync-github-folder.js")).default;
  getSource = (await import("./get-content-database-source.js")).default;
  editDocument = (await import("./edit-document.js")).default;
  updateDocument = (await import("./update-document.js")).default;
  duplicateItem = (await import("./duplicate-database-item.js")).default;
  getDatabase = (await import("./get-content-database.js")).default;
  addItem = (await import("./add-database-item.js")).default;
  attachSource = (await import("./attach-content-database-source.js")).default;
  bindSourceField = (await import("./bind-content-database-source-field.js"))
    .default;
  disconnectSource = (await import("./disconnect-content-database-source.js"))
    .default;
  ({ syncGitHubSource } = await import("./_github-source.js"));
  deleteDocument = (await import("./delete-document.js")).default;
  restoreVersion = (await import("./restore-document-version.js")).default;
  ({ mutateDocumentBody, documentRevisionToken } =
    await import("./_document-edit-mutation.js"));
  getDocument = (await import("./get-document.js")).default;
  ({ runGitHubSourceSweep } = await import("./_github-source-freshness.js"));
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

let collectionCount = 0;
async function newCollection() {
  collectionCount += 1;
  const created = await as(() =>
    createDatabase.run({
      spaceId,
      title: `Docs ${collectionCount}`,
      idempotencyKey: `github-collection-${collectionCount}`,
    }),
  );
  return created.database;
}

async function rows(databaseId: string) {
  return getDb()
    .select({
      itemId: schema.contentDatabaseItems.id,
      documentId: schema.documents.id,
      title: schema.documents.title,
      content: schema.documents.content,
      sourcePath: schema.documents.sourcePath,
      sourceMode: schema.documents.sourceMode,
      bodyRevision: schema.documents.bodyRevision,
      updatedAt: schema.documents.updatedAt,
      trashedAt: schema.documents.trashedAt,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabaseItems.documentId),
    )
    .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
}

async function liveRows(databaseId: string) {
  return (await rows(databaseId))
    .filter((row) => !row.trashedAt)
    .sort((a, b) => (a.sourcePath! < b.sourcePath! ? -1 : 1));
}

async function columns(databaseId: string) {
  return getDb()
    .select({
      id: schema.documentPropertyDefinitions.id,
      name: schema.documentPropertyDefinitions.name,
      type: schema.documentPropertyDefinitions.type,
      optionsJson: schema.documentPropertyDefinitions.optionsJson,
    })
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.databaseId, databaseId));
}

async function value(documentId: string, propertyId: string) {
  const [row] = await getDb()
    .select({ valueJson: schema.documentPropertyValues.valueJson })
    .from(schema.documentPropertyValues)
    .where(
      and(
        eq(schema.documentPropertyValues.documentId, documentId),
        eq(schema.documentPropertyValues.propertyId, propertyId),
      ),
    );
  return row ? JSON.parse(row.valueJson) : undefined;
}

async function history(documentId: string) {
  return getDb()
    .select({
      actorKind: schema.documentVersions.actorKind,
      origin: schema.documentVersions.origin,
      operation: schema.documentVersions.operation,
      content: schema.documentVersions.content,
    })
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.documentId, documentId));
}

async function sourceId(databaseId: string) {
  const [source] = await getDb()
    .select({ id: schema.contentDatabaseSources.id })
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.databaseId, databaseId));
  return source!.id;
}

const GUIDE = `---
title: Getting started
status: Published
order: 1
tags: [intro, guide]
published: 2026-09-01
featured: true
---

Read the [FAQ](faq.md) next.

![Diagram](images/diagram.png)
`;

const FAQ = `# Frequently asked

Answers *live* here.
`;

const BASE_FILES = {
  "docs/getting-started.md": GUIDE,
  "docs/faq.md": FAQ,
  "docs/notes/untitled-notes.md": "Just a body with no heading.\n",
  "docs/demo.mdx": "<Demo />\n",
  "docs/images/diagram.png": "PNGDATA",
  "docs/.github/template.md": "# Hidden\n",
  "README.md": "# Outside the folder\n",
};

async function linkBaseFolder() {
  github.commit(BASE_FILES);
  const database = await newCollection();
  const linked = await as(() =>
    linkFolder.run({ databaseId: database.id, url: FOLDER_URL }),
  );
  return { database, linked };
}

describe("GitHub folder source", () => {
  it("previews a folder without linking anything", async () => {
    github.commit(BASE_FILES);
    const database = await newCollection();
    const preview = await as(() =>
      linkFolder.run({
        databaseId: database.id,
        url: FOLDER_URL,
        dryRun: true,
      }),
    );
    expect(preview).toMatchObject({
      dryRun: true,
      canLink: true,
      preview: {
        location: { owner: "acme", repo: "site", branch: "main", path: "docs" },
        markdownFiles: 3,
        skipped: [{ path: "demo.mdx", reason: "mdx" }],
      },
    });
    const fields = Object.fromEntries(
      preview.preview.fields.map((field) => [field.key, field.type]),
    );
    expect(fields).toEqual({
      status: "select",
      order: "number",
      tags: "multi_select",
      published: "date",
      featured: "checkbox",
    });
    expect(
      preview.preview.fields.find((field) => field.key === "tags")?.examples,
    ).toContain("intro, guide");
    // Agents over MCP read the summary, so it carries the preview itself.
    expect(preview.summary).toContain("tags (multi select)");
    expect(preview.summary).toContain(
      "1 skipped: demo.mdx (MDX isn't supported)",
    );
    expect(await rows(database.id)).toHaveLength(0);
    const [source] = await getDb()
      .select()
      .from(schema.contentDatabaseSources)
      .where(eq(schema.contentDatabaseSources.databaseId, database.id));
    expect(source).toBeUndefined();
  });

  it("links an empty collection: rows, titles, typed columns, images and links", async () => {
    const { database, linked } = await linkBaseFolder();
    expect(linked).toMatchObject({
      dryRun: false,
      sync: { state: "synced", created: 3 },
    });
    const pages = await liveRows(database.id);
    expect(pages.map((page) => [page.sourcePath, page.title])).toEqual([
      ["docs/faq.md", "Frequently asked"],
      ["docs/getting-started.md", "Getting started"],
      ["docs/notes/untitled-notes.md", "Untitled notes"],
    ]);
    expect(pages.every((page) => page.sourceMode === "github")).toBe(true);

    const guide = pages.find(
      (page) => page.sourcePath === "docs/getting-started.md",
    )!;
    const faq = pages.find((page) => page.sourcePath === "docs/faq.md")!;
    expect(guide.content).toContain(`/page/${faq.documentId}`);
    expect(guide.content).toContain("https://files.example.test/1/diagram.png");
    expect(github.state.uploads).toBe(1);

    const byName = Object.fromEntries(
      (await columns(database.id)).map((column) => [column.name, column]),
    );
    expect(byName.order?.type).toBe("number");
    expect(byName.tags?.type).toBe("multi_select");
    expect(await value(guide.documentId, byName.order!.id)).toBe(1);
    expect(await value(guide.documentId, byName.featured!.id)).toBe(true);
    const tagOptions = JSON.parse(byName.tags!.optionsJson).options.map(
      (option: { name: string }) => option.name,
    );
    expect(tagOptions).toEqual(["intro", "guide"]);

    const status = await as(() => getSource.run({ databaseId: database.id }));
    expect(status.source?.metadata.github).toMatchObject({
      owner: "acme",
      repo: "site",
      branch: "main",
      path: "docs",
      syncedCommitSha: github.state.head,
      files: 3,
      skipped: [{ path: "demo.mdx", reason: "mdx" }],
      problem: null,
    });
    expect(status.source?.metadata.github?.syncedAt).toEqual(
      expect.any(String),
    );

    const [fieldRow] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceFields)
      .where(
        and(
          eq(schema.contentDatabaseSourceFields.sourceId, status.source!.id),
          eq(schema.contentDatabaseSourceFields.sourceFieldKey, "order"),
        ),
      );
    expect(fieldRow).toMatchObject({ writeOwner: "source", readOnly: 1 });
  });

  it("refuses to link a collection that already has rows", async () => {
    github.commit(BASE_FILES);
    const database = await newCollection();
    const now = new Date().toISOString();
    const documentId = `existing-row-${Date.now()}`;
    await getDb().insert(schema.documents).values({
      id: documentId,
      spaceId,
      ownerEmail: owner,
      parentId: database.documentId,
      title: "Existing row",
      createdAt: now,
      updatedAt: now,
    });
    await getDb()
      .insert(schema.contentDatabaseItems)
      .values({
        id: `existing-item-${Date.now()}`,
        ownerEmail: owner,
        databaseId: database.id,
        documentId,
        createdAt: now,
        updatedAt: now,
      });
    const preview = await as(() =>
      linkFolder.run({
        databaseId: database.id,
        url: FOLDER_URL,
        dryRun: true,
      }),
    );
    expect(preview).toMatchObject({ canLink: false });
    await expect(
      as(() => linkFolder.run({ databaseId: database.id, url: FOLDER_URL })),
    ).rejects.toThrow("already has rows");
  });

  it("keeps the link and reports it when the first sync loses the GitHub connection", async () => {
    github.commit(BASE_FILES);
    const database = await newCollection();
    const { GitHubSourceError } =
      await import("../server/lib/github-source-client.js");
    // The preview reads with the connection; it fails once the link is saved.
    github.state.duringBlobRead = async () => {
      github.state.failure = new GitHubSourceError(
        "connection",
        "GitHub no longer accepts the saved connection. Reconnect GitHub.",
        401,
      );
    };

    const linked = await as(() =>
      linkFolder.run({ databaseId: database.id, url: FOLDER_URL }),
    );
    expect(linked).toMatchObject({
      dryRun: false,
      sync: { state: "error", problem: { code: "connection" } },
    });
    const status = await as(() => getSource.run({ databaseId: database.id }));
    expect(status.source?.metadata.github?.problem).toMatchObject({
      code: "connection",
    });
  });

  it("keeps the link and reports it when the first sync fails unexpectedly", async () => {
    github.commit(BASE_FILES);
    const database = await newCollection();
    github.state.duringBlobRead = async () => {
      github.state.failure = new Error("socket hang up");
    };

    const linked = await as(() =>
      linkFolder.run({ databaseId: database.id, url: FOLDER_URL }),
    );
    expect(linked).toMatchObject({
      dryRun: false,
      sync: { state: "error", problem: { code: "unavailable" } },
      source: { sourceType: "github" },
    });
    expect(linked.summary).toContain("the first sync failed");
    // The link keeps the problem, so its status line shows it after the toast.
    const status = await as(() => getSource.run({ databaseId: database.id }));
    expect(status.source?.syncState).toBe("error");
    expect(status.source?.metadata.github?.problem).toMatchObject({
      code: "unavailable",
    });
  });

  it("refuses the link when a row arrives while it reads GitHub", async () => {
    github.commit(BASE_FILES);
    const database = await newCollection();
    const discovered = await as(() =>
      getDatabase.run({ databaseId: database.id }),
    );
    const contract =
      "mutationContract" in discovered ? discovered.mutationContract : null;
    github.state.duringBlobRead = async () => {
      await as(() =>
        addItem.run({
          target: contract!.target,
          expectedSchemaRevision: contract!.schemaRevision,
          idempotencyKey: "github-row-during-link",
          title: "Local draft",
        }),
      );
    };

    await expect(
      as(() => linkFolder.run({ databaseId: database.id, url: FOLDER_URL })),
    ).rejects.toThrow("already has rows");
    const sources = await getDb()
      .select({ id: schema.contentDatabaseSources.id })
      .from(schema.contentDatabaseSources)
      .where(eq(schema.contentDatabaseSources.databaseId, database.id));
    expect(sources).toEqual([]);
    expect((await liveRows(database.id)).map((row) => row.title)).toEqual([
      "Local draft",
    ]);
  });

  it("writes nothing when the branch hasn't moved or a commit only reformats", async () => {
    const { database } = await linkBaseFolder();
    const before = await liveRows(database.id);
    const historyBefore = await history(before[0]!.documentId);

    const unchanged = await as(() =>
      syncFolder.run({ databaseId: database.id }),
    );
    expect(unchanged.sync.state).toBe("unchanged");

    const readsBefore = github.state.blobReads;
    github.commit({
      ...BASE_FILES,
      "docs/faq.md": "# Frequently asked\n\n\nAnswers _live_ here.   \n",
    });
    const reformatted = await as(() =>
      syncFolder.run({ databaseId: database.id }),
    );
    expect(reformatted.sync).toMatchObject({
      state: "synced",
      updated: 0,
      unchanged: 3,
    });
    expect(github.state.blobReads).toBe(readsBefore + 1);
    const after = await liveRows(database.id);
    expect(after.map((row) => [row.bodyRevision, row.updatedAt])).toEqual(
      before.map((row) => [row.bodyRevision, row.updatedAt]),
    );
    expect(await history(before[0]!.documentId)).toEqual(historyBefore);
  });

  it("updates an edited file in place and records the change in History", async () => {
    const { database } = await linkBaseFolder();
    const faq = (await liveRows(database.id)).find(
      (row) => row.sourcePath === "docs/faq.md",
    )!;
    github.commit({
      ...BASE_FILES,
      "docs/faq.md": "# Frequently asked\n\nAnswers moved to the forum.\n",
    });
    const synced = await as(() => syncFolder.run({ databaseId: database.id }));
    expect(synced.sync).toMatchObject({ state: "synced", updated: 1 });
    const [updated] = (await liveRows(database.id)).filter(
      (row) => row.documentId === faq.documentId,
    );
    expect(updated!.content).toContain("Answers moved to the forum.");
    expect(updated!.bodyRevision).toBeGreaterThan(faq.bodyRevision);
    const entries = await history(faq.documentId);
    expect(
      entries.some((entry) => entry.content.includes("Answers moved")),
    ).toBe(true);
    expect(
      entries.every(
        (entry) =>
          entry.actorKind === "source" &&
          entry.origin === "github" &&
          entry.operation === "sync-github-source",
      ),
    ).toBe(true);
  });

  it("keeps a renamed file's page, and moves a deleted file's page to Trash", async () => {
    const { database } = await linkBaseFolder();
    const pages = await liveRows(database.id);
    const faq = pages.find((row) => row.sourcePath === "docs/faq.md")!;
    const notes = pages.find(
      (row) => row.sourcePath === "docs/notes/untitled-notes.md",
    )!;
    await getDb()
      .insert(schema.documentComments)
      .values({
        id: `comment-${Date.now()}`,
        ownerEmail: owner,
        documentId: faq.documentId,
        threadId: `thread-${Date.now()}`,
        content: "Keep this answer short.",
        authorEmail: owner,
      });

    const {
      "docs/faq.md": faqText,
      "docs/notes/untitled-notes.md": _notes,
      ...rest
    } = BASE_FILES;
    github.commit({ ...rest, "docs/help/faq.md": faqText }, [
      { from: "docs/faq.md", to: "docs/help/faq.md" },
    ]);
    const synced = await as(() => syncFolder.run({ databaseId: database.id }));
    expect(synced.sync).toMatchObject({
      state: "synced",
      renamed: 1,
      trashed: 1,
    });

    const after = await liveRows(database.id);
    expect(after.map((row) => row.sourcePath)).toEqual([
      "docs/getting-started.md",
      "docs/help/faq.md",
    ]);
    expect(
      after.find((row) => row.sourcePath === "docs/help/faq.md")!.documentId,
    ).toBe(faq.documentId);
    const comments = await getDb()
      .select()
      .from(schema.documentComments)
      .where(eq(schema.documentComments.documentId, faq.documentId));
    expect(comments).toHaveLength(1);
    const [trashed] = await getDb()
      .select({ trashedAt: schema.documents.trashedAt })
      .from(schema.documents)
      .where(eq(schema.documents.id, notes.documentId));
    expect(trashed!.trashedAt).toEqual(expect.any(String));
  });

  it("follows a rename Git didn't report through identical contents or the frontmatter id", async () => {
    github.commit({
      "docs/a.md": "# Alpha\n\nSame text.\n",
      "docs/b.md": "---\nid: page-b\n---\n# Beta\n",
    });
    const database = await newCollection();
    await as(() =>
      linkFolder.run({ databaseId: database.id, url: FOLDER_URL }),
    );
    const before = await liveRows(database.id);

    github.commit({
      "docs/renamed-a.md": "# Alpha\n\nSame text.\n",
      "docs/renamed-b.md": "---\nid: page-b\n---\n# Beta, edited\n",
    });
    const synced = await as(() => syncFolder.run({ databaseId: database.id }));
    expect(synced.sync).toMatchObject({ renamed: 2, trashed: 0, created: 0 });
    const after = await liveRows(database.id);
    expect(after.map((row) => row.documentId).sort()).toEqual(
      before.map((row) => row.documentId).sort(),
    );
    expect(
      after.find((row) => row.sourcePath === "docs/renamed-b.md")!.title,
    ).toBe("Beta, edited");
  });

  it("widens a column to text when a value stops fitting, keeping earlier values", async () => {
    github.commit({
      "docs/one.md": "---\norder: 1\n---\n# One\n",
      "docs/two.md": "---\norder: 2\n---\n# Two\n",
    });
    const database = await newCollection();
    await as(() =>
      linkFolder.run({ databaseId: database.id, url: FOLDER_URL }),
    );
    github.commit({
      "docs/one.md": "---\norder: 1\n---\n# One\n",
      "docs/two.md": "---\norder: TBD\n---\n# Two\n",
    });
    const synced = await as(() => syncFolder.run({ databaseId: database.id }));
    // A frontmatter-only change still counts as an update.
    expect(synced.sync).toMatchObject({ updated: 1, unchanged: 1 });
    const order = (await columns(database.id)).find(
      (column) => column.name === "order",
    )!;
    expect(order.type).toBe("text");
    const [one, two] = await liveRows(database.id);
    expect(await value(one!.documentId, order.id)).toBe("1");
    expect(await value(two!.documentId, order.id)).toBe("TBD");
  });

  it("stops at its time budget and resumes where it left off", async () => {
    github.commit({
      "docs/1.md": "# One\n",
      "docs/2.md": "# Two\n",
      "docs/3.md": "# Three\n",
    });
    const database = await newCollection();
    await as(() =>
      linkFolder.run({ databaseId: database.id, url: FOLDER_URL }),
    );
    github.commit({
      "docs/1.md": "# One, edited\n",
      "docs/2.md": "# Two, edited\n",
      "docs/3.md": "# Three, edited\n",
      "docs/4.md": "# Four\n",
    });
    const id = await sourceId(database.id);
    const partial = await as(() =>
      syncGitHubSource({ sourceId: id, budgetMs: 0 }),
    );
    expect(partial).toMatchObject({ state: "partial", remaining: 4 });
    const status = await as(() => getSource.run({ databaseId: database.id }));
    expect(status.source?.metadata.github).toMatchObject({
      pendingCommitSha: github.state.head,
      progress: { done: 0, total: 4 },
    });
    expect(status.source?.freshness).toBe("stale");

    const resumed = await as(() =>
      syncGitHubSource({ sourceId: id, budgetMs: 30_000 }),
    );
    expect(resumed).toMatchObject({ state: "synced", updated: 3, created: 1 });
    expect((await liveRows(database.id)).map((row) => row.title)).toEqual([
      "One, edited",
      "Two, edited",
      "Three, edited",
      "Four",
    ]);
  });

  it("keeps GitHub pages view only for agents and records specific problems", async () => {
    const { database } = await linkBaseFolder();
    const [page] = await liveRows(database.id);
    await expect(
      as(() =>
        editDocument.run({
          id: page!.documentId,
          find: "Answers",
          replace: "Nope",
        }),
      ),
    ).rejects.toThrow("view only here");
    await expect(
      as(() =>
        updateDocument.run({ id: page!.documentId, title: "Renamed here" }),
      ),
    ).rejects.toThrow("view only here");
    await expect(
      as(() => updateDocument.run({ id: page!.documentId, icon: "📘" })),
    ).resolves.toBeTruthy();
    await expect(
      as(() => duplicateItem.run({ itemId: page!.itemId })),
    ).rejects.toThrow("rows come from the files there");
    const discovered = await as(() =>
      getDatabase.run({ databaseId: database.id }),
    );
    const contract =
      "mutationContract" in discovered ? discovered.mutationContract : null;
    expect(contract).toBeTruthy();
    await expect(
      as(() =>
        addItem.run({
          target: contract!.target,
          expectedSchemaRevision: contract!.schemaRevision,
          idempotencyKey: "github-new-row",
          title: "Local draft",
        }),
      ),
    ).rejects.toThrow("rows come from the files there");
    expect(await liveRows(database.id)).toHaveLength(3);

    const { GitHubSourceError } =
      await import("../server/lib/github-source-client.js");
    github.commit({ ...BASE_FILES, "docs/faq.md": "# Changed\n" });
    github.state.failure = new GitHubSourceError(
      "forbidden",
      "GitHub refused access: Resource not accessible by integration",
    );
    const failed = await as(() => syncFolder.run({ databaseId: database.id }));
    expect(failed.sync).toMatchObject({
      state: "error",
      problem: { code: "forbidden" },
    });
    const status = await as(() => getSource.run({ databaseId: database.id }));
    expect(status.source).toMatchObject({
      syncState: "error",
      freshness: "stale",
    });
    expect(status.source?.metadata.github?.problem?.code).toBe("forbidden");

    github.state.failure = null;
    const recovered = await as(() =>
      syncFolder.run({ databaseId: database.id }),
    );
    expect(recovered.sync.state).toBe("synced");
    const healthy = await as(() => getSource.run({ databaseId: database.id }));
    expect(healthy.source?.metadata.github?.problem).toBeNull();
  });

  it("keeps History restores, shared body edits and Trash off GitHub pages", async () => {
    const { database } = await linkBaseFolder();
    const faq = (await liveRows(database.id)).find(
      (row) => row.sourcePath === "docs/faq.md",
    )!;
    await expect(
      as(() => deleteDocument.run({ id: faq.documentId })),
    ).rejects.toThrow("Delete the file");

    const [version] = await getDb()
      .select({ id: schema.documentVersions.id })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, faq.documentId));
    await expect(
      as(() =>
        restoreVersion.run({
          documentId: faq.documentId,
          versionId: version!.id,
          expectedUpdatedAt: faq.updatedAt,
        }),
      ),
    ).rejects.toThrow("view only here");

    await expect(
      as(() =>
        mutateDocumentBody({
          documentId: faq.documentId,
          baseRevision: documentRevisionToken(faq.bodyRevision, faq.content),
          idempotencyKey: "github-body-edit",
          edits: [{ find: "Answers", replace: "Nope" }],
          ctx: { caller: "mcp", userEmail: owner },
        }),
      ),
    ).rejects.toThrow("view only here");
    const [after] = (await liveRows(database.id)).filter(
      (row) => row.documentId === faq.documentId,
    );
    expect(after).toMatchObject({ content: faq.content, trashedAt: null });
  });

  it("stops a sync that a disconnect overtakes before it writes", async () => {
    const { database } = await linkBaseFolder();
    const before = await liveRows(database.id);
    const { "docs/notes/untitled-notes.md": _notes, ...rest } = BASE_FILES;
    github.commit({ ...rest, "docs/faq.md": "# Changed in GitHub\n" });
    github.state.duringBlobRead = async () => {
      await as(() => disconnectSource.run({ databaseId: database.id }));
    };

    await expect(
      as(() => syncFolder.run({ databaseId: database.id })),
    ).rejects.toThrow("isn't linked to a GitHub folder");
    // Disconnecting clears each page's file path, so compare by page.
    const bodies = (pages: Awaited<ReturnType<typeof liveRows>>) =>
      pages
        .map((row) => [row.documentId, row.content])
        .sort(([a], [b]) => (a! < b! ? -1 : 1));
    const after = await liveRows(database.id);
    expect(bodies(after)).toEqual(bodies(before));
    expect(after.every((row) => row.sourceMode === null)).toBe(true);
  });

  it("skips a file that isn't UTF-8 text and syncs the rest", async () => {
    github.commit({
      "docs/good.md": "# Good\n",
      "docs/bad.md": "BINARY",
    });
    const database = await newCollection();
    const linked = await as(() =>
      linkFolder.run({ databaseId: database.id, url: FOLDER_URL }),
    );
    expect(linked.sync).toMatchObject({ state: "synced", created: 1 });
    expect((await liveRows(database.id)).map((row) => row.title)).toEqual([
      "Good",
    ]);
    const status = await as(() => getSource.run({ databaseId: database.id }));
    expect(status.source?.metadata.github?.skipped).toEqual([
      { path: "bad.md", reason: "not-text" },
    ]);
  });

  it("adds images once file storage is set up, without a new commit", async () => {
    github.state.noStorage = true;
    github.commit(BASE_FILES);
    const database = await newCollection();
    const preview = await as(() =>
      linkFolder.run({
        databaseId: database.id,
        url: FOLDER_URL,
        dryRun: true,
      }),
    );
    expect(preview.preview).toMatchObject({ images: 1, storageReady: false });
    expect(preview.summary).toContain(
      "won't show until file storage is set up",
    );

    const linked = await as(() =>
      linkFolder.run({ databaseId: database.id, url: FOLDER_URL }),
    );
    expect(linked.sync).toMatchObject({
      state: "synced",
      created: 3,
      imagesWaiting: 1,
      problem: { code: "storage_unavailable" },
    });
    const guideBefore = (await liveRows(database.id)).find(
      (row) => row.sourcePath === "docs/getting-started.md",
    )!;
    expect(guideBefore.content).not.toContain("files.example.test");
    const waiting = await as(() => getSource.run({ databaseId: database.id }));
    expect(waiting.source?.metadata.github).toMatchObject({
      imagesWaiting: 1,
      problem: { code: "storage_unavailable" },
    });

    const still = await as(() => syncFolder.run({ databaseId: database.id }));
    expect(still.sync).toMatchObject({
      state: "unchanged",
      imagesWaiting: 1,
      problem: { code: "storage_unavailable" },
    });

    github.state.noStorage = false;
    const filled = await as(() => syncFolder.run({ databaseId: database.id }));
    expect(filled.sync).toMatchObject({
      state: "synced",
      updated: 1,
      unchanged: 2,
      imagesWaiting: 0,
      problem: null,
    });
    const guide = (await liveRows(database.id)).find(
      (row) => row.sourcePath === "docs/getting-started.md",
    )!;
    expect(guide.documentId).toBe(guideBefore.documentId);
    expect(guide.content).toContain("https://files.example.test/1/diagram.png");
    const healthy = await as(() => getSource.run({ databaseId: database.id }));
    expect(healthy.source?.metadata.github).toMatchObject({
      imagesWaiting: 0,
      problem: null,
    });
    const settled = await as(() => syncFolder.run({ databaseId: database.id }));
    expect(settled.sync.state).toBe("unchanged");
  });

  it("keeps general source settings off a GitHub link, and disconnecting frees its pages", async () => {
    const { database } = await linkBaseFolder();
    const id = await sourceId(database.id);
    await expect(
      as(() =>
        attachSource.run({ databaseId: database.id, sourceType: "mock-local" }),
      ),
    ).rejects.toThrow("source settings can't change here");
    const [field] = await getDb()
      .select({ id: schema.contentDatabaseSourceFields.id })
      .from(schema.contentDatabaseSourceFields)
      .where(
        and(
          eq(schema.contentDatabaseSourceFields.sourceId, id),
          eq(schema.contentDatabaseSourceFields.mappingType, "property"),
        ),
      );
    await expect(
      as(() =>
        bindSourceField.run({
          databaseId: database.id,
          sourceFieldId: field!.id,
          propertyId: null,
        }),
      ),
    ).rejects.toThrow("source settings can't change here");

    const disconnected = await as(() =>
      disconnectSource.run({ databaseId: database.id }),
    );
    // Everyone reading the collection hears about it, not just the caller.
    expect(
      disconnectSource.changeResource?.(
        { databaseId: database.id },
        disconnected,
      ),
    ).toEqual({ resourceType: "document", resourceId: database.documentId });
    const pages = await liveRows(database.id);
    expect(pages).toHaveLength(3);
    expect(pages.every((page) => page.sourceMode === null)).toBe(true);
    await expect(
      as(() =>
        updateDocument.run({ id: pages[0]!.documentId, title: "Mine now" }),
      ),
    ).resolves.toBeTruthy();
  });

  it("leaves unlinked collections alone", async () => {
    const database = await newCollection();
    await expect(
      as(() => syncFolder.run({ databaseId: database.id })),
    ).rejects.toThrow("isn't linked to a GitHub folder");
    const [source] = await getDb()
      .select()
      .from(schema.contentDatabaseSources)
      .where(
        and(
          eq(schema.contentDatabaseSources.databaseId, database.id),
          isNull(schema.contentDatabaseSources.lastError),
        ),
      );
    expect(source).toBeUndefined();
  });
});

/** Makes a link look last checked `ms` ago. */
async function checkedAgo(databaseId: string, ms: number) {
  await getDb()
    .update(schema.contentDatabaseSources)
    .set({ lastRefreshedAt: new Date(Date.now() - ms).toISOString() })
    .where(eq(schema.contentDatabaseSources.databaseId, databaseId));
}

const EDITED_FAQ = "# Frequently asked\n\nAnswers moved to the forum.\n";

describe("GitHub folder freshness", () => {
  it("checks GitHub before a read once a link is a minute stale", async () => {
    const { database } = await linkBaseFolder();
    github.commit({ ...BASE_FILES, "docs/faq.md": EDITED_FAQ });

    // Checked moments ago: the read returns what Content has.
    const fresh = await as(() => getDatabase.run({ databaseId: database.id }));
    expect(JSON.stringify(fresh)).not.toContain("forum");
    expect(changes).toHaveLength(0);

    await checkedAgo(database.id, 2 * 60_000);
    const stale = await as(() => getDatabase.run({ databaseId: database.id }));
    expect(
      (await liveRows(database.id)).find(
        (row) => row.sourcePath === "docs/faq.md",
      )!.content,
    ).toContain("Answers moved to the forum.");
    expect(stale).not.toMatchObject({ available: false });
    expect(changes).toEqual([
      expect.objectContaining({
        source: "action",
        key: "sync-github-folder",
        resourceType: "document",
        resourceId: database.documentId,
      }),
    ]);
  });

  it("brings a stale GitHub page up to date when an agent reads it", async () => {
    const { database } = await linkBaseFolder();
    const faq = (await liveRows(database.id)).find(
      (row) => row.sourcePath === "docs/faq.md",
    )!;
    github.commit({ ...BASE_FILES, "docs/faq.md": EDITED_FAQ });
    await checkedAgo(database.id, 2 * 60_000);
    const page = await as(() => getDocument.run({ id: faq.documentId }));
    expect(page.content).toContain("Answers moved to the forum.");
  });

  it("answers a read from what Content has when GitHub fails", async () => {
    const { database } = await linkBaseFolder();
    await checkedAgo(database.id, 2 * 60_000);
    github.state.failure = new Error("socket hang up");
    const read = await as(() => getDatabase.run({ databaseId: database.id }));
    expect(read).not.toMatchObject({ available: false });
    expect(await liveRows(database.id)).toHaveLength(3);
  });

  it("ends a GitHub read at the time budget, and the next read carries on", async () => {
    github.commit({
      "docs/1.md": "# One\n",
      "docs/2.md": "# Two\n",
      "docs/3.md": "# Three\n",
    });
    const database = await newCollection();
    await as(() =>
      linkFolder.run({ databaseId: database.id, url: FOLDER_URL }),
    );
    github.commit({
      "docs/1.md": "# One, edited\n",
      "docs/2.md": "# Two, edited\n",
      "docs/3.md": "# Three, edited\n",
    });
    await checkedAgo(database.id, 2 * 60_000);
    const id = await sourceId(database.id);
    github.state.blobReads = 0;
    github.state.hangAfterBlobReads = 1;

    const started = Date.now();
    const partial = await as(() =>
      syncGitHubSource({ sourceId: id, budgetMs: 1_500 }),
    );
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(partial).toMatchObject({
      state: "partial",
      updated: 1,
      remaining: 2,
      problem: null,
    });

    // Partway isn't a finished check, so the next read finishes the push.
    github.state.hangAfterBlobReads = null;
    await as(() => getDatabase.run({ databaseId: database.id }));
    expect((await liveRows(database.id)).map((row) => row.title)).toEqual([
      "One, edited",
      "Two, edited",
      "Three, edited",
    ]);
  });

  it("counts on from the last run while a push takes several, and tells readers each step", async () => {
    github.commit({
      "docs/1.md": "# One\n",
      "docs/2.md": "# Two\n",
      "docs/3.md": "# Three\n",
    });
    const database = await newCollection();
    await as(() =>
      linkFolder.run({ databaseId: database.id, url: FOLDER_URL }),
    );
    // A push that touches every file but leaves each page as it was, and
    // adds one that's skipped. A skipped file has no row, so every run reads
    // it again.
    github.commit({
      "docs/0.md": "BINARY",
      "docs/1.md": "# One\n\n",
      "docs/2.md": "# Two\n\n",
      "docs/3.md": "# Three\n\n",
    });
    const id = await sourceId(database.id);
    const progress = async () => {
      const [source] = await getDb()
        .select({ metadataJson: schema.contentDatabaseSources.metadataJson })
        .from(schema.contentDatabaseSources)
        .where(eq(schema.contentDatabaseSources.id, id));
      return JSON.parse(source!.metadataJson).github?.progress;
    };
    github.state.blobReads = 0;
    github.state.hangAfterBlobReads = 2;
    const first = await as(() =>
      syncGitHubSource({ sourceId: id, budgetMs: 1_500 }),
    );
    expect(first).toMatchObject({ state: "partial", updated: 0, unchanged: 1 });
    expect(await progress()).toEqual({ done: 2, total: 4 });

    // The next run reads the skipped file again and gets one file further. No
    // row changes, but the status line moves on, so readers hear about it.
    github.state.blobReads = 0;
    changes.length = 0;
    await checkedAgo(database.id, 2 * 60_000);
    await as(() => getDatabase.run({ databaseId: database.id }));
    expect(await progress()).toEqual({ done: 3, total: 4 });
    expect(changes).toEqual([
      expect.objectContaining({
        key: "sync-github-folder",
        resourceType: "document",
        resourceId: database.documentId,
      }),
    ]);

    github.state.hangAfterBlobReads = null;
    await as(() => syncGitHubSource({ sourceId: id, budgetMs: 30_000 }));
    expect(await progress()).toBeNull();
  });

  it("answers a read when GitHub is too slow, then waits its turn without a problem", async () => {
    const { database } = await linkBaseFolder();
    github.commit({ ...BASE_FILES, "docs/faq.md": EDITED_FAQ });
    await checkedAgo(database.id, 2 * 60_000);
    github.state.hangHead = true;
    const faqContent = async () =>
      (await liveRows(database.id)).find(
        (row) => row.sourcePath === "docs/faq.md",
      )!.content;

    const started = Date.now();
    const read = await as(() => getDatabase.run({ databaseId: database.id }));
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(read).not.toMatchObject({ available: false });
    expect(await faqContent()).not.toContain("forum");
    const status = await as(() => getSource.run({ databaseId: database.id }));
    expect(status.source).toMatchObject({
      syncState: "linked",
      lastError: null,
    });
    expect(status.source?.metadata.github).toMatchObject({ problem: null });

    // Counted as a check: the next read doesn't wait on GitHub again.
    github.state.hangHead = false;
    await as(() => getDatabase.run({ databaseId: database.id }));
    expect(await faqContent()).not.toContain("forum");
  });

  it("syncs every stale link in the background as the person who linked it", async () => {
    const stale = await linkBaseFolder();
    const recent = await linkBaseFolder();
    const trashed = await linkBaseFolder();
    await getDb()
      .update(schema.documents)
      .set({ trashedAt: new Date().toISOString() })
      .where(eq(schema.documents.id, trashed.database.documentId));
    github.commit({ ...BASE_FILES, "docs/faq.md": EDITED_FAQ });
    await checkedAgo(stale.database.id, 2 * 60_000);
    await checkedAgo(trashed.database.id, 2 * 60_000);

    // No request context: the sweep supplies the linker's.
    await runGitHubSourceSweep({ deadlineAt: Date.now() + 60_000 });

    const faqOf = async (databaseId: string) =>
      (await liveRows(databaseId)).find(
        (row) => row.sourcePath === "docs/faq.md",
      )!.content;
    expect(await faqOf(stale.database.id)).toContain("forum");
    expect(await faqOf(recent.database.id)).not.toContain("forum");
    expect(await faqOf(trashed.database.id)).not.toContain("forum");
    expect(changes).toEqual([
      expect.objectContaining({
        source: "action",
        key: "sync-github-folder",
        owner,
        resourceType: "document",
        resourceId: stale.database.documentId,
      }),
    ]);

    // A sweep right after finds nothing due and sends nothing.
    changes.length = 0;
    await runGitHubSourceSweep({ deadlineAt: Date.now() + 60_000 });
    expect(changes).toHaveLength(0);
  });

  it("tells readers when a background sync finds or clears a problem", async () => {
    const { database } = await linkBaseFolder();
    const { GitHubSourceError } =
      await import("../server/lib/github-source-client.js");
    const sweepAgain = async () => {
      changes.length = 0;
      await checkedAgo(database.id, 2 * 60_000);
      await runGitHubSourceSweep({ deadlineAt: Date.now() + 60_000 });
    };
    const announced = [
      expect.objectContaining({
        key: "sync-github-folder",
        resourceType: "document",
        resourceId: database.documentId,
      }),
    ];

    github.state.failure = new GitHubSourceError(
      "connection",
      "GitHub no longer accepts the saved connection. Reconnect GitHub.",
      401,
    );
    await sweepAgain();
    expect(changes).toEqual(announced);

    // The same problem again leaves the status line as it was.
    await sweepAgain();
    expect(changes).toHaveLength(0);

    github.state.failure = null;
    await sweepAgain();
    expect(changes).toEqual(announced);
    const status = await as(() => getSource.run({ databaseId: database.id }));
    expect(status.source?.metadata.github).toMatchObject({ problem: null });

    // A failure GitHub doesn't name is a problem on the link all the same.
    github.state.failure = new Error("socket hang up");
    await sweepAgain();
    expect(changes).toEqual(announced);
    const failed = await as(() => getSource.run({ databaseId: database.id }));
    expect(failed.source?.metadata.github?.problem).toMatchObject({
      code: "unavailable",
    });
  });

  it("keeps sweeping after one link fails", async () => {
    const first = await linkBaseFolder();
    const second = await linkBaseFolder();
    await getDb()
      .update(schema.contentDatabaseSources)
      .set({ metadataJson: "not json" })
      .where(eq(schema.contentDatabaseSources.databaseId, first.database.id));
    github.commit({ ...BASE_FILES, "docs/faq.md": EDITED_FAQ });
    await checkedAgo(first.database.id, 2 * 60_000);
    await checkedAgo(second.database.id, 2 * 60_000);
    await runGitHubSourceSweep({ deadlineAt: Date.now() + 60_000 });
    expect(
      (await liveRows(second.database.id)).find(
        (row) => row.sourcePath === "docs/faq.md",
      )!.content,
    ).toContain("forum");
  });

  it("tells every reader of the collection when a sync changes rows", async () => {
    const { database } = await linkBaseFolder();
    github.commit({ ...BASE_FILES, "docs/faq.md": EDITED_FAQ });
    const synced = await as(() => syncFolder.run({ databaseId: database.id }));
    expect(
      syncFolder.changeResource?.({ databaseId: database.id }, synced),
    ).toEqual({
      resourceType: "document",
      resourceId: database.documentId,
    });
    const again = await as(() => syncFolder.run({ databaseId: database.id }));
    expect(
      syncFolder.changeResource?.({ databaseId: database.id }, again),
    ).toBeNull();
  });

  it("tells every reader when a sync changes only the status line", async () => {
    const { database } = await linkBaseFolder();
    const { GitHubSourceError } =
      await import("../server/lib/github-source-client.js");
    const announced = {
      resourceType: "document",
      resourceId: database.documentId,
    };
    const sync = () => as(() => syncFolder.run({ databaseId: database.id }));

    github.state.failure = new GitHubSourceError(
      "connection",
      "GitHub no longer accepts the saved connection. Reconnect GitHub.",
      401,
    );
    const failed = await sync();
    expect(failed.sync.problem).toMatchObject({ code: "connection" });
    expect(
      syncFolder.changeResource?.({ databaseId: database.id }, failed),
    ).toEqual(announced);

    // The same problem again leaves the status line as it was.
    const again = await sync();
    expect(
      syncFolder.changeResource?.({ databaseId: database.id }, again),
    ).toBeNull();

    github.state.failure = null;
    const recovered = await sync();
    expect(recovered.sync).toMatchObject({ state: "unchanged", problem: null });
    expect(
      syncFolder.changeResource?.({ databaseId: database.id }, recovered),
    ).toEqual(announced);
  });
});
