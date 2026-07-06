import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  requireDbAdminContextFromRequest,
  saveDbAdminConnection,
} from "../server/lib/db-admin-connections";

export default defineAction({
  description:
    "Create or update an admin-only connected agent-native app database for the Analytics DB admin surface. Requires active organization owner/admin role. Secret values are encrypted and are not returned.",
  schema: z.object({
    id: z.string().optional().describe("Existing connection id to update."),
    name: z.string().min(1).describe("Human-readable app or agent name."),
    appId: z.string().optional().describe("Optional app id, such as plan."),
    appUrl: z
      .string()
      .optional()
      .describe("Optional URL for the connected app."),
    databaseUrl: z
      .string()
      .min(1)
      .describe("Postgres, PostgreSQL, or libSQL database URL."),
    databaseAuthToken: z
      .string()
      .optional()
      .describe("Optional libSQL/Turso auth token. Leave empty for Postgres."),
  }),
  run: async (args, ctx) => {
    const admin = await requireDbAdminContextFromRequest(ctx);
    return saveDbAdminConnection(admin, args);
  },
});
