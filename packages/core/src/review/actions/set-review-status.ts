import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  assertReviewableResourceAccess,
  normalizeReviewVisibility,
} from "../registry.js";
import { upsertReviewStatus } from "../store.js";
import type { ReviewResourceContext } from "../types.js";

const schema = z.object({
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  status: z.enum(["draft", "in_review", "approved", "changes_requested"]),
  note: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export default defineAction({
  description: "Set the review status for a reusable resource.",
  schema,
  run: async (args, ctx) => {
    const actionCtx = ctx as ReviewResourceContext | undefined;
    const access = await assertReviewableResourceAccess(
      args.resourceType,
      args.resourceId,
      actionCtx,
      "editor",
    );
    return upsertReviewStatus({
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      status: args.status,
      note: args.note,
      updatedBy: actionCtx?.userEmail ?? null,
      ownerEmail: access.ownerEmail ?? actionCtx?.userEmail ?? null,
      orgId: access.orgId ?? actionCtx?.orgId ?? null,
      visibility: normalizeReviewVisibility(access.visibility),
      metadata: args.metadata,
    });
  },
  audit: {
    target: (args, result) => {
      const status = result as {
        ownerEmail?: string | null;
        orgId?: string | null;
        visibility?: "private" | "org" | "public";
      };
      return {
        type: args.resourceType,
        id: args.resourceId,
        ownerEmail: status.ownerEmail,
        orgId: status.orgId,
        visibility: status.visibility,
      };
    },
  },
});
