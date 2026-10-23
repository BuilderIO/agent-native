import { createHash } from "node:crypto";

export function getCommentAccessTokenResourceId(
  recordingId: string,
  storedPassword: string,
  sharePasswordVersion: string | null | undefined,
): string {
  const version = createHash("sha256")
    .update(
      JSON.stringify([
        recordingId,
        storedPassword,
        sharePasswordVersion ?? null,
      ]),
    )
    .digest("hex");
  return `clips-comment:${recordingId}:${version}`;
}
