import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description: "Update an account's name, domain, or logo URL.",
  schema: z.object({
    id: z.string().describe("Account ID"),
    name: z.string().optional().describe("New name"),
    domain: z.string().nullish().describe("New domain (null to clear)"),
    logoUrl: z.string().nullish().describe("New logo URL (null to clear)"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, args.id));
    if (!existing) throw new Error(`Account not found: ${args.id}`);

    const patch: Record<string, unknown> = {};
    if (typeof args.name === "string") patch.name = args.name.trim();
    if (args.domain !== undefined) patch.domain = args.domain ?? null;
    if (args.logoUrl !== undefined) patch.logoUrl = args.logoUrl ?? null;

    if (Object.keys(patch).length) {
      await db
        .update(schema.accounts)
        .set(patch)
        .where(eq(schema.accounts.id, args.id));
    }

    await writeAppState("refresh-signal", { ts: Date.now() });
    return { id: args.id };
  },
});
