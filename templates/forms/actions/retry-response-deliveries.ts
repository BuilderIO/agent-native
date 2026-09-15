import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { reconcileResponseDeliveries } from "../server/handlers/submissions.js";

export default defineAction({
  description:
    "Retry failed or pending deliveries for a saved response using its immutable delivery snapshot. The form may be unpublished or archived; pass the response ID.",
  schema: z.object({
    responseId: z.string().describe("Saved response ID to reconcile"),
  }),
  run: async ({ responseId }) => {
    const db = getDb();
    const [response] = await db
      .select({ formId: schema.responses.formId })
      .from(schema.responses)
      .where(eq(schema.responses.id, responseId));
    if (!response)
      fail(`Response ${responseId} not found`, {
        errorCode: "response_not_found",
        statusCode: 404,
      });

    await assertAccess("form", response.formId, "editor");
    return reconcileResponseDeliveries(responseId);
  },
});
