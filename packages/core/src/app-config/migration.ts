import { z } from "zod";

export const migrationConfig = z.object({
  releaseMigrations: z.boolean().default(false).meta({
    env: "AGENT_NATIVE_RELEASE_MIGRATIONS",
    doc: "Treat database migrations as release-owned so request runtimes only probe an already-prepared schema.",
  }),
  deployContext: z.string().trim().min(1).optional().meta({
    env: "CONTEXT",
    doc: "Netlify deploy context for the build. Only 'production' owns production schema, so only that context refuses to migrate a local database.",
  }),
  skipEnsureTables: z.boolean().default(false).meta({
    env: "AGENT_NATIVE_SKIP_ENSURE_TABLES",
    doc: "Operator opt-out: never run schema setup outside the release step, for database roles that cannot run DDL.",
  }),
  betaSchemaOwner: z.string().trim().min(1).optional().meta({
    env: "AGENT_NATIVE_BETA_SCHEMA_OWNER",
    doc: "Schema owner marker embedded in a prebuilt beta server bundle.",
  }),
});
