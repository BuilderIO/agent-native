import { readFile } from "node:fs/promises";

import { writeAppState } from "@agent-native/core/application-state";
import { saveCredential } from "@agent-native/core/credentials";
import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";

const tokenFile = process.env.BRAIN_CLIPS_TOKEN_FILE;
if (!tokenFile) throw new Error("BRAIN_CLIPS_TOKEN_FILE is required");
const token = (await readFile(tokenFile, "utf8")).trim();
if (!token.startsWith("brain_") || token.length < 32) {
  throw new Error("The Brain ingest token is invalid");
}

const db = getDbExec();
const { rows } = await db.execute({
  sql: `SELECT id, owner_email, org_id, created_at
    FROM recordings
    WHERE status = ? AND trashed_at IS NULL AND created_at >= ?
      AND EXISTS (
        SELECT 1 FROM recording_transcripts
        WHERE recording_transcripts.recording_id = recordings.id
          AND recording_transcripts.status = ?
          AND LENGTH(TRIM(COALESCE(recording_transcripts.full_text, ''))) > 0
      )
    ORDER BY created_at DESC
    LIMIT ?`,
  args: [
    "ready",
    new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    "ready",
    20,
  ],
});
if (rows.length === 0)
  throw new Error("No recent ready Clips recordings found");

const recordings = rows as Array<{
  id: string;
  owner_email: string;
  org_id?: string | null;
}>;
const ownerEmail = recordings[0]!.owner_email;
const orgId = recordings[0]!.org_id?.trim();
if (!ownerEmail || !orgId) {
  throw new Error(
    "Recent Clips recordings are missing owner or organization scope",
  );
}
if (
  recordings.some(
    (recording) =>
      recording.owner_email !== ownerEmail ||
      recording.org_id?.trim() !== orgId,
  )
) {
  throw new Error(
    "Recent Clips recordings span multiple owners or organizations",
  );
}

await saveCredential(
  "BRAIN_INGEST_URL",
  "https://brain.agent-native.com/api/_agent-native/brain/ingest",
  { userEmail: ownerEmail, orgId, scope: "org" },
);
await saveCredential("BRAIN_INGEST_TOKEN", token, {
  userEmail: ownerEmail,
  orgId,
  scope: "org",
});

await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
  const now = new Date().toISOString();
  for (const recording of recordings) {
    await writeAppState(`clips-brain-export-${recording.id}`, {
      recordingId: recording.id,
      status: "pending",
      attempts: 0,
      updatedAt: now,
      nextAttemptAt: now,
    });
  }
});

console.log(
  JSON.stringify({
    configured: true,
    queued: recordings.length,
    organizationScoped: true,
  }),
);
