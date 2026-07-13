import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import {
  recordingTranscriptionLanguage,
  restartTranscriptionEngine,
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
