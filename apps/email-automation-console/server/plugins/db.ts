import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      name: "email-automation-console-tables",
      sql: `CREATE TABLE IF NOT EXISTS email_automations (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        schedule TEXT NOT NULL,
        recipient TEXT NOT NULL,
        prompt TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS email_automations_owner_slug_idx
        ON email_automations (owner_email, slug);
      CREATE TABLE IF NOT EXISTS email_automation_runs (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        automation_id TEXT NOT NULL,
        recipient TEXT NOT NULL,
        status TEXT NOT NULL,
        stage TEXT NOT NULL,
        error_message TEXT,
        subject TEXT NOT NULL,
        preview_intro TEXT NOT NULL,
        preview_items TEXT NOT NULL,
        prompt_snapshot TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS email_automation_runs_owner_created_idx
        ON email_automation_runs (owner_email, created_at);`,
    },
    {
      version: 2,
      name: "email-automation-console-unique-defaults",
      sql: `DELETE FROM email_automations
        WHERE EXISTS (
          SELECT 1 FROM email_automations older
          WHERE older.owner_email = email_automations.owner_email
            AND older.slug = email_automations.slug
            AND (
              older.updated_at < email_automations.updated_at
              OR (
                older.updated_at = email_automations.updated_at
                AND older.id < email_automations.id
              )
            )
        );
      CREATE UNIQUE INDEX IF NOT EXISTS email_automations_owner_slug_unique_idx
        ON email_automations (owner_email, slug);`,
    },
  ],
  { table: "email_automation_console_migrations" },
);
