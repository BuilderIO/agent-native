import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { putUserSetting } from "@agent-native/core/settings";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nanoid, nowIso } from "../server/lib/brain.js";

const DEFAULT_PROJECT_SETTING = "brain-default-project";

export default defineAction({
  description:
    "Create, update, remove, or select a Brain project that scopes related knowledge sources.",
  schema: z.object({
    operation: z.enum(["create", "update", "delete", "set-default"]),
    projectId: z.string().optional(),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    sourceIds: z.array(z.string().min(1)).optional(),
  }),
  run: async (args) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("Not authenticated");
    const db = getDb();
    const now = nowIso();

    if (args.operation === "create") {
      if (!args.title) throw new Error("title is required");
      const id = args.projectId ?? nanoid();
      await db.insert(schema.brainProjects).values({
        id,
        title: args.title,
        description: args.description ?? "",
        ownerEmail: userEmail,
        orgId: getRequestOrgId() ?? null,
        visibility: "private",
        createdAt: now,
        updatedAt: now,
      });
      await replaceProjectSources(id, args.sourceIds ?? []);
      return { projectId: id, operation: args.operation };
    }

    if (!args.projectId) throw new Error("projectId is required");
    if (args.operation === "set-default") {
      await assertAccess("brain-project", args.projectId, "viewer");
      await putUserSetting(userEmail, DEFAULT_PROJECT_SETTING, {
        projectId: args.projectId,
      });
      return { projectId: args.projectId, default: true };
    }

    await assertAccess("brain-project", args.projectId, "editor");
    if (args.operation === "delete") {
      await db
        .delete(schema.brainProjectSources)
        .where(eq(schema.brainProjectSources.projectId, args.projectId));
      await db
        .delete(schema.brainProjectShares)
        .where(eq(schema.brainProjectShares.resourceId, args.projectId));
      await db
        .delete(schema.brainProjects)
        .where(eq(schema.brainProjects.id, args.projectId));
      return { projectId: args.projectId, deleted: true };
    }

    await db
      .update(schema.brainProjects)
      .set({
        ...(args.title ? { title: args.title } : {}),
        ...(args.description !== undefined
          ? { description: args.description }
          : {}),
        updatedAt: now,
      })
      .where(eq(schema.brainProjects.id, args.projectId));
    if (args.sourceIds) {
      await replaceProjectSources(args.projectId, args.sourceIds);
    }
    return { projectId: args.projectId, operation: args.operation };
  },
});

async function replaceProjectSources(projectId: string, sourceIds: string[]) {
  const db = getDb();
  const unique = Array.from(new Set(sourceIds));
  if (unique.length) {
    const accessible = await db
      .select({ id: schema.brainSources.id })
      .from(schema.brainSources)
      .where(
        and(
          accessFilter(schema.brainSources, schema.brainSourceShares),
          inArray(schema.brainSources.id, unique),
        ),
      );
    if (accessible.length !== unique.length) {
      throw new Error("One or more Brain sources were not found");
    }
  }
  await db
    .delete(schema.brainProjectSources)
    .where(eq(schema.brainProjectSources.projectId, projectId));
  if (!unique.length) return;
  await db.insert(schema.brainProjectSources).values(
    unique.map((sourceId) => ({
      id: nanoid(),
      projectId,
      sourceId,
      createdAt: nowIso(),
    })),
  );
}
