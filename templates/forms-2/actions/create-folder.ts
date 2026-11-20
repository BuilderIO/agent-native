import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  formsAccess,
  formsErrors,
  nowIso,
  orgScope,
  requireWorkspace,
} from "./_access.js";
import { newFormId } from "./_form-store.js";

export default defineAction({
  description:
    "Create a folder inside a workspace, placed after the existing folders. Folders do not nest.",
  schema: z.object({
    workspaceId: z.string().describe("Workspace id"),
    name: z.string().trim().min(1).max(120).describe("Folder name"),
  }),
  outputSchema: z.object({ id: z.string() }),
  errors: formsErrors,
  link: ({ result, args }) =>
    result
      ? {
          url: buildDeepLink({
            app: "forms-2",
            view: "workspace",
            to: `/workspaces/${encodeURIComponent(String(args.workspaceId))}/folders/${encodeURIComponent(result.id)}`,
            params: { id: String(args.workspaceId) },
          }),
          label: "Open folder in Forms",
        }
      : null,
  run: async ({ workspaceId, name }) => {
    const access = formsAccess();
    await requireWorkspace(access, workspaceId);
    const { folders } = schema;
    const db = getDb();
    const last = await db
      .select({ position: folders.position })
      .from(folders)
      .where(
        and(
          orgScope(folders, access.orgId),
          eq(folders.workspaceId, workspaceId),
          isNull(folders.deletedAt),
        ),
      )
      .orderBy(desc(folders.position))
      .limit(1);
    const now = nowIso();
    const id = `fld-${newFormId()}`;
    await db.insert(folders).values({
      id,
      orgId: access.orgId,
      workspaceId,
      name,
      position: (last[0]?.position ?? -1) + 1,
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  },
});
