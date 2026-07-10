import { describe, expect, it, vi } from "vitest";

import { planNativeFullscreenWarmOverlap } from "./native-recording-warm";

describe("planNativeFullscreenWarmOverlap", () => {
  it("starts transcription immediately and overlaps warm with create-recording", async () => {
    const events: string[] = [];
    let resolveCreate!: (value: {
      id: string;
      uploadMode?: "streaming";
    }) => void;
    let resolveTranscription!: () => void;

    const createRecording = () =>
      new Promise<{ id: string; uploadMode?: "streaming" }>((resolve) => {
        events.push("create-started");
        resolveCreate = (value) => {
          events.push("create-resolved");
          resolve(value);
        };
      });

    const startTranscription = () =>
      new Promise<void>((resolve) => {
        events.push("transcription-started");
        resolveTranscription = () => {
          events.push("transcription-resolved");
          resolve();
        };
      });

    const warmMic = vi.fn(async (recordingId: string) => {
      events.push(`warm-started:${recordingId}`);
      await Promise.resolve();
      events.push(`warm-resolved:${recordingId}`);
    });

    const pending = planNativeFullscreenWarmOverlap({
      createRecording,
      startTranscription,
      warmMic,
    });

    // Transcription must be kicked off before create resolves.
    expect(events).toEqual(["transcription-started", "create-started"]);

    resolveCreate({ id: "rec-1", uploadMode: "streaming" });
    await Promise.resolve();
    expect(events).toContain("create-resolved");
    expect(events).toContain("warm-started:rec-1");

    // Warm should not wait for transcription readiness.
    expect(events.indexOf("warm-started:rec-1")).toBeLessThan(
      events.indexOf("transcription-resolved") === -1
        ? Number.POSITIVE_INFINITY
        : events.indexOf("transcription-resolved"),
    );

    resolveTranscription();
    const result = await pending;
    expect(result).toEqual({ id: "rec-1", uploadMode: "streaming" });
    expect(warmMic).toHaveBeenCalledWith("rec-1");
    expect(events).toContain("transcription-resolved");
    expect(events).toContain("warm-resolved:rec-1");
  });

  it("awaits both transcription and warm before resolving", async () => {
    let resolveTranscription!: () => void;
    let resolveWarm!: () => void;
    let settled = false;

    const pending = planNativeFullscreenWarmOverlap({
      createRecording: async () => ({ id: "rec-2" }),
      startTranscription: () =>
        new Promise<void>((resolve) => {
          resolveTranscription = resolve;
        }),
      warmMic: () =>
        new Promise<void>((resolve) => {
          resolveWarm = resolve;
        }),
    });

    void pending.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    resolveWarm();
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveTranscription();
    await expect(pending).resolves.toEqual({ id: "rec-2" });
    expect(settled).toBe(true);
  });
});
