import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  updateSet: vi.fn(),
  snapshot: vi.fn(async () => false),
  uploadProvider: vi.fn(async () => null),
  writeState: vi.fn(async () => {}),
  bufferedFallbackAvailable: true,
  streamingEnabled: false,
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  defineAction: (action: unknown) => action,
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => calls.writeState(...args),
}));
vi.mock("@agent-native/core/file-upload", () => ({
  getActiveFileUploadProviderForRequest: (...args: unknown[]) =>
    calls.uploadProvider(...args),
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
  schema: { recordings: { id: "recordings.id" } },
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
  STORAGE_SETUP_REQUIRED_REASON: "Storage setup required",
}));
vi.mock("../server/lib/streaming-upload-mode.js", () => ({
  shouldEnableStreamingUpload: () => calls.streamingEnabled,
}));

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
    expect(calls.uploadProvider).not.toHaveBeenCalled();
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
});
