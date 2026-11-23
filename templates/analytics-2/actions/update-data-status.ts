import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { dataStatusSchema } from "../app/lib/model/data-status-contracts.js";
import {
  isWorkspaceAdministrator,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import { updateStatus } from "../server/model/statuses-store.js";

export default defineAction({
  description:
    "Update a status in the current workspace's shared catalogue. Workspace administrators only.",
  schema: z
    .object({
      id: z.string().trim().min(1),
      name: z.string().trim().min(1).max(30).optional(),
      description: z.string().max(200).optional(),
      color: z
        .string()
        .trim()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      endorsed: z.boolean().optional(),
      inLibrary: z.boolean().optional(),
      enforcesReview: z.boolean().optional(),
      sortOrder: z.number().finite().optional(),
    })
    .strict(),
  outputSchema: z.object({ status: dataStatusSchema }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ id, ...patch }) => {
    const current = await requireCurrentWorkspace();
    if (!isWorkspaceAdministrator(current)) {
      fail("Only workspace admins can update statuses.", {
        statusCode: 403,
        errorCode: "data_status_admin_required",
      });
    }
    const status = await updateStatus({
      ownerEmail: current.ownerEmail,
      orgId: current.orgId,
      statusId: id,
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.description === undefined
        ? {}
        : { description: patch.description }),
      ...(patch.color === undefined ? {} : { color: patch.color }),
      ...(patch.endorsed === undefined ? {} : { endorsed: patch.endorsed }),
      ...(patch.inLibrary === undefined ? {} : { inLibrary: patch.inLibrary }),
      ...(patch.enforcesReview === undefined
        ? {}
        : { enforcesReview: patch.enforcesReview }),
      ...(patch.sortOrder === undefined ? {} : { sortOrder: patch.sortOrder }),
    });
    return { status: dataStatusSchema.parse(status) };
  },
});
