import { describe, expect, it } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { AGENT_HARNESS_SESSION_MIGRATIONS } from "../agent/harness/migrations.js";
import { AGENT_RUN_MIGRATIONS } from "../agent/run-migrations.js";
import { CHAT_THREAD_SCHEMA_MIGRATIONS } from "../chat-threads/schema-migrations.js";
import type { MigrationEntry } from "../db/migrations.js";
import { REMOTE_DEVICE_MIGRATIONS } from "../integrations/remote-device-migrations.js";
import { USAGE_ALERT_MIGRATIONS } from "../usage/migrations.js";

async function applyMigrations(
  db: Awaited<ReturnType<typeof createTestPglite>>,
  migrations: MigrationEntry[],
) {
  for (const migration of migrations) {
    const sql =
      typeof migration.sql === "string"
        ? migration.sql
        : (migration.sql.postgres ?? "");
    if (sql) await db.exec(sql);
  }
}
async function columns(
  db: Awaited<ReturnType<typeof createTestPglite>>,
  table: string,
): Promise<string[]> {
  const rows = await db
    .prepare(
      "SELECT column_name FROM information_schema.columns WHERE table_name = ? ORDER BY ordinal_position",
    )
    .all(table);
  return rows.map((row) => row.column_name);
}

describe("framework release schema migrations", () => {
  it("creates the chat thread schema used by active-run ownership reads", async () => {
    const db = await createTestPglite();
    await applyMigrations(db, CHAT_THREAD_SCHEMA_MIGRATIONS);
    expect(await columns(db, "chat_threads")).toEqual(
      expect.arrayContaining([
        "owner_email",
        "thread_data",
        "message_count",
        "scope_type",
        "org_id",
        "visibility",
      ]),
    );
    expect(await columns(db, "chat_thread_shares")).toEqual(
      expect.arrayContaining(["resource_id", "principal_id"]),
    );
    await db.close();
  });
  it("creates the run and event columns used by failure diagnostics", async () => {
    const db = await createTestPglite();
    await applyMigrations(db, AGENT_RUN_MIGRATIONS);
    expect(await columns(db, "agent_runs")).toEqual(
      expect.arrayContaining([
        "error_code",
        "terminal_reason",
        "worker_stage",
        "in_flight_since",
      ]),
    );
    expect(await columns(db, "agent_run_events")).toContain("event_at");
    expect(await columns(db, "agent_tool_ledger")).toContain("result_summary");
    await db.close();
  });
  it("creates harness schemas and tolerates rerunning their migrations", async () => {
    const db = await createTestPglite();
    await applyMigrations(db, AGENT_HARNESS_SESSION_MIGRATIONS);
    await applyMigrations(db, AGENT_HARNESS_SESSION_MIGRATIONS);
    await applyMigrations(db, USAGE_ALERT_MIGRATIONS);
    expect(await columns(db, "agent_harness_sessions")).toEqual(
      expect.arrayContaining([
        "provider_session_id",
        "owner_email",
        "generation",
        "stopped_at",
      ]),
    );
    expect(
      AGENT_HARNESS_SESSION_MIGRATIONS.find((m) => m.version === 3)?.sql,
    ).toMatchObject({
      postgres: expect.stringContaining("ALTER COLUMN created_at TYPE BIGINT"),
    });
    expect(
      AGENT_HARNESS_SESSION_MIGRATIONS.find((m) => m.version === 4)?.sql,
    ).toMatchObject({ postgres: expect.stringContaining("generation BIGINT") });
    expect(
      (
        await db
          .prepare(
            "SELECT data_type FROM information_schema.columns WHERE table_name = 'agent_harness_sessions' AND column_name IN ('created_at', 'updated_at', 'stopped_at')",
          )
          .all()
      ).every((column) =>
        [
          "bigint",
          "timestamp without time zone",
          "timestamp with time zone",
        ].includes(column.data_type),
      ),
    ).toBe(true);
    expect(await columns(db, "usage_alert_rules")).toContain("is_default");
    expect(await columns(db, "usage_alert_events")).toContain(
      "notification_id",
    );
    await db.close();
  });
  it("creates the remote-device schema before Portal requests run", async () => {
    const db = await createTestPglite();
    await applyMigrations(db, REMOTE_DEVICE_MIGRATIONS);
    expect(await columns(db, "integration_remote_devices")).toEqual(
      expect.arrayContaining([
        "device_token_hash",
        "last_seen_at",
        "metadata_json",
        "revoked_at",
      ]),
    );
    expect(
      await db
        .prepare(
          "SELECT indexname FROM pg_indexes WHERE tablename = 'integration_remote_devices' AND indexname IN ('idx_remote_devices_token_hash', 'idx_remote_devices_owner')",
        )
        .all(),
    ).toHaveLength(2);
    await db.close();
  });
});
