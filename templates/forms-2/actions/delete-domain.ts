import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { formsAccess, formsErrors } from "./_access.js";
import { requireDomain } from "./_domains.js";

export default defineAction({
  description:
    "Remove a custom domain and its form mappings. Its link stops serving forms at once; this cannot be undone.",
  schema: z.object({ id: z.string().describe("Domain id") }),
  outputSchema: z.object({ id: z.string() }),
  errors: formsErrors,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ id }) => {
    await requireDomain(formsAccess(), id);
    await getDb().delete(schema.domains).where(eq(schema.domains.id, id));
    return { id };
  },
});
