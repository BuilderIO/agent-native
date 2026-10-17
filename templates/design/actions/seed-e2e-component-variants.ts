import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

const componentName = "E2EButton";
const props = [
  { name: "variant", type: "primary | secondary | ghost" },
  { name: "size", type: "sm | md | lg" },
];
const variants = {
  variant: ["primary", "secondary", "ghost"],
  size: ["sm", "md", "lg"],
};

export default defineAction({
  description:
    "Seed component variant metadata for an authenticated local E2E run. " +
    "Unavailable in production and when E2E_RUN_ROOT is unset.",
  schema: z
    .object({
      designId: z
        .string()
        .min(1)
        .describe(
          "Design project ID whose E2EButton metadata should be seeded.",
        ),
    })
    .strict(),
  readOnly: false,
  agentTool: false,
  http: { method: "POST" },
  run: async ({ designId }) => {
    if (!process.env.E2E_RUN_ROOT || process.env.NODE_ENV === "production") {
      fail("Not found", { errorCode: "not_found", statusCode: 404 });
    }
    if (!getRequestUserEmail()) {
      fail("Unauthorized", { errorCode: "unauthorized", statusCode: 401 });
    }

    await assertAccess("design", designId, "editor");
    const db = getDb();
    const rows = await db
      .select({ id: schema.componentIndex.id })
      .from(schema.componentIndex)
      .where(
        and(
          eq(schema.componentIndex.designId, designId),
          eq(schema.componentIndex.name, componentName),
        ),
      )
      .limit(2);
    if (rows.length !== 1) {
      fail("Expected one indexed E2EButton component", {
        errorCode: "component_metadata_fixture_not_unique",
        statusCode: 409,
      });
    }

    const updated = await db
      .update(schema.componentIndex)
      .set({
        filePath: "index.html",
        exportName: componentName,
        props: JSON.stringify(props),
        variants: JSON.stringify(variants),
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(schema.componentIndex.id, rows[0]!.id),
          eq(schema.componentIndex.designId, designId),
          eq(schema.componentIndex.name, componentName),
        ),
      )
      .returning({ id: schema.componentIndex.id });
    if (updated.length !== 1) {
      fail("Component metadata fixture was not updated", {
        errorCode: "component_metadata_fixture_update_failed",
        statusCode: 409,
      });
    }

    return { designId, componentName };
  },
});
