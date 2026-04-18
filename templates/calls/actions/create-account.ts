import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { nanoid, resolveDefaultWorkspaceId } from "../server/lib/calls.js";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description: "Create an account row in the current workspace.",
  schema: z.object({
    name: z.string().min(1).describe("Account name (e.g. 'Acme Corp')"),
    domain: z.string().nullish().describe("Primary domain (e.g. 'acme.com')"),
    logoUrl: z.string().nullish().describe("Logo URL"),
    workspaceId: z
      .string()
      .optional()
      .describe("Workspace id (defaults to the user's current workspace)"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();
    const id = nanoid();
    const workspaceId = args.workspaceId || (await resolveDefaultWorkspaceId());
    await db.insert(schema.accounts).values({
      id,
      workspaceId,
      name: args.name.trim(),
      domain: args.domain ?? null,
      logoUrl: args.logoUrl ?? null,
      createdAt: new Date().toISOString(),
    });
    await writeAppState("refresh-signal", { ts: Date.now() });
    return { id, workspaceId };
  },
});
