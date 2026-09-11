import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  deleteDbAdminConnection,
  requireDbAdminContextFromRequest,
} from "../server/lib/db-admin-connections";

export default defineAction({
  description:
    "Remove a connected agent-native app database from the Analytics DB admin surface and delete its encrypted connection secrets. Requires active organization owner/admin role.",
  schema: z.object({
    id: z.string().min(1).describe("Connection id to remove."),
  }),
  run: async ({ id }, ctx) => {
    const admin = await requireDbAdminContextFromRequest(ctx);
    return deleteDbAdminConnection(admin, id);
  },
});
