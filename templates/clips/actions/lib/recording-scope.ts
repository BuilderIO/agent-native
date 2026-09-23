import { and, eq, inArray } from "drizzle-orm";

import type { getDb } from "../../server/db/index.js";
import { schema } from "../../server/db/index.js";
import { sameOwnerEmail } from "../../server/lib/recordings.js";

export async function validateRecordingScope(
  db: ReturnType<typeof getDb>,
  {
    organizationId,
    ownerEmail,
    spaceIds,
    folderId,
  }: {
    organizationId: string;
    ownerEmail: string;
    spaceIds: string[];
    folderId?: string | null;
  },
): Promise<string[]> {
  const uniqueSpaceIds = [...new Set(spaceIds.filter(Boolean))];

  if (folderId !== null && folderId !== undefined) {
    const [folder] = await db
      .select({
        ownerEmail: schema.folders.ownerEmail,
        spaceId: schema.folders.spaceId,
      })
      .from(schema.folders)
      .where(
        and(
          eq(schema.folders.id, folderId),
          eq(schema.folders.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (
      !folder ||
      (!folder.spaceId && !sameOwnerEmail(folder.ownerEmail, ownerEmail))
    ) {
      throw new Error(`Folder not found: ${folderId}`);
    }
    if (
      folder.spaceId &&
      uniqueSpaceIds.length > 0 &&
      !uniqueSpaceIds.includes(folder.spaceId)
    ) {
      throw new Error(
        "Target folder must belong to the same organization and space as the recording.",
      );
    }
    if (folder.spaceId && uniqueSpaceIds.length === 0) {
      uniqueSpaceIds.push(folder.spaceId);
    }
  }

  if (uniqueSpaceIds.length > 0) {
    const spaces = await db
      .select({ id: schema.spaces.id })
      .from(schema.spaces)
      .where(
        and(
          eq(schema.spaces.organizationId, organizationId),
          inArray(schema.spaces.id, uniqueSpaceIds),
        ),
      )
      .limit(uniqueSpaceIds.length);

    if (spaces.length !== uniqueSpaceIds.length) {
      throw new Error("One or more spaces were not found.");
    }
  }

  return uniqueSpaceIds;
}
