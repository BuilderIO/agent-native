import { CONTEXT_XRAY_MIGRATIONS } from "../agent/context-xray/migrations.js";
import {
  AGENT_HARNESS_SESSION_MIGRATIONS,
  AGENT_HARNESS_SESSION_MIGRATIONS_TABLE,
} from "../agent/harness/migrations.js";
import { OBSERVATIONAL_MEMORY_MIGRATIONS } from "../agent/observational-memory/migrations.js";
import {
  AGENT_RUN_MIGRATIONS,
  AGENT_RUN_MIGRATIONS_TABLE,
} from "../agent/run-migrations.js";
import {
  AGENT_TOOL_APPROVAL_MIGRATIONS,
  AGENT_TOOL_APPROVAL_MIGRATIONS_TABLE,
} from "../agent/tool-approval-migrations.js";
import { getAppConfig } from "../app-config/index.js";
import {
  CHAT_THREAD_SCHEMA_MIGRATIONS,
  CHAT_THREAD_SCHEMA_MIGRATIONS_TABLE,
} from "../chat-threads/schema-migrations.js";
import { isLocalDatabase } from "../db/client.js";
import { runMigrations } from "../db/migrations.js";
import {
  REMOTE_DEVICE_MIGRATIONS,
  REMOTE_DEVICE_MIGRATIONS_TABLE,
} from "../integrations/remote-device-migrations.js";
import { runAutomationRunMigrations } from "../jobs/run-history.js";
import { runAutomationSchedulerHealthMigrations } from "../jobs/scheduler-health.js";
import {
  OAUTH_TOKEN_MIGRATIONS,
  OAUTH_TOKEN_MIGRATIONS_TABLE,
} from "../oauth-tokens/migrations.js";
import { ORG_MIGRATIONS } from "../org/migrations.js";
import {
  USAGE_ALERT_MIGRATIONS,
  USAGE_ALERT_MIGRATIONS_TABLE,
} from "../usage/migrations.js";
import {
  WORKSPACE_CONNECTIONS_MIGRATIONS,
  WORKSPACE_CONNECTIONS_MIGRATIONS_TABLE,
} from "../workspace-connections/migrations.js";
import { runBetterAuthMigrations } from "./better-auth-migrations.js";
import { IDENTITY_SSO_MIGRATIONS } from "./identity-sso-migrations.js";
import { runFrameworkSchemaEnsures } from "./release-schema.js";

/**
 * A release deploy whose `DATABASE_URL` resolves to a local SQLite file
 * migrated nothing: the file dies with the build container while the deployed
 * functions keep talking to the real database. Every later signal still reports
 * success — `Applied migration ...` lines, a zero exit, a published deploy — so
 * this has to fail here or it fails silently forever. CRM shipped this way and
 * served 500s on every write because its `jwks`/`user` tables were never
 * created on the database its functions actually use.
 *
 * `migration.runningReleaseMigrations` (env `AGENT_NATIVE_RUN_RELEASE_MIGRATIONS`)
 * is set by exactly one caller, the production deploy workflow, so this can
 * never trip a test or a local run.
 */
function assertReleaseMigrationTargetsRemoteDatabase(): void {
  if (!getAppConfig().migration.runningReleaseMigrations) return;
  if (!isLocalDatabase()) return;
  throw new Error(
    "Release migrations resolved to a local database. DATABASE_URL is unset " +
      "or local in this deploy step, so migrations would apply to a throwaway " +
      "file while the deployed functions keep using the remote database. " +
      "Supply the site's DATABASE_URL to the deploy step before publishing.",
  );
}

/**
 * Apply framework-owned schema in one explicit release step.
 *
 * Template migrations are intentionally supplied by the template's own
 * release script. Keeping that boundary explicit prevents a template's
 * private schema from being silently coupled to every framework deployment.
 */
export async function runFrameworkReleaseMigrations(
  nitroApp: unknown,
): Promise<void> {
  assertReleaseMigrationTargetsRemoteDatabase();
  // First: the versioned migration lists below only cover the tables that have
  // one. Most framework tables are defined by their store's `ensureTable()`,
  // which production serverless can never run — see `./release-schema.ts`.
  await runFrameworkSchemaEnsures();
  await runBetterAuthMigrations(nitroApp);
  await runMigrations(AGENT_TOOL_APPROVAL_MIGRATIONS, {
    table: AGENT_TOOL_APPROVAL_MIGRATIONS_TABLE,
  })(nitroApp);
  await runMigrations(OAUTH_TOKEN_MIGRATIONS, {
    table: OAUTH_TOKEN_MIGRATIONS_TABLE,
  })(nitroApp);
  await runMigrations(CHAT_THREAD_SCHEMA_MIGRATIONS, {
    table: CHAT_THREAD_SCHEMA_MIGRATIONS_TABLE,
  })(nitroApp);
  await runMigrations(AGENT_RUN_MIGRATIONS, {
    table: AGENT_RUN_MIGRATIONS_TABLE,
  })(nitroApp);
  await runMigrations(AGENT_HARNESS_SESSION_MIGRATIONS, {
    table: AGENT_HARNESS_SESSION_MIGRATIONS_TABLE,
  })(nitroApp);
  await runMigrations(USAGE_ALERT_MIGRATIONS, {
    table: USAGE_ALERT_MIGRATIONS_TABLE,
  })(nitroApp);
  await runMigrations(ORG_MIGRATIONS, { table: "_org_migrations" })(nitroApp);
  await runMigrations(REMOTE_DEVICE_MIGRATIONS, {
    table: REMOTE_DEVICE_MIGRATIONS_TABLE,
  })(nitroApp);
  await runMigrations(IDENTITY_SSO_MIGRATIONS, {
    table: "_identity_sso_migrations",
  })(nitroApp);
  await runMigrations(CONTEXT_XRAY_MIGRATIONS, {
    table: "_context_xray_migrations",
  })(nitroApp);
  await runMigrations(OBSERVATIONAL_MEMORY_MIGRATIONS, {
    table: "_observational_memory_migrations",
  })(nitroApp);
  await runMigrations(WORKSPACE_CONNECTIONS_MIGRATIONS, {
    table: WORKSPACE_CONNECTIONS_MIGRATIONS_TABLE,
  })(nitroApp);
  await runAutomationRunMigrations(nitroApp);
  await runAutomationSchedulerHealthMigrations(nitroApp);
}
