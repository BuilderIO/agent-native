import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
  },
}));

import {
  bindCaptureJobOwner,
  CAPTURE_QUEUE_STORAGE_KEY,
  CaptureQueueOwnerMismatchError,
  enqueueCaptureJob,
  listCaptureJobs,
  markCaptureJobExhausted,
  recoverCaptureQueueStore,
  releaseCaptureJobLocalFile,
  startCaptureUploadAttempt,
} from "./capture-queue";

describe("capture queue account binding", () => {
  beforeEach(() => storage.clear());

  it("binds an unowned capture once and rejects another account", async () => {
    const job = await enqueueCaptureJob({
      id: "capture-owner-test",
      localUri: "file:///capture.m4a",
      kind: "meeting",
      durationMs: 1000,
      mimeType: "audio/mp4",
      title: "Meeting",
    });

    const bound = await bindCaptureJobOwner(job.id, "owner-a");
    expect(bound.ownerKey).toBe("owner-a");
    await expect(bindCaptureJobOwner(job.id, "owner-b")).rejects.toBeInstanceOf(
      CaptureQueueOwnerMismatchError,
    );
  });

  it("retains dictation audio until transcription releases it", async () => {
    const job = await enqueueCaptureJob({
      id: "capture-dictation-test",
      localUri: "file:///dictation.m4a",
      kind: "dictation",
      durationMs: 1000,
      mimeType: "audio/mp4",
      title: "Dictation",
    });

    expect(job.retainLocalFile).toBe(true);
    expect((await releaseCaptureJobLocalFile(job.id)).retainLocalFile).toBe(
      false,
    );
  });

  it("resets a corrupted store so capture can continue", async () => {
    storage.set(CAPTURE_QUEUE_STORAGE_KEY, "{not-json");

    await expect(recoverCaptureQueueStore()).resolves.toBe(true);
    await expect(listCaptureJobs()).resolves.toEqual([]);
    await expect(recoverCaptureQueueStore()).resolves.toBe(false);
  });

  it("keeps exhausted jobs terminal until a manual retry", async () => {
    const job = await enqueueCaptureJob({
      id: "capture-exhausted-test",
      localUri: "file:///capture.m4a",
      kind: "meeting",
      durationMs: 1000,
      mimeType: "audio/mp4",
      title: "Meeting",
    });
    const exhausted = await markCaptureJobExhausted(job.id, "Offline");

    expect(exhausted.state).toBe("exhausted");
    expect(exhausted.resume.retryable).toBe(false);
    const retrying = await startCaptureUploadAttempt(job.id);
    expect(retrying.state).toBe("uploading");
    expect(retrying.attempts).toBe(1);
  });

  it("returns the same queued job when durable delivery retries", async () => {
    const input = {
      id: "capture-stable-retry",
      localUri: "file:///capture-stable-retry.m4a",
      kind: "meeting" as const,
      durationMs: 1000,
      mimeType: "audio/mp4",
      title: "Meeting",
    };

    const first = await enqueueCaptureJob(input);
    const retried = await enqueueCaptureJob(input);

    expect(retried).toEqual(first);
    expect(await listCaptureJobs()).toHaveLength(1);
  });
});
