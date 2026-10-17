import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { isEmailDerivedName } from "@agent-native/core/user-profile";
import { getUserProfiles } from "@agent-native/core/user-profile/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Read when an authorized Page was last edited and by whom, without its body. Returns the editor's profile name when one exists.",
  schema: z.object({ id: z.string().min(1).describe("Page ID") }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ id }) => {
    await assertAccess("document", id, "viewer");
    const [document] = await getDb()
      .select({
        updatedAt: schema.documents.updatedAt,
        updatedBy: schema.documents.updatedBy,
      })
      .from(schema.documents)
      .where(
        and(eq(schema.documents.id, id), isNull(schema.documents.trashedAt)),
      )
      .limit(1);
    if (!document) {
      fail("Page not found", { errorCode: "not_found", statusCode: 404 });
    }
    const updatedBy = document.updatedBy?.trim().toLowerCase() || null;
    let updatedByName: string | null = null;
    if (updatedBy) {
      const name = (await getUserProfiles([updatedBy])).get(updatedBy)?.name;
      updatedByName =
        name && !isEmailDerivedName(name, updatedBy) ? name : null;
    }
    return { updatedAt: document.updatedAt, updatedBy, updatedByName };
  },
});
