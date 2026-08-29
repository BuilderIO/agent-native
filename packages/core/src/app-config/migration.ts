import { z } from "zod";

export const migrationConfig = z.object({
  releaseMigrations: z.boolean().default(false).meta({
    env: "AGENT_NATIVE_RELEASE_MIGRATIONS",
    doc: "Treat database migrations as release-owned so request runtimes only probe an already-prepared schema.",
  }),
  runningReleaseMigrations: z.boolean().default(false).meta({
    env: "AGENT_NATIVE_RUN_RELEASE_MIGRATIONS",
    doc: "Set only by the production deploy step while it executes migrate:production, so that step can refuse to migrate a local database.",
  }),
  betaSchemaOwner: z.string().trim().min(1).optional().meta({
    env: "AGENT_NATIVE_BETA_SCHEMA_OWNER",
    doc: "Schema owner marker embedded in a prebuilt beta server bundle.",
  }),
});
