import fs from "fs/promises";
import path from "path";
import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";
import { getRunRow } from "./_utils.js";

export default defineAction({
  description:
    "Read a migration artifact from the approved run directory by basename.",
  schema: z.object({
    id: z.string().describe("Migration run ID"),
    file: z
      .enum(["01-assessment.md", "02-plan.md", "03-tasks.md", "04-report.md"])
      .describe("Artifact file to read"),
  }),
  http: { method: "GET" },
  run: async ({ id, file }) => {
    await assertAccess("migration-run", id, "viewer");
    const row = await getRunRow(id);
    const artifactPath = path.join(row.artifactDir, file);
    return {
      path: artifactPath,
      content: await fs.readFile(artifactPath, "utf-8"),
    };
  },
});
