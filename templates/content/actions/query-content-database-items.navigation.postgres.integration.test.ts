import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ContentDatabaseNavigationPageResponse } from "../shared/api.js";

const url = process.env.CONTENT_NAVIGATION_POSTGRES_URL;
if (process.env.CONTENT_NAVIGATION_POSTGRES_REQUIRED === "1" && !url) {
  throw new Error(
    "CONTENT_NAVIGATION_POSTGRES_URL is required for navigation proof",
  );
}
const owner = "navigation-snapshot@example.test";
const stamp = "2026-01-01T00:00:00.000Z";
const requireFromCore = createRequire(
  resolve(import.meta.dirname, "../../../packages/core/package.json"),
);
const postgresModule = requireFromCore
  .resolve("postgres")
  .replace("/cjs/src/index.js", "/src/index.js");

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let action: typeof import("./query-content-database-items.js").default;
type PgQuery = PromiseLike<unknown> & { values(): Promise<unknown> };
type PgClient = {
  (parts: TemplateStringsArray, ...args: unknown[]): Promise<unknown>;
  unsafe(text: string, ...args: unknown[]): PgQuery;
  begin<T>(callback: (tx: PgClient) => Promise<T>): Promise<T>;
  end(): Promise<void>;
};
let writer: PgClient;
let interleave: (() => Promise<void>) | undefined;
let beforeSnapshot: (() => Promise<void>) | undefined;
let finishFolder: (() => void) | undefined;
let folderFinished: Promise<void> | undefined;

function instrument(client: PgClient): PgClient {
  return new Proxy(client, {
    get(target, property) {
      if (property === "begin") {
        return async (callback: (tx: PgClient) => Promise<unknown>) => {
          if (beforeSnapshot) {
            const change = beforeSnapshot;
            beforeSnapshot = undefined;
            await change();
          }
          return target.begin((tx: PgClient) => callback(instrument(tx)));
        };
      }
      if (property === "unsafe") {
        return (text: string, ...args: unknown[]) => {
          const query = target.unsafe(text, ...args);
          const execute = async (mode: "values" | "rows") => {
            const isFolder =
              text.startsWith("select navigation_folder_entry.root_path,") &&
              text.includes("group by");
            const isPage =
              text.includes("navigation_favorite_memberships") &&
              text.includes(" limit ");
            if (folderFinished && isPage) await folderFinished;
            const result =
              mode === "values" ? await query.values() : await query;
            if (interleave && isFolder) {
              const move = interleave;
              interleave = undefined;
              try {
                await move();
              } finally {
                finishFolder?.();
              }
            }
            return result;
          };
          return new Proxy(query, {
            get(queryTarget, key) {
              if (key === "values") return () => execute("values");
              if (key === "then") {
                const pending = execute("rows");
                return pending.then.bind(pending);
              }
              const value = Reflect.get(queryTarget, key, queryTarget);
              return typeof value === "function"
                ? value.bind(queryTarget)
                : value;
            },
          });
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

// oracle-change: local runs without PostgreSQL skip this integration suite; CI proof requires the URL.
describe.runIf(Boolean(url))("PostgreSQL navigation snapshots", () => {
  beforeAll(async () => {
    if (!url || !new URL(url).pathname.toLowerCase().includes("test")) {
      throw new Error(
        "CONTENT_NAVIGATION_POSTGRES_URL must name an isolated PostgreSQL test database",
      );
    }
    process.env.DATABASE_URL = url;
    const actual = await vi.importActual<{
      default: (url: string, options?: { max: number }) => PgClient;
    }>(postgresModule);
    writer = actual.default(url, { max: 1 });
    vi.doMock(postgresModule, () => ({
      ...actual,
      default: (...args: Parameters<typeof actual.default>) =>
        instrument(actual.default(...args)),
    }));
    const db = await import("../server/db/index.js");
    getDb = db.getDb;
    schema = db.schema;
    action = (await import("./query-content-database-items.js")).default;
    await (await import("../server/plugins/db.js")).default(undefined);
  });

  afterAll(async () => {
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- setup can fail before the writer is assigned.
    if (writer) await writer.end();
    const { closeDbExec } = await import("@agent-native/core/db");
    await closeDbExec();
    await (
      await import("../../../packages/core/src/db/client.js")
    ).closeDbExec();
    delete process.env.DATABASE_URL;
    vi.doUnmock(postgresModule);
  });

  it("keeps prewarmed store readiness usable in unscoped executor transactions", async () => {
    const { getDbExec } =
      await import("../../../packages/core/src/db/client.js");
    const { defineStore } =
      await import("../../../packages/core/src/db/store-registry.js");
    const suffix = crypto.randomUUID().replaceAll("-", "");
    const table = `store_probe_${suffix}`;
    // raw-sql-ok: table is a test-owned identifier made from a UUID.
    const store = defineStore({
      id: table,
      migrations: [{ name: "initial", sql: `CREATE TABLE ${table} (id TEXT)` }],
    });
    await store.ready();
    const exec = getDbExec();
    if (!exec.transaction) throw new Error("Transaction support is required");
    await expect(
      exec.transaction(async (tx) => {
        await store.ready();
        // raw-sql-ok: table is a test-owned identifier made from a UUID.
        await tx.execute(`INSERT INTO ${table} (id) VALUES ('rolled-back')`);
        throw new Error("intentional rollback");
      }),
    ).rejects.toThrow("intentional rollback");
    // raw-sql-ok: table is a test-owned identifier made from a UUID.
    const { rows } = await exec.execute(`SELECT id FROM ${table}`);
    expect(rows).toEqual([]);
    // raw-sql-ok: table is a test-owned identifier made from a UUID.
    await exec.execute(`DROP TABLE ${table}`);
  });

  it("keeps cold unscoped setup independent and retries scoped setup after rollback", async () => {
    const { getDbExec, withDbExec } =
      await import("../../../packages/core/src/db/client.js");
    const { defineStore } =
      await import("../../../packages/core/src/db/store-registry.js");
    const suffix = crypto.randomUUID().replaceAll("-", "");
    const coldTable = `cold_probe_${suffix}`;
    const scopedTable = `scoped_probe_${suffix}`;
    // raw-sql-ok: id is a test-owned identifier made from a UUID.
    const storeFor = (id: string) =>
      defineStore({
        id,
        migrations: [{ name: "initial", sql: `CREATE TABLE ${id} (id TEXT)` }],
      });
    const cold = storeFor(coldTable);
    const scoped = storeFor(scopedTable);
    const exec = getDbExec();
    if (!exec.transaction) throw new Error("Transaction support is required");
    await expect(
      exec.transaction(async () => {
        await cold.ready();
        throw new Error("roll back unscoped");
      }),
    ).rejects.toThrow("roll back unscoped");
    expect(
      (
        await exec.execute({
          sql: "SELECT to_regclass(?) AS name",
          args: [coldTable],
        })
      ).rows[0]?.name,
    ).toBe(coldTable);
    await expect(
      exec.transaction(async (tx) =>
        withDbExec(tx, async () => {
          await scoped.ready();
          throw new Error("roll back scoped");
        }),
      ),
    ).rejects.toThrow("roll back scoped");
    expect(
      (
        await exec.execute({
          sql: "SELECT to_regclass(?) AS name",
          args: [scopedTable],
        })
      ).rows[0]?.name,
    ).toBeNull();
    await scoped.ready();
    expect(
      (
        await exec.execute({
          sql: "SELECT to_regclass(?) AS name",
          args: [scopedTable],
        })
      ).rows[0]?.name,
    ).toBe(scopedTable);
    // raw-sql-ok: both table names are test-owned identifiers made from a UUID.
    await exec.execute(`DROP TABLE ${coldTable}, ${scopedTable}`);
  });

  async function fixture(id: string, sourcePath: string) {
    const space = `${id}-space`;
    const database = `${id}-database`;
    await getDb()
      .insert(schema.documents)
      .values([
        {
          id: `${id}-database-page`,
          spaceId: space,
          ownerEmail: owner,
          title: "Files",
          content: "",
          visibility: "private",
          createdAt: stamp,
          updatedAt: stamp,
        },
        {
          id: `${id}-moving`,
          spaceId: space,
          ownerEmail: owner,
          title: "A",
          content: "",
          visibility: "private",
          sourceMode: "local-files",
          sourceKind: "file",
          sourcePath,
          sourceRootPath: `${id}-root`,
          createdAt: stamp,
          updatedAt: stamp,
        },
        {
          id: `${id}-middle`,
          spaceId: space,
          ownerEmail: owner,
          title: "Y",
          content: "",
          visibility: "private",
          createdAt: stamp,
          updatedAt: stamp,
        },
        {
          id: `${id}-tail`,
          spaceId: space,
          ownerEmail: owner,
          title: "Z",
          content: "",
          visibility: "private",
          createdAt: stamp,
          updatedAt: stamp,
        },
      ]);
    await getDb().insert(schema.contentSpaces).values({
      id: space,
      name: space,
      kind: "personal",
      ownerEmail: owner,
      filesDatabaseId: database,
      createdBy: owner,
      createdAt: stamp,
      updatedAt: stamp,
    });
    await getDb()
      .insert(schema.contentDatabases)
      .values({
        id: database,
        spaceId: space,
        ownerEmail: owner,
        documentId: `${id}-database-page`,
        title: "Files",
        systemRole: "files",
        createdAt: stamp,
        updatedAt: stamp,
      });
    await getDb()
      .insert(schema.contentDatabaseSources)
      .values({
        id: `${id}-source`,
        ownerEmail: owner,
        databaseId: database,
        sourceType: "local-folder",
        sourceName: "root",
        sourceTable: `${id}-root`,
      });
    await getDb()
      .insert(schema.contentDatabaseItems)
      .values([
        {
          id: `${id}-membership`,
          ownerEmail: owner,
          databaseId: database,
          documentId: `${id}-moving`,
          position: 0,
          createdAt: stamp,
          updatedAt: stamp,
        },
        {
          id: `${id}-middle-membership`,
          ownerEmail: owner,
          databaseId: database,
          documentId: `${id}-middle`,
          position: 1,
          createdAt: stamp,
          updatedAt: stamp,
        },
        {
          id: `${id}-tail-membership`,
          ownerEmail: owner,
          databaseId: database,
          documentId: `${id}-tail`,
          position: 2,
          createdAt: stamp,
          updatedAt: stamp,
        },
      ]);
    await getDb()
      .insert(schema.contentDatabaseSourceRows)
      .values({
        id: `${id}-source-row`,
        ownerEmail: owner,
        sourceId: `${id}-source`,
        databaseItemId: `${id}-membership`,
        documentId: `${id}-moving`,
        sourceRowId: sourcePath,
        sourceQualifiedId: `local-folder://${id}-root/${encodeURIComponent(sourcePath)}`,
        sourceDisplayKey: sourcePath,
      });
    return database;
  }

  function navigate(databaseId: string, cursor?: string) {
    return runWithRequestContext({ userEmail: owner }, () =>
      action.run(
        {
          databaseId,
          limit: 2,
          navigation: { parentId: null, sort: "name", cursor },
        },
        { userEmail: owner },
      ),
    ) as Promise<ContentDatabaseNavigationPageResponse>;
  }

  it.each([true, false])(
    "enforces federated membership present=%s while reading Files",
    async (memberPresent) => {
      const id = `federated-${randomUUID()}`;
      const orgId = `${id}-org`;
      const databaseId = await fixture(id, "folder/a.md");
      await writer`CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at BIGINT NOT NULL, identity_authority TEXT, identity_id TEXT)`;
      await writer`CREATE TABLE IF NOT EXISTS org_members (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at BIGINT NOT NULL, federation_removal_pending_at BIGINT)`;
      await writer`INSERT INTO organizations (id, name, created_by, created_at, identity_authority, identity_id) VALUES (${orgId}, ${"Test organization"}, ${"owner@example.test"}, ${0}, ${"http://localhost:43191"}, ${orgId})`;
      await writer`INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (${`${id}-member`}, ${orgId}, ${owner}, ${"member"}, ${0})`;
      await writer`UPDATE content_spaces SET org_id = ${orgId}, owner_email = ${"owner@example.test"}, kind = ${"organization"} WHERE id = ${`${id}-space`}`;
      await writer`UPDATE content_databases SET org_id = ${orgId}, owner_email = ${"owner@example.test"} WHERE id = ${databaseId}`;
      await writer`UPDATE documents SET org_id = ${orgId}, owner_email = ${"owner@example.test"}, visibility = ${"org"} WHERE space_id = ${`${id}-space`}`;
      const { registerFeatureFlags } =
        await import("@agent-native/core/feature-flags");
      const { CROSS_APP_ORG_FEDERATION_FLAG } =
        await import("@agent-native/core/org");
      registerFeatureFlags([CROSS_APP_ORG_FEDERATION_FLAG]);
      const { putOrgSetting } = await import("@agent-native/core/settings");
      await putOrgSetting(
        orgId,
        "feature-flag:organization.cross-app-federation",
        {
          version: 1,
          mode: "on",
          emails: [],
          orgIds: [],
          percentage: 0,
          updatedAt: null,
          updatedBy: null,
        },
      );
      vi.stubEnv("AGENT_NATIVE_IDENTITY_HUB_URL", "http://localhost:43191");
      vi.stubEnv(
        "AGENT_NATIVE_IDENTITY_FEDERATION_SECRET",
        "not-a-real-secret-for-test",
      );
      const authority = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              orgId,
              memberEmail: owner,
              memberPresent,
              memberRole: "admin",
            }),
            { status: 200 },
          ),
      );
      vi.stubGlobal("fetch", authority);
      try {
        const read = () =>
          runWithRequestContext(
            { userEmail: owner, orgId, requestOrigin: "http://localhost:3000" },
            () =>
              action.run(
                { databaseId, navigation: { parentId: null, sort: "name" } },
                { userEmail: owner },
              ),
          );
        if (memberPresent) {
          // oxlint-disable-next-line vitest/no-conditional-expect -- the parameter selects the authorized outcome.
          await expect(read()).resolves.toMatchObject({
            // oxlint-disable-next-line vitest/no-conditional-expect -- the authorized response contains rows.
            items: expect.any(Array),
          });
        } else {
          // oxlint-disable-next-line vitest/no-conditional-expect -- the parameter selects the unauthorized outcome.
          await expect(read()).rejects.toMatchObject({
            errorCode: "DATABASE_NOT_FOUND",
          });
        }
        expect(authority).toHaveBeenCalled();
        const rows =
          (await writer`SELECT role FROM org_members WHERE id = ${`${id}-member`}`) as unknown as Array<{
            role: string;
          }>;
        expect(rows.map((row) => row.role)).toEqual(
          memberPresent ? ["admin"] : [],
        );
        if (memberPresent) {
          await writer`UPDATE org_members SET role = ${"member"} WHERE id = ${`${id}-member`}`;
          let count = 0;
          let release: () => void = () => {};
          const bothArrived = new Promise<void>((resolve) => {
            release = resolve;
          });
          authority.mockImplementation(async () => {
            count += 1;
            if (count === 2) release();
            await bothArrived;
            return new Response(
              JSON.stringify({
                orgId,
                memberEmail: owner,
                memberPresent: true,
                memberRole: "admin",
              }),
              { status: 200 },
            );
          });
          const concurrent = await Promise.all([read(), read()]);
          // oxlint-disable-next-line vitest/no-conditional-expect -- only an active member can run this concurrency case.
          expect(concurrent).toHaveLength(2);
          await writer`UPDATE org_members SET role = ${"member"} WHERE id = ${`${id}-member`}`;
          const key = `u:${owner}:content-database-personal-view:${databaseId}`;
          await writer`INSERT INTO settings (key, value, updated_at) VALUES (${key}, ${"{"}, ${0})`;
          // oxlint-disable-next-line vitest/no-conditional-expect -- only an active member reaches personal settings.
          await expect(read()).rejects.toBeInstanceOf(SyntaxError);
          const reconciled =
            (await writer`SELECT role FROM org_members WHERE id = ${`${id}-member`}`) as unknown as Array<{
              role: string;
            }>;
          // oxlint-disable-next-line vitest/no-conditional-expect -- reconciliation applies to the active member case.
          expect(reconciled.map((row) => row.role)).toEqual(["admin"]);
          await writer`DELETE FROM settings WHERE key = ${key}`;
          beforeSnapshot = async () => {
            await writer`DELETE FROM org_members WHERE id = ${`${id}-member`}`;
          };
          // oxlint-disable-next-line vitest/no-conditional-expect -- the membership is removed just before the snapshot.
          await expect(read()).rejects.toMatchObject({
            errorCode: "DATABASE_NOT_FOUND",
          });
          // oxlint-disable-next-line vitest/no-conditional-expect -- the active member case must exercise the interleaving.
          expect(beforeSnapshot).toBeUndefined();
        }
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }
    },
  );

  it("rejects navigation when the action identity is missing", async () => {
    const databaseId = await fixture(
      `missing-identity-${randomUUID()}`,
      "a.md",
    );
    await expect(
      runWithRequestContext({ userEmail: owner }, () =>
        action.run(
          { databaseId, navigation: { parentId: null, sort: "name" } },
          {},
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "unauthenticated", statusCode: 401 });
  });

  it("reads only the resolved database's personal view and propagates its parse errors", async () => {
    const id = `personal-${randomUUID()}`;
    const databaseId = await fixture(id, "folder/a.md");
    const documentId = `${id}-database-page`;
    const key = (target: string) =>
      `u:${owner}:content-database-personal-view:${target}`;
    await writer`INSERT INTO settings (key, value, updated_at) VALUES (${key(documentId)}, ${"{"}, ${0})`;
    const read = () =>
      runWithRequestContext({ userEmail: owner }, () =>
        action.run(
          { documentId, navigation: { parentId: null, sort: "name" } },
          { userEmail: owner },
        ),
      );
    await expect(read()).resolves.toMatchObject({ items: expect.any(Array) });
    await writer`INSERT INTO settings (key, value, updated_at) VALUES (${key(databaseId)}, ${"{"}, ${0})`;
    await expect(read()).rejects.toBeInstanceOf(SyntaxError);
  });

  for (const [direction, before, after, expected] of [
    ["folder-to-root", "folder/a.md", "a.md", "folder"],
    ["root-to-folder", "a.md", "folder/a.md", "A"],
  ] as const) {
    it(`keeps ${direction} and its cursor on one snapshot`, async () => {
      const id = `${direction}-${randomUUID()}`;
      const database = await fixture(id, before);
      folderFinished = new Promise((resolve) => {
        finishFolder = resolve;
      });
      interleave = async () => {
        await writer.begin(async (tx) => {
          await tx`update documents set source_path = ${after}, updated_at = ${"2026-01-02T00:00:00.000Z"} where id = ${`${id}-moving`}`;
          await tx`update content_database_items set updated_at = ${"2026-01-02T00:00:00.000Z"} where id = ${`${id}-membership`}`;
          await tx`update content_database_source_rows set source_row_id = ${after}, source_display_key = ${after}, source_qualified_id = ${`local-folder://${id}-root/${encodeURIComponent(after)}`} where id = ${`${id}-source-row`}`;
        });
      };
      const page = await navigate(database);
      expect(interleave).toBeUndefined();
      expect(page.items.map((item) => item.title)).toEqual([expected, "Y"]);
      expect(page.pagination.nextCursor).toBeTruthy();
      const cursor = page.pagination.nextCursor;
      if (!cursor) throw new Error("Expected a next cursor");
      await expect(navigate(database, cursor)).rejects.toMatchObject({
        errorCode: "invalid_navigation_cursor",
      });
      const moved = await getDb()
        .select({ path: schema.documents.sourcePath })
        .from(schema.documents)
        .where(eq(schema.documents.id, `${id}-moving`));
      expect(moved[0]?.path).toBe(after);
    });
  }
});
