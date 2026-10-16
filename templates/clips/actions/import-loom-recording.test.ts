import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureEnabledAt: vi.fn(),
  enqueue: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  ownerEmailMatches: vi.fn(),
  and: vi.fn(),
  asc: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
  ne: vi.fn(),
  or: vi.fn(),
  gte: vi.fn(),
  inArray: vi.fn(),
  defineAction: vi.fn((options: unknown) => options),
  fail: vi.fn((message: string, options?: Record<string, unknown>) => {
    const error = new Error(message) as Error & Record<string, unknown>;
    Object.assign(error, options);
    throw error;
  }),
  writeAppState: vi.fn(),
  writeAppStateForCurrentTab: vi.fn(),
  uploadFile: vi.fn(),
  ssrfSafeFetch: vi.fn(),
  getDb: vi.fn(),
  getCurrentOwnerEmail: vi.fn(),
  getDefaultRecordingVisibility: vi.fn(),
  nanoid: vi.fn(),
  parseSpaceIds: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  stringifySpaceIds: vi.fn(),
  hasRequestVideoStorage: vi.fn(),
  resolveClipsVideoStorage: vi.fn(),
  verifyHostedClipMedia: vi.fn(),
  consumeHostedClipRecording: vi.fn(),
  releaseHostedClipRecording: vi.fn(),
  deleteS3ObjectByUrl: vi.fn(),
  getRequestContext: vi.fn(),
  downloadDirectVideo: vi.fn(),
  hostedUpload: vi.fn(),
  isCandidateDirectVideoUrl: vi.fn(),
  queueBuilderMediaCompression: vi.fn(),
  dispatchPostFinalizeJob: vi.fn(),
  trackRecordingCreated: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => mocks.defineAction(options),
}));
vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => mocks.defineAction(options),
  fail: (...args: [string, Record<string, unknown>?]) => mocks.fail(...args),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mocks.writeAppState(...args),
  writeAppStateForCurrentTab: (...args: unknown[]) =>
    mocks.writeAppStateForCurrentTab(...args),
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: (...args: unknown[]) => mocks.ssrfSafeFetch(...args),
}));

vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: (...args: unknown[]) => mocks.uploadFile(...args),
}));
vi.mock("@agent-native/core/server", () => ({ buildDeepLink: vi.fn() }));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestContext: (...args: unknown[]) => mocks.getRequestContext(...args),
}));
vi.mock("@agent-native/core/org", () => ({
  registerIdentityColumns: vi.fn(),
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  and: (...args: unknown[]) => mocks.and(...args),
  asc: (...args: unknown[]) => mocks.asc(...args),
  eq: (...args: unknown[]) => mocks.eq(...args),
  gte: (...args: unknown[]) => mocks.gte(...args),
  inArray: (...args: unknown[]) => mocks.inArray(...args),
  isNull: (...args: unknown[]) => mocks.isNull(...args),
  ne: (...args: unknown[]) => mocks.ne(...args),
  or: (...args: unknown[]) => mocks.or(...args),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: (...args: unknown[]) => mocks.getDb(...args),
  schema: {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      status: "recordings.status",
      failureCode: "recordings.failureCode",
      sourceAppName: "recordings.sourceAppName",
      createdAt: "recordings.createdAt",
      storageMode: "recordings.storageMode",
    },
    recordingTranscripts: {
      recordingId: "recording_transcripts.recordingId",
    },
  },
}));

vi.mock("../server/lib/builder-media-compression.js", () => ({
  queueBuilderMediaCompression: (...args: unknown[]) =>
    mocks.queueBuilderMediaCompression(...args),
}));
vi.mock("../server/lib/recording-created.js", () => ({
  trackRecordingCreated: (...args: unknown[]) =>
    mocks.trackRecordingCreated(...args),
}));
vi.mock("../server/lib/post-finalize-dispatch.js", () => ({
  dispatchPostFinalizeJob: (...args: unknown[]) =>
    mocks.dispatchPostFinalizeJob(...args),
}));

vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: (...args: unknown[]) =>
    mocks.getCurrentOwnerEmail(...args),
  getDefaultRecordingVisibility: (...args: unknown[]) =>
    mocks.getDefaultRecordingVisibility(...args),
  nanoid: (...args: unknown[]) => mocks.nanoid(...args),
  ownerEmailMatches: (...args: unknown[]) => mocks.ownerEmailMatches(...args),
  parseSpaceIds: (...args: unknown[]) => mocks.parseSpaceIds(...args),
  requireOrganizationAccess: (...args: unknown[]) =>
    mocks.requireOrganizationAccess(...args),
  stringifySpaceIds: (...args: unknown[]) => mocks.stringifySpaceIds(...args),
}));

vi.mock("../server/lib/transactional-email-store.js", () => ({
  transactionalEmailStore: {
    ensureEnabledAt: (...args: unknown[]) => mocks.ensureEnabledAt(...args),
    enqueueOrConvergeFirstImport: (...args: unknown[]) =>
      mocks.enqueue(...args),
  },
}));

vi.mock("../server/lib/video-storage.js", () => ({
  hasRequestVideoStorage: (...args: unknown[]) =>
    mocks.hasRequestVideoStorage(...args),
  resolveClipsVideoStorage: (...args: unknown[]) =>
    mocks.resolveClipsVideoStorage(...args),
  verifyHostedClipMedia: (...args: unknown[]) =>
    mocks.verifyHostedClipMedia(...args),
  consumeHostedClipRecording: (...args: unknown[]) =>
    mocks.consumeHostedClipRecording(...args),
  releaseHostedClipRecording: (...args: unknown[]) =>
    mocks.releaseHostedClipRecording(...args),
  STORAGE_SETUP_REQUIRED_REASON:
    "Video storage is not connected yet. Use Builder.io (free tier available) or configure S3-compatible storage to upload clips.",
}));
vi.mock("../server/lib/s3-upload-provider.js", () => ({
  deleteS3ObjectByUrl: (...args: unknown[]) =>
    mocks.deleteS3ObjectByUrl(...args),
}));

vi.mock("./lib/direct-video.js", () => ({
  downloadDirectVideo: (...args: unknown[]) =>
    mocks.downloadDirectVideo(...args),
  isCandidateDirectVideoUrl: (...args: unknown[]) =>
    mocks.isCandidateDirectVideoUrl(...args),
}));

vi.mock("./lib/loom-transcript.js", () => ({
  fetchLoomTranscript: vi.fn(),
  loomTranscriptUnavailableMessage: vi.fn(),
}));

vi.mock("./lib/loom-video.js", () => ({ downloadLoomVideo: vi.fn() }));

import {
  WAITING_STORAGE_EXPIRED_REASON,
  WAITING_STORAGE_LEASE_MS,
} from "../server/lib/upload-lease.js";
import importLoomRecording, {
  enqueueFirstImportEmailIfEligible,
} from "./import-loom-recording";
import { VideoDownloadTooLargeError } from "./lib/video-download-limits.js";

function createDb(firstReadyImportId: string | null) {
  mocks.select.mockReturnValue({ from: mocks.from });
  mocks.from.mockReturnValue({ where: mocks.where });
  mocks.where.mockReturnValue({ orderBy: mocks.orderBy });
  mocks.orderBy.mockReturnValue({ limit: mocks.limit });
  mocks.limit.mockResolvedValue(
    firstReadyImportId ? [{ id: firstReadyImportId }] : [],
  );
  return { select: mocks.select } as any;
}

describe("first imported recording transactional email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureEnabledAt.mockResolvedValue({
      enabledAt: "2026-07-01T00:00:00.000Z",
    });
    mocks.enqueue.mockResolvedValue({ created: true });
    mocks.ownerEmailMatches.mockReturnValue("owner-match");
    mocks.and.mockReturnValue("conditions");
    mocks.isNull.mockImplementation((column) => ({ op: "isNull", column }));
    mocks.ne.mockImplementation((column, value) => ({
      op: "ne",
      column,
      value,
    }));
    mocks.or.mockImplementation((...conditions) => ({ op: "or", conditions }));
    mocks.asc.mockImplementation((column) => ({ column, direction: "asc" }));
    mocks.eq.mockImplementation((column, value) => ({ column, value }));
    mocks.gte.mockImplementation((column, value) => ({ column, value }));
    mocks.inArray.mockImplementation((column, values) => ({ column, values }));
    mocks.dispatchPostFinalizeJob.mockResolvedValue(undefined);
    mocks.getRequestContext.mockReturnValue({ authUserId: "user-1" });
    mocks.resolveClipsVideoStorage.mockResolvedValue({
      mode: "own",
      provider: null,
      hostedRemaining: 0,
      hostedLimit: 3,
      maxClipBytes: 100,
      maxClipDurationMs: 60_000,
    });
    mocks.verifyHostedClipMedia.mockResolvedValue(3);
    mocks.consumeHostedClipRecording.mockResolvedValue({ ok: true });
    mocks.releaseHostedClipRecording.mockResolvedValue({ released: true });
    mocks.deleteS3ObjectByUrl.mockResolvedValue(true);
  });

  it("enqueues only when this recording is the first ready import after enablement", async () => {
    const db = createDb("recording-first");

    await enqueueFirstImportEmailIfEligible(
      {
        recordingId: "recording-first",
        ownerEmail: "Owner@Example.com",
        createdAt: "2026-07-02T00:00:00.000Z",
      },
      db,
    );

    expect(mocks.eq).toHaveBeenCalledWith("recordings.status", "ready");
    expect(mocks.inArray).toHaveBeenCalledWith("recordings.sourceAppName", [
      "Loom",
      "Video link",
    ]);
    expect(mocks.gte).toHaveBeenCalledWith(
      "recordings.createdAt",
      "2026-07-01T00:00:00.000Z",
    );
    expect(mocks.orderBy).toHaveBeenCalledWith(
      { column: "recordings.createdAt", direction: "asc" },
      { column: "recordings.id", direction: "asc" },
    );
    expect(mocks.enqueue).toHaveBeenCalledWith(
      "Owner@Example.com",
      "recording-first",
      "Owner@Example.com",
    );
  });

  it("does not query or enqueue for a recording created before enablement", async () => {
    const db = createDb("recording-old");

    await enqueueFirstImportEmailIfEligible(
      {
        recordingId: "recording-old",
        ownerEmail: "owner@example.com",
        createdAt: "2026-06-30T23:59:59.999Z",
      },
      db,
    );

    expect(mocks.ensureEnabledAt).toHaveBeenCalledOnce();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("does not enqueue later successful imports", async () => {
    const db = createDb("recording-first");

    await enqueueFirstImportEmailIfEligible(
      {
        recordingId: "recording-later",
        ownerEmail: "owner@example.com",
        createdAt: "2026-07-03T00:00:00.000Z",
      },
      db,
    );

    expect(mocks.limit).toHaveBeenCalledWith(1);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("preserves WebM format and filename for direct imports", async () => {
    const updated: unknown[] = [];
    const insertValues = vi.fn(async () => undefined);
    const db = {
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({
        set: (value: unknown) => {
          updated.push(value);
          return {
            where: vi.fn(() => ({
              returning: vi.fn(async () => [{ id: "updated-recording" }]),
            })),
          };
        },
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(async () => []) })),
      })),
    } as any;
    mocks.getDb.mockReturnValue(db);
    mocks.getCurrentOwnerEmail.mockReturnValue("owner@example.com");
    mocks.requireOrganizationAccess.mockResolvedValue({
      organizationId: "org-1",
    });
    mocks.getDefaultRecordingVisibility.mockResolvedValue("private");
    mocks.nanoid.mockReturnValue("recording-webm");
    mocks.parseSpaceIds.mockReturnValue([]);
    mocks.stringifySpaceIds.mockReturnValue("[]");
    mocks.isCandidateDirectVideoUrl.mockReturnValue(true);
    mocks.hasRequestVideoStorage.mockResolvedValue(true);
    mocks.downloadDirectVideo.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "video/webm",
      sizeBytes: 3,
    });
    mocks.uploadFile.mockResolvedValue({
      id: "asset-1",
      url: "https://media.example.com/recording-webm.webm",
      provider: "builder",
    });
    mocks.queueBuilderMediaCompression.mockResolvedValue(undefined);
    mocks.ensureEnabledAt.mockRejectedValue(
      new Error("email store unavailable"),
    );

    await importLoomRecording.run({
      url: "https://media.example.com/source.webm",
    });

    expect(mocks.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "recording-webm.webm",
        mimeType: "video/webm",
      }),
    );
    expect(updated).toContainEqual(
      expect.objectContaining({ status: "ready", videoFormat: "webm" }),
    );
    expect(mocks.dispatchPostFinalizeJob).toHaveBeenCalledWith({
      recordingId: "recording-webm",
      kind: "thumbnail",
      requireAccepted: true,
    });
  });

  it("reserves and pins hosted direct imports before downloading", async () => {
    const inserted: unknown[] = [];
    const updated: unknown[] = [];
    const insertValues = vi.fn(async (value: unknown) => {
      inserted.push(value);
    });
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(async () => []) })),
      })),
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({
        set: (value: unknown) => {
          updated.push(value);
          return {
            where: vi.fn(() => ({
              returning: vi.fn(async () => [{ id: "updated-recording" }]),
            })),
          };
        },
      })),
    } as any;
    const hostedProvider = { id: "clips-hosted", upload: mocks.hostedUpload };
    mocks.getDb.mockReturnValue(db);
    mocks.getCurrentOwnerEmail.mockReturnValue("owner@example.com");
    mocks.requireOrganizationAccess.mockResolvedValue({
      organizationId: "org-1",
    });
    mocks.getDefaultRecordingVisibility.mockResolvedValue("private");
    mocks.nanoid.mockReturnValue("recording-hosted");
    mocks.parseSpaceIds.mockReturnValue([]);
    mocks.stringifySpaceIds.mockReturnValue("[]");
    mocks.isCandidateDirectVideoUrl.mockReturnValue(true);
    mocks.resolveClipsVideoStorage.mockResolvedValue({
      mode: "hosted",
      provider: hostedProvider,
      hostedRemaining: 2,
      hostedLimit: 3,
      maxClipBytes: 3,
      maxClipDurationMs: 60_000,
      reservationCreated: true,
    });
    mocks.downloadDirectVideo.mockImplementation(async (_url, options) => {
      expect(insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "processing",
          storageMode: "hosted",
        }),
      );
      expect(options).toEqual({ maxBytes: 3 });
      return {
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "video/mp4",
        sizeBytes: 3,
      };
    });
    mocks.hostedUpload.mockResolvedValue({
      id: "asset-hosted",
      url: "https://clips.example.com/recording-hosted.mp4",
      provider: "clips-hosted",
    });
    mocks.verifyHostedClipMedia.mockResolvedValue(3);
    mocks.consumeHostedClipRecording.mockResolvedValue({ ok: true });
    mocks.ensureEnabledAt.mockRejectedValue(
      new Error("email store unavailable"),
    );

    const result = await importLoomRecording.run({
      url: "https://media.example.com/source.mp4",
    });

    expect(result).toMatchObject({
      recordingId: "recording-hosted",
      status: "ready",
    });
    expect(mocks.resolveClipsVideoStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "new",
        recordingId: "recording-hosted",
        email: "owner@example.com",
      }),
    );
    expect(mocks.hostedUpload).toHaveBeenCalledOnce();
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.verifyHostedClipMedia).toHaveBeenCalledWith({
      recordingId: "recording-hosted",
      videoUrl: "https://clips.example.com/recording-hosted.mp4",
    });
    expect(
      mocks.verifyHostedClipMedia.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.consumeHostedClipRecording.mock.invocationCallOrder[0]!,
    );
    expect(inserted[0]).toMatchObject({ storageMode: "hosted" });
    expect(updated.at(-1)).toMatchObject({
      status: "ready",
      storageMode: "hosted",
      videoUrl: "https://clips.example.com/recording-hosted.mp4",
    });
  });

  it("retries a failed hosted direct import from its pinned stored object", async () => {
    const sourceUrl = "https://media.example.com/source.mp4";
    const videoUrl = "https://clips.example.com/recording-retry-hosted.mp4";
    const updates: unknown[] = [];
    const existing = {
      id: "recording-retry-hosted",
      organizationId: "org-1",
      ownerEmail: "owner@example.com",
      status: "failed",
      storageMode: "hosted",
      videoUrl,
      videoSizeBytes: 3,
      videoFormat: "mp4",
      failureReason: "transient finalization failure",
      sourceAppName: "Video link",
      sourceWindowTitle: sourceUrl,
      thumbnailUrl: null,
      editsJson: "{}",
      title: "Imported video",
      titleSource: "upload",
      spaceIds: "[]",
      visibility: "private",
      folderId: null,
      description: "",
      createdAt: "2026-09-01T00:00:00.000Z",
    };
    const selectWhere = vi
      .fn()
      .mockResolvedValueOnce([existing])
      .mockResolvedValueOnce([]);
    const db = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: selectWhere })) })),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
      update: vi.fn(() => ({
        set: (value: unknown) => {
          updates.push(value);
          return {
            where: vi.fn(() => ({
              returning: vi.fn(async () => [{ id: "updated-recording" }]),
            })),
          };
        },
      })),
    } as any;
    mocks.getDb.mockReturnValue(db);
    mocks.getCurrentOwnerEmail.mockReturnValue("owner@example.com");
    mocks.requireOrganizationAccess.mockResolvedValue({
      organizationId: "org-1",
    });
    mocks.getDefaultRecordingVisibility.mockResolvedValue("private");
    mocks.parseSpaceIds.mockReturnValue([]);
    mocks.stringifySpaceIds.mockReturnValue("[]");
    mocks.isCandidateDirectVideoUrl.mockReturnValue(true);
    mocks.resolveClipsVideoStorage.mockResolvedValue({
      mode: "hosted",
      provider: { id: "clips-hosted", upload: mocks.hostedUpload },
      hostedRemaining: 0,
      hostedLimit: 3,
      maxClipBytes: 10,
      maxClipDurationMs: 60_000,
    });
    mocks.verifyHostedClipMedia.mockResolvedValue(3);
    mocks.ensureEnabledAt.mockRejectedValue(
      new Error("email store unavailable"),
    );

    const result = await importLoomRecording.run({
      url: sourceUrl,
      recordingId: existing.id,
    });

    expect(result).toMatchObject({ recordingId: existing.id, status: "ready" });
    expect(mocks.resolveClipsVideoStorage).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "existing", recordingId: existing.id }),
    );
    expect(mocks.verifyHostedClipMedia).toHaveBeenCalledWith({
      recordingId: existing.id,
      videoUrl,
    });
    expect(mocks.downloadDirectVideo).not.toHaveBeenCalled();
    expect(mocks.hostedUpload).not.toHaveBeenCalled();
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(updates.at(-1)).toMatchObject({
      status: "ready",
      storageMode: "hosted",
      videoUrl,
    });
  });

  describe("hosted direct import verification failures", () => {
    const sourceUrl = "https://media.example.com/source.mp4";
    const uploadedUrl = "https://clips.example.com/recording-verify.mp4";

    function setup(existing?: Record<string, unknown>) {
      const updates: Array<Record<string, unknown>> = [];
      const selectWhere = vi
        .fn()
        .mockResolvedValueOnce(existing ? [existing] : [])
        .mockResolvedValue([]);
      mocks.getDb.mockReturnValue({
        select: vi.fn(() => ({ from: vi.fn(() => ({ where: selectWhere })) })),
        insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
        update: vi.fn(() => ({
          set: (value: Record<string, unknown>) => {
            updates.push(value);
            return {
              where: vi.fn(() => ({
                returning: vi.fn(async () => [{ id: "updated-recording" }]),
              })),
            };
          },
        })),
      } as any);
      mocks.getCurrentOwnerEmail.mockReturnValue("owner@example.com");
      mocks.requireOrganizationAccess.mockResolvedValue({
        organizationId: "org-1",
      });
      mocks.getDefaultRecordingVisibility.mockResolvedValue("private");
      mocks.nanoid.mockReturnValue("recording-verify");
      mocks.parseSpaceIds.mockReturnValue([]);
      mocks.stringifySpaceIds.mockReturnValue("[]");
      mocks.isCandidateDirectVideoUrl.mockReturnValue(true);
      mocks.resolveClipsVideoStorage.mockResolvedValue({
        mode: "hosted",
        provider: { id: "clips-hosted", upload: mocks.hostedUpload },
        hostedRemaining: 2,
        hostedLimit: 3,
        maxClipBytes: 10,
        maxClipDurationMs: 60_000,
        reservationCreated: true,
      });
      mocks.downloadDirectVideo.mockResolvedValue({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "video/mp4",
        sizeBytes: 3,
      });
      mocks.hostedUpload.mockResolvedValue({
        id: "asset-verify",
        url: uploadedUrl,
        provider: "clips-hosted",
      });
      mocks.ensureEnabledAt.mockRejectedValue(
        new Error("email store unavailable"),
      );
      return updates;
    }

    it("marks a confirmed size mismatch media_verification_failed and keeps its handle", async () => {
      const updates = setup();
      mocks.verifyHostedClipMedia.mockResolvedValue(2);

      await expect(importLoomRecording.run({ url: sourceUrl })).rejects.toThrow(
        /does not match the downloaded file/,
      );

      expect(updates.at(-1)).toMatchObject({
        status: "failed",
        failureCode: "media_verification_failed",
        videoUrl: uploadedUrl,
      });
      expect(mocks.consumeHostedClipRecording).not.toHaveBeenCalled();
    });

    it("keeps a transient verification read failure out of media_verification_failed", async () => {
      const updates = setup();
      mocks.verifyHostedClipMedia.mockRejectedValue(
        new Error("read timed out"),
      );
      mocks.deleteS3ObjectByUrl.mockResolvedValue(true);

      await expect(importLoomRecording.run({ url: sourceUrl })).rejects.toThrow(
        "read timed out",
      );

      expect(updates.at(-1)).toMatchObject({
        status: "failed",
        failureCode: "video_link_import_failed",
        videoUrl: null,
      });
    });

    it("persists the object URL when deleting a failed upload is unconfirmed", async () => {
      const updates = setup();
      mocks.verifyHostedClipMedia.mockRejectedValue(
        new Error("read timed out"),
      );
      mocks.deleteS3ObjectByUrl.mockResolvedValue(false);

      await expect(importLoomRecording.run({ url: sourceUrl })).rejects.toThrow(
        "read timed out",
      );

      expect(updates.at(-1)).toMatchObject({
        status: "failed",
        videoUrl: uploadedUrl,
      });
      expect(mocks.releaseHostedClipRecording).not.toHaveBeenCalled();
    });

    it("deletes a mismatched object on retry and downloads afresh", async () => {
      const updates = setup({
        id: "recording-verify",
        organizationId: "org-1",
        ownerEmail: "owner@example.com",
        status: "failed",
        failureCode: "media_verification_failed",
        storageMode: "hosted",
        videoUrl: uploadedUrl,
        videoSizeBytes: 2,
        videoFormat: "mp4",
        failureReason: "Hosted Clips media size does not match.",
        sourceAppName: "Video link",
        sourceWindowTitle: sourceUrl,
        thumbnailUrl: null,
        editsJson: "{}",
        title: "Imported video",
        titleSource: "upload",
        spaceIds: "[]",
        visibility: "private",
        folderId: null,
        description: "",
        createdAt: "2026-09-01T00:00:00.000Z",
      });
      mocks.verifyHostedClipMedia.mockResolvedValue(3);
      mocks.deleteS3ObjectByUrl.mockResolvedValue(true);

      const result = await importLoomRecording.run({
        url: sourceUrl,
        recordingId: "recording-verify",
      });

      expect(result).toMatchObject({ status: "ready" });
      expect(mocks.deleteS3ObjectByUrl).toHaveBeenCalledWith(uploadedUrl, {
        storageMode: "hosted",
        recordingId: "recording-verify",
      });
      expect(mocks.downloadDirectVideo).toHaveBeenCalledOnce();
      expect(updates.find((u) => u.status === "processing")).toMatchObject({
        videoUrl: null,
      });
    });
  });

  it.each([
    {
      label: "direct-video",
      url: "https://media.example.com/source.mp4",
      sourceAppName: "Video link",
    },
    {
      label: "Loom",
      url: "https://www.loom.com/share/abcDEF_123456",
      sourceAppName: "Loom",
    },
  ])(
    "rejects a taken-down $label import retry",
    async ({ url, sourceAppName }) => {
      const sourceUrl =
        sourceAppName === "Loom"
          ? "https://www.loom.com/share/abcDEF_123456"
          : url;
      const existing = {
        id: "recording-taken-down",
        ownerEmail: "owner@example.com",
        organizationId: "org-1",
        status: "failed",
        failureCode: "taken_down",
        storageMode: "hosted",
        videoUrl: null,
        sourceAppName,
        sourceWindowTitle: sourceUrl,
      };
      const db = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({ where: vi.fn(async () => [existing]) })),
        })),
      } as any;
      mocks.getDb.mockReturnValue(db);
      mocks.getCurrentOwnerEmail.mockReturnValue("owner@example.com");
      mocks.isCandidateDirectVideoUrl.mockReturnValue(true);

      await expect(
        importLoomRecording.run({ url, recordingId: existing.id }),
      ).rejects.toThrow(
        "This recording was removed from hosted Clips storage.",
      );

      expect(mocks.resolveClipsVideoStorage).not.toHaveBeenCalled();
      expect(mocks.downloadDirectVideo).not.toHaveBeenCalled();
      expect(mocks.ssrfSafeFetch).not.toHaveBeenCalled();
      expect(mocks.dispatchPostFinalizeJob).not.toHaveBeenCalled();
    },
  );

  it("stops a retry when takedown wins between the read and processing update", async () => {
    const sourceUrl = "https://media.example.com/source.mp4";
    const existing = {
      id: "recording-takedown-race",
      ownerEmail: "owner@example.com",
      organizationId: "org-1",
      status: "failed",
      failureCode: "video_link_import_failed",
      storageMode: "hosted",
      videoUrl: "https://clips.example.com/recording-takedown-race.mp4",
      videoSizeBytes: 3,
      videoFormat: "mp4",
      sourceAppName: "Video link",
      sourceWindowTitle: sourceUrl,
      thumbnailUrl: null,
      editsJson: "{}",
      title: "Imported video",
      titleSource: "upload",
      spaceIds: "[]",
      visibility: "private",
      folderId: null,
      description: "",
      createdAt: "2026-09-01T00:00:00.000Z",
    };
    const set = vi.fn(() => ({
      where: vi.fn(() => ({ returning: vi.fn(async () => []) })),
    }));
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(async () => [existing]) })),
      })),
      update: vi.fn(() => ({ set })),
    } as any;
    mocks.getDb.mockReturnValue(db);
    mocks.getCurrentOwnerEmail.mockReturnValue("owner@example.com");
    mocks.requireOrganizationAccess.mockResolvedValue({
      organizationId: "org-1",
    });
    mocks.getDefaultRecordingVisibility.mockResolvedValue("private");
    mocks.parseSpaceIds.mockReturnValue([]);
    mocks.stringifySpaceIds.mockReturnValue("[]");
    mocks.isCandidateDirectVideoUrl.mockReturnValue(true);
    mocks.resolveClipsVideoStorage.mockResolvedValue({
      mode: "hosted",
      provider: { id: "clips-hosted", upload: mocks.hostedUpload },
      hostedRemaining: 0,
      hostedLimit: 3,
      maxClipBytes: 10,
      maxClipDurationMs: 60_000,
    });

    await expect(
      importLoomRecording.run({ url: sourceUrl, recordingId: existing.id }),
    ).rejects.toThrow("This recording was removed from hosted Clips storage.");

    expect(mocks.ne).toHaveBeenCalledWith(
      "recordings.failureCode",
      "taken_down",
    );
    expect(mocks.downloadDirectVideo).not.toHaveBeenCalled();
    expect(mocks.hostedUpload).not.toHaveBeenCalled();
    expect(mocks.verifyHostedClipMedia).not.toHaveBeenCalled();
    expect(mocks.dispatchPostFinalizeJob).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledOnce();
  });

  it("releases a new hosted reservation when the import exceeds its byte cap", async () => {
    const updates: unknown[] = [];
    const insertValues = vi.fn(async () => undefined);
    const db = {
      select: vi.fn(),
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => [{ id: "updated-recording" }]),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: (value: unknown) => {
          updates.push(value);
          return {
            where: vi.fn(() => ({
              returning: vi.fn(async () => [{ id: "updated-recording" }]),
            })),
          };
        },
      })),
    } as any;
    mocks.getDb.mockReturnValue(db);
    mocks.getCurrentOwnerEmail.mockReturnValue("owner@example.com");
    mocks.requireOrganizationAccess.mockResolvedValue({
      organizationId: "org-1",
    });
    mocks.getDefaultRecordingVisibility.mockResolvedValue("private");
    mocks.nanoid.mockReturnValue("recording-over-cap");
    mocks.parseSpaceIds.mockReturnValue([]);
    mocks.stringifySpaceIds.mockReturnValue("[]");
    mocks.isCandidateDirectVideoUrl.mockReturnValue(true);
    mocks.resolveClipsVideoStorage.mockResolvedValue({
      mode: "hosted",
      provider: { id: "clips-hosted", upload: mocks.hostedUpload },
      hostedRemaining: 2,
      hostedLimit: 3,
      maxClipBytes: 3,
      maxClipDurationMs: 60_000,
      reservationCreated: true,
    });
    mocks.downloadDirectVideo.mockRejectedValue(
      new VideoDownloadTooLargeError(4, 3),
    );
    mocks.ensureEnabledAt.mockRejectedValue(
      new Error("email store unavailable"),
    );

    await expect(
      importLoomRecording.run({ url: "https://media.example.com/source.mp4" }),
    ).rejects.toThrow("Video is too large to import");

    expect(mocks.hostedUpload).not.toHaveBeenCalled();
    expect(mocks.releaseHostedClipRecording).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: "recording-over-cap",
        ownerEmail: "owner@example.com",
      }),
    );
    expect(updates.at(-1)).toMatchObject({
      status: "failed",
      storageMode: null,
      videoUrl: null,
    });
  });

  it("releases a new hosted reservation when the source download fails before any upload", async () => {
    const updates: unknown[] = [];
    const db = {
      select: vi.fn(),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
      update: vi.fn(() => ({
        set: (value: unknown) => {
          updates.push(value);
          return {
            where: vi.fn(() => ({
              returning: vi.fn(async () => [{ id: "updated-recording" }]),
            })),
          };
        },
      })),
    } as any;
    mocks.getDb.mockReturnValue(db);
    mocks.getCurrentOwnerEmail.mockReturnValue("owner@example.com");
    mocks.requireOrganizationAccess.mockResolvedValue({
      organizationId: "org-1",
    });
    mocks.getDefaultRecordingVisibility.mockResolvedValue("private");
    mocks.nanoid.mockReturnValue("recording-download-failed");
    mocks.parseSpaceIds.mockReturnValue([]);
    mocks.stringifySpaceIds.mockReturnValue("[]");
    mocks.isCandidateDirectVideoUrl.mockReturnValue(true);
    mocks.resolveClipsVideoStorage.mockResolvedValue({
      mode: "hosted",
      provider: { id: "clips-hosted", upload: mocks.hostedUpload },
      hostedRemaining: 2,
      hostedLimit: 3,
      maxClipBytes: 3,
      maxClipDurationMs: 60_000,
      reservationCreated: true,
    });
    mocks.downloadDirectVideo.mockRejectedValue(
      new Error("source returned 404"),
    );

    await expect(
      importLoomRecording.run({ url: "https://media.example.com/source.mp4" }),
    ).rejects.toThrow("source returned 404");

    expect(mocks.hostedUpload).not.toHaveBeenCalled();
    expect(mocks.releaseHostedClipRecording).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: "recording-download-failed",
        ownerEmail: "owner@example.com",
      }),
    );
    expect(updates.at(-1)).toMatchObject({
      status: "failed",
      storageMode: null,
      videoUrl: null,
    });
  });

  it("rejects hosted policy denials instead of parking the import", async () => {
    const insertValues = vi.fn(async () => undefined);
    const db = {
      select: vi.fn(),
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => [{ id: "updated-recording" }]),
          })),
        })),
      })),
    } as any;
    mocks.getDb.mockReturnValue(db);
    mocks.getCurrentOwnerEmail.mockReturnValue("owner@example.com");
    mocks.requireOrganizationAccess.mockResolvedValue({
      organizationId: "org-1",
    });
    mocks.getDefaultRecordingVisibility.mockResolvedValue("private");
    mocks.nanoid.mockReturnValue("recording-denied");
    mocks.parseSpaceIds.mockReturnValue([]);
    mocks.stringifySpaceIds.mockReturnValue("[]");
    mocks.isCandidateDirectVideoUrl.mockReturnValue(true);
    mocks.resolveClipsVideoStorage.mockResolvedValue({
      mode: "none",
      provider: null,
      hostedRemaining: 0,
      hostedLimit: 3,
      maxClipBytes: 3,
      maxClipDurationMs: 60_000,
      denyReason: "ip_velocity",
    });

    await expect(
      importLoomRecording.run({ url: "https://media.example.com/source.mp4" }),
    ).rejects.toMatchObject({ errorCode: "ip_velocity", statusCode: 403 });
    expect(mocks.downloadDirectVideo).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("does not hide a failed direct-import thumbnail enqueue", async () => {
    const insertValues = vi.fn(async () => undefined);
    const db = {
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => [{ id: "updated-recording" }]),
          })),
        })),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(async () => []) })),
      })),
    } as any;
    mocks.getDb.mockReturnValue(db);
    mocks.getCurrentOwnerEmail.mockReturnValue("owner@example.com");
    mocks.requireOrganizationAccess.mockResolvedValue({
      organizationId: "org-1",
    });
    mocks.getDefaultRecordingVisibility.mockResolvedValue("private");
    mocks.nanoid.mockReturnValue("recording-no-thumb-job");
    mocks.parseSpaceIds.mockReturnValue([]);
    mocks.stringifySpaceIds.mockReturnValue("[]");
    mocks.isCandidateDirectVideoUrl.mockReturnValue(true);
    mocks.hasRequestVideoStorage.mockResolvedValue(true);
    mocks.downloadDirectVideo.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "video/mp4",
      sizeBytes: 3,
    });
    mocks.uploadFile.mockResolvedValue({
      id: "asset-1",
      url: "https://media.example.com/recording-no-thumb-job.mp4",
      provider: "builder",
    });
    mocks.dispatchPostFinalizeJob.mockRejectedValueOnce(
      new Error("thumbnail queue unavailable"),
    );

    await expect(
      importLoomRecording.run({
        url: "https://media.example.com/source.mp4",
      }),
    ).rejects.toThrow("thumbnail queue unavailable");
  });

  it("does not reuse an automatic thumbnail from an earlier direct import", async () => {
    const sourceUrl = "https://media.example.com/source.mp4";
    const updateValues = vi.fn();
    const existing = {
      id: "recording-retry",
      organizationId: "org-1",
      ownerEmail: "owner@example.com",
      status: "uploading",
      videoUrl: null,
      failureReason:
        "Video storage is not connected yet. Use Builder.io (free tier available) or configure S3-compatible storage to upload clips. Then retry this import.",
      sourceAppName: "Video link",
      sourceWindowTitle: sourceUrl,
      thumbnailUrl: "https://media.example.com/old-thumbnail.jpg",
      editsJson: "{}",
      title: "Earlier import",
      titleSource: "upload",
      spaceIds: "[]",
      visibility: "private",
      folderId: null,
      description: "",
      createdAt: "2026-09-01T00:00:00.000Z",
    };
    const selectWhere = vi
      .fn()
      .mockResolvedValueOnce([existing])
      .mockResolvedValueOnce([]);
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: selectWhere })),
      })),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
      update: vi.fn(() => ({
        set: (values: unknown) => {
          updateValues(values);
          return {
            where: vi.fn(() => ({
              returning: vi.fn(async () => [{ id: "updated-recording" }]),
            })),
          };
        },
      })),
    } as any;
    mocks.getDb.mockReturnValue(db);
    mocks.getCurrentOwnerEmail.mockReturnValue("owner@example.com");
    mocks.requireOrganizationAccess.mockResolvedValue({
      organizationId: "org-1",
    });
    mocks.getDefaultRecordingVisibility.mockResolvedValue("private");
    mocks.parseSpaceIds.mockReturnValue([]);
    mocks.stringifySpaceIds.mockReturnValue("[]");
    mocks.isCandidateDirectVideoUrl.mockReturnValue(true);
    mocks.hasRequestVideoStorage.mockResolvedValue(true);
    mocks.downloadDirectVideo.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "video/mp4",
      sizeBytes: 3,
    });
    mocks.uploadFile.mockResolvedValue({
      id: "asset-1",
      url: "https://media.example.com/recording-retry.mp4",
      provider: "builder",
    });
    mocks.queueBuilderMediaCompression.mockResolvedValue(undefined);
    mocks.ensureEnabledAt.mockRejectedValue(
      new Error("email store unavailable"),
    );

    const result = await importLoomRecording.run({
      url: sourceUrl,
      recordingId: "recording-retry",
    });

    expect(updateValues).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ready",
        videoUrl: "https://media.example.com/recording-retry.mp4",
        thumbnailUrl: null,
      }),
    );
    expect(result).toMatchObject({
      recordingId: "recording-retry",
      thumbnailUrl: null,
    });
  });

  it("retries a direct import in place after the reaper expired its storage wait", async () => {
    const sourceUrl = "https://media.example.com/source.mp4";
    const updateValues = vi.fn();
    const existing = {
      id: "recording-expired",
      organizationId: "org-1",
      ownerEmail: "owner@example.com",
      status: "failed",
      videoUrl: null,
      failureReason: WAITING_STORAGE_EXPIRED_REASON,
      sourceAppName: "Video link",
      sourceWindowTitle: sourceUrl,
      thumbnailUrl: null,
      editsJson: "{}",
      title: "Parked import",
      titleSource: "upload",
      spaceIds: "[]",
      visibility: "private",
      folderId: null,
      description: "",
      createdAt: "2026-09-01T00:00:00.000Z",
    };
    const selectWhere = vi
      .fn()
      .mockResolvedValueOnce([existing])
      .mockResolvedValueOnce([]);
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: selectWhere })),
      })),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
      update: vi.fn(() => ({
        set: (values: unknown) => {
          updateValues(values);
          return {
            where: vi.fn(() => ({
              returning: vi.fn(async () => [{ id: "updated-recording" }]),
            })),
          };
        },
      })),
    } as any;
    mocks.getDb.mockReturnValue(db);
    mocks.getCurrentOwnerEmail.mockReturnValue("owner@example.com");
    mocks.requireOrganizationAccess.mockResolvedValue({
      organizationId: "org-1",
    });
    mocks.getDefaultRecordingVisibility.mockResolvedValue("private");
    mocks.parseSpaceIds.mockReturnValue([]);
    mocks.stringifySpaceIds.mockReturnValue("[]");
    mocks.isCandidateDirectVideoUrl.mockReturnValue(true);
    mocks.hasRequestVideoStorage.mockResolvedValue(true);
    mocks.downloadDirectVideo.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "video/mp4",
      sizeBytes: 3,
    });
    mocks.uploadFile.mockResolvedValue({
      id: "asset-1",
      url: "https://media.example.com/recording-expired.mp4",
      provider: "builder",
    });
    mocks.queueBuilderMediaCompression.mockResolvedValue(undefined);
    mocks.ensureEnabledAt.mockRejectedValue(
      new Error("email store unavailable"),
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await importLoomRecording.run({
      url: sourceUrl,
      recordingId: "recording-expired",
    });

    expect(result).toMatchObject({
      recordingId: "recording-expired",
      status: "ready",
    });
    expect(updateValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ready", failureReason: null }),
    );
  });

  it("completes a persisted import when transactional email enqueue fails", async () => {
    const insertValues = vi.fn(async () => undefined);
    const db = {
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => [{ id: "updated-recording" }]),
          })),
        })),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(async () => []) })),
      })),
    } as any;
    mocks.getDb.mockReturnValue(db);
    mocks.getCurrentOwnerEmail.mockReturnValue("owner@example.com");
    mocks.requireOrganizationAccess.mockResolvedValue({
      organizationId: "org-1",
    });
    mocks.getDefaultRecordingVisibility.mockResolvedValue("private");
    mocks.nanoid.mockReturnValue("recording-imported");
    mocks.parseSpaceIds.mockReturnValue([]);
    mocks.stringifySpaceIds.mockReturnValue("[]");
    mocks.isCandidateDirectVideoUrl.mockReturnValue(true);
    mocks.hasRequestVideoStorage.mockResolvedValue(true);
    mocks.downloadDirectVideo.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "video/mp4",
      sizeBytes: 3,
    });
    mocks.uploadFile.mockResolvedValue({
      id: "asset-1",
      url: "https://media.example.com/recording-imported.mp4",
      provider: "builder",
    });
    mocks.queueBuilderMediaCompression.mockResolvedValue(undefined);
    mocks.ensureEnabledAt.mockRejectedValue(
      new Error("email store unavailable"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await importLoomRecording.run({
      url: "https://media.example.com/source.mp4",
    });

    expect(result).toMatchObject({
      recordingId: "recording-imported",
      status: "ready",
    });
    expect(insertValues).toHaveBeenCalledTimes(2);
    expect(mocks.writeAppState).toHaveBeenCalledWith("refresh-signal", {
      ts: expect.any(Number),
    });
    expect(mocks.writeAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "recording",
      recordingId: "recording-imported",
    });
    expect(warn).toHaveBeenCalledWith(
      "[clips] First-import email enqueue failed",
      {
        recordingId: "recording-imported",
        error: "email store unavailable",
      },
    );
  });
});

describe("Loom imports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dispatchPostFinalizeJob.mockResolvedValue(undefined);
    mocks.getRequestContext.mockReturnValue({ authUserId: "user-1" });
    mocks.resolveClipsVideoStorage.mockResolvedValue({
      mode: "own",
      provider: null,
      hostedRemaining: 0,
      hostedLimit: 3,
      maxClipBytes: 100,
      maxClipDurationMs: 60_000,
    });
    mocks.verifyHostedClipMedia.mockResolvedValue(3);
    mocks.consumeHostedClipRecording.mockResolvedValue({ ok: true });
    mocks.releaseHostedClipRecording.mockResolvedValue({ released: true });
    mocks.deleteS3ObjectByUrl.mockResolvedValue(true);
  });

  it("leases background imports so the reaper can close a lost job", async () => {
    const insertValues = vi.fn(async () => undefined);
    mocks.getDb.mockReturnValue({
      insert: vi.fn(() => ({ values: insertValues })),
    });
    mocks.getCurrentOwnerEmail.mockReturnValue("owner@example.com");
    mocks.requireOrganizationAccess.mockResolvedValue({
      organizationId: "org-1",
    });
    mocks.getDefaultRecordingVisibility.mockResolvedValue("private");
    mocks.nanoid.mockReturnValue("recording-loom");
    mocks.parseSpaceIds.mockReturnValue([]);
    mocks.stringifySpaceIds.mockReturnValue("[]");
    mocks.hasRequestVideoStorage.mockResolvedValue(true);
    mocks.ssrfSafeFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "video",
          html: "<iframe></iframe>",
          title: "Demo",
          duration: 5,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await importLoomRecording.run({
      url: "https://www.loom.com/share/abcDEF_123456",
    });

    const recording = insertValues.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(result).toMatchObject({
      recordingId: "recording-loom",
      status: "processing",
    });
    expect(recording).toMatchObject({ status: "processing" });
    expect(Date.parse(String(recording?.uploadLeaseExpiresAt))).toBeGreaterThan(
      Date.now(),
    );
    expect(mocks.dispatchPostFinalizeJob).toHaveBeenCalledWith({
      recordingId: "recording-loom",
      kind: "loom-import",
      requireAccepted: true,
    });
  });

  it("parks an import without storage on the days-long waiting lease", async () => {
    const insertValues = vi.fn(async () => undefined);
    mocks.getDb.mockReturnValue({
      insert: vi.fn(() => ({ values: insertValues })),
    });
    mocks.getCurrentOwnerEmail.mockReturnValue("owner@example.com");
    mocks.requireOrganizationAccess.mockResolvedValue({
      organizationId: "org-1",
    });
    mocks.getDefaultRecordingVisibility.mockResolvedValue("private");
    mocks.nanoid.mockReturnValue("recording-loom");
    mocks.parseSpaceIds.mockReturnValue([]);
    mocks.stringifySpaceIds.mockReturnValue("[]");
    mocks.hasRequestVideoStorage.mockResolvedValue(false);
    mocks.ssrfSafeFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "video",
          html: "<iframe></iframe>",
          title: "Demo",
          duration: 5,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const before = Date.now();

    const result = await importLoomRecording.run({
      url: "https://www.loom.com/share/abcDEF_123456",
    });

    expect(result).toMatchObject({ status: "waiting_storage" });
    expect(mocks.trackRecordingCreated).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        recordingId: "recording-loom",
        platform: "import",
        source: "import",
      }),
    );
    const recording = insertValues.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(recording).toMatchObject({ status: "uploading" });
    expect(
      Date.parse(String(recording?.uploadLeaseExpiresAt)) - before,
    ).toBeGreaterThanOrEqual(WAITING_STORAGE_LEASE_MS);
  });

  describe("retrying a failed hosted Loom import in place", () => {
    const sourceUrl = "https://www.loom.com/share/abcDEF_123456";
    const staleUrl = "https://clips.example.com/rec_loom_retry.mp4";

    async function retryFailedHostedLoom(failureCode: string) {
      const updates: Array<Record<string, unknown>> = [];
      const existing = {
        id: "rec_loom_retry",
        organizationId: "org-1",
        ownerEmail: "owner@example.com",
        status: "failed",
        storageMode: "hosted",
        videoUrl: staleUrl,
        videoSizeBytes: 4,
        failureCode,
        failureReason: "Hosted Clips media size does not match.",
        sourceAppName: "Loom",
        sourceWindowTitle: sourceUrl,
        thumbnailUrl: null,
        editsJson: "{}",
        title: "Loom import",
        titleSource: "upload",
        spaceIds: "[]",
        visibility: "private",
        folderId: null,
        description: "",
        createdAt: "2026-09-30T00:00:00.000Z",
      };
      mocks.getDb.mockReturnValue({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValueOnce([existing]),
          })),
        })),
        update: vi.fn(() => ({
          set: (values: Record<string, unknown>) => {
            updates.push(values);
            return {
              where: vi.fn(() => ({
                returning: vi.fn(async () => [{ id: "updated-recording" }]),
              })),
            };
          },
        })),
      } as any);
      mocks.getCurrentOwnerEmail.mockReturnValue("owner@example.com");
      mocks.requireOrganizationAccess.mockResolvedValue({
        organizationId: "org-1",
      });
      mocks.getDefaultRecordingVisibility.mockResolvedValue("private");
      mocks.parseSpaceIds.mockReturnValue([]);
      mocks.stringifySpaceIds.mockReturnValue("[]");
      mocks.resolveClipsVideoStorage.mockResolvedValue({
        mode: "hosted",
        provider: { id: "clips-hosted", upload: mocks.hostedUpload },
        hostedRemaining: 0,
        hostedLimit: 3,
        maxClipBytes: 100,
        maxClipDurationMs: 60_000,
      });
      mocks.ssrfSafeFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            type: "video",
            html: "<iframe></iframe>",
            title: "Demo",
            duration: 5,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      const result = await importLoomRecording.run({
        url: sourceUrl,
        recordingId: existing.id,
      });
      return {
        result,
        processingUpdate: updates.find((u) => u.status === "processing"),
      };
    }

    it("deletes an object that failed verification and unlinks it so the job downloads and verifies afresh", async () => {
      const { result, processingUpdate } = await retryFailedHostedLoom(
        "media_verification_failed",
      );

      expect(result).toMatchObject({ status: "processing" });
      expect(mocks.deleteS3ObjectByUrl).toHaveBeenCalledWith(staleUrl, {
        storageMode: "hosted",
        recordingId: "rec_loom_retry",
      });
      expect(processingUpdate).toMatchObject({ videoUrl: null });
    });

    it("keeps a failed retry loud and the row untouched when the stale object cannot be deleted", async () => {
      mocks.deleteS3ObjectByUrl.mockResolvedValueOnce(false);

      await expect(
        retryFailedHostedLoom("media_verification_failed"),
      ).rejects.toThrow(/could not be deleted/);
      expect(mocks.dispatchPostFinalizeJob).not.toHaveBeenCalled();
    });

    it("still reuses a verified object after an unrelated failure", async () => {
      const { processingUpdate } =
        await retryFailedHostedLoom("loom_import_failed");

      expect(mocks.deleteS3ObjectByUrl).not.toHaveBeenCalled();
      expect(processingUpdate).toMatchObject({ videoUrl: staleUrl });
    });
  });

  it("restarts an expired waiting Loom import in place once storage is connected", async () => {
    const sourceUrl = "https://www.loom.com/share/abcDEF_123456";
    const updateValues = vi.fn();
    const existing = {
      id: "recording-loom-expired",
      organizationId: "org-1",
      ownerEmail: "owner@example.com",
      status: "failed",
      videoUrl: null,
      failureReason: WAITING_STORAGE_EXPIRED_REASON,
      sourceAppName: "Loom",
      sourceWindowTitle: sourceUrl,
      thumbnailUrl: null,
      editsJson: "{}",
      title: "Parked Loom import",
      titleSource: "upload",
      spaceIds: "[]",
      visibility: "private",
      folderId: null,
      description: "",
      createdAt: "2026-09-30T00:00:00.000Z",
    };
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValueOnce([existing]),
        })),
      })),
      update: vi.fn(() => ({
        set: (values: unknown) => {
          updateValues(values);
          return {
            where: vi.fn(() => ({
              returning: vi.fn(async () => [{ id: "updated-recording" }]),
            })),
          };
        },
      })),
    } as any;
    mocks.getDb.mockReturnValue(db);
    mocks.getCurrentOwnerEmail.mockReturnValue("owner@example.com");
    mocks.requireOrganizationAccess.mockResolvedValue({
      organizationId: "org-1",
    });
    mocks.getDefaultRecordingVisibility.mockResolvedValue("private");
    mocks.parseSpaceIds.mockReturnValue([]);
    mocks.stringifySpaceIds.mockReturnValue("[]");
    mocks.hasRequestVideoStorage.mockResolvedValue(true);
    mocks.ssrfSafeFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "video",
          html: "<iframe></iframe>",
          title: "Demo",
          duration: 5,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await importLoomRecording.run({
      url: sourceUrl,
      recordingId: existing.id,
    });

    expect(result).toMatchObject({
      recordingId: existing.id,
      status: "processing",
    });
    expect(updateValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "processing", failureReason: null }),
    );
    expect(mocks.dispatchPostFinalizeJob).toHaveBeenCalledWith({
      recordingId: existing.id,
      kind: "loom-import",
      requireAccepted: true,
    });
    // Restarting an existing row in place is not a new recording.
    expect(mocks.trackRecordingCreated).not.toHaveBeenCalled();
  });
});
