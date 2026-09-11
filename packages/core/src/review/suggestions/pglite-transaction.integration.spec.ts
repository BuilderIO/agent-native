import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDbExec, createDbExec, getDbExec } from "../../db/client.js";
import { createGetDb } from "../../db/create-get-db.js";
import { resolveAccess } from "../../sharing/access.js";
import { registerShareableResource } from "../../sharing/registry.js";
import { createSharesTable, ownableColumns } from "../../sharing/schema.js";
import {
  __resetReviewInitForTests,
  ensureReviewTables,
  insertReviewComment,
  queryReviewComments,
} from "../store.js";
import {
  decideResourceSuggestion,
  updateResourceSuggestion,
} from "./actions.js";
import {
  __resetSuggestionAdaptersForTests,
  registerSuggestionAdapter,
} from "./registry.js";
import {
  __resetSuggestionTablesForTests,
  ensureSuggestionTables,
  insertSuggestion,
  listSuggestions,
} from "./store.js";

const resources = pgTable("pglite_review_resources", {
  id: text("id").primaryKey(),
  body: text("body").notNull(),
  ...ownableColumns(),
});
const resourceShares = createSharesTable("pglite_review_resource_shares");
const getDb = createGetDb({ resources, resourceShares });

const resourceType = "pglite-review-transaction-resource";
const resourceId = "resource-1";
const ownerEmail = "owner@example.com";
const baseRevision = "revision-1";
const originalOperation = {
  ordinal: 0,
  kind: "replace_text",
  targetId: "body",
  before: { markdown: "Before" },
  after: { markdown: "After" },
  schemaVersion: 1,
};

let previousDatabaseUrl: string | undefined;
let independentClientsDirectory: string | undefined;

beforeAll(async () => {
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "pglite:memory";
  await closeDbExec();

  const db = getDbExec();
  await db.execute(`CREATE TABLE pglite_review_resources (
    id TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    owner_email TEXT,
    org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
  )`);
  await db.execute(`CREATE TABLE pglite_review_resource_shares (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL,
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  await db.execute({
    sql: "INSERT INTO pglite_review_resources (id,body,owner_email,org_id,visibility) VALUES (?,?,?,?,?)",
    args: [resourceId, "Before", ownerEmail, null, "private"],
  });

  registerShareableResource({
    type: resourceType,
    resourceTable: resources,
    sharesTable: resourceShares,
    displayName: "PGlite review transaction resource",
    getDb,
  });
  __resetSuggestionAdaptersForTests();
  registerSuggestionAdapter({
    kind: "pglite-review-transaction-adapter",
    version: 1,
    validateProposal: ({ operations }) => operations,
    apply: async ({ operations, resourceId: targetId, transaction }) => {
      const after = operations[0]?.after as { markdown?: unknown } | undefined;
      if (typeof after?.markdown !== "string") {
        throw new Error("Test suggestion is missing after.markdown");
      }
      await transaction.execute({
        sql: "UPDATE pglite_review_resources SET body = ? WHERE id = ?",
        args: [after.markdown, targetId],
      });
    },
  });
  __resetSuggestionTablesForTests();
  __resetReviewInitForTests();
  await ensureSuggestionTables();
  await ensureReviewTables();
});

afterAll(async () => {
  await closeDbExec();
  if (independentClientsDirectory) {
    await rm(independentClientsDirectory, { recursive: true, force: true });
  }
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

describe.sequential("suggestion actions on native PGlite transactions", () => {
  it("amends, decides, and releases the client for an ordinary read", async () => {
    const suggestion = await insertSuggestion({
      resourceType,
      resourceId,
      adapterKind: "pglite-review-transaction-adapter",
      adapterVersion: 1,
      threadId: "review-thread-1",
      authorEmail: ownerEmail,
      actorKind: "human",
      baseRevision,
      status: "pending",
      summary: "Original suggestion",
      ownerEmail,
      orgId: null,
      visibility: "private",
      metadata: null,
      operations: [originalOperation],
    });
    await insertReviewComment({
      resourceType,
      resourceId,
      threadId: suggestion.threadId,
      targetId: suggestion.id,
      body: suggestion.summary,
      authorEmail: ownerEmail,
      ownerEmail,
    });

    const amended = await updateResourceSuggestion.run(
      {
        id: suggestion.id,
        observedRevision: 1,
        idempotencyKey: "amend-native-pglite",
        summary: "Amended suggestion",
        operations: [
          {
            ...originalOperation,
            after: { markdown: "Amended" },
          },
        ],
      },
      { userEmail: ownerEmail },
    );
    expect(amended.revision).toBe(2);

    const decided = await decideResourceSuggestion.run(
      {
        id: suggestion.id,
        decision: "rejected",
        idempotencyKey: "decide-native-pglite",
        observedBase: baseRevision,
        observedRevision: 2,
      },
      { userEmail: ownerEmail },
    );
    expect(decided.decision.outcome).toBe("rejected");

    const ordinaryRead = await listSuggestions(resourceType, resourceId);
    expect(ordinaryRead).toHaveLength(1);
    expect(ordinaryRead[0]).toMatchObject({
      id: suggestion.id,
      revision: 2,
      status: "rejected",
      summary: "Amended suggestion",
    });
    expect(
      await queryReviewComments({
        resourceType,
        resourceId,
        scope: { userEmail: ownerEmail },
        includeResolved: true,
      }),
    ).toMatchObject([{ threadId: suggestion.threadId, status: "resolved" }]);
  });

  it("keeps an unrelated async read outside a rolling-back transaction", async () => {
    let startOutsideRead!: () => void;
    const start = new Promise<void>((resolve) => {
      startOutsideRead = resolve;
    });
    const outsideRead = new Promise<string>((resolve, reject) => {
      setTimeout(() => {
        void start
          .then(async () => {
            const [row] = await getDb()
              .select({ body: resources.body })
              .from(resources)
              .where(eq(resources.id, resourceId));
            resolve(row!.body);
          })
          .catch(reject);
      }, 0);
    });

    await expect(
      getDbExec().transaction!(async (tx) => {
        await tx.execute({
          sql: "UPDATE pglite_review_resources SET body = ? WHERE id = ?",
          args: ["Uncommitted", resourceId],
        });
        startOutsideRead();
        await new Promise((resolve) => setTimeout(resolve, 20));
        throw new Error("roll back test");
      }),
    ).rejects.toThrow("roll back test");

    expect(await outsideRead).toBe("Before");
  });

  it("reads uncommitted access state on the transaction and rolls it back", async () => {
    const temporaryOwner = "temporary-owner@example.com";
    await expect(
      getDbExec().transaction!(async (tx) => {
        await tx.execute({
          sql: "UPDATE pglite_review_resources SET owner_email = ? WHERE id = ?",
          args: [temporaryOwner, resourceId],
        });
        await expect(
          resolveAccess(resourceType, resourceId, {
            userEmail: temporaryOwner,
          }),
        ).resolves.toMatchObject({ role: "owner" });
        throw new Error("roll back access test");
      }),
    ).rejects.toThrow("roll back access test");

    await expect(
      resolveAccess(resourceType, resourceId, { userEmail: ownerEmail }),
    ).resolves.toMatchObject({ role: "owner" });
    await expect(
      resolveAccess(resourceType, resourceId, { userEmail: temporaryOwner }),
    ).resolves.toBeNull();
  });

  it("routes a fresh global DbExec read through the transaction", async () => {
    await expect(
      getDbExec().transaction!(async (tx) => {
        await tx.execute({
          sql: "UPDATE pglite_review_resources SET body = ? WHERE id = ?",
          args: ["Visible only in transaction", resourceId],
        });
        const row = (
          await getDbExec().execute({
            sql: "SELECT body FROM pglite_review_resources WHERE id = ?",
            args: [resourceId],
          })
        ).rows[0];
        expect(row?.body).toBe("Visible only in transaction");
        throw new Error("roll back global DbExec test");
      }),
    ).rejects.toThrow("roll back global DbExec test");

    const row = (
      await getDbExec().execute({
        sql: "SELECT body FROM pglite_review_resources WHERE id = ?",
        args: [resourceId],
      })
    ).rows[0];
    expect(row?.body).toBe("Before");
  });

  it("accepts through an adapter that writes on the same transaction", async () => {
    const suggestion = await insertSuggestion({
      resourceType,
      resourceId,
      adapterKind: "pglite-review-transaction-adapter",
      adapterVersion: 1,
      threadId: "review-thread-accepted",
      authorEmail: ownerEmail,
      actorKind: "human",
      baseRevision,
      status: "pending",
      summary: "Accepted suggestion",
      ownerEmail,
      orgId: null,
      visibility: "private",
      metadata: null,
      operations: [originalOperation],
    });
    await insertReviewComment({
      resourceType,
      resourceId,
      threadId: suggestion.threadId,
      targetId: suggestion.id,
      body: suggestion.summary,
      authorEmail: ownerEmail,
      ownerEmail,
    });

    const decided = await decideResourceSuggestion.run(
      {
        id: suggestion.id,
        decision: "accepted",
        idempotencyKey: "accept-native-pglite",
        observedBase: baseRevision,
        observedRevision: 1,
      },
      { userEmail: ownerEmail },
    );
    expect(decided.decision.outcome).toBe("accepted");

    const [resource] = await getDb()
      .select({ body: resources.body })
      .from(resources)
      .where(eq(resources.id, resourceId));
    expect(resource?.body).toBe("After");
  });

  it("fails nested global transactions explicitly", async () => {
    await expect(
      getDbExec().transaction!(async () =>
        getDbExec().transaction!(async () => undefined),
      ),
    ).rejects.toThrow("Nested PGlite transactions are not supported");
  });

  it("keeps nested transactions on two PGlite databases isolated", async () => {
    independentClientsDirectory = await mkdtemp(
      join(tmpdir(), "agent-native-pglite-routing-"),
    );
    const firstUrl = `pglite:${join(independentClientsDirectory, "first")}`;
    const secondUrl = `pglite:${join(independentClientsDirectory, "second")}`;
    const first = await createDbExec({ url: firstUrl });
    const second = await createDbExec({ url: secondUrl });
    await first.execute(
      "CREATE TABLE scoped_values (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    await second.execute(
      "CREATE TABLE scoped_values (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    await first.execute({
      sql: "INSERT INTO scoped_values (id,value) VALUES (?,?)",
      args: ["row", "first-before"],
    });
    await second.execute({
      sql: "INSERT INTO scoped_values (id,value) VALUES (?,?)",
      args: ["row", "second-before"],
    });

    await expect(
      first.transaction!(async (firstTx) => {
        await firstTx.execute({
          sql: "UPDATE scoped_values SET value = ? WHERE id = ?",
          args: ["first-uncommitted", "row"],
        });
        await second.transaction!(async (secondTx) => {
          expect(
            (
              await first.execute({
                sql: "SELECT value FROM scoped_values WHERE id = ?",
                args: ["row"],
              })
            ).rows[0]?.value,
          ).toBe("first-uncommitted");
          expect(
            (
              await secondTx.execute({
                sql: "SELECT value FROM scoped_values WHERE id = ?",
                args: ["row"],
              })
            ).rows[0]?.value,
          ).toBe("second-before");
          await secondTx.execute({
            sql: "UPDATE scoped_values SET value = ? WHERE id = ?",
            args: ["second-committed", "row"],
          });
          await expect(
            first.transaction!(async () => undefined),
          ).rejects.toThrow("Nested PGlite transactions are not supported");
        });
        expect(
          (
            await first.execute({
              sql: "SELECT value FROM scoped_values WHERE id = ?",
              args: ["row"],
            })
          ).rows[0]?.value,
        ).toBe("first-uncommitted");
        throw new Error("roll back first database");
      }),
    ).rejects.toThrow("roll back first database");

    expect(
      (
        await first.execute({
          sql: "SELECT value FROM scoped_values WHERE id = ?",
          args: ["row"],
        })
      ).rows[0]?.value,
    ).toBe("first-before");
    expect(
      (
        await second.execute({
          sql: "SELECT value FROM scoped_values WHERE id = ?",
          args: ["row"],
        })
      ).rows[0]?.value,
    ).toBe("second-committed");
  }, 15_000);
});
