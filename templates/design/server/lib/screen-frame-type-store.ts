import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";

import { parseDesignDataBlob } from "../../shared/full-app.js";
import {
  resolveScreenFrameType,
  storedScreenFrameType,
  withScreenFrameTypeLayout,
  withStoredScreenFrameType,
  type StoredScreenFrameType,
} from "../../shared/screen-frame-type.js";
import { schema } from "../db/index.js";
import {
  InvalidDesignDataError,
  mutateDesignData,
  type DesignDataMutationTransaction,
} from "./design-data-mutation.js";

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
  const access = await assertAccess("design", designId, "editor");
  if (settled(parseDesignDataBlob(access.resource.data))) return;
  await mutateDesignData({
    designId,
    mutate: (current) =>
      settled(current)
        ? current
        : withStoredScreenFrameType(current, fileId, frameType),
    isApplied: settled,
  });
}

/**
 * The design data, read under a row lock inside the caller's transaction so
 * a frame type decided from it holds until the caller commits.
 */
export async function readDesignDataForUpdate(
  tx: DesignDataMutationTransaction,
  designId: string,
): Promise<Record<string, unknown>> {
  await assertAccess("design", designId, "editor");
  const rows = await tx
    .select({ data: schema.designs.data })
    .from(schema.designs)
    .where(eq(schema.designs.id, designId))
    .for("update");
  const row = rows.find(Boolean);
  if (!row) throw new Error(`Design "${designId}" not found.`);
  return parseStoredDesignData(designId, row.data);
}

/**
 * The serialized design data with an explicit frame type change and its
 * layout applied, or undefined when the type is already stored.
 * `previousContent` is the screen's HTML before the write, which decides the
 * previous type of a legacy screen with no stored type.
 */
export function serializeFrameTypeChange(
  current: Record<string, unknown>,
  {
    fileId,
    frameType,
    previousContent,
  }: {
    fileId: string;
    frameType: StoredScreenFrameType;
    previousContent: string;
  },
): string | undefined {
  if (storedScreenFrameType(current, fileId) === frameType) return undefined;
  return JSON.stringify(
    withScreenFrameTypeLayout(
      current,
      fileId,
      frameType,
      resolveScreenFrameType({
        designData: current,
        fileId,
        content: previousContent,
      }),
    ),
  );
}

/** Both steps above, for a caller that only changes the type. */
export async function designDataWithFrameTypeChange(
  tx: DesignDataMutationTransaction,
  {
    designId,
    ...change
  }: {
    designId: string;
    fileId: string;
    frameType: StoredScreenFrameType;
    previousContent: string;
  },
): Promise<string | undefined> {
  return serializeFrameTypeChange(
    await readDesignDataForUpdate(tx, designId),
    change,
  );
}

function parseStoredDesignData(
  designId: string,
  serialized: string | null,
): Record<string, unknown> {
  if (serialized === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new InvalidDesignDataError(designId);
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  throw new InvalidDesignDataError(designId);
}
