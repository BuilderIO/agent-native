import { describe, expect, it } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { AUTOMATION_RUN_MIGRATIONS } from "../jobs/run-history.js";
import {
  AUTOMATION_THREAD_SOURCE_BACKFILL_SQL,
  CHAT_THREAD_SCHEMA_MIGRATIONS,
} from "./schema-migrations.js";

type Db = Awaited<ReturnType<typeof createTestPglite>>;

async function apply(db: Db, migrations: typeof CHAT_THREAD_SCHEMA_MIGRATIONS) {
  for (const m of migrations) {
    const sql = typeof m.sql === "string" ? m.sql : (m.sql.postgres ?? "");
    if (sql) await db.exec(sql);
  }
}

async function sourceOf(db: Db, id: string) {
  const r = await db.query<{ source_app_id: string | null }>(
    "SELECT source_app_id FROM chat_threads WHERE id = $1",
    [id],
  );
  return r.rows[0]?.source_app_id;
}

describe("automation thread source_app_id backfill", () => {
  it("tags untagged automation threads from run history and leaves ambiguous ones", async () => {
    const db = await createTestPglite();
    await apply(db, CHAT_THREAD_SCHEMA_MIGRATIONS);
    await apply(db, AUTOMATION_RUN_MIGRATIONS);
    for (const id of ["t-a", "t-both", "t-user", "t-noapp"]) {
      await db.query(
        `INSERT INTO chat_threads (id, owner_email, title, created_at, updated_at) VALUES ($1, 'a@x.test', 'Job: x', 1, 1)`,
        [id],
      );
    }
    await db.query(
      `UPDATE chat_threads SET source_app_id = 'mail' WHERE id = 't-user'`,
    );
    const run = (id: string, thread: string, app: string | null) =>
      db.query(
        `INSERT INTO automation_runs (id, owner, automation, path, app_id, thread_id, started_at) VALUES ($1, 'a@x.test', 'job', 'jobs/job.md', $2, $3, 1)`,
        [id, app, thread],
      );
    await run("r1", "t-a", "analytics");
    await run("r2", "t-both", "analytics");
    await run("r3", "t-both", "slides");
    await run("r4", "t-user", "analytics");
    await run("r5", "t-noapp", null);

    await db.exec(AUTOMATION_THREAD_SOURCE_BACKFILL_SQL);

    expect(await sourceOf(db, "t-a")).toBe("analytics");
    expect(await sourceOf(db, "t-both")).toBeNull();
    expect(await sourceOf(db, "t-user")).toBe("mail");
    expect(await sourceOf(db, "t-noapp")).toBeNull();
  });

  it("is a no-op when automation_runs does not exist", async () => {
    const db = await createTestPglite();
    await apply(db, CHAT_THREAD_SCHEMA_MIGRATIONS);
    await db.exec(AUTOMATION_THREAD_SOURCE_BACKFILL_SQL);
    expect(await sourceOf(db, "none")).toBeUndefined();
  });
});
