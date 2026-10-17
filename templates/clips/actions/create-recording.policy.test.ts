import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  updateSet: vi.fn(),
  snapshot: vi.fn(async () => false),
  uploadProvider: vi.fn(async () => null),
  captureError: vi.fn(),
  writeState: vi.fn(async () => {}),
  bufferedFallbackAvailable: true,
  streamingEnabled: false,
  resolveStorage: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  defineAction: (action: unknown) => action,
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => calls.writeState(...args),
}));
vi.mock("@agent-native/core/server", () => ({
  captureError: (...args: unknown[]) => calls.captureError(...args),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestContext: () => null,
}));
vi.mock("@agent-native/core/file-upload", () => ({
  getActiveFileUploadProviderForRequest: (...args: unknown[]) =>
    calls.uploadProvider(...args),
}));
vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => calls.track(...args),
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    insert: () => ({ values: (...args: unknown[]) => calls.insert(...args) }),
    update: () => ({
      set: (...args: unknown[]) => {
        calls.updateSet(...args);
        return {
          where: (...whereArgs: unknown[]) => calls.update(...whereArgs),
        };
      },
    }),
  }),
  schema: {
    recordings: { id: "recordings.id", storageMode: "recordings.storageMode" },
  },
}));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (...args: unknown[]) => args,
}));
vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  createError: (options: Record<string, unknown>) =>
    Object.assign(new Error(String(options.statusMessage)), options),
}));
vi.mock("../server/lib/recording-policy.js", () => ({
  snapshotUploadRecoveryPolicy: (...args: unknown[]) => calls.snapshot(...args),
}));
vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => "owner@example.com",
  getDefaultRecordingVisibility: async () => "private",
  nanoid: () => "rec-1",
  requireOrganizationAccess: async () => ({ organizationId: "org-1" }),
  stringifySpaceIds: () => "[]",
}));
vi.mock("./lib/recording-scope.js", () => ({
  validateRecordingScope: async () => [],
}));
vi.mock("../server/lib/video-storage.js", () => ({
  allowsSqlRecordingChunkScratch: () => calls.bufferedFallbackAvailable,
  resolveClipsVideoStorage: (...args: unknown[]) =>
    calls.resolveStorage(...args),
  releaseHostedClipRecording: vi.fn(),
  STORAGE_SETUP_REQUIRED_REASON: "Storage setup required",
  HOSTED_STORAGE_UNAVAILABLE_REASON:
    "Clips hosted storage is temporarily unavailable. Try again later.",
}));
vi.mock("../server/lib/streaming-upload-mode.js", () => ({
  shouldEnableStreamingUpload: () => calls.streamingEnabled,
}));

import { S3MultipartStartError } from "../server/lib/s3-upload-provider.js";
import createRecording, {
  classifyInitialUploadFailure,
} from "./create-recording";

describe("create-recording policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.insert.mockResolvedValue(undefined);
    calls.update.mockResolvedValue(undefined);
    calls.snapshot.mockResolvedValue(false);
    calls.bufferedFallbackAvailable = true;
    calls.streamingEnabled = false;
    calls.resolveStorage.mockImplementation(async () => {
      const provider = await calls.uploadProvider();
      return {
        mode: "own",
        provider,
        hostedRemaining: 0,
        hostedLimit: 3,
        maxClipBytes: 250 * 1024 * 1024,
        maxClipDurationMs: 10 * 60 * 1000,
        reservationCreated: false,
      };
    });
    calls.track.mockReset();
  });

  it("returns the duration cap only for hosted recordings", async () => {
    const action = createRecording as unknown as {
      run: (
        args: Record<string, unknown>,
        context: { userEmail: string },
      ) => Promise<{ maxClipDurationMs: number | null }>;
    };
    const context = { userEmail: "owner@example.com" };

    await expect(
      action.run({ id: "rec-own", recordingPlatform: "web" }, context),
    ).resolves.toMatchObject({ maxClipDurationMs: null });

    calls.resolveStorage.mockResolvedValueOnce({
      mode: "hosted",
      provider: await calls.uploadProvider(),
      hostedRemaining: 2,
      hostedLimit: 3,
      maxClipBytes: 250 * 1024 * 1024,
      maxClipDurationMs: 10 * 60 * 1000,
      reservationCreated: false,
    });
    await expect(
      action.run({ id: "rec-hosted", recordingPlatform: "web" }, context),
    ).resolves.toMatchObject({ maxClipDurationMs: 10 * 60 * 1000 });
  });

  it("saves the new recording's policy before initializing its upload", async () => {
    const action = createRecording as unknown as {
      run: (
        args: Record<string, unknown>,
        context: { userEmail: string },
      ) => Promise<unknown>;
    };

    await action.run(
      { id: "rec-1", recordingPlatform: "web" },
      { userEmail: "owner@example.com" },
    );

    expect(calls.snapshot).toHaveBeenCalledWith(
      "owner@example.com",
      "org-1",
      "rec-1",
    );
    expect(calls.snapshot.mock.invocationCallOrder[0]).toBeLessThan(
      calls.insert.mock.invocationCallOrder[0]!,
    );
    expect(calls.snapshot.mock.invocationCallOrder[0]).toBeLessThan(
      calls.uploadProvider.mock.invocationCallOrder[0]!,
    );
  });

  it.each(["policy read failed", "policy snapshot write failed"])(
    "does not create an orphan recording when %s",
    async (message) => {
      const error = new Error(message);
      calls.snapshot.mockRejectedValueOnce(error);
      const action = createRecording as unknown as {
        run: (
          args: Record<string, unknown>,
          context: { userEmail: string },
        ) => Promise<unknown>;
      };

      await expect(
        action.run(
          { id: "rec-1", recordingPlatform: "web" },
          { userEmail: "owner@example.com" },
        ),
      ).rejects.toBe(error);

      expect(calls.insert).not.toHaveBeenCalled();
      expect(calls.uploadProvider).not.toHaveBeenCalled();
      expect(calls.writeState).not.toHaveBeenCalled();
    },
  );

  it("refuses to create a recording for an account other than the expected owner", async () => {
    const action = createRecording as unknown as {
      run: (
        args: Record<string, unknown>,
        context: { userEmail: string },
      ) => Promise<unknown>;
    };

    await expect(
      action.run(
        { id: "rec-1", expectedOwnerEmail: "someone-else@example.com" },
        { userEmail: "owner@example.com" },
      ),
    ).rejects.toMatchObject({
      errorCode: "recording_owner_mismatch",
      statusCode: 409,
    });
    expect(calls.insert).not.toHaveBeenCalled();

    await action.run(
      { id: "rec-1", expectedOwnerEmail: "Owner@Example.com" },
      { userEmail: "owner@example.com" },
    );
    expect(calls.insert).toHaveBeenCalledOnce();
  });

  it("preserves an insert failure without publishing upload state", async () => {
    const error = new Error("recording insert failed");
    calls.insert.mockRejectedValueOnce(error);
    const action = createRecording as unknown as {
      run: (
        args: Record<string, unknown>,
        context: { userEmail: string },
      ) => Promise<unknown>;
    };

    await expect(
      action.run(
        { id: "rec-1", recordingPlatform: "web" },
        { userEmail: "owner@example.com" },
      ),
    ).rejects.toBe(error);

    expect(calls.snapshot).toHaveBeenCalledOnce();
    expect(calls.resolveStorage).toHaveBeenCalledOnce();
    expect(calls.uploadProvider).toHaveBeenCalledOnce();
    expect(calls.writeState).not.toHaveBeenCalled();
  });

  it("keeps a transient Builder signed-URL authorization failure retryable", async () => {
    calls.bufferedFallbackAvailable = false;
    calls.streamingEnabled = true;
    calls.uploadProvider.mockResolvedValueOnce({
      id: "builder",
      resumable: {
        startSession: vi
          .fn()
          .mockRejectedValue(
            new Error(
              'Builder.io signed-URL request failed (401): {"message":"Authorization required"}',
            ),
          ),
      },
    });

    const action = createRecording as unknown as {
      run: (
        args: Record<string, unknown>,
        context: { userEmail: string },
      ) => Promise<unknown>;
    };

    await expect(
      action.run(
        {
          id: "rec-1",
          recordingPlatform: "web",
          requestStreaming: true,
        },
        { userEmail: "owner@example.com" },
      ),
    ).rejects.toMatchObject({
      statusCode: 503,
      data: { retryable: true },
    });

    expect(calls.update).toHaveBeenCalledOnce();
    expect(calls.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: "multipart_start_failed" }),
    );
    expect(calls.writeState).toHaveBeenLastCalledWith(
      "recording-upload-rec-1",
      expect.objectContaining({
        status: "failed",
        storageSetupRequired: false,
      }),
    );
  });

  it("persists and reports hosted provider auth failures without exposing the provider error", async () => {
    calls.bufferedFallbackAvailable = false;
    calls.streamingEnabled = true;
    const provider = {
      id: "clips-hosted",
      resumable: {
        startSession: vi.fn().mockRejectedValue(new S3MultipartStartError(403)),
      },
    };
    calls.resolveStorage.mockResolvedValueOnce({
      mode: "hosted",
      provider,
      hostedRemaining: 2,
      hostedLimit: 3,
      maxClipBytes: 250 * 1024 * 1024,
      maxClipDurationMs: 10 * 60 * 1000,
      reservationCreated: false,
    });

    const action = createRecording as unknown as {
      run: (
        args: Record<string, unknown>,
        context: { userEmail: string },
      ) => Promise<unknown>;
    };

    await expect(
      action.run(
        {
          id: "rec-1",
          recordingPlatform: "web",
          requestStreaming: true,
        },
        { userEmail: "owner@example.com" },
      ),
    ).rejects.toMatchObject({
      statusCode: 503,
      data: {
        errorCode: "hosted_storage_unavailable",
        retryable: true,
      },
      statusMessage:
        "Clips hosted storage is temporarily unavailable. Try again later.",
    });

    expect(calls.updateSet).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "failed",
        failureCode: "hosted_storage_unavailable",
        failureReason:
          "Clips hosted storage is temporarily unavailable. Try again later.",
      }),
    );
    expect(calls.captureError).toHaveBeenCalledWith(
      expect.any(S3MultipartStartError),
      expect.objectContaining({
        route: "/_agent-native/actions/create-recording",
        errorMessagePolicy: "omit",
        tags: expect.objectContaining({
          area: "clips-storage",
          errorCode: "hosted_storage_unavailable",
          providerStatus: "403",
          reportExpected: "true",
        }),
      }),
    );
  });

  it("keeps explicit Builder reauthorization failures setup-required", () => {
    expect(
      classifyInitialUploadFailure(
        Object.assign(new Error("Builder authorization expired"), {
          status: 401,
          errorCode: "builder_oauth_reauthorization_required",
        }),
      ),
    ).toMatchObject({
      failureCode: "storage_setup_required",
      httpStatus: 401,
    });
  });

  it("classifies confirmed rejected Builder credentials as setup-required", () => {
    expect(
      classifyInitialUploadFailure(
        Object.assign(new Error("Builder.io signed-URL request failed (401)"), {
          status: 401,
          errorCode: "builder_credentials_rejected",
        }),
      ),
    ).toMatchObject({
      failureCode: "storage_setup_required",
      httpStatus: 401,
    });
  });
});

describe("recording_created", () => {
  const action = createRecording as unknown as {
    run: (
      args: Record<string, unknown>,
      context: { userEmail: string },
    ) => Promise<unknown>;
  };
  const createdCalls = () =>
    calls.track.mock.calls.filter(([name]) => name === "recording_created");

  beforeEach(() => {
    vi.clearAllMocks();
    calls.insert.mockResolvedValue(undefined);
    calls.update.mockResolvedValue(undefined);
    calls.snapshot.mockResolvedValue(false);
    calls.bufferedFallbackAvailable = true;
    calls.streamingEnabled = false;
    calls.track.mockReset();
  });

  it("fires once after the row is inserted, naming the recording's platform", async () => {
    await action.run(
      { id: "rec-1", recordingPlatform: "desktop", hasCamera: true },
      { userEmail: "owner@example.com" },
    );

    expect(createdCalls()).toEqual([
      [
        "recording_created",
        {
          app_name: "clips",
          template_name: "clips",
          output_id: "rec-1",
          output_type: "clip",
          recording_attempt_id: "rec-1",
          recording_platform: "desktop",
          recording_source: "recorder",
          has_audio: true,
          has_camera: true,
        },
        expect.objectContaining({ userId: "owner@example.com" }),
      ],
    ]);
    expect(calls.insert.mock.invocationCallOrder[0]).toBeLessThan(
      calls.track.mock.invocationCallOrder[0]!,
    );
  });

  it("names the caller's take and source when given", async () => {
    await action.run(
      {
        id: "rec-2",
        recordingPlatform: "mobile",
        recordingSource: "local_copy_upload",
        recordingAttemptId: "local-7",
      },
      { userEmail: "owner@example.com" },
    );

    expect(createdCalls()[0][1]).toMatchObject({
      output_id: "rec-2",
      recording_attempt_id: "local-7",
      recording_platform: "mobile",
      recording_source: "local_copy_upload",
    });
  });

  it("treats desktop and extension rows without a source as recorder captures, and nothing else", async () => {
    await action.run(
      { id: "rec-ext", recordingPlatform: "extension" },
      { userEmail: "owner@example.com" },
    );
    await action.run(
      { id: "rec-web", recordingPlatform: "web" },
      { userEmail: "owner@example.com" },
    );
    await action.run(
      {
        id: "rec-desk",
        recordingPlatform: "desktop",
        recordingSource: "file_upload",
      },
      { userEmail: "owner@example.com" },
    );

    expect(
      createdCalls().map(([, props]) => [
        props.output_id,
        props.recording_source,
      ]),
    ).toEqual([
      ["rec-ext", "recorder"],
      ["rec-web", "unknown"],
      ["rec-desk", "file_upload"],
    ]);
  });

  it("attributes the native mobile app's captures by its app name, on the row and every event", async () => {
    calls.bufferedFallbackAvailable = false;

    await expect(
      action.run(
        {
          id: "rec-mob",
          sourceAppName: "Agent-Native Mobile",
          titleSource: "upload",
        },
        { userEmail: "owner@example.com" },
      ),
    ).rejects.toMatchObject({ statusCode: 503 });

    expect(calls.insert.mock.calls[0][0]).toMatchObject({
      recordingPlatform: "mobile",
    });
    expect(createdCalls()[0][1]).toMatchObject({
      recording_platform: "mobile",
      recording_source: "recorder",
    });
    const failed = calls.track.mock.calls.find(
      ([name]) => name === "recording_failed",
    );
    expect(failed?.[1]).toMatchObject({ recording_platform: "mobile" });
  });

  it("keeps an explicit platform over the app name, and leaves other apps alone", async () => {
    await action.run(
      {
        id: "rec-a",
        sourceAppName: "Agent-Native Mobile",
        recordingPlatform: "web",
      },
      { userEmail: "owner@example.com" },
    );
    await action.run(
      { id: "rec-b", sourceAppName: "Zoom" },
      { userEmail: "owner@example.com" },
    );

    expect(
      createdCalls().map(([, props]) => [
        props.output_id,
        props.recording_platform,
      ]),
    ).toEqual([
      ["rec-a", "web"],
      ["rec-b", "unknown"],
    ]);
  });

  it("reports a recording with no platform as unknown, not a guess", async () => {
    await action.run({ id: "rec-1" }, { userEmail: "owner@example.com" });

    expect(createdCalls()[0][1]).toMatchObject({
      recording_platform: "unknown",
    });
  });

  it("does not fire when no row is created", async () => {
    calls.insert.mockRejectedValueOnce(new Error("recording insert failed"));
    await expect(
      action.run(
        { id: "rec-1", recordingPlatform: "web" },
        { userEmail: "owner@example.com" },
      ),
    ).rejects.toThrow("recording insert failed");

    calls.snapshot.mockRejectedValueOnce(new Error("policy read failed"));
    await expect(
      action.run(
        { id: "rec-1", recordingPlatform: "web" },
        { userEmail: "owner@example.com" },
      ),
    ).rejects.toThrow("policy read failed");

    await expect(
      action.run(
        { id: "rec-1", expectedOwnerEmail: "someone-else@example.com" },
        { userEmail: "owner@example.com" },
      ),
    ).rejects.toMatchObject({ errorCode: "recording_owner_mismatch" });

    expect(createdCalls()).toHaveLength(0);
  });

  it("is followed by recording_failed when storage is missing, so the row is never silent", async () => {
    calls.bufferedFallbackAvailable = false;

    await expect(
      action.run(
        { id: "rec-1", recordingPlatform: "extension" },
        { userEmail: "owner@example.com" },
      ),
    ).rejects.toMatchObject({ statusCode: 503 });

    const names = calls.track.mock.calls.map(([name]) => name);
    expect(names).toEqual(["recording_created", "recording_failed"]);
    expect(calls.track.mock.calls[1][1]).toMatchObject({
      failure_code: "storage_setup_required",
      recording_platform: "extension",
    });
  });

  it("still creates the recording when tracking throws", async () => {
    calls.track.mockImplementation(() => {
      throw new Error("tracker down");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      action.run(
        { id: "rec-1", recordingPlatform: "web" },
        { userEmail: "owner@example.com" },
      ),
    ).resolves.toMatchObject({ id: "rec-1" });
    expect(calls.writeState).toHaveBeenCalledWith(
      "recording-upload-rec-1",
      expect.objectContaining({ status: "uploading" }),
    );
    warn.mockRestore();
  });
});
