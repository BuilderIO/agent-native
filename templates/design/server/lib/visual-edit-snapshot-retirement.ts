import { and, eq } from "drizzle-orm";

import { designScreenSourceTypeFromData } from "../../shared/source-mode.js";
import { schema } from "../db/index.js";
import type { DesignDataMutationTransaction } from "./design-data-mutation.js";
import { queueVisualEditSnapshotBlobCleanupInTransaction } from "./visual-edit-snapshot-blobs.js";

const MAX_CAPTURE_REVISION = 9_223_372_036_854_775_807n;

export async function retireVisualEditSnapshotInTransaction(args: {
  tx: DesignDataMutationTransaction;
  designId: string;
  fileId: string;
  currentData: Record<string, unknown>;
  nextData: Record<string, unknown>;
}): Promise<string | null> {
  if (
    designScreenSourceTypeFromData(args.currentData, args.fileId) !==
      "localhost" ||
    designScreenSourceTypeFromData(args.nextData, args.fileId) === "localhost"
  ) {
    return null;
  }

  const table = schema.designVisualEditSnapshots;
  const [snapshot] = await args.tx
    .select({
      html: table.html,
      blobHandle: table.blobHandle,
      captureRevision: table.captureRevision,
      publishedRevision: table.publishedRevision,
    })
    .from(table)
    .where(
      and(eq(table.designId, args.designId), eq(table.fileId, args.fileId)),
    )
    .for("update")
    .limit(1);
  if (!snapshot) return null;
  if (
    !snapshot.html &&
    !snapshot.blobHandle &&
    snapshot.captureRevision === snapshot.publishedRevision
  ) {
    return null;
  }
  if (snapshot.captureRevision >= MAX_CAPTURE_REVISION) {
    throw new Error("The visual-edit snapshot revision is exhausted.");
  }

  await queueVisualEditSnapshotBlobCleanupInTransaction(args.tx, [
    snapshot.blobHandle,
  ]);

  const nextRevision = snapshot.captureRevision + 1n;
  const retired = await args.tx
    .update(table)
    .set({
      html: "",
      blobHandle: null,
      captureRevision: nextRevision,
      // Consume the retired generation so its token cannot become current again.
      publishedRevision: nextRevision,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(table.designId, args.designId),
        eq(table.fileId, args.fileId),
        eq(table.captureRevision, snapshot.captureRevision),
      ),
    )
    .returning({ retired: table.fileId });

  return retired.length ? snapshot.blobHandle : null;
}
