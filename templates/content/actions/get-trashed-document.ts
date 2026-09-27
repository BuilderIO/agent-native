import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Read one authorized Page body from Trash without restoring or hydrating it.",
  schema: z.object({ id: z.string().min(1).describe("Trashed Page ID") }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ id }) => {
    await assertAccess("document", id, "viewer");
    const [document] = await getDb()
      .select()
      .from(schema.documents)
      .where(
        and(eq(schema.documents.id, id), isNotNull(schema.documents.trashedAt)),
      )
      .limit(1);
    if (!document) {
      fail("Trashed Page not found", {
        errorCode: "not_found",
        statusCode: 404,
      });
    }
    return document;
  },
});
