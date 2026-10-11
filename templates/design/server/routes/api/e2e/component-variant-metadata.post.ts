import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import {
  createError,
  defineEventHandler,
  readBody,
  setResponseStatus,
} from "h3";
import { z } from "zod";

import { getDb, schema } from "../../../db/index.js";

const componentName = "E2EButton";
const props = [
  { name: "variant", type: "primary | secondary | ghost" },
  { name: "size", type: "sm | md | lg" },
];
const variants = {
  variant: ["primary", "secondary", "ghost"],
  size: ["sm", "md", "lg"],
};

export default defineEventHandler(async (event) => {
  if (!process.env.E2E_RUN_ROOT || process.env.NODE_ENV === "production") {
    setResponseStatus(event, 404);
    return { error: "Not found" };
  }

  const session = await getSession(event);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  const parsed = z
    .object({ designId: z.string().min(1) })
    .strict()
    .safeParse(await readBody(event));
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid fixture request",
    });
  }

  return runWithRequestContext(
    {
      userEmail: session.email,
      ...(session.orgId ? { orgId: session.orgId } : {}),
    },
    async () => {
      await assertAccess("design", parsed.data.designId, "editor");
      const db = getDb();
      const rows = await db
        .select({ id: schema.componentIndex.id })
        .from(schema.componentIndex)
        .where(
          and(
            eq(schema.componentIndex.designId, parsed.data.designId),
            eq(schema.componentIndex.name, componentName),
          ),
        )
        .limit(2);
      if (rows.length !== 1) {
        throw createError({
          statusCode: 409,
          statusMessage: "Expected one indexed E2EButton component",
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
            eq(schema.componentIndex.designId, parsed.data.designId),
            eq(schema.componentIndex.name, componentName),
          ),
        )
        .returning({ id: schema.componentIndex.id });
      if (updated.length !== 1) {
        throw createError({
          statusCode: 409,
          statusMessage: "Component metadata fixture was not updated",
        });
      }

      return { designId: parsed.data.designId, componentName };
    },
  );
});
