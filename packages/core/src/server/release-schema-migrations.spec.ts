import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { AGENT_HARNESS_SESSION_MIGRATIONS } from "../agent/harness/migrations.js";
import { AGENT_RUN_MIGRATIONS } from "../agent/run-migrations.js";
import { CHAT_THREAD_SCHEMA_MIGRATIONS } from "../chat-threads/schema-migrations.js";
import type { MigrationEntry } from "../db/migrations.js";
import { USAGE_ALERT_MIGRATIONS } from "../usage/migrations.js";

function applySqliteMigrations(
  db: Database.Database,
  migrations: MigrationEntry[],
): void {
  for (const migration of migrations) {
    if (typeof migration.sql !== "string") {
      throw new Error(`Expected ${migration.name} to use shared SQL`);
    }
    for (const statement of migration.sql
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)) {
      try {
        db.exec(statement.replace(/ADD COLUMN IF NOT EXISTS/gi, "ADD COLUMN"));
      } catch (error) {
        if (!/duplicate column name/i.test(String(error))) throw error;
      }
    }
  }
}

function columns(db: Database.Database, table: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  ).map((column) => column.name);
}

describe("framework release schema migrations", () => {
  it("creates the chat thread schema used by active-run ownership reads", () => {
    const db = new Database(":memory:");
    applySqliteMigrations(db, CHAT_THREAD_SCHEMA_MIGRATIONS);

    expect(columns(db, "chat_threads")).toEqual(
      expect.arrayContaining([
        "owner_email",
        "thread_data",
        "message_count",
        "scope_type",
        "org_id",
        "visibility",
      ]),
    );
    expect(columns(db, "chat_thread_shares")).toEqual(
      expect.arrayContaining(["resource_id", "principal_id"]),
    );
    db.close();
  });

  it("creates the run and event columns used by failure diagnostics", () => {
    const db = new Database(":memory:");
    applySqliteMigrations(db, AGENT_RUN_MIGRATIONS);

    expect(columns(db, "agent_runs")).toEqual(
      expect.arrayContaining([
        "error_code",
        "terminal_reason",
        "worker_stage",
        "in_flight_since",
      ]),
    );
    expect(columns(db, "agent_run_events")).toContain("event_at");
    expect(columns(db, "agent_tool_ledger")).toContain("result_summary");
    db.close();
  });

  it("creates harness session and usage alert schemas before their actions run", () => {
    const db = new Database(":memory:");
    applySqliteMigrations(db, AGENT_HARNESS_SESSION_MIGRATIONS);
    applySqliteMigrations(db, USAGE_ALERT_MIGRATIONS);

    expect(columns(db, "agent_harness_sessions")).toEqual(
      expect.arrayContaining([
        "provider_session_id",
        "owner_email",
        "stopped_at",
      ]),
    );
    expect(columns(db, "usage_alert_rules")).toContain("is_default");
    expect(columns(db, "usage_alert_events")).toContain("notification_id");
    db.close();
  });
});
