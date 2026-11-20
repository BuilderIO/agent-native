import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { and, desc, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  ensureDefaultWorkspace,
  formsAccess,
  formsErrors,
  nowIso,
  workspaceScope,
} from "./_access.js";
import { newFormId } from "./_form-store.js";

export default defineAction({
  description:
    "Create a workspace that holds forms, placed after the existing ones.",
  schema: z.object({
    name: z.string().trim().min(1).max(120).describe("Workspace name"),
  }),
  outputSchema: z.object({ id: z.string() }),
  errors: formsErrors,
  link: ({ result }) =>
    result
      ? {
          url: buildDeepLink({
            app: "forms-2",
            view: "workspace",
            to: `/workspaces/${encodeURIComponent(result.id)}`,
            params: { id: result.id },
          }),
          label: "Open workspace in Forms",
        }
      : null,
  run: async ({ name }) => {
    const access = formsAccess();
    await ensureDefaultWorkspace(access);
    const { workspaces } = schema;
    const db = getDb();
    const last = await db
      .select({ position: workspaces.position })
      .from(workspaces)
      .where(
        and(
          workspaceScope(access.orgId, access.userEmail),
          isNull(workspaces.deletedAt),
        ),
      )
      .orderBy(desc(workspaces.position))
      .limit(1);
    const now = nowIso();
    const id = `ws-${newFormId()}`;
    await db.insert(workspaces).values({
      id,
      orgId: access.orgId,
      createdBy: access.userEmail,
      name,
      position: (last[0]?.position ?? -1) + 1,
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  },
});
