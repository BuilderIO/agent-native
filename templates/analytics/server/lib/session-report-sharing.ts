import { ForbiddenError } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";

import type { getDb } from "../db/index.js";
import * as schema from "../db/schema.js";

type SharingChange =
  | { kind: "visibility"; visibility: "private" | "org" | "public" }
  | { kind: "grant" };

/**
 * The framework's share email and sharing responses carry a report's title
 * before any report read checks its recording, so a report opens to its
 * organization or to a person only while that whole organization can open the
 * recording. Making it private is always allowed.
 */
export async function assertSessionReportSharingChange(
  db: ReturnType<typeof getDb>,
  resource: { orgId?: string | null; recordingId: string },
  change: SharingChange,
): Promise<void> {
  if (change.kind === "visibility" && change.visibility === "private") return;
  // guard:allow-unscoped -- reads one recording's org and visibility to bound a sharing change the framework has already authorized; nothing from the row is returned.
  const rows = await db
    .select({
      orgId: schema.sessionRecordings.orgId,
      visibility: schema.sessionRecordings.visibility,
    })
    .from(schema.sessionRecordings)
    .where(eq(schema.sessionRecordings.id, resource.recordingId))
    .limit(1);
  const recording = rows[0] as (typeof rows)[number] | undefined;
  if (
    !resource.orgId ||
    !recording ||
    recording.orgId !== resource.orgId ||
    recording.visibility === "private"
  ) {
    throw new ForbiddenError(
      "A session report can be shared only while its recording is open to the whole organization.",
    );
  }
}
