// guard:allow-unscoped — isolated PostgreSQL-compatible fixtures.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "../db/schema.js";

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("../db/index.js", () => ({ getDb: () => db, schema }));
vi.mock("@agent-native/core/secrets", () => ({
  encryptSecretValue: (value: string) => `encrypted:${value}`,
  decryptSecretValue: (value: string) => value.slice("encrypted:".length),
}));

const { recordingMediaCleanupMigration } =
  await import("./recording-media-cleanup-schema.js");
const {
  captureRecordingMediaCleanup,
  beginMediaProduction,
  finishMediaProduction,
  withRecordingMediaProduction,
  journalMediaObject,
  openCleanupPayload,
} = await import("./recording-media-lifecycle.js");

const video =
  "https://cdn.builder.io/o/assets%2Ffake-space%2F0123456789abcdef0123456789abcdef?alt=media&token=fake-token";
const alias =
  "https://cdn.builder.io/api/v1/file/assets/fake-space/0123456789abcdef0123456789abcdef/compressed?fake=other";
const recording = {
  id: "rec-1",
  ownerEmail: "owner@example.test",
  orgId: "org-1",
  organizationId: "org-1",
  storageMode: "own" as const,
  videoUrl: video,
  thumbnailUrl: null,
  animatedThumbnailUrl: null,
  filmstripUrl: null,
  imageUrl: null,
  baseImageUrl: null,
  kind: "video" as const,
  editsJson: "{}",
  status: "ready" as const,
};

const upload = vi.hoisted(() => vi.fn());
const hosted = vi.hoisted(() => ({
  transport: vi.fn(),
  account: vi.fn(),
  conserve: vi.fn(),
}));
vi.mock("@agent-native/core/server", () => ({
  getAppConfig: () => ({
    clips: {
      hostedStorage: {
        enabled: true,
        maxClipBytes: 1024,
        endpoint: "https://s3.example.test",
        bucket: "fake-hosted",
        region: "auto",
        accessKeyId: "fake-access",
        secretAccessKey: "fake-secret",
      },
    },
  }),
  resolveClipsHostedStorageConfig: (value: unknown) => value,
}));
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  isBlockedExtensionUrlWithDns: async () => false,
  ssrfSafeFetch: (...args: unknown[]) => hosted.transport(...args),
}));
vi.mock("./video-storage.js", () => ({
  addHostedClipRecordingBytes: (...args: unknown[]) => hosted.account(...args),
  accountHostedClipAdditionalRecordingBytes: (...args: unknown[]) =>
    hosted.conserve(...args),
}));
vi.mock("@agent-native/core/file-upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/file-upload")>()),
  uploadFile: (...args: unknown[]) => upload(...args),
}));
const { uploadRecordingMedia } = await import("./upload-recording-media.js");

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await client.exec(`CREATE TABLE recordings (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, org_id TEXT, workspace_id TEXT NOT NULL, storage_mode TEXT, video_url TEXT, thumbnail_url TEXT, animated_thumbnail_url TEXT, filmstrip_url TEXT, image_url TEXT, base_image_url TEXT, edits_json TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE recording_agent_frames (id TEXT PRIMARY KEY, recording_id TEXT, storage_url TEXT, storage_provider TEXT, storage_id TEXT);
    CREATE TABLE recording_browser_diagnostics (recording_id TEXT PRIMARY KEY, app_activity_blob_json TEXT);
    CREATE TABLE application_state (session_id TEXT, key TEXT, value TEXT, updated_at BIGINT, PRIMARY KEY (session_id,key));
    CREATE TABLE clips_hosted_clip_allowances (recording_id TEXT PRIMARY KEY, user_id TEXT, status TEXT, quota_bytes BIGINT);`);
  await client.exec(recordingMediaCleanupMigration);
  await client.query(
    "INSERT INTO recordings (id,owner_email,org_id,workspace_id,storage_mode,video_url) VALUES ($1,$2,$3,$3,$4,$5)",
    [
      recording.id,
      recording.ownerEmail,
      recording.orgId,
      recording.storageMode,
      video,
    ],
  );
});
afterEach(async () => {
  await client.close();
});

describe("durable permanent media removal", () => {
  it("records provenance for a new screenshot before its recording row is inserted", async () => {
    const result = await withRecordingMediaProduction(
      {
        recordingId: "new-image",
        ownerEmail: recording.ownerEmail,
        recordAsset: false,
        newRecording: true,
      },
      async () => ({ url: alias, provider: "builder" }),
    );
    expect(result.url).toBe(alias);
    const producer = (
      await client.query<{ payload: string }>(
        "SELECT payload FROM recording_media_producers WHERE recording_id='new-image'",
      )
    ).rows.shift();
    expect(producer && openCleanupPayload(producer.payload)).toMatchObject({
      builderUpload: { recordingId: "new-image" },
    });
  });
  it("refuses a new-recording producer when its id belongs to another owner", async () => {
    await expect(
      beginMediaProduction({
        recordingId: recording.id,
        ownerEmail: "other@example.test",
        newRecording: true,
      }),
    ).rejects.toThrow(/deleted|not found/i);
  });
  it("keeps Builder provenance usable after the registered producer owner's email is rekeyed", async () => {
    const nextOwner = "renamed@example.test";
    await withRecordingMediaProduction(
      {
        recordingId: recording.id,
        ownerEmail: recording.ownerEmail,
        recordAsset: false,
      },
      async () => ({ url: alias, provider: "builder" }),
    );
    const producer = (
      await client.query<{ payload: string }>(
        "SELECT payload FROM recording_media_producers",
      )
    ).rows.shift();
    if (!producer) throw new Error("Missing producer");
    const output = openCleanupPayload<
      import("./recording-media-production-context.js").ProducedMediaReference
    >(producer.payload);
    const proof = output.builderUpload;
    if (!proof) throw new Error("Missing Builder provenance");
    await client.query("UPDATE recording_media_producers SET owner_email=$1", [
      nextOwner,
    ]);
    await client.query("UPDATE recordings SET owner_email=$1", [nextOwner]);
    await db.transaction(async (tx) => {
      await captureRecordingMediaCleanup(tx, {
        ...recording,
        ownerEmail: nextOwner,
      });
      await journalMediaObject(tx, {
        recordingId: recording.id,
        ownerEmail: nextOwner,
        url: alias,
        builderUpload: proof,
      });
    });
    const object = (
      await client.query<{ payload: string }>(
        "SELECT payload FROM recording_media_cleanup_objects",
      )
    ).rows.shift();
    expect(object && openCleanupPayload(object.payload)).toMatchObject({
      builderUpload: { ownerEmail: nextOwner },
    });
  });
  it("records Builder ownership only for an explicitly hidden upload made by this recording", async () => {
    upload.mockResolvedValue({ url: alias, provider: "builder" });
    await uploadRecordingMedia({
      recordingId: recording.id,
      ownerEmail: recording.ownerEmail,
      recordAsset: false,
      data: new Uint8Array([1]),
      filename: "frame.png",
    });
    const producer = (
      await client.query<{ payload: string }>(
        "SELECT payload FROM recording_media_producers",
      )
    ).rows.shift();
    if (!producer) throw new Error("Expected an upload producer");
    expect(
      JSON.parse(producer.payload.slice("encrypted:".length)),
    ).toMatchObject({
      builderUpload: {
        recordingId: recording.id,
        ownerEmail: recording.ownerEmail,
        producerId: expect.any(String),
        objectKey: "builder:fake-space:0123456789abcdef0123456789abcdef",
      },
    });
  });
  it("journals the actual uploaded handle before failed accounting and failed compensating deletion", async () => {
    await client.exec("UPDATE recordings SET storage_mode='hosted'");
    let beforePut: Record<string, unknown> | null = null;
    hosted.transport.mockImplementation(
      async (_url: string, options: RequestInit) => {
        if (options.method === "PUT") {
          beforePut =
            (
              await client.query<Record<string, unknown>>(
                "SELECT status,payload FROM recording_media_producers",
              )
            ).rows.shift() ?? null;
          return new Response(null, { status: 200 });
        }
        return new Response(null, { status: 503 });
      },
    );
    hosted.account.mockRejectedValue(new Error("fake ledger unavailable"));
    hosted.conserve.mockResolvedValue({ ok: false });
    await expect(
      uploadRecordingMedia({
        recordingId: recording.id,
        ownerEmail: recording.ownerEmail,
        data: new Uint8Array([1]),
        filename: "frame.png",
        mimeType: "image/png",
      }),
    ).rejects.toThrow(/could not be deleted/);
    expect(beforePut).toMatchObject({
      status: "active",
      payload: expect.stringContaining("storageFingerprint"),
    });
    const producer = (
      await client.query<{ status: string; payload: string }>(
        "SELECT status,payload FROM recording_media_producers",
      )
    ).rows.shift();
    if (!producer) throw new Error("Expected the uploaded media producer");
    expect(producer.status).toBe("finished");
    expect(
      JSON.parse(producer.payload.slice("encrypted:".length)),
    ).toMatchObject({
      provider: "clips-hosted",
      url: expect.stringContaining("/fake-hosted/clips/rec-1/"),
      storageFingerprint: expect.any(String),
      uploadConfirmed: true,
    });
  });
  it("tracks an actual derivative upload across permanent row removal", async () => {
    let resolveUpload: (result: {
      url: string;
      provider: string;
    }) => void = () => {};
    upload.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );
    const producing = uploadRecordingMedia({
      recordingId: recording.id,
      ownerEmail: recording.ownerEmail,
      data: new Uint8Array([1]),
      mimeType: "image/png",
      filename: "frame.png",
    });
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    const active = await client.query(
      "SELECT status FROM recording_media_producers",
    );
    expect(active.rows).toEqual([{ status: "active" }]);
    await db.transaction(async (tx) => {
      await captureRecordingMediaCleanup(tx, recording);
      await tx.delete(schema.recordings);
    });
    resolveUpload({ url: alias, provider: "builder" });
    expect(await producing).toEqual({ url: alias, provider: "builder" });
    expect(
      (await client.query("SELECT status FROM recording_media_producers")).rows,
    ).toEqual([{ status: "finished" }]);
    expect(
      (
        await client.query<{ payload: string }>(
          "SELECT payload FROM recording_media_producers",
        )
      ).rows[0]?.payload,
    ).toContain(alias);
  });
  it("rolls the cleanup intent back with row removal and preserves app-state-only URLs", async () => {
    await client.query("INSERT INTO application_state VALUES ($1,$2,$3,0)", [
      recording.ownerEmail,
      "recording-thumbnail-asset-rec-1",
      JSON.stringify({
        url: "https://cdn.builder.io/o/assets%2Ffake-space%2F1123456789abcdef0123456789abcdef?token=fake-thumbnail",
        provider: "builder",
      }),
    ]);
    await expect(
      db.transaction(async (tx) => {
        await captureRecordingMediaCleanup(tx, recording);
        await tx.delete(schema.recordings);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(
      (await client.query("SELECT id FROM recording_media_cleanups")).rows,
    ).toEqual([]);
    expect((await client.query("SELECT id FROM recordings")).rows).toHaveLength(
      1,
    );
    await db.transaction((tx) => captureRecordingMediaCleanup(tx, recording));
    const objects = await client.query<{ payload: string }>(
      "SELECT payload FROM recording_media_cleanup_objects ORDER BY object_key",
    );
    expect(objects.rows).toHaveLength(2);
    expect(
      objects.rows.every((row) => row.payload.startsWith("encrypted:")),
    ).toBe(true);
    expect(
      objects.rows.some((row) => row.payload.includes("fake-thumbnail")),
    ).toBe(true);
  });

  it("prevents attachment through an alias after deletion is claimed", async () => {
    await db.transaction((tx) => captureRecordingMediaCleanup(tx, recording));
    await client.exec(
      "UPDATE recording_media_cleanup_objects SET deletion_claimed = true",
    );
    await expect(
      client.query(
        "INSERT INTO recordings (id,owner_email,workspace_id,video_url) VALUES ('rec-2','other@example.test','org-2',$1)",
        [alias],
      ),
    ).rejects.toThrow(/media.*delet/i);
  });

  it("journals a producer that finishes after row removal, and rejects a new producer", async () => {
    const producer = await beginMediaProduction({
      recordingId: recording.id,
      ownerEmail: recording.ownerEmail,
    });
    await db.transaction(async (tx) => {
      await captureRecordingMediaCleanup(tx, recording);
      await tx.delete(schema.recordings);
    });
    await finishMediaProduction(producer, { url: alias, provider: "builder" });
    const outputs = await client.query<{ payload: string; status: string }>(
      "SELECT payload,status FROM recording_media_producers",
    );
    expect(outputs.rows[0]?.status).toBe("finished");
    expect(outputs.rows[0]?.payload).toContain(alias);
    await expect(
      beginMediaProduction({
        recordingId: recording.id,
        ownerEmail: recording.ownerEmail,
      }),
    ).rejects.toThrow(/deleted|not found/i);
  });
});
