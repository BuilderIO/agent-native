import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import {
  appendFinalTranscript,
  recordingTranscriptionLanguage,
  restartTranscriptionEngine,
  type SourcedTranscriptSegment,
  startTranscriptionEngine,
} from "./transcription-engine";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

describe("recording transcription language", () => {
  it("leaves local Whisper recordings on auto-detect instead of forcing the UI locale", () => {
    expect(recordingTranscriptionLanguage()).toBeNull();
  });

  it("drops overlapping duplicate speech from the other audio source", () => {
    const lines: string[] = [];
    const segments: SourcedTranscriptSegment[] = [];

    expect(
      appendFinalTranscript(
        {
          text: "Send the pull request button",
          source: "mic",
          segments: [
            {
              startMs: 1_000,
              endMs: 2_000,
              text: "Send the pull request button",
            },
          ],
        },
        lines,
        segments,
      ),
    ).toBe(true);

    expect(
      appendFinalTranscript(
        {
          text: "Send the pull request button",
          source: "system",
          segments: [
            {
              startMs: 1_100,
              endMs: 2_100,
              text: "Send the pull request button",
            },
          ],
        },
        lines,
        segments,
      ),
    ).toBe(false);

    expect(lines).toEqual(["Me: Send the pull request button"]);
    expect(segments).toHaveLength(1);
  });

  it("keeps matching speech when it happens at a different time", () => {
    const lines: string[] = [];
    const segments: SourcedTranscriptSegment[] = [];
    const event = {
      text: "Please review the changes",
      segments: [
        {
          startMs: 1_000,
          endMs: 2_000,
          text: "Please review the changes",
        },
      ],
    };

    expect(
      appendFinalTranscript({ ...event, source: "mic" }, lines, segments),
    ).toBe(true);
    expect(
      appendFinalTranscript(
        {
          ...event,
          source: "system",
          segments: [
            {
              startMs: 3_000,
              endMs: 4_000,
              text: "Please review the changes",
            },
          ],
        },
        lines,
        segments,
      ),
    ).toBe(true);

    expect(lines).toHaveLength(2);
    expect(segments).toHaveLength(2);
  });
});

describe("meeting microphone capture", () => {
  it("starts without VoiceProcessingIO so call apps keep control of mic gain", async () => {
    await startTranscriptionEngine({
      mic: { deviceId: "mic-1", label: "Built-in Microphone" },
    });

    expect(invokeMock).toHaveBeenCalledWith("audio_transcription_start", {
      meetingId: null,
      locale: null,
      micDeviceId: "mic-1",
      micDeviceLabel: "Built-in Microphone",
      captureSystem: true,
      voiceProcessing: false,
      emitPartials: true,
      owner: "meeting",
    });
  });

  it("keeps VoiceProcessingIO off when meeting transcription resumes", async () => {
    await restartTranscriptionEngine("whisper", {
      deviceId: "mic-1",
      label: "Built-in Microphone",
    });

    expect(invokeMock).toHaveBeenCalledWith("audio_transcription_start", {
      meetingId: null,
      locale: null,
      micDeviceId: "mic-1",
      micDeviceLabel: "Built-in Microphone",
      captureSystem: true,
      voiceProcessing: false,
      emitPartials: true,
      owner: "meeting",
    });
  });

  it("can disable partial inference for recording-only consumers", async () => {
    await startTranscriptionEngine({
      mic: { deviceId: "mic-1", label: "Built-in Microphone" },
      emitPartials: false,
    });

    expect(invokeMock).toHaveBeenCalledWith("audio_transcription_start", {
      meetingId: null,
      locale: null,
      micDeviceId: "mic-1",
      micDeviceLabel: "Built-in Microphone",
      captureSystem: true,
      voiceProcessing: false,
      emitPartials: false,
      owner: "meeting",
    });
  });

  it("falls back to native speech when the local Whisper capture cannot start", async () => {
    invokeMock
      .mockRejectedValueOnce(new Error("local meeting capture unavailable"))
      .mockResolvedValueOnce(undefined);

    const engine = await startTranscriptionEngine({
      mic: { deviceId: "mic-1", label: "Built-in Microphone" },
    });

    expect(engine).toBe("macos-native");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "native_speech_start", {
      locale: "en-US",
      micDeviceId: "mic-1",
      micDeviceLabel: "Built-in Microphone",
      owner: "meeting",
    });
  });

  it("surfaces the native fallback error when both local engines fail", async () => {
    invokeMock
      .mockRejectedValueOnce(new Error("local Whisper capture unavailable"))
      .mockRejectedValueOnce(
        new Error("VoiceProcessingIO enable failed: unavailable"),
      );

    await expect(
      startTranscriptionEngine({
        mic: { deviceId: "mic-1", label: "Built-in Microphone" },
      }),
    ).rejects.toThrow("VoiceProcessingIO enable failed: unavailable");
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
