import { CONTEXT_XRAY_MIGRATIONS } from "../agent/context-xray/migrations.js";
import { OBSERVATIONAL_MEMORY_MIGRATIONS } from "../agent/observational-memory/migrations.js";
import { getAppConfig } from "../app-config/index.js";
import { getDatabaseUrl } from "../db/client.js";
import { runMigrations } from "../db/migrations.js";
import { withStoreMigrationLock } from "../db/store-registry.js";
import { ORG_MIGRATIONS } from "../org/migrations.js";
import { ensureSharingAccessIndexes } from "../sharing/indexes.js";
import { runAutomationTriggerEventMigrations } from "../triggers/event-queue.js";
import { runBetterAuthMigrations } from "./better-auth-migrations.js";
import { recordDatabaseIdentity } from "./database-identity.js";
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
 * against masked site secrets, and its database is migrated by the beta
 * publish step — so keying off that flag would fail every beta deploy while
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

function describeReleaseMigrationUrl(url: string): string {
  if (!url) return "unset";
  if (url.startsWith("pglite:")) return "local database";
  const scheme = url.includes("://") ? url.split("://")[0] : undefined;
  return scheme ? `${scheme} url` : "no scheme — likely a masked secret";
}

export async function runFrameworkReleaseMigrations(
  nitroApp: unknown,
): Promise<void> {
  assertReleaseMigrationTargetsRemoteDatabase();
  // One lease for the whole release: the store pass, Better Auth and every
  // versioned list, so two deploys against one database never interleave.
  await withStoreMigrationLock(async () => {
    // First: the versioned migration lists below only cover the tables that have
    // one. Most framework tables are defined by their store's `ensureTable()`,
    // which production serverless can never run — see `./release-schema.ts`.
    await runFrameworkSchemaEnsures();
    await recordDatabaseIdentity();
    await runBetterAuthMigrations(nitroApp);
    await runMigrations(ORG_MIGRATIONS, { table: "_org_migrations" })(nitroApp);
    await runMigrations(CONTEXT_XRAY_MIGRATIONS, {
      table: "_context_xray_migrations",
    })(nitroApp);
    await runMigrations(OBSERVATIONAL_MEMORY_MIGRATIONS, {
      table: "_observational_memory_migrations",
    })(nitroApp);
    await runAutomationTriggerEventMigrations(nitroApp);
    // Last, so the framework's own share and owner tables exist. An app's tables
    // are indexed by the release after the one that creates them.
    await ensureSharingAccessIndexes();
  });
}
