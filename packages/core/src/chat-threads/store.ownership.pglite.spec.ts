import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { storeLedgerResult } from "../db/store-ledger.test-helpers.js";
import { runWithRequestContext } from "../server/request-context.js";

// Real PGlite behind getDbExec so the ownership filter, the ACL, and the
// access-basis projection run their genuine SQL, including LIMIT/OFFSET.
let pglite: Awaited<ReturnType<typeof createTestPglite>>;
const membershipQueries: string[] = [];
const renameRace = vi.hoisted(() => ({ enabled: false }));
const renameLineageRace = vi.hoisted(() => ({
  insert: false,
  deleteRoot: false,
}));
const deleteRace = vi.hoisted(() => ({ enabled: false, deleteRoot: false }));
const federation = vi.hoisted(() => ({
  enabled: vi.fn(async () => true),
  validate: vi.fn(async () => ({ active: true, role: "member" })),
}));

vi.mock("../feature-flags/store.js", () => ({
  evaluateFeatureFlagStrict: federation.enabled,
}));
vi.mock("../org/federation.js", () => ({
  validateFederatedOrganizationMembershipForCurrentRequest: federation.validate,
}));
vi.mock("../db/create-get-db.js", () => ({
  createGetDb: () => () =>
    drizzle(pglite.db, {
      logger: {
        logQuery(query) {
          if (query.includes('from "org_members"'))
            membershipQueries.push(query);
        },
      },
    }),
}));

vi.mock("../db/client.js", () => ({
  getScopedDbExec: () => undefined,
  getDbExec: () => ({
    execute: async (input: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof input === "string" ? input : input.sql;
      const ledger = storeLedgerResult(sql);
      if (ledger) return ledger;
      if (/FROM information_schema\.columns/i.test(sql)) {
        return { rows: [], rowsAffected: 0 };
      }
      if (typeof input === "string") {
        await pglite.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const args = (input.args ?? []) as unknown[];
      if (/^\s*(SELECT|WITH)\b/i.test(sql)) {
        return {
          rows: await pglite.prepare(sql).all(...args),
          rowsAffected: 0,
        };
      }
      const { changes } = await pglite.prepare(sql).run(...args);
      return { rows: [], rowsAffected: changes };
    },
    transaction: async <T>(fn: Parameters<typeof pglite.transaction<T>>[0]) => {
      if (renameLineageRace.insert) {
        renameLineageRace.insert = false;
        await pglite.query(
          `INSERT INTO chat_threads (id, owner_email, title, preview, thread_data, message_count, created_at, updated_at, source_app_id, edit_root_id, edit_prefix_count) VALUES (?, ?, 'Old title', '', ?, 1, 20, 20, 'app', ?, 0)`,
          [
            "rename-race-child",
            "rename-race@example.com",
            '{"messages":[{"id":"new-question"}]}',
            "rename-race-root",
          ],
        );
      }
      if (renameLineageRace.deleteRoot) {
        renameLineageRace.deleteRoot = false;
        await pglite.query(`DELETE FROM chat_threads WHERE id = ?`, [
          "rename-vanished-root",
        ]);
      }
      if (deleteRace.deleteRoot) {
        deleteRace.deleteRoot = false;
        await pglite.query(`DELETE FROM chat_threads WHERE id = ?`, [
          "edit-race-root",
        ]);
      }
      if (deleteRace.enabled) {
        deleteRace.enabled = false;
        await pglite.query(
          `INSERT INTO chat_threads (id, owner_email, title, preview, thread_data, message_count, created_at, updated_at, source_app_id, edit_root_id, edit_prefix_count) VALUES (?, ?, '', '', '{}', 2, 20, 20, 'app', ?, 1)`,
          ["race-child", "race@example.com", "race-root"],
        );
      }
      return pglite.transaction(async (tx) =>
        fn({
          ...tx,
          execute: async (input) => {
            if (
              renameRace.enabled &&
              typeof input !== "string" &&
              "sql" in input &&
              input.sql.startsWith("UPDATE chat_threads SET thread_data = ?")
            ) {
              renameRace.enabled = false;
              const args = input.args ?? [];
              await tx.execute({
                sql: "UPDATE chat_threads SET thread_data = ? WHERE id = ?",
                args: ['{"messages":[{"id":"new"}]}', args[3]],
              });
            }
            return tx.execute(input);
          },
        }),
      );
    },
  }),
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExists: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./emitter.js", () => ({ emitChatThreadChange: vi.fn() }));

const {
  listThreads,
  searchThreads,
  resolveThreadsAccess,
  setThreadPinned,
  setThreadArchived,
  renameThread,
  deleteThread,
  forkThread,
  getThread,
} = await import("./store.js");

const ME = "Me@Example.com";
const ORG = "org-1";

interface SeedThread {
  id: string;
  owner: string;
  updatedAt: number;
  visibility?: "private" | "org";
  orgId?: string | null;
  title?: string;
  /** Provenance: which app wrote this thread. Null models a legacy row. */
  sourceAppId?: string | null;
}

async function seed(thread: SeedThread) {
  await pglite.query(
    `INSERT INTO chat_threads (id, owner_email, title, preview, thread_data, message_count, created_at, updated_at, org_id, visibility, source_app_id)
     VALUES (?, ?, ?, '', '{}', 1, ?, ?, ?, ?, ?)`,
    [
      thread.id,
      thread.owner,
      thread.title ?? "Quarterly plan",
      thread.updatedAt,
      thread.updatedAt,
      thread.orgId ?? null,
      thread.visibility ?? "private",
      thread.sourceAppId ?? null,
    ],
  );
}

async function share(
  threadId: string,
  principalType: "user" | "org",
  principalId: string,
  role: "viewer" | "admin" = "viewer",
) {
  await pglite.query(
    `INSERT INTO chat_thread_shares (id, resource_id, principal_type, principal_id, role, created_by)
     VALUES (?, ?, ?, ?, ?, 'seed')`,
    [
      `${threadId}:${principalType}:${principalId}`,
      threadId,
      principalType,
      principalId,
      role,
    ],
  );
}

describe("chat thread ownership lists (real SQL)", () => {
  beforeAll(async () => {
    pglite = await createTestPglite();
    await pglite.exec(`
      CREATE TABLE chat_threads (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        preview TEXT NOT NULL DEFAULT '',
        thread_data TEXT NOT NULL DEFAULT '{}',
        message_count BIGINT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        scope_type TEXT, scope_id TEXT, scope_label TEXT,
        pinned_at BIGINT, archived_at BIGINT, share_token_hash TEXT,
        source_platform TEXT, source_app_id TEXT, source_url TEXT,
        org_id TEXT, edit_root_id TEXT, edit_prefix_count BIGINT,
        visibility TEXT NOT NULL DEFAULT 'private'
      );
      CREATE TABLE chat_thread_shares (
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL,
        principal_type TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT '',
        notified_at TEXT
      );
      CREATE TABLE agent_chat_submission_inbox (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL
      );
      CREATE TABLE organizations (
        id TEXT PRIMARY KEY, identity_authority TEXT, identity_id TEXT
      );
      CREATE TABLE org_members (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
        role TEXT NOT NULL, federation_removal_pending_at BIGINT
      );
    `);

    // Mine: owned private, and owned org-visible (still mine).
    await seed({ id: "mine-private", owner: "me@example.com", updatedAt: 100 });
    await seed({
      id: "mine-org",
      owner: "ME@EXAMPLE.COM",
      updatedAt: 90,
      visibility: "org",
      orgId: ORG,
    });
    // Shared with me by name, with the stored principal in another case.
    await seed({ id: "direct", owner: "ann@example.com", updatedAt: 95 });
    await share("direct", "user", "ME@example.COM", "admin");
    // Organization only.
    await seed({
      id: "org-visible",
      owner: "bob@example.com",
      updatedAt: 85,
      visibility: "org",
      orgId: ORG,
    });
    await seed({ id: "org-grant", owner: "cy@example.com", updatedAt: 80 });
    await share("org-grant", "org", ORG);
    // Both: the direct grant outranks organization visibility.
    await seed({
      id: "direct-and-org",
      owner: "dee@example.com",
      updatedAt: 75,
      visibility: "org",
      orgId: ORG,
    });
    await share("direct-and-org", "user", "me@example.com");
    // Not accessible: other org, other person's grant, no grant.
    await seed({
      id: "other-org",
      owner: "eve@example.com",
      updatedAt: 70,
      visibility: "org",
      orgId: "org-2",
    });
    await seed({
      id: "other-org-grant",
      owner: "eve@example.com",
      updatedAt: 65,
    });
    await share("other-org-grant", "org", "org-2");
    await seed({
      id: "someone-elses",
      owner: "eve@example.com",
      updatedAt: 60,
    });
    await share("someone-elses", "user", "fay@example.com");
    await seed({
      id: "private-other",
      owner: "eve@example.com",
      updatedAt: 55,
    });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    federation.enabled.mockResolvedValue(true);
    federation.validate.mockResolvedValue({ active: true, role: "member" });
    await pglite.exec(`
      DELETE FROM org_members;
      DELETE FROM organizations;
      INSERT INTO organizations (id) VALUES ('org-1'), ('org-2');
      INSERT INTO org_members (id, org_id, email, role)
        VALUES ('me', 'org-1', 'ME@example.COM', 'admin');
    `);
    membershipQueries.length = 0;
  });

  afterAll(async () => {
    await pglite.close();
  });

  const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);

  it("collapses eligible edits before paging and preserves the group pin", async () => {
    const owner = "edits@example.com";
    await seed({ id: "edit-root", owner, updatedAt: 1, sourceAppId: "app" });
    await pglite.query(`UPDATE chat_threads SET pinned_at = 5 WHERE id = ?`, [
      "edit-root",
    ]);
    for (let i = 0; i < 65; i++) {
      await seed({
        id: `edit-${i}`,
        owner,
        updatedAt: 10 + i,
        sourceAppId: "app",
      });
      await pglite.query(
        `UPDATE chat_threads SET edit_root_id = ?, edit_prefix_count = 1, message_count = 2 WHERE id = ?`,
        ["edit-root", `edit-${i}`],
      );
    }
    await pglite.query(
      `UPDATE chat_threads SET updated_at = 500 WHERE id = ?`,
      ["edit-root"],
    );
    await seed({
      id: "edit-pending",
      owner,
      updatedAt: 1000,
      sourceAppId: "app",
    });
    await pglite.query(
      `UPDATE chat_threads SET edit_root_id = ?, edit_prefix_count = 1 WHERE id = ?`,
      ["edit-root", "edit-pending"],
    );
    await seed({ id: "another", owner, updatedAt: 900, sourceAppId: "app" });
    const collapsed = await listThreads(owner, {
      limit: 2,
      collapseEdits: true,
    });
    expect(ids(collapsed)).toEqual(["edit-64", "another"]);
    expect(collapsed[0]?.pinnedAt).toBe(5);
    expect(collapsed[0]?.editRootId).toBe("edit-root");
    const raw = await listThreads(owner, { limit: 2 });
    expect(ids(raw)).toEqual(["edit-root", "edit-pending"]);
    expect(
      await setThreadPinned("edit-64", false, {
        ownerEmail: owner,
        collapseEdits: true,
      }),
    ).toBe(true);
    expect(
      ids(await listThreads(owner, { limit: 2, collapseEdits: true })),
    ).toEqual(["another", "edit-64"]);
    expect(
      await setThreadArchived("edit-64", true, {
        ownerEmail: owner,
        collapseEdits: true,
      }),
    ).toBe(true);
    expect(ids(await listThreads(owner, { collapseEdits: true }))).toEqual([
      "another",
    ]);
    expect(
      await setThreadArchived("edit-64", false, {
        ownerEmail: owner,
        collapseEdits: true,
      }),
    ).toBe(true);
    expect(ids(await listThreads(owner, { collapseEdits: true }))).toEqual([
      "another",
      "edit-64",
    ]);
  });

  it("separates lineages by app, organization, and scope", async () => {
    const owner = "partitions@example.com";
    for (const [id, app, org, scope] of [
      ["partition-root", "app", "org-1", "one"],
      ["partition-same", "app", "org-1", "one"],
      ["partition-other-app", "other", "org-1", "one"],
      ["partition-other-org", "app", "org-2", "one"],
      ["partition-other-scope", "app", "org-1", "two"],
    ]) {
      await seed({
        id,
        owner,
        updatedAt: id === "partition-same" ? 10 : 5,
        sourceAppId: app,
        orgId: org,
      });
      await pglite.query(
        `UPDATE chat_threads SET scope_type = 'workspace', scope_id = ?, edit_root_id = ?, edit_prefix_count = 0 WHERE id = ?`,
        [scope, id === "partition-root" ? null : "partition-root", id],
      );
    }
    const rows = await listThreads(owner, { collapseEdits: true });
    expect(ids(rows).sort()).toEqual(
      [
        "partition-other-app",
        "partition-other-org",
        "partition-other-scope",
        "partition-same",
      ].sort(),
    );
    const search = await searchThreads(owner, "Quarterly", 20, {
      collapseEdits: true,
    });
    expect(ids(search).sort()).toEqual(ids(rows).sort());
    await setThreadPinned("partition-same", true, {
      ownerEmail: owner,
      collapseEdits: true,
    });
    await setThreadArchived("partition-same", true, {
      ownerEmail: owner,
      collapseEdits: true,
    });
    const left = await listThreads(owner, { collapseEdits: true });
    expect(ids(left).sort()).toEqual(
      [
        "partition-other-app",
        "partition-other-org",
        "partition-other-scope",
      ].sort(),
    );
    expect(left.every((row) => row.pinnedAt === null)).toBe(true);
  });

  it("deletes an edit committed immediately before the delete transaction", async () => {
    await seed({
      id: "race-root",
      owner: "race@example.com",
      updatedAt: 1,
      sourceAppId: "app",
    });
    deleteRace.enabled = true;
    expect(
      await deleteThread("race-root", "race@example.com", {
        collapseEdits: true,
      }),
    ).toBe(true);
    expect(
      ids(await listThreads("race@example.com", { collapseEdits: true })),
    ).toEqual([]);
  });

  it("rejects an edit if its root disappeared before the transaction", async () => {
    const owner = "edit-race@example.com";
    await seed({
      id: "edit-race-root",
      owner,
      updatedAt: 1,
      sourceAppId: "app",
    });
    await seed({
      id: "edit-race-source",
      owner,
      updatedAt: 2,
      sourceAppId: "app",
    });
    const data = { messages: [{ id: "question", role: "user", parts: [] }] };
    await pglite.query(
      `UPDATE chat_threads SET edit_root_id = ?, edit_prefix_count = 0, thread_data = ? WHERE id = ?`,
      ["edit-race-root", JSON.stringify(data), "edit-race-source"],
    );
    deleteRace.deleteRoot = true;
    const fork = await forkThread("edit-race-source", owner, {
      id: "edit-race-new",
      forkPurpose: "edit",
      trustedAppId: "app",
      source: { threadData: JSON.stringify(data), beforeMessageId: "question" },
    });
    expect(fork).toBeNull();
    expect(
      (
        await pglite.query(`SELECT id FROM chat_threads WHERE id = ?`, [
          "edit-race-new",
        ])
      ).rows,
    ).toEqual([]);
  });

  it.each([
    {
      name: "ordinary fork without destination",
      edit: false,
      target: null,
      expectedSource: null,
      rooted: false,
    },
    {
      name: "ordinary fork with local destination",
      edit: false,
      target: { appId: "app-b" },
      expectedSource: { appId: "app-b" },
      rooted: false,
    },
    {
      name: "trusted edit without explicit destination",
      edit: true,
      target: null,
      expectedSource: { appId: "app-a" },
      rooted: true,
    },
    {
      name: "trusted edit with matching destination",
      edit: true,
      target: { appId: "app-a" },
      expectedSource: { appId: "app-a" },
      rooted: true,
    },
    {
      name: "edit targeting another app",
      edit: true,
      target: { appId: "app-b" },
      expectedSource: { appId: "app-b" },
      rooted: false,
    },
    {
      name: "edit targeting an external platform",
      edit: true,
      target: { appId: "app-a", platform: "external" },
      expectedSource: { appId: "app-a", platform: "external" },
      rooted: false,
    },
  ])(
    "preserves destination attribution and edit isolation: $name",
    async ({ name, edit, target, expectedSource, rooted }) => {
      const rootId = `destination-${name.replaceAll(" ", "-")}-root`;
      const childId = `${rootId}-child`;
      const owner = "destination-owner@example.test";
      const data = { messages: [{ id: "question", role: "user", parts: [] }] };
      await seed({ id: rootId, owner, updatedAt: 1, sourceAppId: "app-a" });
      await pglite.query(
        `UPDATE chat_threads SET thread_data = ? WHERE id = ?`,
        [JSON.stringify(data), rootId],
      );
      const fork = await forkThread(rootId, owner, {
        id: childId,
        ...(edit
          ? { forkPurpose: "edit" as const, trustedAppId: "app-a" }
          : {}),
        ...(target ? { targetSource: target } : {}),
        source: {
          threadData: JSON.stringify(data),
          beforeMessageId: "question",
        },
      });
      expect(fork).not.toBeNull();
      expect(fork?.editRootId).toBe(rooted ? rootId : undefined);
      const normalizeSource = (
        value:
          | {
              appId?: string | null;
              platform?: string | null;
              url?: string | null;
            }
          | null
          | undefined,
      ) =>
        value
          ? {
              appId: value.appId ?? null,
              platform: value.platform ?? null,
              url: value.url ?? null,
            }
          : null;
      expect(normalizeSource(fork?.source)).toEqual(
        normalizeSource(expectedSource),
      );
      const saved = await getThread(childId);
      expect(normalizeSource(saved?.source)).toEqual(
        normalizeSource(expectedSource),
      );
      expect(saved?.editRootId).toBe(rooted ? rootId : undefined);
    },
  );

  // The ALS request boundary installs tracking scope only, so an ordinary HTTP
  // request has no request org. The route resolves the owner's org from the
  // event and must pass it; otherwise an org-scoped edit fork compares against
  // null and stores edit_root_id = NULL, which shows one edit as its own row.
  it("groups an org-scoped edit under its root when the route supplies the org", async () => {
    const owner = "org-edit-owner@example.test";
    const rootId = "org-edit-root";
    const childId = "org-edit-child";
    const data = { messages: [{ id: "question", role: "user", parts: [] }] };
    await seed({
      id: rootId,
      owner,
      orgId: "acme",
      updatedAt: 1,
      sourceAppId: "app-a",
    });
    await pglite.query(`UPDATE chat_threads SET thread_data = ? WHERE id = ?`, [
      JSON.stringify(data),
      rootId,
    ]);
    const fork = await runWithRequestContext(
      { userEmail: owner, orgId: "acme" },
      () =>
        forkThread(rootId, owner, {
          id: childId,
          forkPurpose: "edit",
          trustedAppId: "app-a",
          targetSource: { appId: "app-a" },
          sourceAccessGranted: true,
          source: {
            threadData: JSON.stringify(data),
            beforeMessageId: "question",
          },
        }),
    );
    expect(fork?.editRootId).toBe(rootId);
    expect((await getThread(childId))?.editRootId).toBe(rootId);
  });

  it("leaves an org-scoped edit ungrouped when neither the route nor the request supplies the org", async () => {
    const owner = "org-edit-miss@example.test";
    const rootId = "org-edit-miss-root";
    const childId = "org-edit-miss-child";
    const data = { messages: [{ id: "question", role: "user", parts: [] }] };
    await seed({
      id: rootId,
      owner,
      orgId: "acme",
      updatedAt: 1,
      sourceAppId: "app-a",
    });
    await pglite.query(`UPDATE chat_threads SET thread_data = ? WHERE id = ?`, [
      JSON.stringify(data),
      rootId,
    ]);
    const fork = await forkThread(rootId, owner, {
      id: childId,
      forkPurpose: "edit",
      trustedAppId: "app-a",
      targetSource: { appId: "app-a" },
      sourceAccessGranted: true,
      source: { threadData: JSON.stringify(data), beforeMessageId: "question" },
    });
    expect(fork?.editRootId).toBeUndefined();
  });

  it.each(["actor", "organization"] as const)(
    "keeps a destination-attributed edit separate across %s",
    async (boundary) => {
      const owner = "edit-destination-owner@example.test";
      const rootId = `destination-boundary-${boundary}`;
      const childId = `${rootId}-child`;
      const data = { messages: [{ id: "question", role: "user", parts: [] }] };
      await seed({
        id: rootId,
        owner: boundary === "actor" ? "source-owner@example.test" : owner,
        orgId: boundary === "organization" ? "other-organization" : null,
        updatedAt: 1,
        sourceAppId: "app-a",
      });
      await pglite.query(
        `UPDATE chat_threads SET thread_data = ? WHERE id = ?`,
        [JSON.stringify(data), rootId],
      );
      const fork = await forkThread(rootId, owner, {
        id: childId,
        forkPurpose: "edit",
        trustedAppId: "app-a",
        targetSource: { appId: "app-a" },
        sourceAccessGranted: true,
        source: {
          threadData: JSON.stringify(data),
          beforeMessageId: "question",
        },
      });
      expect(fork).not.toBeNull();
      expect(fork?.editRootId).toBeUndefined();
      expect(fork?.source).toEqual({ appId: "app-a" });
      expect((await getThread(childId))?.editRootId).toBeUndefined();
    },
  );

  it("inserts a locked owned edit that grouped deletion removes", async () => {
    const owner = "locked-edit@example.com";
    const data = { messages: [{ id: "question", role: "user", parts: [] }] };
    await seed({ id: "locked-root", owner, updatedAt: 1, sourceAppId: "app" });
    await pglite.query(`UPDATE chat_threads SET thread_data = ? WHERE id = ?`, [
      JSON.stringify(data),
      "locked-root",
    ]);
    const fork = await forkThread("locked-root", owner, {
      id: "locked-child",
      forkPurpose: "edit",
      trustedAppId: "app",
      source: { threadData: JSON.stringify(data), beforeMessageId: "question" },
    });
    expect(fork?.editRootId).toBe("locked-root");
    expect(
      await deleteThread("locked-root", owner, { collapseEdits: true }),
    ).toBe(true);
    expect(
      (
        await pglite.query(`SELECT id FROM chat_threads WHERE id = ?`, [
          "locked-child",
        ])
      ).rows,
    ).toEqual([]);
  });

  it("renames an edit committed immediately before the rename transaction", async () => {
    const owner = "rename-race@example.com";
    await seed({
      id: "rename-race-root",
      owner,
      updatedAt: 1,
      sourceAppId: "app",
    });
    renameLineageRace.insert = true;
    expect(
      await renameThread("rename-race-root", "New title", {
        ownerEmail: owner,
        collapseEdits: true,
      }),
    ).toBe(true);
    expect(renameLineageRace.insert).toBe(false);
    const { rows } = await pglite.query(
      `SELECT id, title, thread_data FROM chat_threads WHERE owner_email = ? ORDER BY id`,
      [owner],
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.title).toBe("New title");
      expect(JSON.parse(String(row.thread_data))._titleOverride).toBe(
        "New title",
      );
    }
    expect(JSON.parse(String(rows[0]?.thread_data)).messages).toEqual([
      { id: "new-question" },
    ]);
  });

  it("declines grouped rename if its root disappeared before the transaction", async () => {
    const owner = "rename-race@example.com";
    for (const id of ["rename-vanished-root", "rename-vanished-child"]) {
      await seed({ id, owner, updatedAt: 1, sourceAppId: "app" });
    }
    await pglite.query(
      `UPDATE chat_threads SET edit_root_id = ? WHERE id = ?`,
      ["rename-vanished-root", "rename-vanished-child"],
    );
    renameLineageRace.deleteRoot = true;
    expect(
      await renameThread("rename-vanished-child", "New title", {
        ownerEmail: owner,
        collapseEdits: true,
      }),
    ).toBe(false);
    expect(renameLineageRace.deleteRoot).toBe(false);
    const { rows } = await pglite.query(
      `SELECT title FROM chat_threads WHERE id = ?`,
      ["rename-vanished-child"],
    );
    expect(rows[0]?.title).toBe("Quarterly plan");
  });

  it("deletes only owned lineage members", async () => {
    const owner = "lifecycle@example.com";
    for (const id of ["life-root", "life-edit", "life-unrelated"]) {
      await seed({ id, owner, updatedAt: 5, sourceAppId: "app" });
      await pglite.query(
        `UPDATE chat_threads SET thread_data = ? WHERE id = ?`,
        [
          JSON.stringify({
            messages: [{ id, role: "user", content: "unchanged" }],
            agentKit: {
              runs: [{ id: `run-${id}`, state: { payload: "unchanged" } }],
            },
          }),
          id,
        ],
      );
    }
    await pglite.query(
      `UPDATE chat_threads SET edit_root_id = ?, edit_prefix_count = 0 WHERE id = ?`,
      ["life-root", "life-edit"],
    );
    renameRace.enabled = true;
    await expect(
      renameThread("life-edit", "Conflict", {
        ownerEmail: owner,
        collapseEdits: true,
      }),
    ).rejects.toThrow("Concurrent chat thread write");
    const afterConflict = await pglite.query(
      `SELECT thread_data FROM chat_threads WHERE id = ?`,
      ["life-edit"],
    );
    expect(
      JSON.parse(String(afterConflict.rows[0]?.thread_data)).messages,
    ).toEqual([{ id: "life-edit", role: "user", content: "unchanged" }]);
    expect(
      await renameThread("life-edit", "Renamed", {
        ownerEmail: owner,
        collapseEdits: true,
      }),
    ).toBe(true);
    const { rows } = await pglite.query(
      `SELECT id, title, thread_data FROM chat_threads WHERE owner_email = ? ORDER BY id`,
      [owner],
    );
    for (const row of rows as Array<{
      id: string;
      title: string;
      thread_data: string;
    }>) {
      expect(row.title).toBe(
        row.id === "life-unrelated" ? "Quarterly plan" : "Renamed",
      );
      expect(JSON.parse(row.thread_data).messages).toEqual([
        { id: row.id, role: "user", content: "unchanged" },
      ]);
      expect(JSON.parse(row.thread_data).agentKit.runs).toEqual([
        { id: `run-${row.id}`, state: { payload: "unchanged" } },
      ]);
    }
    expect(
      await deleteThread("life-edit", owner, { collapseEdits: true }),
    ).toBe(true);
    expect(ids(await listThreads(owner))).toEqual(["life-unrelated"]);
  });

  it("mine is ownership alone, so an org-visible chat I own stays mine", async () => {
    const rows = await listThreads(ME, { orgId: ORG, ownership: "mine" });
    expect(ids(rows)).toEqual(["mine-private", "mine-org"]);
    expect(rows.every((row) => row.accessBasis === "owner")).toBe(true);
  });

  it("shared is accessible chats owned by someone else, with direct beating organization", async () => {
    const rows = await listThreads(ME, { orgId: ORG, ownership: "shared" });
    expect(
      rows.map((row) => [row.id, row.accessBasis, row.ownerEmail]),
    ).toEqual([
      ["direct", "direct", "ann@example.com"],
      ["org-visible", "organization", "bob@example.com"],
      ["org-grant", "organization", "cy@example.com"],
      ["direct-and-org", "direct", "dee@example.com"],
    ]);
  });

  it("shared never widens access: cross-org and ungranted chats stay hidden", async () => {
    const all = await listThreads(ME, { orgId: ORG, ownership: "all" });
    expect(ids(all)).not.toContain("other-org");
    expect(ids(all)).not.toContain("other-org-grant");
    expect(ids(all)).not.toContain("someone-elses");
    expect(ids(all)).not.toContain("private-other");
    expect(ids(all)).toHaveLength(6);
  });

  it("checks membership once for an active member's batch", async () => {
    const threads = await resolveThreadsAccess(
      ` ${ME} `,
      ["mine-org", "direct", "org-visible", "org-grant", "other-org"],
      { orgId: ORG },
    );
    expect([...threads.keys()].sort()).toEqual([
      "direct",
      "mine-org",
      "org-grant",
      "org-visible",
    ]);
    expect(membershipQueries).toHaveLength(1);
  });

  it("without an organization, org visibility grants nothing", async () => {
    const rows = await listThreads(ME, { orgId: null, ownership: "shared" });
    expect(ids(rows)).toEqual(["direct", "direct-and-org"]);
  });

  it("pages mine and shared independently: the filter narrows before LIMIT/OFFSET", async () => {
    const paged: string[] = [];
    for (let offset = 0; offset < 6; offset += 1) {
      const page = await listThreads(ME, {
        orgId: ORG,
        ownership: "shared",
        limit: 1,
        offset,
      });
      paged.push(...ids(page));
    }
    expect(paged).toEqual([
      "direct",
      "org-visible",
      "org-grant",
      "direct-and-org",
    ]);

    // A page of 2 from the shared list is never padded with my own chats.
    const first = await listThreads(ME, {
      orgId: ORG,
      ownership: "shared",
      limit: 2,
    });
    expect(ids(first)).toEqual(["direct", "org-visible"]);
  });

  it("search honours ownership and offset before paging", async () => {
    const mine = await searchThreads(ME, "Quarterly", 10, {
      orgId: ORG,
      ownership: "mine",
    });
    expect(ids(mine)).toEqual(["mine-private", "mine-org"]);

    const sharedPage2 = await searchThreads(ME, "Quarterly", 2, {
      orgId: ORG,
      ownership: "shared",
      offset: 2,
    });
    expect(ids(sharedPage2)).toEqual(["org-grant", "direct-and-org"]);
    expect(
      sharedPage2.map(({ ownerEmail, accessBasis }) => ({
        ownerEmail,
        accessBasis,
      })),
    ).toEqual([
      { ownerEmail: "cy@example.com", accessBasis: "organization" },
      { ownerEmail: "dee@example.com", accessBasis: "direct" },
    ]);
  });

  it("rejects an unknown ownership instead of listing everything", async () => {
    await expect(
      listThreads(ME, { ownership: "everyone" as never }),
    ).rejects.toThrow(/Unknown chat thread ownership/);
  });

  it.each(["deleted", "pending"])(
    "excludes organization access for a %s member with stale scope in every store boundary",
    async (state) => {
      if (state === "deleted") await pglite.exec("DELETE FROM org_members");
      else
        await pglite.exec(
          "UPDATE org_members SET federation_removal_pending_at = 1",
        );
      const expected = ["mine-private", "direct", "mine-org", "direct-and-org"];
      expect(ids(await listThreads(ME, { orgId: ORG }))).toEqual(expected);
      expect(
        ids(await searchThreads(ME, "Quarterly", 20, { orgId: ORG })),
      ).toEqual(expected);
      const batch = await resolveThreadsAccess(
        ME,
        [...expected, "org-visible", "org-grant"],
        { orgId: ORG },
      );
      expect([...batch.keys()].sort()).toEqual([...expected].sort());
      expect(membershipQueries).toHaveLength(3);
      expect(federation.validate).not.toHaveBeenCalled();
    },
  );

  it("filters inaccessible rows before paging and does not expose body-only search matches", async () => {
    await pglite.exec("DELETE FROM org_members");
    await pglite.query(
      "UPDATE chat_threads SET thread_data = ? WHERE id = 'org-visible'",
      ['{"content":"synthetic-body-secret"}'],
    );
    try {
      const page = await listThreads(ME, {
        orgId: ORG,
        ownership: "shared",
        offset: 1,
        limit: 2,
      });
      expect(ids(page)).toEqual(["direct-and-org"]);
      expect(
        ids(
          await searchThreads(ME, "Quarterly", 2, {
            orgId: ORG,
            ownership: "shared",
            offset: 1,
          }),
        ),
      ).toEqual(["direct-and-org"]);
      expect(
        await searchThreads(ME, "synthetic-body-secret", 2, { orgId: ORG }),
      ).toEqual([]);
    } finally {
      await pglite.exec("UPDATE chat_threads SET thread_data = '{}'");
    }
  });

  it("keeps explicit personal scope separate from an omitted scope", async () => {
    await runWithRequestContext({ userEmail: ME, orgId: ORG }, async () => {
      expect(
        ids(await listThreads(ME, { orgId: null, ownership: "shared" })),
      ).toEqual(["direct", "direct-and-org"]);
      expect(
        ids(await searchThreads(ME, "Quarterly", 20, { orgId: null })),
      ).toEqual(["mine-private", "direct", "mine-org", "direct-and-org"]);
      expect(ids(await listThreads(ME, { ownership: "shared" }))).toEqual([
        "direct",
        "org-visible",
        "org-grant",
        "direct-and-org",
      ]);
      expect(await resolveThreadsAccess(ME, ["org-visible"])).toEqual(
        new Map(),
      );
    });
  });

  it("does not treat membership in another organization as membership in the requested one", async () => {
    await pglite.exec("UPDATE org_members SET org_id = 'org-2'");
    expect(
      ids(await listThreads(ME, { orgId: ORG, ownership: "shared" })),
    ).toEqual(["direct", "direct-and-org"]);
  });

  it("rejects missing organization metadata and unreadable membership tables", async () => {
    await pglite.exec("DELETE FROM organizations WHERE id = 'org-1'");
    await expect(listThreads(ME, { orgId: ORG })).rejects.toThrow(
      /organization/i,
    );
    await pglite.exec("ALTER TABLE org_members RENAME TO unavailable_members");
    try {
      await expect(
        searchThreads(ME, "Quarterly", 10, { orgId: ORG }),
      ).rejects.toThrow();
    } finally {
      await pglite.exec(
        "ALTER TABLE unavailable_members RENAME TO org_members",
      );
    }
  });

  it("validates linked organizations once and preserves authoritative denial and errors", async () => {
    await pglite.exec(
      "UPDATE organizations SET identity_authority = 'https://identity.example.test', identity_id = 'upstream-org' WHERE id = 'org-1'",
    );
    expect(
      ids(await listThreads(ME, { orgId: ORG, ownership: "shared" })),
    ).toEqual(["direct", "org-visible", "org-grant", "direct-and-org"]);
    expect(federation.validate).toHaveBeenCalledTimes(1);
    federation.validate.mockClear();
    federation.validate.mockResolvedValue({ active: false, role: "member" });
    expect(
      ids(await listThreads(ME, { orgId: ORG, ownership: "shared" })),
    ).toEqual(["direct", "direct-and-org"]);
    expect(federation.validate).toHaveBeenCalledTimes(1);
    federation.validate.mockRejectedValue(new Error("authority unavailable"));
    await expect(
      resolveThreadsAccess(ME, ["org-grant"], { orgId: ORG }),
    ).rejects.toThrow("authority unavailable");
    federation.enabled.mockRejectedValue(new Error("rollout unavailable"));
    await expect(
      searchThreads(ME, "Quarterly", 10, { orgId: ORG }),
    ).rejects.toThrow("rollout unavailable");
  });

  it("allows only proven local service identities without a membership row", async () => {
    const serviceEmail = `svc-recap@service.${ORG}`;
    const context = {
      userEmail: serviceEmail,
      orgId: ORG,
      verifiedServiceIdentity: { userEmail: serviceEmail, orgId: ORG },
    };
    await runWithRequestContext(context, async () => {
      expect(ids(await listThreads(serviceEmail, { orgId: ORG }))).toEqual([
        "mine-org",
        "org-visible",
        "org-grant",
        "direct-and-org",
      ]);
      await pglite.exec(
        "UPDATE organizations SET identity_authority = 'https://identity.example.test', identity_id = 'upstream-org' WHERE id = 'org-1'",
      );
      expect(await listThreads(serviceEmail, { orgId: ORG })).toEqual([]);
    });
    await runWithRequestContext(
      { userEmail: serviceEmail, orgId: ORG },
      async () => {
        await pglite.exec(
          "UPDATE organizations SET identity_authority = NULL, identity_id = NULL",
        );
        expect(await listThreads(serviceEmail, { orgId: ORG })).toEqual([]);
      },
    );
  });

  it("lists only chats attributed to the requesting app, and never an unattributed legacy row", async () => {
    const stamp = 1_700_000_900_000;
    await seed({
      id: "app-a-chat",
      owner: ME,
      updatedAt: stamp,
      sourceAppId: "app-a",
    });
    await seed({
      id: "app-b-chat",
      owner: ME,
      updatedAt: stamp + 1,
      sourceAppId: "app-b",
    });
    // A row written before provenance existed: stored, owned by the same user,
    // and deliberately not adopted by whichever app reads it first.
    await seed({ id: "legacy-chat", owner: ME, updatedAt: stamp + 2 });

    const appA = await listThreads(ME, {
      orgId: null,
      ownership: "mine",
      includeExternal: false,
      sourceAppId: "app-a",
    });
    expect(ids(appA)).toEqual(["app-a-chat"]);

    const appB = await listThreads(ME, {
      orgId: null,
      ownership: "mine",
      includeExternal: false,
      sourceAppId: "app-b",
    });
    expect(ids(appB)).toEqual(["app-b-chat"]);
  });

  it("finds only the requesting app's chats in search", async () => {
    const stamp = 1_700_000_910_000;
    // A word no other case in this fixture uses, so the assertion is about
    // attribution rather than about what earlier tests happened to seed.
    await seed({
      id: "search-a",
      owner: ME,
      updatedAt: stamp,
      sourceAppId: "app-a",
      title: "Zephyr rollout",
    });
    await seed({
      id: "search-b",
      owner: ME,
      updatedAt: stamp + 1,
      sourceAppId: "app-b",
      title: "Zephyr rollout",
    });
    await seed({
      id: "search-legacy",
      owner: ME,
      updatedAt: stamp + 2,
      title: "Zephyr rollout",
    });

    const hits = await searchThreads(ME, "Zephyr", 20, {
      orgId: null,
      ownership: "mine",
      includeExternal: false,
      sourceAppId: "app-a",
    });
    expect(ids(hits)).toEqual(["search-a"]);
  });

  it("returns no local chats at all when the reader has no proven app id", async () => {
    // Without an app id there is nothing to scope to, so the local view is empty
    // rather than every app's history. This is the fail-closed default.
    const rows = await listThreads(ME, {
      orgId: null,
      ownership: "mine",
      includeExternal: false,
    });
    expect(rows).toEqual([]);
  });
});
