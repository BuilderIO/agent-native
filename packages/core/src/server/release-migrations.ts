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
import { getDatabaseUrl } from "../db/client.js";
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
import { recordDatabaseIdentity } from "./database-identity.js";
import { IDENTITY_SSO_MIGRATIONS } from "./identity-sso-migrations.js";
import { runFrameworkSchemaEnsures } from "./release-schema.js";

/**
 * A release deploy whose `DATABASE_URL` resolves to a local development
 * database migrates nothing: that database dies with the build container while
 * deployed functions keep talking to the real database. Every later signal
 * still reports success — `Applied migration ...` lines, a zero exit, a
 * published deploy — so this has to fail here or it fails silently forever.
 *
 * Scoped to `CONTEXT=production` on purpose. The beta lane deliberately builds
 * with `AGENT_NATIVE_RUN_RELEASE_MIGRATIONS=1` under a branch-deploy context
 * against masked site secrets, and its databases are migrated by their
 * production twin — so keying off that flag would fail every beta deploy while
 * never guarding the production one this exists for.
 */
function assertReleaseMigrationTargetsRemoteDatabase(): void {
  if (getAppConfig().migration.deployContext !== "production") return;
  const url = getDatabaseUrl();
  // `isLocalDatabase()` alone is not enough. Netlify hands the CLI a MASKED
  // secret ("****************uire") outside its own build infra, and that is
  // neither empty nor a local URL — so it reads as "not local" while being
  // unconnectable. Require a real remote scheme too.
  if (url.includes("://")) return;
  throw new Error(
    `Release migrations resolved to an unusable database (${describeReleaseMigrationUrl(url)}). ` +
      "In a production deploy the schema must be applied to the same remote " +
      "database the deployed functions use; migrating a local or unconnectable " +
      "URL succeeds silently and publishes a site whose database never received " +
      "the schema. Supply the site's real DATABASE_URL to the deploy step. Note " +
      "NETLIFY_DATABASE_URL and NETLIFY_DATABASE_URL_UNPOOLED take precedence " +
      "over DATABASE_URL in the deploy build command, so a masked value in " +
      "either of those overrides a correct DATABASE_URL.",
  );
}

/** Describes the URL shape without ever echoing a credential into build logs. */
function describeReleaseMigrationUrl(url: string): string {
  if (!url) return "unset";
  if (url.startsWith("pglite:")) return "local database";
  const scheme = url.includes("://") ? url.split("://")[0] : undefined;
  return scheme ? `${scheme} url` : "no scheme — likely a masked secret";
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
  // Immediately after: the `settings` table this writes to now exists, and
  // this must fail the release the same way a schema-ensure failure does —
  // a deploy that silently never recorded which app owns this database is
  // the exact incident this exists to catch, not something to shrug off and
  // keep migrating on.
  await recordDatabaseIdentity();
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
