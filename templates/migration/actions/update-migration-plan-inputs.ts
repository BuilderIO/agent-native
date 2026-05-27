import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getRunRow, resolvePlanInputsUpdate } from "./_utils.js";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Update a Migration Workbench run's custom plan inputs before a plan is generated.",
  schema: z.object({
    id: z.string().describe("Migration run ID"),
    planInputs: z
      .unknown()
      .optional()
      .describe("Custom migration profile JSON. Pass null to clear it."),
    planInputsText: z
      .string()
      .optional()
      .describe("Raw JSON or notes to infer a migration profile from."),
  }),
  run: async ({ id, planInputs, planInputsText }) => {
    await assertAccess("migration-run", id, "editor");
    const row = await getRunRow(id);
    if (row.planPath) {
      throw new Error(
        "Plan inputs cannot be changed after a plan is generated. Create a new run or clear the plan through a dedicated reset flow.",
      );
    }

    const normalized = resolvePlanInputsUpdate({ planInputs, planInputsText });
    const planInputsJson = normalized
      ? JSON.stringify(normalized, null, 2)
      : null;
    const updatedAt = new Date().toISOString();

    await getDb()
      .update(schema.migrationRuns)
      .set({ planInputsJson, updatedAt })
      .where(eq(schema.migrationRuns.id, id));

    return {
      ok: true,
      planInputs: normalized,
      updatedAt,
    };
  },
});
