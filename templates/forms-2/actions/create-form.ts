import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { and, asc, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { blankFormBlocks, formTitleOf } from "../shared/form-model/index.js";
import { TEMPLATE_IDS, buildTemplate } from "../shared/form-templates/index.js";
import {
  ensureDefaultWorkspace,
  failNotFound,
  firstRow,
  formsAccess,
  formsErrors,
  nowIso,
  requireWorkspace,
  workspaceScope,
} from "./_access.js";
import { requireDestination } from "./_folders.js";
import { newFormId } from "./_form-store.js";

export default defineAction({
  description:
    "Create a blank form, or one from a built-in template, in a workspace (the first workspace when omitted). Open it at /forms/<id>/edit.",
  schema: z.object({
    workspaceId: z
      .string()
      .optional()
      .describe("Workspace id; defaults to the first workspace"),
    folderId: z
      .string()
      .optional()
      .describe("Folder of that workspace to create the form in"),
    name: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe("Starting name; derived from the title block when omitted"),
    templateId: z
      .enum(TEMPLATE_IDS)
      .optional()
      .describe(
        "Start from a built-in template instead of a blank form: contact-form, registration-form, customer-feedback, trivia-quiz, web-project-intake or personality-quiz",
      ),
  }),
  outputSchema: z.object({ id: z.string(), workspaceId: z.string() }),
  errors: formsErrors,
  link: ({ result }) =>
    result
      ? {
          url: buildDeepLink({
            app: "forms-2",
            view: "editor",
            to: `/forms/${encodeURIComponent(result.id)}/edit`,
            params: { id: result.id },
          }),
          label: "Open form in Forms",
        }
      : null,
  run: async ({ workspaceId, folderId, name, templateId }) => {
    const access = formsAccess();
    await ensureDefaultWorkspace(access);
    const { workspaces, forms } = schema;
    const db = getDb();
    let target = workspaceId;
    if (target) await requireWorkspace(access, target);
    else {
      const first = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(
          and(
            workspaceScope(access.orgId, access.userEmail),
            isNull(workspaces.deletedAt),
          ),
        )
        .orderBy(asc(workspaces.position), asc(workspaces.createdAt))
        .limit(1);
      const row = firstRow(first);
      if (!row) return failNotFound("Create a workspace first.");
      target = row.id;
    }
    if (folderId) await requireDestination(access, target, folderId);
    const now = nowIso();
    const id = newFormId();
    const blocks = templateId ? buildTemplate(templateId) : blankFormBlocks();
    await db.insert(forms).values({
      id,
      orgId: access.orgId,
      workspaceId: target,
      folderId: folderId ?? null,
      name: name ?? (templateId ? formTitleOf(blocks) : ""),
      nameIsCustom: Boolean(name),
      status: templateId ? "draft" : "blank",
      draftBlocks: blocks,
      revisionUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { id, workspaceId: target };
  },
});
