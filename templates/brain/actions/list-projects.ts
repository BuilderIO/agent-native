import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { getUserSetting } from "@agent-native/core/settings";
import { accessFilter } from "@agent-native/core/sharing";
import { inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

const DEFAULT_PROJECT_SETTING = "brain-default-project";

export default defineAction({
  description: "List accessible Brain projects and their source membership.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async () => {
    const db = getDb();
    const projects = await db
      .select()
      .from(schema.brainProjects)
      .where(accessFilter(schema.brainProjects, schema.brainProjectShares));
    const projectIds = projects.map((project) => project.id);
    const links = projectIds.length
      ? await db
          .select()
          .from(schema.brainProjectSources)
          .where(inArray(schema.brainProjectSources.projectId, projectIds))
      : [];
    const userEmail = getRequestUserEmail();
    const setting = userEmail
      ? ((await getUserSetting(userEmail, DEFAULT_PROJECT_SETTING)) as {
          projectId?: string;
        } | null)
      : null;
    return {
      projects: projects.map((project) => ({
        id: project.id,
        title: project.title,
        description: project.description,
        visibility: project.visibility,
        sourceIds: links
          .filter((link) => link.projectId === project.id)
          .map((link) => link.sourceId),
        isDefault: setting?.projectId === project.id,
        updatedAt: project.updatedAt,
      })),
    };
  },
});
