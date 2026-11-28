import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, asc, eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const writeAppStateMock = vi.hoisted(() => vi.fn(async () => undefined));
const listContentOrganizationMembershipsMock = vi.hoisted(() =>
  vi.fn(async () => [] as { orgId: string }[]),
);
vi.mock("@agent-native/core/application-state", async (importOriginal) => ({
  ...(await importOriginal()),
  writeAppState: writeAppStateMock,
}));
vi.mock("./_content-space-access.js", async (importOriginal) => ({
  ...(await importOriginal()),
  listContentOrganizationMemberships: listContentOrganizationMembershipsMock,
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `document-version-names-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "names-owner@example.com";
const OUTSIDER = "names-outsider@example.com";
const DOCUMENT_ID = "named-versions-document";
const FRONTEND = { caller: "frontend", userEmail: OWNER } as const;

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let nameDocumentVersion: typeof import("./name-document-version.js").default;
let compareDocumentVersions: typeof import("./compare-document-versions.js").default;
let getDocumentHistoryCheckpoint: typeof import("./get-document-history-checkpoint.js").default;
let listDocumentVersions: typeof import("./list-document-versions.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  ({ getDb, schema } = await import("../server/db/index.js"));
  nameDocumentVersion = (await import("./name-document-version.js")).default;
  compareDocumentVersions = (await import("./compare-document-versions.js"))
    .default;
  getDocumentHistoryCheckpoint = (
    await import("./get-document-history-checkpoint.js")
  ).default;
  listDocumentVersions = (await import("./list-document-versions.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
}, 60_000);

beforeEach(async () => {
  listContentOrganizationMembershipsMock.mockResolvedValue([]);
  writeAppStateMock.mockResolvedValue(undefined);
  await getDb().delete(schema.documentVersions);
  await getDb().delete(schema.documents);
  const now = new Date(Date.now() - 60_000).toISOString();
  await getDb().insert(schema.documents).values({
    id: DOCUMENT_ID,
    ownerEmail: OWNER,
    title: "Draft",
    content: "line one\nline two",
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  });
});

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

function asOwner<T>(run: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail: OWNER }, run);
}

function asOutsider<T>(run: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail: OUTSIDER }, run);
}

async function insertCheckpoint(args: {
  id: string;
  title?: string;
  content?: string;
  secondsAgo: number;
}) {
  const createdAt = new Date(Date.now() - args.secondsAgo * 1000).toISOString();
  await getDb()
    .insert(schema.documentVersions)
    .values({
      id: args.id,
      ownerEmail: OWNER,
      documentId: DOCUMENT_ID,
      title: args.title ?? "Draft",
      content: args.content ?? "line one\nline two",
      groupId: `group-${args.id}`,
      groupKind: "human_session",
      checkpointKind: "after",
      createdAt,
      updatedAt: createdAt,
    });
}

async function checkpointRows() {
  return getDb()
    .select()
    .from(schema.documentVersions)
    .where(
      and(
        eq(schema.documentVersions.ownerEmail, OWNER),
        eq(schema.documentVersions.documentId, DOCUMENT_ID),
      ),
    )
    .orderBy(asc(schema.documentVersions.createdAt));
}

async function setCurrentPage(title: string, content: string) {
  await getDb()
    .update(schema.documents)
    .set({ title, content, updatedAt: new Date().toISOString() })
    .where(eq(schema.documents.id, DOCUMENT_ID));
}

describe("naming the page as it is now", () => {
  it("saves one named checkpoint of the current page", async () => {
    const result = await asOwner(() =>
      nameDocumentVersion.run(
        { documentId: DOCUMENT_ID, name: "  Week  of Nov 17 " },
        FRONTEND,
      ),
    );

    expect(result.created).toBe(true);
    expect(result.checkpoint).toMatchObject({
      documentId: DOCUMENT_ID,
      title: "Draft",
      name: "Week of Nov 17",
      namedBy: OWNER,
      checkpointKind: "after",
    });
    const rows = await checkpointRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: result.checkpoint.id,
      content: "line one\nline two",
      operation: "name-document-version",
      name: "Week of Nov 17",
    });
    const [page] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, DOCUMENT_ID));
    expect(page.content).toBe("line one\nline two");
  });

  it("names the newest checkpoint when it already holds the current page", async () => {
    await insertCheckpoint({ id: "latest", secondsAgo: 30 });

    const result = await asOwner(() =>
      nameDocumentVersion.run(
        { documentId: DOCUMENT_ID, name: "Launch" },
        FRONTEND,
      ),
    );

    expect(result).toMatchObject({
      created: false,
      checkpoint: { id: "latest", name: "Launch" },
    });
    expect(await checkpointRows()).toHaveLength(1);

    await setCurrentPage("Final", "line one\nline 2 changed");
    const changed = await asOwner(() =>
      nameDocumentVersion.run(
        { documentId: DOCUMENT_ID, name: "After review" },
        FRONTEND,
      ),
    );
    expect(changed.created).toBe(true);
    const rows = await checkpointRows();
    expect(rows.map((row) => [row.id, row.name, row.title])).toEqual([
      ["latest", "Launch", "Draft"],
      [changed.checkpoint.id, "After review", "Final"],
    ]);
  });

  it("needs a name and edit access", async () => {
    await expect(
      asOwner(() =>
        nameDocumentVersion.run(
          { documentId: DOCUMENT_ID, name: "   " },
          FRONTEND,
        ),
      ),
    ).rejects.toMatchObject({
      errorCode: "DOCUMENT_VERSION_NAME_REQUIRED",
      statusCode: 400,
    });
    await expect(
      asOutsider(() =>
        nameDocumentVersion.run(
          { documentId: DOCUMENT_ID, name: "Mine" },
          { caller: "frontend", userEmail: OUTSIDER },
        ),
      ),
    ).rejects.toThrow();
    expect(await checkpointRows()).toHaveLength(0);
  });
});

describe("naming a saved version", () => {
  beforeEach(async () => {
    await insertCheckpoint({ id: "older", secondsAgo: 120 });
    await insertCheckpoint({ id: "newer", secondsAgo: 60 });
  });

  it("names, renames and clears a version", async () => {
    const named = await asOwner(() =>
      nameDocumentVersion.run(
        { documentId: DOCUMENT_ID, versionId: "older", name: "First pass" },
        FRONTEND,
      ),
    );
    expect(named).toMatchObject({
      created: false,
      checkpoint: { id: "older", name: "First pass", namedBy: OWNER },
    });

    const renamed = await asOwner(() =>
      nameDocumentVersion.run(
        { documentId: DOCUMENT_ID, versionId: "older", name: "first PASS" },
        FRONTEND,
      ),
    );
    expect(renamed.checkpoint.name).toBe("first PASS");

    const cleared = await asOwner(() =>
      nameDocumentVersion.run(
        { documentId: DOCUMENT_ID, versionId: "older", name: "" },
        FRONTEND,
      ),
    );
    expect(cleared.checkpoint).toMatchObject({
      id: "older",
      name: null,
      namedBy: null,
      namedAt: null,
    });
    expect((await checkpointRows()).map((row) => row.name)).toEqual([
      null,
      null,
    ]);
  });

  it("keeps names unique on a page, ignoring case", async () => {
    await asOwner(() =>
      nameDocumentVersion.run(
        { documentId: DOCUMENT_ID, versionId: "older", name: "Draft one" },
        FRONTEND,
      ),
    );
    await expect(
      asOwner(() =>
        nameDocumentVersion.run(
          { documentId: DOCUMENT_ID, versionId: "newer", name: "DRAFT ONE" },
          FRONTEND,
        ),
      ),
    ).rejects.toMatchObject({
      errorCode: "DOCUMENT_VERSION_NAME_TAKEN",
      statusCode: 409,
      details: { name: "DRAFT ONE", versionId: "older" },
    });
    await expect(
      asOwner(() =>
        nameDocumentVersion.run(
          { documentId: DOCUMENT_ID, name: "draft one" },
          FRONTEND,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "DOCUMENT_VERSION_NAME_TAKEN" });

    const settled = await Promise.allSettled(
      ["older", "newer"].map((versionId) =>
        asOwner(() =>
          nameDocumentVersion.run(
            { documentId: DOCUMENT_ID, versionId, name: "Same time" },
            FRONTEND,
          ),
        ),
      ),
    );
    expect(settled.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({
          errorCode: "DOCUMENT_VERSION_NAME_TAKEN",
        }),
      }),
    ]);
  });

  it("refuses a version of another page", async () => {
    const createdAt = new Date().toISOString();
    await getDb().insert(schema.documentVersions).values({
      id: "elsewhere",
      ownerEmail: OWNER,
      documentId: "another-document",
      title: "Other",
      content: "other",
      createdAt,
    });
    await expect(
      asOwner(() =>
        nameDocumentVersion.run(
          { documentId: DOCUMENT_ID, versionId: "elsewhere", name: "Borrowed" },
          FRONTEND,
        ),
      ),
    ).rejects.toMatchObject({
      errorCode: "DOCUMENT_CHECKPOINT_NOT_FOUND",
      statusCode: 404,
    });
  });
});

describe("reading and comparing versions", () => {
  beforeEach(async () => {
    await insertCheckpoint({ id: "before", secondsAgo: 120 });
    await insertCheckpoint({
      id: "after",
      title: "Final",
      content: "line one\nline 2 changed",
      secondsAgo: 60,
    });
    await setCurrentPage("Final", "line one\nline 2 changed");
    for (const [versionId, name] of [
      ["before", "Before review"],
      ["after", "After review"],
    ]) {
      await asOwner(() =>
        nameDocumentVersion.run(
          { documentId: DOCUMENT_ID, versionId, name },
          FRONTEND,
        ),
      );
    }
  });

  it("lists only named versions when asked", async () => {
    await insertCheckpoint({ id: "unnamed", secondsAgo: 30 });
    const result = await asOwner(() =>
      listDocumentVersions.run({
        documentId: DOCUMENT_ID,
        includeContent: false,
        namedOnly: true,
        limit: 100,
      }),
    );
    expect(
      result.versions.map((version) => [version.id, version.name]),
    ).toEqual([
      ["after", "After review"],
      ["before", "Before review"],
    ]);
  });

  it("reads a version by its name, ignoring case", async () => {
    const result = await asOwner(() =>
      getDocumentHistoryCheckpoint.run({
        documentId: DOCUMENT_ID,
        versionName: " before REVIEW ",
      }),
    );
    expect(result.checkpoint).toMatchObject({
      id: "before",
      name: "Before review",
      content: "line one\nline two",
    });
    await expect(
      asOwner(() =>
        getDocumentHistoryCheckpoint.run({
          documentId: DOCUMENT_ID,
          versionName: "Never named",
        }),
      ),
    ).rejects.toThrow("Checkpoint not found");
  });

  it("compares a named version with the current page and with another version", async () => {
    const withCurrent = await asOwner(() =>
      compareDocumentVersions.run({
        documentId: DOCUMENT_ID,
        fromVersionName: "before review",
      }),
    );
    expect(withCurrent).toMatchObject({
      from: { kind: "checkpoint", id: "before", name: "Before review" },
      to: { kind: "current", id: null, title: "Final" },
      identical: false,
      title: { before: "Draft", after: "Final" },
      body: { addedLineCount: 1, removedLineCount: 1 },
    });
    const changedLines = withCurrent.body?.hunks.flatMap((hunk) =>
      hunk.lines.filter((line) => line.kind !== "same"),
    );
    expect(changedLines?.map((line) => [line.kind, line.text])).toEqual([
      ["removed", "line two"],
      ["added", "line 2 changed"],
    ]);

    const betweenVersions = await asOwner(() =>
      compareDocumentVersions.run({
        documentId: DOCUMENT_ID,
        fromVersionId: "before",
        toVersionName: "After review",
      }),
    );
    expect(betweenVersions.to).toMatchObject({
      kind: "checkpoint",
      id: "after",
    });
    expect(betweenVersions.body).toEqual(withCurrent.body);

    const unchanged = await asOwner(() =>
      compareDocumentVersions.run({
        documentId: DOCUMENT_ID,
        fromVersionName: "After review",
      }),
    );
    expect(unchanged).toMatchObject({
      identical: true,
      title: null,
      body: null,
    });
  });

  it("keeps versions private to people with access to the page", async () => {
    await expect(
      asOutsider(() =>
        compareDocumentVersions.run({
          documentId: DOCUMENT_ID,
          fromVersionId: "before",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      asOutsider(() =>
        getDocumentHistoryCheckpoint.run({
          documentId: DOCUMENT_ID,
          versionName: "Before review",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      asOwner(() => compareDocumentVersions.run({ documentId: DOCUMENT_ID })),
    ).rejects.toMatchObject({
      errorCode: "DOCUMENT_CHECKPOINT_REFERENCE_REQUIRED",
    });
  });
});
