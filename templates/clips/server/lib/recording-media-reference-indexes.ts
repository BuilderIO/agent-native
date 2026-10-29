type Execute = (statement: string) => Promise<{ rows: unknown[] }>;

export async function recordingMediaReferenceIndexesReady(
  execute: Execute,
): Promise<boolean> {
  const result = await execute(`SELECT count(*)=2 AS ready
    FROM pg_catalog.pg_index AS i JOIN pg_catalog.pg_class AS c ON c.oid=i.indexrelid
    WHERE i.indisvalid AND i.indisready AND (
      (c.relname='clips_recording_media_reference_idx' AND i.indrelid=to_regclass('recordings')) OR
      (c.relname='clips_frame_media_reference_idx' AND i.indrelid=to_regclass('recording_agent_frames'))
    )`);
  const row = result.rows.shift();
  if (
    !row ||
    typeof row !== "object" ||
    !("ready" in row) ||
    typeof row.ready !== "boolean"
  )
    throw new Error("Media reference index state is unreadable");
  return row.ready;
}

export async function buildRecordingMediaReferenceIndexes(
  execute: Execute,
): Promise<void> {
  await execute(
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS clips_recording_media_reference_idx ON recordings USING gin(clips_recording_media_keys(video_url,thumbnail_url,animated_thumbnail_url,filmstrip_url,image_url,base_image_url,edits_json))",
  );
  await execute(
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS clips_frame_media_reference_idx ON recording_agent_frames(clips_media_object_key(storage_url))",
  );
  if (!(await recordingMediaReferenceIndexesReady(execute)))
    throw new Error(
      "Media reference indexes are not ready; repair invalid indexes before retrying the release",
    );
}
