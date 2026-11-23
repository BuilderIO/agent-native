import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import { listLibraryApps } from "../server/model/library-apps.js";

export default defineAction({
  description:
    "List accessible published apps with an endorsed or Library status in the current workspace. Results are paginated and exclude drafts, archived and trashed projects.",
  schema: z
    .object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      afterUpdatedAt: z.string().min(1).optional(),
      afterId: z.string().min(1).optional(),
    })
    .strict()
    .superRefine((input, ctx) => {
      if (
        (input.afterUpdatedAt === undefined) !==
        (input.afterId === undefined)
      ) {
        ctx.addIssue({
          code: "custom",
          path: [input.afterId === undefined ? "afterId" : "afterUpdatedAt"],
        });
      }
    }),
  outputSchema: z.object({
    apps: z.array(z.object({ id: z.string(), title: z.string() })),
    nextCursor: z.object({ updatedAt: z.string(), id: z.string() }).nullable(),
  }),
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async ({ limit, afterUpdatedAt, afterId }) => {
    const current = await requireCurrentWorkspace();
    const apps = await listLibraryApps(
      { ownerEmail: current.ownerEmail, orgId: current.orgId },
      {
        limit: limit + 1,
        ...(afterUpdatedAt && afterId
          ? { after: { updatedAt: afterUpdatedAt, id: afterId } }
          : {}),
      },
    );
    const page = apps.slice(0, limit);
    const last = page.at(-1);
    return {
      apps: page.map(({ id, title }) => ({ id, title })),
      nextCursor:
        apps.length > limit && last
          ? { id: last.id, updatedAt: last.updatedAt }
          : null,
    };
  },
});
