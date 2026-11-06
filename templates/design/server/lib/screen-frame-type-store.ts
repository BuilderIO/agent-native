import { eq } from "drizzle-orm";

import {
  storedScreenFrameType,
  withStoredScreenFrameType,
  type StoredScreenFrameType,
} from "../../shared/screen-frame-type.js";
import { getDb, schema } from "../db/index.js";
import { mutateDesignData, parseDesignData } from "./design-data-mutation.js";

/**
 * Stores a screen's frame type in `screenMetadata`. With `onlyIfAbsent` it is
 * the lazy backfill for legacy marker screens: it reads first so a screen that
 * already has a stored type costs no write.
 */
export async function persistScreenFrameType({
  designId,
  fileId,
  frameType,
  onlyIfAbsent = false,
}: {
  designId: string;
  fileId: string;
  frameType: StoredScreenFrameType;
  onlyIfAbsent?: boolean;
}): Promise<void> {
  const settled = (data: unknown) => {
    const stored = storedScreenFrameType(data, fileId);
    return onlyIfAbsent ? stored !== undefined : stored === frameType;
  };
  const [row] = await getDb()
    .select({ data: schema.designs.data })
    .from(schema.designs)
    .where(eq(schema.designs.id, designId))
    .limit(1);
  if (!row) throw new Error(`Design "${designId}" not found.`);
  if (settled(parseDesignData(designId, row.data))) return;
  await mutateDesignData({
    designId,
    mutate: (current) =>
      settled(current)
        ? current
        : withStoredScreenFrameType(current, fileId, frameType),
    isApplied: settled,
  });
}
