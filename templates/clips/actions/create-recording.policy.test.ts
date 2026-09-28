import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  insert: vi.fn(),
  snapshot: vi.fn(async () => false),
  uploadProvider: vi.fn(async () => null),
  writeState: vi.fn(async () => {}),
}));

vi.mock("@agent-native/core/action", () => ({
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
  }),
  schema: { recordings: {} },
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
  allowsSqlRecordingChunkScratch: () => true,
  STORAGE_SETUP_REQUIRED_REASON: "Storage setup required",
}));
vi.mock("../server/lib/streaming-upload-mode.js", () => ({
  shouldEnableStreamingUpload: () => false,
}));

import createRecording from "./create-recording";

describe("create-recording policy", () => {
  it("saves the new recording's policy before initializing its upload", async () => {
    calls.insert.mockResolvedValue(undefined);
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
      calls.uploadProvider.mock.invocationCallOrder[0]!,
    );
  });
});
