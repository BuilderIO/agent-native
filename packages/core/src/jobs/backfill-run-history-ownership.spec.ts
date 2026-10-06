import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";
import { backfillRunHistoryOwnership } from "./backfill-run-history-ownership.js";

const pglite = await createTestPglite();
const executor = (client: Pick<typeof pglite.db, "query">): DbExec => ({
  execute: async (input) => {
    const sql = typeof input === "string" ? input : input.sql;
    const result = await client.query(
      sql,
      typeof input === "string" ? [] : input.args,
    );
    return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
  },
});
const db: DbExec = {
  ...executor(pglite.db),
  transaction: (fn) => pglite.db.transaction((tx) => fn(executor(tx))),
};

await pglite.exec(`
  CREATE TABLE automation_runs (
    id TEXT PRIMARY KEY, owner TEXT, scope TEXT, org_id TEXT, path TEXT,
    run_id TEXT, status TEXT, dispatch_pending INTEGER, started_at BIGINT
  );
  CREATE TABLE resources (id TEXT PRIMARY KEY, owner TEXT, path TEXT, created_at BIGINT);
  CREATE TABLE agent_trace_spans (
    id TEXT PRIMARY KEY, run_id TEXT, span_type TEXT, name TEXT,
    user_id TEXT, org_id TEXT, metadata TEXT
  );
`);
afterAll(() => pglite.close());
beforeEach(async () => {
  await pglite.exec(
    "DELETE FROM agent_trace_spans; DELETE FROM automation_runs; DELETE FROM resources",
  );
});

async function job(id: string, owner = "alice@example.test") {
  await pglite.query(
    "INSERT INTO resources VALUES ($1, $2, 'jobs/digest.md', 1)",
    [id, owner],
  );
}

async function run(id: string, jobId?: string, actor = "alice@example.test") {
  await pglite.query(
    "INSERT INTO automation_runs VALUES ($1, '__organization__:acme', 'organization', 'acme', 'jobs/digest.md', $1, 'success', 0, 2)",
    [id],
  );
  if (jobId !== undefined) await trace(id, jobId, actor);
}

async function trace(
  runId: string,
  jobId: string,
  actor = "alice@example.test",
) {
  await pglite.query(
    "INSERT INTO agent_trace_spans VALUES ($1, $2, 'agent_run', 'background_automation_run:digest', $3, 'acme', $4)",
    [
      `${runId}-${jobId}-${actor}`,
      runId,
      actor,
      JSON.stringify({ automationId: jobId }),
    ],
  );
}

describe("automation history ownership backfill", () => {
  it("dry-runs without writes, moves by stable id and owner, and is idempotent", async () => {
    await job("personal");
    await job("same-name-org", "__organization__:acme");
    await job("same-name-bob", "bob@example.test");
    await run("personal-run", "personal");
    await run("org-run", "same-name-org");
    await run("bob-run", "same-name-bob", "bob@example.test");
    await run("no-id");
    const before = await pglite.query(
      "SELECT * FROM automation_runs ORDER BY id",
    );
    expect(await backfillRunHistoryOwnership(db)).toEqual({
      organizationRows: 4,
      eligibleRows: 2,
      organizationJobRows: 1,
      ambiguousRows: 1,
      deferredRows: 0,
      movedRows: 0,
    });
    expect(
      (await pglite.query("SELECT * FROM automation_runs ORDER BY id")).rows,
    ).toEqual(before.rows);
    expect(
      (await backfillRunHistoryOwnership(db, { apply: true })).movedRows,
    ).toBe(2);
    expect(
      (
        await pglite.query(
          "SELECT id, owner, scope, org_id FROM automation_runs ORDER BY id",
        )
      ).rows,
    ).toEqual([
      {
        id: "bob-run",
        owner: "bob@example.test",
        scope: "personal",
        org_id: null,
      },
      {
        id: "no-id",
        owner: "__organization__:acme",
        scope: "organization",
        org_id: "acme",
      },
      {
        id: "org-run",
        owner: "__organization__:acme",
        scope: "organization",
        org_id: "acme",
      },
      {
        id: "personal-run",
        owner: "alice@example.test",
        scope: "personal",
        org_id: null,
      },
    ]);
    expect(
      (await backfillRunHistoryOwnership(db, { apply: true })).movedRows,
    ).toBe(0);
  });

  it("leaves missing, replaced, conflicting and mismatched provenance untouched", async () => {
    await job("personal");
    await job("other", "bob@example.test");
    await job("shared", "__shared__");
    await run("deleted-job", "old-job-id");
    await run("wrong-owner", "other");
    await run("shared", "shared");
    await run("conflict", "personal");
    await trace("conflict", "other", "bob@example.test");
    await run("wrong-org", "personal");
    await pglite.query(
      "UPDATE agent_trace_spans SET org_id = 'other-org' WHERE run_id = 'wrong-org'",
    );
    await run("wrong-path", "personal");
    await pglite.query(
      "UPDATE automation_runs SET path = 'jobs/other.md' WHERE id = 'wrong-path'",
    );
    await run("new-resource", "personal");
    await pglite.query(
      "UPDATE automation_runs SET started_at = 0 WHERE id = 'new-resource'",
    );
    const before = await pglite.query(
      "SELECT * FROM automation_runs ORDER BY id",
    );
    expect(
      (await backfillRunHistoryOwnership(db, { apply: true })).movedRows,
    ).toBe(0);
    expect(
      (await pglite.query("SELECT * FROM automation_runs ORDER BY id")).rows,
    ).toEqual(before.rows);
  });

  it("defers active, queued and inconsistent-scope rows", async () => {
    await job("personal");
    await run("active", "personal");
    await run("queued", "personal");
    await run("wrong-scope", "personal");
    await pglite.query(
      "UPDATE automation_runs SET status = 'running' WHERE id = 'active'",
    );
    await pglite.query(
      "UPDATE automation_runs SET dispatch_pending = 1 WHERE id = 'queued'",
    );
    await pglite.query(
      "UPDATE automation_runs SET scope = 'personal' WHERE id = 'wrong-scope'",
    );
    expect(
      await backfillRunHistoryOwnership(db, { apply: true }),
    ).toMatchObject({
      eligibleRows: 0,
      deferredRows: 3,
      movedRows: 0,
    });
  });

  it("fails and rolls back on unreadable lineage rather than guessing", async () => {
    await job("personal");
    await run("valid", "personal");
    await run("invalid", "personal");
    await pglite.query(
      "UPDATE agent_trace_spans SET metadata = 'unreadable' WHERE run_id = 'invalid'",
    );
    await expect(
      backfillRunHistoryOwnership(db, { apply: true }),
    ).rejects.toThrow();
    expect(
      (
        await pglite.query(
          "SELECT count(*)::int AS count FROM automation_runs WHERE scope = 'personal'",
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
  });

  it("rejects a trace whose name only matches the old SQL wildcard prefix", async () => {
    await job("personal");
    await run("near-match", "personal");
    await pglite.query(
      "UPDATE agent_trace_spans SET name = 'backgroundXautomationYrun:digest'",
    );
    expect(
      await backfillRunHistoryOwnership(db, { apply: true }),
    ).toMatchObject({
      eligibleRows: 0,
      ambiguousRows: 1,
      movedRows: 0,
    });
  });

  it("counts mismatched organization provenance as ambiguous", async () => {
    await job("org", "__organization__:acme");
    await run("wrong-path", "org");
    await run("before-creation", "org");
    await pglite.query(
      "UPDATE automation_runs SET path = 'jobs/other.md' WHERE id = 'wrong-path'",
    );
    await pglite.query(
      "UPDATE automation_runs SET started_at = 0 WHERE id = 'before-creation'",
    );
    expect(
      await backfillRunHistoryOwnership(db, { apply: true }),
    ).toMatchObject({
      organizationJobRows: 0,
      ambiguousRows: 2,
      movedRows: 0,
    });
  });

  it("rolls back completed writes when the update count disagrees", async () => {
    await job("personal");
    await run("eligible", "personal");
    const inconsistent: DbExec = {
      ...db,
      transaction: (fn) =>
        db.transaction!((tx) =>
          fn({
            ...tx,
            execute: async (statement) => {
              const result = await tx.execute(statement);
              const sql =
                typeof statement === "string" ? statement : statement.sql;
              return sql.includes("UPDATE automation_runs h")
                ? { ...result, rows: [] }
                : result;
            },
          }),
        ),
    };
    await expect(
      backfillRunHistoryOwnership(inconsistent, { apply: true }),
    ).rejects.toThrow("transaction rolled back");
    expect(
      (await pglite.query("SELECT owner, scope, org_id FROM automation_runs"))
        .rows,
    ).toEqual([
      { owner: "__organization__:acme", scope: "organization", org_id: "acme" },
    ]);
  });
});
