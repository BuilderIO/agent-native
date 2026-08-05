import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  endStaleIOSCaptureActivities: vi.fn(),
  enqueueCaptureJob: vi.fn(),
  getClipsSession: vi.fn(),
  importIOSSharedCaptures: vi.fn(),
  listCaptureJobs: vi.fn(),
  listRecoverableCaptureFiles: vi.fn(),
  recoverCaptureQueueStore: vi.fn(),
  sweepOrphanedCaptureFiles: vi.fn(),
}));

vi.mock("expo-notifications", () => ({
  setNotificationHandler: vi.fn(),
}));
vi.mock("react-native", () => ({
  AppState: { currentState: "active" },
  Linking: {},
}));
vi.mock("@/lib/capture-queue", () => ({
  enqueueCaptureJob: mocks.enqueueCaptureJob,
  listCaptureJobs: mocks.listCaptureJobs,
  recoverCaptureQueueStore: mocks.recoverCaptureQueueStore,
}));
vi.mock("@/lib/clips-api", () => ({ syncPendingCaptureJobs: vi.fn() }));
vi.mock("@/lib/clips-session", () => ({
  getClipsSession: mocks.getClipsSession,
}));
vi.mock("@/lib/ios-companion", () => ({
  endStaleIOSCaptureActivities: mocks.endStaleIOSCaptureActivities,
  importIOSSharedCaptures: mocks.importIOSSharedCaptures,
  subscribeToSharedCapture: vi.fn(),
}));
vi.mock("@/lib/persist-capture", () => ({
  listRecoverableCaptureFiles: mocks.listRecoverableCaptureFiles,
  sweepOrphanedCaptureFiles: mocks.sweepOrphanedCaptureFiles,
}));

import { initializeCaptureStorage } from "./CaptureSyncProvider";

describe("capture storage initialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recoverCaptureQueueStore.mockResolvedValue(false);
    mocks.endStaleIOSCaptureActivities.mockResolvedValue(undefined);
    mocks.importIOSSharedCaptures.mockResolvedValue(undefined);
    mocks.getClipsSession.mockResolvedValue({ ownerKey: "owner" });
    mocks.enqueueCaptureJob.mockResolvedValue(undefined);
  });

  it("recovers an unqueued capture before sweeping on every launch", async () => {
    const recoverable = {
      captureId: "capture_recovered_123",
      kind: "meeting",
      localUri: "file:///captures/capture_recovered_123.m4a",
      mimeType: "audio/mp4",
      title: "Recovered audio capture",
    };
    mocks.listCaptureJobs
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ localUri: recoverable.localUri }]);
    mocks.listRecoverableCaptureFiles.mockReturnValue([recoverable]);

    await initializeCaptureStorage();

    expect(mocks.recoverCaptureQueueStore).toHaveBeenCalledOnce();
    expect(mocks.listRecoverableCaptureFiles).toHaveBeenCalledWith([]);
    expect(mocks.enqueueCaptureJob).toHaveBeenCalledWith({
      id: recoverable.captureId,
      localUri: recoverable.localUri,
      ownerKey: "owner",
      kind: recoverable.kind,
      durationMs: 0,
      mimeType: recoverable.mimeType,
      title: recoverable.title,
    });
    expect(mocks.sweepOrphanedCaptureFiles).toHaveBeenCalledWith([
      recoverable.localUri,
    ]);
    expect(mocks.enqueueCaptureJob.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sweepOrphanedCaptureFiles.mock.invocationCallOrder[0],
    );
  });
});
