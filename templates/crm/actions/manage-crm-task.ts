import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireCrmScope } from "./_crm-action-utils.js";

export default defineAction({
  description:
    "Create or update a local CRM follow-up task. Mirrored provider tasks remain read-only in this phase so they cannot be changed without an explicit provider proposal.",
  schema: z
    .object({
      taskId: z.string().trim().min(1).max(128).optional(),
      recordId: z.string().trim().min(1).max(128).optional(),
      title: z.string().trim().min(1).max(300).optional(),
      description: z.string().trim().max(2_000).optional(),
      status: z.enum(["open", "done", "cancelled"]).optional(),
      dueAt: z.string().datetime({ offset: true }).optional(),
      assignedTo: z.string().trim().max(240).optional(),
    })
    .superRefine((value, issue) => {
      if (!value.taskId && !value.title) {
        issue.addIssue({
          code: "custom",
          message: "title is required when creating a task",
          path: ["title"],
        });
      }
    }),
  audit: {
    target: (_args, result) => {
      const task = result as {
        id: string;
        ownerEmail: string;
        orgId: string | null;
        visibility: "private" | "org";
      };
      return {
        type: "crm-task",
        id: task.id,
        ownerEmail: task.ownerEmail,
        orgId: task.orgId,
        visibility: task.visibility,
      };
    },
    summary: (args) =>
      args.taskId
        ? `Updated CRM task ${args.taskId}`
        : `Created CRM task ${args.title}`,
  },
  run: async (args, ctx) => {
    const db = getDb();
    const now = new Date().toISOString();
    if (args.taskId) {
      await assertAccess("crm-task", args.taskId, "editor");
      const [task] = await db
        .select()
        .from(schema.crmTasks)
        .where(eq(schema.crmTasks.id, args.taskId))
        .limit(1);
      if (!task) throw new Error("CRM task was not found.");
      if (task.authority !== "local") {
        throw new Error(
          "This is a mirrored HubSpot task. Provider task writeback is not available in phase 1.",
        );
      }
      if (args.recordId && args.recordId !== task.recordId) {
        await assertAccess("crm-record", args.recordId, "editor");
      }
      await db
        .update(schema.crmTasks)
        .set({
          ...(args.recordId !== undefined ? { recordId: args.recordId } : {}),
          ...(args.title !== undefined ? { title: args.title } : {}),
          ...(args.description !== undefined
            ? { description: args.description }
            : {}),
          ...(args.status !== undefined ? { status: args.status } : {}),
          ...(args.dueAt !== undefined ? { dueAt: args.dueAt } : {}),
          ...(args.assignedTo !== undefined
            ? { assignedTo: args.assignedTo }
            : {}),
          ...(args.status === "done" ? { completedAt: now } : {}),
          ...(args.status && args.status !== "done"
            ? { completedAt: null }
            : {}),
          updatedAt: now,
        })
        .where(eq(schema.crmTasks.id, args.taskId));
      const [updated] = await db
        .select()
        .from(schema.crmTasks)
        .where(eq(schema.crmTasks.id, args.taskId))
        .limit(1);
      if (!updated)
        throw new Error("CRM task could not be verified after updating.");
      return updated;
    }

    if (args.recordId)
      await assertAccess("crm-record", args.recordId, "editor");
    const scope = requireCrmScope(ctx);
    const id = crypto.randomUUID();
    await db.insert(schema.crmTasks).values({
      id,
      recordId: args.recordId ?? null,
      title: args.title!,
      description: args.description ?? "",
      status: args.status ?? "open",
      dueAt: args.dueAt ?? null,
      assignedTo: args.assignedTo ?? null,
      authority: "local",
      completedAt: args.status === "done" ? now : null,
      ...scope,
      createdAt: now,
      updatedAt: now,
    });
    const [task] = await db
      .select()
      .from(schema.crmTasks)
      .where(
        and(
          eq(schema.crmTasks.id, id),
          eq(schema.crmTasks.ownerEmail, scope.ownerEmail),
        ),
      )
      .limit(1);
    if (!task) throw new Error("CRM task could not be verified after saving.");
    return task;
  },
});
