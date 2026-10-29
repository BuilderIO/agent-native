// guard:allow-unscoped — isolated PostgreSQL-compatible fixtures.
// oracle-change: Approved durable cleanup replaces synchronous deletion; assert row/intent atomicity and eventual worker outcomes in the database.
import { PGlite } from "@electric-sql/pglite";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "../server/db/schema.js";
import { recordingMediaCleanupMigration } from "../server/lib/recording-media-cleanup-schema.js";

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const mocks = vi.hoisted(() => ({
  owner: "owner@example.test",
  remove: vi.fn(),
  builder: vi.fn(),
  adjust: vi.fn(),
  allowance: vi.fn(),
  release: vi.fn(),
  context: vi.fn(),
  role: vi.fn(),
  privateBlob: vi.fn(),
}));
vi.mock("../server/db/index.js", async () => ({
  getDb: () => db,
  schema: await import("../server/db/schema.js"),
}));
vi.mock("@agent-native/core/secrets", () => ({
  encryptSecretValue: (value: string) => "encrypted:" + value,
  decryptSecretValue: (value: string) => value.slice(10),
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(),
}));
vi.mock("@agent-native/core/server", () => ({
  BUILDER_ASSETS_WRITE_SCOPE: "assets:write",
  resolveBuilderRequestAuthorization: vi.fn(),
  readOrgMemberRole: (...args: unknown[]) => mocks.role(...args),
  runWithRequestContext: async (
    context: unknown,
    fn: () => Promise<unknown>,
  ) => {
    mocks.context(context);
    return fn();
  },
}));
vi.mock("@agent-native/core/private-blob", () => ({
  deletePrivateBlob: (...args: unknown[]) => mocks.privateBlob(...args),
}));
vi.mock("../server/lib/recordings.js", async () => {
  const { sql } = await import("drizzle-orm");
  return {
    getCurrentOwnerEmail: () => mocks.owner,
    ownerEmailMatches: (column: unknown, email: string) =>
      sql`lower(${column}) = ${email.toLowerCase()}`,
  };
});
vi.mock("../server/lib/recording-media-provider.js", () => ({
  captureMediaCleanupScope: vi.fn(async () => ({
    storageFingerprint: "fake-bucket",
  })),
  deleteBuilderMediaForCleanup: (...args: unknown[]) => mocks.builder(...args),
}));
vi.mock("../server/lib/s3-upload-provider.js", () => ({
  deleteS3MediaForCleanup: (...args: unknown[]) => mocks.remove(...args),
}));
vi.mock("../server/lib/video-storage.js", () => ({
  adjustHostedClipRecordingBytes: (...args: unknown[]) => mocks.adjust(...args),
  getHostedClipRecordingAllowance: (...args: unknown[]) =>
    mocks.allowance(...args),
  releaseHostedClipRecording: (...args: unknown[]) => mocks.release(...args),
}));

const { default: action } = await import("./delete-recording-permanent.js");
const { default: listCleanups } =
  await import("./list-recording-media-cleanups.js");
const { default: retryCleanup } =
  await import("./retry-recording-media-cleanup.js");
const { runRecordingMediaCleanup, mediaCleanupSummary } =
  await import("../server/lib/recording-media-cleanup-worker.js");
const { beginMediaProduction, finishMediaProduction } =
  await import("../server/lib/recording-media-lifecycle.js");
const owner = "owner@example.test";
const video = "https://s3.example.test/bucket/clips/rec-1/video.mp4";
const builderVideo =
  "https://cdn.builder.io/o/assets%2Ffake-space%2F0123456789abcdef0123456789abcdef?token=fake-private";

function createTable(table: PgTable): string {
  const config = getTableConfig(table);
  const columns = config.columns.map((column) => {
    const parts = ['"' + column.name + '" ' + column.getSQLType()];
    if (column.primary) parts.push("PRIMARY KEY");
    if (typeof column.default === "string")
      parts.push("DEFAULT '" + column.default.replace(/'/g, "''") + "'");
    else if (
      typeof column.default === "number" ||
      typeof column.default === "boolean"
    )
      parts.push("DEFAULT " + column.default);
    return parts.join(" ");
  });
  return 'CREATE TABLE "' + config.name + '" (' + columns.join(",") + ");";
}
async function insertRecording(id = "rec-1", url = video, email = owner) {
  await client.query(
    "INSERT INTO recordings (id,owner_email,org_id,workspace_id,video_url,kind,status,edits_json,trashed_at) VALUES ($1,$2,'org-1','workspace-1',$3,'video','ready','{}','2026-10-28T00:00:00Z')",
    [id, email, url],
  );
}
async function rows(table: string) {
  return (await client.query('SELECT * FROM "' + table + '"')).rows;
}
async function state(key: string, value: unknown) {
  await client.query("INSERT INTO application_state VALUES ($1,$2,$3,0)", [
    owner,
    key,
    JSON.stringify(value),
  ]);
}
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.owner = owner;
  mocks.role.mockResolvedValue("member");
  mocks.remove.mockResolvedValue({ phase: "complete", httpStatus: 404 });
  mocks.builder.mockResolvedValue({
    phase: "blocked",
    reason: "needs_provider_recovery",
    servingStatus: 403,
  });
  mocks.privateBlob.mockResolvedValue({ deleted: true });
  mocks.adjust.mockResolvedValue({ ok: true });
  mocks.allowance.mockResolvedValue({ status: "consumed" });
  mocks.release.mockResolvedValue({ ok: true });
  client = new PGlite();
  db = drizzle(client, { schema });
  const tables = [
    schema.recordings,
    schema.recordingAgentFrames,
    schema.recordingBrowserDiagnostics,
    schema.hostedClipAllowances,
    schema.recordingContextItems,
    schema.recordingComments,
    schema.recordingReactions,
    schema.recordingViews,
    schema.recordingPlaybackPositions,
    schema.recordingViewers,
    schema.recordingEvents,
    schema.recordingTranscripts,
    schema.recordingTranscriptVersions,
    schema.recordingBugReports,
    schema.recordingTags,
    schema.recordingCtas,
    schema.recordingShares,
    schema.recordingAgentViews,
    schema.recordingContentBindings,
  ];
  for (const table of tables) await client.exec(createTable(table));
  await client.exec(
    "CREATE TABLE application_state(session_id TEXT,key TEXT,value TEXT,updated_at BIGINT,PRIMARY KEY(session_id,key))",
  );
  await client.exec(recordingMediaCleanupMigration);
  await insertRecording();
});
afterEach(async () => {
  await client.close();
});

describe("permanent recording deletion with durable media cleanup", () => {
  it("removes access but returns pending instead of permanent media success, including an idempotent repeat", async () => {
    const result = await action.run({ id: "rec-1" });
    expect(result).toMatchObject({
      success: false,
      recordingRemoved: true,
      mediaCleanup: { status: "pending", pending: 1, deleted: 0 },
    });
    expect(await rows("recordings")).toEqual([]);
    expect(await rows("recording_media_cleanups")).toHaveLength(1);
    expect(await action.run({ id: "rec-1" })).toEqual(result);
    expect(mocks.remove).not.toHaveBeenCalled();
    await runRecordingMediaCleanup("rec-1");
    expect(await action.run({ id: "rec-1" })).toMatchObject({
      success: true,
      mediaCleanup: { status: "complete", deleted: 1, pending: 0 },
    });
    expect((await rows("recording_media_cleanup_objects"))[0]).toMatchObject({
      phase: "complete",
      payload: null,
    });
  });
  it("keeps provider-accepted Builder deletion blocked while variants are unconfirmed", async () => {
    await client.query("UPDATE recordings SET video_url=$1", [builderVideo]);
    await action.run({ id: "rec-1" });
    await runRecordingMediaCleanup("rec-1");
    const result = await action.run({ id: "rec-1" });
    expect(result).toMatchObject({
      success: false,
      recordingRemoved: true,
      mediaCleanup: {
        status: "blocked",
        blocked: 1,
        deleted: 0,
        reason: "needs_provider_recovery",
      },
    });
    expect(JSON.stringify(result)).not.toContain("fake-private");
    expect(
      (await rows("recording_media_cleanup_objects"))[0]?.payload,
    ).toContain("fake-private");
  });
  it("rolls intent capture and row cleanup back together when a dependent delete fails", async () => {
    await state("recording-thumbnail-asset-rec-1", {
      url: video + "/thumbnail",
    });
    await client.exec(
      "CREATE FUNCTION refuse_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'delete refused'; END $$; CREATE TRIGGER refuse_recording_delete BEFORE DELETE ON recordings FOR EACH ROW EXECUTE FUNCTION refuse_delete()",
    );
    await expect(action.run({ id: "rec-1" })).rejects.toThrow();
    expect(await rows("recordings")).toHaveLength(1);
    expect(await rows("recording_media_cleanups")).toEqual([]);
    expect(await rows("recording_media_cleanup_objects")).toEqual([]);
    expect(await rows("application_state")).toHaveLength(1);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("journals frame, activity, screenshot leftovers and app-state-only objects before removing their rows", async () => {
    await client.query(
      "UPDATE recordings SET kind='image', image_url=$1,base_image_url=$2,edits_json=$3,video_url=NULL",
      [
        video,
        video + "-base",
        JSON.stringify({ unreclaimedUrls: [video + "-old"] }),
      ],
    );
    await client.query(
      "INSERT INTO recording_agent_frames(id,recording_id,storage_url,storage_provider) VALUES ('frame','rec-1',$1,'s3')",
      [video + "-frame"],
    );
    await client.query(
      "INSERT INTO recording_browser_diagnostics(recording_id,app_activity_blob_json) VALUES ('rec-1',$1)",
      [JSON.stringify({ provider: "fake-private", id: "fake-activity" })],
    );
    await state("recording-thumbnail-asset-rec-1", {
      url: video + "-thumb",
      provider: "s3",
    });
    const result = await action.run({ id: "rec-1" });
    expect(result.mediaCleanup.pending).toBe(6);
    expect(await rows("recording_agent_frames")).toEqual([]);
    expect(await rows("recording_browser_diagnostics")).toEqual([]);
    const captured = await rows("recording_media_cleanup_objects");
    expect(captured.map((r) => r.provider).sort()).toEqual([
      "private_blob",
      "s3",
      "s3",
      "s3",
      "s3",
      "s3",
    ]);
    expect(
      captured.every(
        (r) =>
          typeof r.payload === "string" && r.payload.startsWith("encrypted:"),
      ),
    ).toBe(true);
    await runRecordingMediaCleanup("rec-1");
    expect(mocks.privateBlob).toHaveBeenCalledWith({
      provider: "fake-private",
      id: "fake-activity",
    });
    expect(await mediaCleanupSummary("rec-1", owner)).toMatchObject({
      deleted: 5,
      blocked: 1,
      status: "blocked",
      reason: "private_blob_confirmation_unavailable",
    });
  });
  it("refuses unreadable screenshot edits without losing either the recording or recovery state", async () => {
    await client.exec("UPDATE recordings SET kind='image',edits_json='{}'");
    // The invalid legacy data predates the new media write fence.
    await client.exec(
      "ALTER TABLE recordings DISABLE TRIGGER clips_recording_media_fence; UPDATE recordings SET edits_json='not-json'; ALTER TABLE recordings ENABLE TRIGGER clips_recording_media_fence",
    );
    await expect(action.run({ id: "rec-1" })).rejects.toThrow(/edits/);
    expect(await rows("recordings")).toHaveLength(1);
    expect(await rows("recording_media_cleanups")).toEqual([]);
  });
  it("deletes dependent access rows and trashes owned context footage atomically", async () => {
    await insertRecording("footage", video + "-context");
    await insertRecording(
      "other-footage",
      video + "-other",
      "other@example.test",
    );
    await client.exec(
      "INSERT INTO recording_context_items(id,recording_id,media_recording_id,pending_media_recording_id) VALUES ('context','rec-1','footage','other-footage')",
    );
    for (const name of [
      "recording_comments",
      "recording_reactions",
      "recording_views",
      "recording_playback_positions",
      "recording_viewers",
      "recording_events",
      "recording_transcripts",
      "recording_transcript_versions",
      "recording_bug_reports",
      "recording_tags",
      "recording_ctas",
    ]) {
      const columns = await client.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND column_name='id'",
        [name],
      );
      await client.query(
        'INSERT INTO "' +
          name +
          '" (' +
          (columns.rows.length ? "id," : "") +
          "recording_id) VALUES (" +
          (columns.rows.length ? "'fake-row'," : "") +
          "$1)",
        ["rec-1"],
      );
    }
    await client.exec(
      "INSERT INTO recording_shares(id,resource_id) VALUES ('fake-share','rec-1')",
    );
    await action.run({ id: "rec-1" });
    for (const name of [
      "recording_comments",
      "recording_reactions",
      "recording_views",
      "recording_playback_positions",
      "recording_viewers",
      "recording_events",
      "recording_transcripts",
      "recording_transcript_versions",
      "recording_bug_reports",
      "recording_tags",
      "recording_ctas",
      "recording_context_items",
      "recording_shares",
    ])
      expect(await rows(name)).toEqual([]);
    const recordings = await rows("recordings");
    expect(recordings.find((r) => r.id === "footage")?.trashed_at).not.toBe(
      "2026-10-28T00:00:00Z",
    );
    expect(recordings.find((r) => r.id === "other-footage")?.trashed_at).toBe(
      "2026-10-28T00:00:00Z",
    );
  });
  it("protects shared aliases, then retries when the final recording reference disappears", async () => {
    await insertRecording("rec-2", video + "?other-token=fake");
    await action.run({ id: "rec-1" });
    await runRecordingMediaCleanup("rec-1");
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(await mediaCleanupSummary("rec-1", owner)).toMatchObject({
      status: "retained_shared",
      retained: 1,
      deleted: 0,
    });
    await client.exec("UPDATE recording_media_cleanups SET attempts=12");
    await client.exec("DELETE FROM recordings WHERE id='rec-2'");
    await runRecordingMediaCleanup("rec-1");
    expect(await mediaCleanupSummary("rec-1", owner)).toMatchObject({
      status: "complete",
      deleted: 1,
      retained: 0,
    });
  });
  it("retains accounting while a producer is active and journals its late output before final release", async () => {
    await client.exec(
      "UPDATE recordings SET storage_mode='hosted'; INSERT INTO clips_hosted_clip_allowances(recording_id,user_id,status,quota_bytes) VALUES ('rec-1','stable-user','consumed',123)",
    );
    const producer = await beginMediaProduction({
      recordingId: "rec-1",
      ownerEmail: owner,
    });
    await action.run({ id: "rec-1" });
    await runRecordingMediaCleanup("rec-1");
    expect(mocks.adjust).not.toHaveBeenCalled();
    expect(await mediaCleanupSummary("rec-1", owner)).toMatchObject({
      status: "blocked",
      reason: "producer_unresolved",
    });
    await finishMediaProduction(producer, {
      url: video + "-late",
      provider: "clips-hosted",
      storageFingerprint: "fake-bucket",
    });
    await runRecordingMediaCleanup("rec-1");
    expect(mocks.adjust).toHaveBeenCalledWith({
      recordingId: "rec-1",
      userId: "stable-user",
      retainedBytes: 0,
    });
    expect(await mediaCleanupSummary("rec-1", owner)).toMatchObject({
      status: "complete",
      deleted: 2,
    });
    expect((await rows("recording_media_producers"))[0]).toMatchObject({
      status: "journaled",
      payload: null,
    });
  });
  it.each([
    video.replace("video.mp4", "%76ideo.mp4"),
    video.replace("video.mp4", "discard/%2e%2e/video.mp4"),
    video.replace("video.mp4", "discard\\..\\video.mp4"),
    video.replace("https://", "HTTPS://"),
    " \n" + video + "\t",
  ])("retains S3 media referenced through the %s alias", async (alias) => {
    await insertRecording("rec-2", alias);
    await action.run({ id: "rec-1" });
    await runRecordingMediaCleanup("rec-1");
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(await mediaCleanupSummary("rec-1", owner)).toMatchObject({
      status: "retained_shared",
      retained: 1,
    });
  });
  it("never guesses a late upload's bucket from the deletion-time settings", async () => {
    const producer = await beginMediaProduction({
      recordingId: "rec-1",
      ownerEmail: owner,
    });
    await client.exec("UPDATE recordings SET video_url=NULL");
    await action.run({ id: "rec-1" });
    await finishMediaProduction(producer, { url: video, provider: "s3" });
    await runRecordingMediaCleanup("rec-1");
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(await mediaCleanupSummary("rec-1", owner)).toMatchObject({
      status: "blocked",
      deleted: 0,
    });
  });
  it("makes progress beyond ten objects whose previous deletes are capability-blocked", async () => {
    for (let index = 0; index < 10; index++)
      await client.query(
        "INSERT INTO recording_agent_frames(id,recording_id,storage_url,storage_provider) VALUES ($1,'rec-1',$2,'s3')",
        [`frame-${index}`, video.replace("video.mp4", `frame-${index}.png`)],
      );
    mocks.remove.mockImplementation(
      async (
        _url: string,
        _options: unknown,
        checkpoint: (fingerprint: string) => Promise<void>,
      ) => {
        await checkpoint("fake-bucket");
        return { phase: "blocked", reason: "retained_versions" };
      },
    );
    await action.run({ id: "rec-1" });
    await runRecordingMediaCleanup("rec-1");
    expect(mocks.remove).toHaveBeenCalledTimes(10);
    await runRecordingMediaCleanup("rec-1");
    expect(new Set(mocks.remove.mock.calls.map(([url]) => url)).size).toBe(11);
  });
  it("retries accounting failure without deleting or refunding an object twice", async () => {
    await client.exec(
      "UPDATE recordings SET storage_mode='hosted'; INSERT INTO clips_hosted_clip_allowances(recording_id,user_id,status,quota_bytes) VALUES ('rec-1','stable-user','consumed',123)",
    );
    mocks.adjust.mockRejectedValueOnce(new Error("ledger unavailable"));
    await action.run({ id: "rec-1" });
    await runRecordingMediaCleanup("rec-1");
    expect(await mediaCleanupSummary("rec-1", owner)).toMatchObject({
      status: "blocked",
      deleted: 1,
    });
    await runRecordingMediaCleanup("rec-1");
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.adjust).toHaveBeenCalledTimes(2);
    expect(await mediaCleanupSummary("rec-1", owner)).toMatchObject({
      status: "complete",
      deleted: 1,
    });
  });
  it("keeps reserved hosted quota until cleanup is confirmed", async () => {
    await client.exec(
      "UPDATE recordings SET storage_mode='hosted'; INSERT INTO clips_hosted_clip_allowances(recording_id,user_id,status,quota_bytes) VALUES ('rec-1','stable-user','reserved',123)",
    );
    mocks.allowance.mockResolvedValue({ status: "reserved" });
    mocks.remove.mockResolvedValueOnce({
      phase: "pending",
      reason: "delete_unconfirmed",
    });
    await action.run({ id: "rec-1" });
    await runRecordingMediaCleanup("rec-1");
    expect(mocks.release).not.toHaveBeenCalled();
    await runRecordingMediaCleanup("rec-1");
    expect(mocks.release).toHaveBeenCalledWith({
      recordingId: "rec-1",
      userId: "stable-user",
    });
  });
  it("does not settle accounting while external compression can still produce media", async () => {
    await client.exec(
      "UPDATE recordings SET storage_mode='hosted'; INSERT INTO clips_hosted_clip_allowances(recording_id,user_id,status,quota_bytes) VALUES ('rec-1','stable-user','consumed',123)",
    );
    await state("recording-builder-compression-rec-1", {
      status: "worker-processing",
      sourceUrl: video,
    });
    await action.run({ id: "rec-1" });
    await runRecordingMediaCleanup("rec-1");
    expect(mocks.adjust).not.toHaveBeenCalled();
    expect(await mediaCleanupSummary("rec-1", owner)).toMatchObject({
      status: "blocked",
      reason: "producer_unresolved",
    });
  });
  it("restores the fixed owner/org context and blocks removed members before contacting storage", async () => {
    await action.run({ id: "rec-1" });
    mocks.owner = "somebody-else@example.test";
    mocks.role.mockResolvedValue(null);
    await runRecordingMediaCleanup("rec-1");
    expect(mocks.context).toHaveBeenCalledWith({
      userEmail: owner,
      orgId: "org-1",
    });
    expect(mocks.role).toHaveBeenCalledWith("org-1", owner);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(await mediaCleanupSummary("rec-1", owner)).toMatchObject({
      status: "blocked",
      reason: "owner_unavailable",
    });
    await expect(action.run({ id: "rec-1" })).rejects.toMatchObject({
      errorCode: "recording_not_found",
    });
  });
  it("serializes competing worker leases", async () => {
    let complete: (value: { phase: string }) => void = () => {};
    const underway = new Promise<{ phase: string }>((resolve) => {
      complete = resolve;
    });
    mocks.remove.mockReturnValue(underway);
    await action.run({ id: "rec-1" });
    const first = runRecordingMediaCleanup("rec-1");
    await vi.waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(1));
    await runRecordingMediaCleanup("rec-1");
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    complete({ phase: "complete" });
    await first;
    expect(await mediaCleanupSummary("rec-1", owner)).toMatchObject({
      status: "complete",
    });
  });
  it("blocks unknown owned media instead of silently skipping it", async () => {
    await client.query("UPDATE recordings SET video_url=$1", [
      "https://unclassified.example.test/fake-video.mp4",
    ]);
    await action.run({ id: "rec-1" });
    await runRecordingMediaCleanup("rec-1");
    expect(await mediaCleanupSummary("rec-1", owner)).toMatchObject({
      status: "blocked",
      reason: "unclassified_provider",
      deleted: 0,
      blocked: 1,
    });
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("does not count third-party embed media as owned storage removed", async () => {
    await client.query("UPDATE recordings SET thumbnail_url=$1", [
      "https://cdn.loom.com/sessions/thumbnails/fake-thumbnail.jpg",
    ]);
    await action.run({ id: "rec-1" });
    await runRecordingMediaCleanup("rec-1");
    expect(await mediaCleanupSummary("rec-1", owner)).toMatchObject({
      status: "complete",
      deleted: 1,
      external: 1,
    });
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });
  it("lists only owned safe status and requeues exhausted objects without overriding an active lease", async () => {
    await action.run({ id: "rec-1" });
    await client.query(
      "UPDATE recording_media_cleanup_objects SET payload=$1",
      [
        "encrypted:" +
          JSON.stringify({
            urls: [video],
            storageFingerprint: "original-bucket",
          }),
      ],
    );
    await client.exec(
      "UPDATE recording_media_cleanup_objects SET attempts=12, phase='blocked', reason='retry_exhausted'; UPDATE recording_media_cleanups SET status='blocked', reason='retry_exhausted'",
    );
    const result = await listCleanups.run({ limit: 100 });
    expect(result.cleanups).toMatchObject([
      { recordingId: "rec-1", blocked: 1, deleted: 0 },
    ]);
    expect(JSON.stringify(result)).not.toContain("s3.example.test");
    mocks.owner = "other@example.test";
    expect((await listCleanups.run({ limit: 100 })).cleanups).toEqual([]);
    await expect(retryCleanup.run({ id: "rec-1" })).rejects.toMatchObject({
      errorCode: "media_cleanup_not_found",
    });
    mocks.owner = owner;
    await client.query(
      "UPDATE recording_media_cleanups SET lease_token='fake-worker', lease_until=$1",
      [new Date(Date.now() + 120_000).toISOString()],
    );
    await retryCleanup.run({ id: "rec-1" });
    expect((await rows("recording_media_cleanup_objects"))[0].attempts).toBe(
      12,
    );
    await client.exec(
      "UPDATE recording_media_cleanups SET lease_token=NULL, lease_until=NULL",
    );
    expect(await retryCleanup.run({ id: "rec-1" })).toMatchObject({
      status: "pending",
    });
    await runRecordingMediaCleanup("rec-1");
    expect(mocks.remove).toHaveBeenCalledWith(
      video,
      expect.objectContaining({ fingerprint: "original-bucket" }),
      expect.any(Function),
    );
    expect(await mediaCleanupSummary("rec-1", owner)).toMatchObject({
      status: "complete",
      deleted: 1,
    });
  });
});
