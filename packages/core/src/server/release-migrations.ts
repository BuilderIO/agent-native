import { getAppConfig } from "../app-config/index.js";
import { getDatabaseUrl } from "../db/client.js";
import { withStoreMigrationLock } from "../db/store-registry.js";
import { ensureSharingAccessIndexes } from "../sharing/indexes.js";
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

function shouldLogReleaseTiming(): boolean {
  return (
    typeof process !== "undefined" &&
    typeof process.uptime === "function" &&
    process.env.VITEST !== "true" &&
    process.env.VITEST !== "1"
  );
}

export async function runFrameworkReleaseMigrations(
  _nitroApp?: unknown,
): Promise<void> {
  const logTiming = shouldLogReleaseTiming();
  const startedAt = Date.now();
  if (logTiming) {
    console.log(
      `[db] Migration runtime ready ${Math.round(process.uptime() * 1_000)}ms after process start`,
    );
  }
  let lockWaitMs: number | undefined;
  try {
    assertReleaseMigrationTargetsRemoteDatabase();
    // One lease for the whole release, so two deploys against one database
    // never interleave.
    await withStoreMigrationLock(async () => {
      lockWaitMs = Date.now() - startedAt;
      await runFrameworkSchemaEnsures();
      await recordDatabaseIdentity();
      // Last, so the framework's own share and owner tables exist. An app's tables
      // are indexed by the release after the one that creates them.
      await ensureSharingAccessIndexes();
    });
  } catch (err) {
    if (logTiming) {
      const lockWait =
        lockWaitMs === undefined
          ? "lock not acquired"
          : `lock wait ${lockWaitMs}ms`;
      console.log(
        `[db] Framework release migrations failed after ${Date.now() - startedAt}ms (${lockWait})`,
      );
    }
    throw err;
  }
  if (logTiming) {
    console.log(
      `[db] Framework release migrations finished in ${Date.now() - startedAt}ms (lock wait ${lockWaitMs}ms)`,
    );
  }
}
