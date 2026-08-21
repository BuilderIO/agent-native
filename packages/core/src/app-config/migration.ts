import { z } from "zod";

export const migrationConfig = z.object({
  releaseMigrations: z.boolean().default(false).meta({
    env: "AGENT_NATIVE_RELEASE_MIGRATIONS",
    doc: "Treat database migrations as release-owned so request runtimes only probe an already-prepared schema.",
  }),
  betaSchemaOwner: z.string().trim().min(1).optional().meta({
    env: "AGENT_NATIVE_BETA_SCHEMA_OWNER",
    doc: "Schema owner marker embedded in a prebuilt beta server bundle.",
  }),
});
