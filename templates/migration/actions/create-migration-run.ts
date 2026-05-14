import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { z } from "zod";
import { artifactRoot, assertSafeOutputRoot, normalizePath } from "./_utils.js";
import { createMigrationRun } from "@agent-native/migrate";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Create a Migration Workbench run. This only records source/output paths; it does not mutate the source or generated output.",
  schema: z.object({
    name: z.string().optional().describe("Human-readable run name"),
    sourceRoot: z.string().describe("Existing Next.js app path"),
    outputRoot: z
      .string()
      .optional()
      .describe("Generated agent-native app path"),
    target: z.string().optional().default("agent-native"),
  }),
  run: async (args) => {
    const sourceRoot = normalizePath(args.sourceRoot);
    const outputRoot = normalizePath(args.outputRoot ?? "../migrated-app");
    assertSafeOutputRoot(sourceRoot, outputRoot);
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("No authenticated user");
    const orgId = getRequestOrgId();

    const run = await createMigrationRun({
      sourceRoot,
      outputRoot,
      artifactRoot: artifactRoot(),
      target: args.target,
    });
    const now = new Date().toISOString();
    const db = getDb();
    await db.insert(schema.migrationRuns).values({
      id: run.id,
      name: args.name || `Migration ${run.id}`,
      sourceRoot,
      outputRoot,
      target: run.target,
      phase: run.phase,
      approved: run.approved,
      artifactDir: run.artifactDir,
      createdAt: now,
      updatedAt: now,
      ownerEmail,
      orgId,
      visibility: "private",
    });
    return { run };
  },
});
