import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getSchedulingContext } from "../server/context.js";
import { listCalendarProviders } from "../server/providers/registry.js";
import { currentUserEmail } from "./_helpers.js";

export default defineAction({
  description: "List calendar integrations (available + installed)",
  schema: z.object({}),
  run: async () => {
    const { getDb, schema } = getSchedulingContext();
    const email = currentUserEmail();
    const credentials = await getDb()
      .select()
      .from(schema.schedulingCredentials)
      .where(eq(schema.schedulingCredentials.userEmail, email));
    return {
      available: listCalendarProviders().map((p) => ({
        kind: p.kind,
        label: p.label,
      })),
      installed: credentials,
    };
  },
});
