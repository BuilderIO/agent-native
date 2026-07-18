// @ts-expect-error Vitest is provided by the repository test workspace.
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
  },
}));

import {
  bindCaptureJobOwner,
  CaptureQueueOwnerMismatchError,
  enqueueCaptureJob,
  releaseCaptureJobLocalFile,
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
});
