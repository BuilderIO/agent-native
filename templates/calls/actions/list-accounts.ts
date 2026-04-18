import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { resolveDefaultWorkspaceId } from "../server/lib/calls.js";

export default defineAction({
  description: "List all accounts in the current workspace.",
  schema: z.object({
    workspaceId: z
      .string()
      .optional()
      .describe("Workspace id (defaults to the user's current workspace)"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const workspaceId = args.workspaceId || (await resolveDefaultWorkspaceId());
    const accounts = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.workspaceId, workspaceId))
      .orderBy(asc(schema.accounts.name));
    return { workspaceId, accounts };
  },
});
