import { CONTEXT_XRAY_MIGRATIONS } from "../agent/context-xray/migrations.js";
import { OBSERVATIONAL_MEMORY_MIGRATIONS } from "../agent/observational-memory/migrations.js";
import {
  AGENT_TOOL_APPROVAL_MIGRATIONS,
  AGENT_TOOL_APPROVAL_MIGRATIONS_TABLE,
} from "../agent/tool-approval-migrations.js";
import { runMigrations } from "../db/migrations.js";
import { runAutomationRunMigrations } from "../jobs/run-history.js";
import { runAutomationSchedulerHealthMigrations } from "../jobs/scheduler-health.js";
import {
  OAUTH_TOKEN_MIGRATIONS,
  OAUTH_TOKEN_MIGRATIONS_TABLE,
} from "../oauth-tokens/migrations.js";
import { ORG_MIGRATIONS } from "../org/migrations.js";
import { runBetterAuthMigrations } from "./better-auth-migrations.js";

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
  await runBetterAuthMigrations(nitroApp);
  await runMigrations(AGENT_TOOL_APPROVAL_MIGRATIONS, {
    table: AGENT_TOOL_APPROVAL_MIGRATIONS_TABLE,
  })(nitroApp);
  await runMigrations(OAUTH_TOKEN_MIGRATIONS, {
    table: OAUTH_TOKEN_MIGRATIONS_TABLE,
  })(nitroApp);
  await runMigrations(ORG_MIGRATIONS, { table: "_org_migrations" })(nitroApp);
  await runMigrations(CONTEXT_XRAY_MIGRATIONS, {
    table: "_context_xray_migrations",
  })(nitroApp);
  await runMigrations(OBSERVATIONAL_MEMORY_MIGRATIONS, {
    table: "_observational_memory_migrations",
  })(nitroApp);
  await runAutomationRunMigrations(nitroApp);
  await runAutomationSchedulerHealthMigrations(nitroApp);
}
