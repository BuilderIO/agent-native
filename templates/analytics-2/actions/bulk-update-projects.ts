import { defineAction, isActionContractError } from "@agent-native/core/action";
import { z } from "zod";

import { requireOwnedProject } from "../server/lib/project-action-access.js";
import { updateProject } from "../server/model/projects-store.js";

export const BULK_PROJECT_LIMIT = 100;

const operations = {
  trash: { trashed: true },
  restore: { trashed: false },
  archive: { archived: true },
  unarchive: { archived: false },
  favorite: { favorited: true },
  unfavorite: { favorited: false },
} as const;

const itemResultSchema = z.discriminatedUnion("ok", [
  z.object({ projectId: z.string(), ok: z.literal(true) }),
  z.object({
    projectId: z.string(),
    ok: z.literal(false),
    errorCode: z.string(),
    statusCode: z.number().int(),
    message: z.string(),
  }),
]);

export default defineAction({
  mcpTool: true,
  description: `Apply one change (trash, restore, archive, unarchive, favorite, unfavorite) to up to ${BULK_PROJECT_LIMIT} projects at once. Each project gets its own typed result, so one bad id never hides the others; check \`failed\` before telling the user it all worked. Duplicate ids are applied once. Permanent deletion is not available here.`,
  schema: z
    .object({
      projectIds: z
        .array(z.string().trim().min(1).max(128))
        .min(1)
        .max(BULK_PROJECT_LIMIT),
      operation: z.enum(
        Object.keys(operations) as [
          keyof typeof operations,
          ...(keyof typeof operations)[],
        ],
      ),
    })
    .strict(),
  outputSchema: z.object({
    operation: z.string(),
    results: z.array(itemResultSchema),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  retrySafe: true,
  run: async ({ projectIds, operation }) => {
    const change = operations[operation];
    const results: z.infer<typeof itemResultSchema>[] = [];
    for (const projectId of new Set(projectIds)) {
      try {
        const { scope } = await requireOwnedProject(projectId);
        await updateProject({ ...scope, projectId, ...change });
        results.push({ projectId, ok: true });
      } catch (error) {
        results.push(
          isActionContractError(error)
            ? {
                projectId,
                ok: false,
                errorCode: error.errorCode,
                statusCode: error.statusCode,
                message: error.message,
              }
            : {
                projectId,
                ok: false,
                errorCode: "project_update_failed",
                statusCode: 500,
                message: "This project could not be updated.",
              },
        );
      }
    }
    const failed = results.filter((result) => !result.ok).length;
    return {
      operation,
      results,
      succeeded: results.length - failed,
      failed,
    };
  },
});
