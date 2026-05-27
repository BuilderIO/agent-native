import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { z } from "zod";
import {
  artifactRoot,
  assertSafeOutputRoot,
  normalizePath,
  resolvePlanInputsUpdate,
} from "./_utils.js";
import {
  createMigrationRun,
  inferMigrationInputKind,
} from "@agent-native/migrate";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Create a Migration Workbench run. This records a path, URL, or description input; it does not mutate the source or generated output.",
  schema: z.object({
    name: z.string().optional().describe("Human-readable run name"),
    sourceRoot: z
      .string()
      .describe("Source input: local path, URL, or prose description"),
    inputKind: z.enum(["path", "url", "description"]).optional(),
    inputDescription: z
      .string()
      .optional()
      .describe("Optional human description or extra context"),
    outputRoot: z
      .string()
      .optional()
      .describe("Generated agent-native app path"),
    target: z.string().optional().default("agent-native"),
    planInputs: z
      .unknown()
      .optional()
      .describe(
        "Optional custom migration profile JSON for AEM, Builder, headless, jQuery, and verification planning.",
      ),
    planInputsText: z
      .string()
      .optional()
      .describe("Raw JSON or notes to infer a migration profile from."),
  }),
  run: async (args) => {
    const inputKind =
      args.inputKind ?? inferMigrationInputKind(args.sourceRoot);
    const sourceRoot =
      inputKind === "path"
        ? normalizePath(args.sourceRoot)
        : args.sourceRoot.trim();
    const outputRoot = normalizePath(args.outputRoot ?? "../migrated-app");
    if (!sourceRoot) throw new Error("Source input is required.");
    if (inputKind === "path") assertSafeOutputRoot(sourceRoot, outputRoot);
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("No authenticated user");
    const orgId = getRequestOrgId();
    const planInputs =
      args.planInputsText !== undefined || args.planInputs !== undefined
        ? resolvePlanInputsUpdate({
            planInputs: args.planInputs,
            planInputsText: args.planInputsText,
          })
        : null;
    const planInputsJson = planInputs
      ? JSON.stringify(planInputs, null, 2)
      : null;

    const run = await createMigrationRun({
      sourceRoot,
      inputKind,
      inputDescription: args.inputDescription,
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
      inputKind: run.inputKind,
      inputDescription: run.inputDescription,
      outputRoot,
      target: run.target,
      phase: run.phase,
      approved: run.approved,
      artifactDir: run.artifactDir,
      planInputsJson,
      createdAt: now,
      updatedAt: now,
      ownerEmail,
      orgId,
      visibility: "private",
    });
    return { run };
  },
});
