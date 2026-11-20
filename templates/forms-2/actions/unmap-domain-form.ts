import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { formsAccess, formsErrors, orgScope } from "./_access.js";

export default defineAction({
  description: "Stop serving a form on a custom domain.",
  schema: z.object({ id: z.string().describe("Mapping id from list-domains") }),
  outputSchema: z.object({ id: z.string() }),
  errors: formsErrors,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ id }) => {
    const access = formsAccess();
    const { domainForms } = schema;
    await getDb()
      .delete(domainForms)
      .where(and(eq(domainForms.id, id), orgScope(domainForms, access.orgId)));
    return { id };
  },
});
