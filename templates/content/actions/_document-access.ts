import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { resolveContentSpaceAccess } from "./_content-space-access.js";

export async function resolveDocumentAccess(id: string) {
  const current = await resolveAccess("document", id);
  if (current) return current;
  const [reference] = await getDb()
    .select({ spaceId: schema.documents.spaceId })
    .from(schema.documents)
    .where(eq(schema.documents.id, id))
    .limit(1);
  if (!reference?.spaceId) return null;
  try {
    const spaceAccess = await resolveContentSpaceAccess(reference.spaceId);
    return resolveAccess("document", id, {
      userEmail: spaceAccess.authority.userEmail,
      orgId: spaceAccess.authority.orgId ?? undefined,
    });
  } catch {
    return null;
  }
}
