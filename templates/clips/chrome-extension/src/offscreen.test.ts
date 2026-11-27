import type { ScreenCaptureSurface } from "@shared/recording-capture";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  MEDIA_PERMISSION_REQUIRED_CODE,
  MediaPermissionRequiredError,
} from "./media-permission";

let displayConstraints: (
  surface: ScreenCaptureSurface,
  wantsMic: boolean,
) => MediaStreamConstraints;
let errorResponse: (error: unknown) => {
  ok: false;
  error: string;
  errorCode?: string;
  errorDevice?: string;
};
let abortServerUpload: (...args: any[]) => Promise<void>;
let correctMicStreamIfNeeded: (
  stream: MediaStream,
  requestedDeviceId: string,
  requestedDeviceLabel: string,
) => Promise<MediaStream>;

function micStream(deviceId: string, label: string): MediaStream {
  const track = {
    label,
    getSettings: () => ({ deviceId }),
    stop: vi.fn(),
  };
  return {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
}

function stubMicrophones() {
  const replacement = micStream("built-in", "MacBook Pro Microphone");
  const getUserMedia = vi.fn(async () => replacement);
  vi.stubGlobal("navigator", {
    mediaDevices: {
      enumerateDevices: async () => [
        { kind: "audioinput", deviceId: "ipad", label: "iPad Mic" },
        {
          kind: "audioinput",
          deviceId: "built-in",
          label: "MacBook Pro Microphone",
        },
      ],
      getUserMedia,
    },
  });
  return { getUserMedia, replacement };
}

beforeAll(async () => {
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      onMessage: { addListener: () => undefined },
      onConnect: { addListener: () => undefined },
      getManifest: () => ({ version: "test" }),
    },
    storage: {
      sync: { get: async () => ({}) },
    },
  };
  ({
    displayConstraints,
    errorResponse,
    abortServerUpload,
    correctMicStreamIfNeeded,
  } = await import("./offscreen"));
});

describe("offscreen phone-like microphone correction", () => {
  it("records from a phone-like mic the user picked", async () => {
    const { getUserMedia } = stubMicrophones();
    try {
      const picked = micStream("ipad", "iPad Mic");

      await expect(
        correctMicStreamIfNeeded(picked, "ipad", "iPad Mic"),
      ).resolves.toBe(picked);
      expect(getUserMedia).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("moves the system default off a phone-like mic", async () => {
    const { getUserMedia, replacement } = stubMicrophones();
    try {
      const systemDefault = micStream("ipad", "iPad Mic");

      await expect(
        correctMicStreamIfNeeded(systemDefault, "", ""),
      ).resolves.toBe(replacement);
      expect(getUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          audio: expect.objectContaining({ deviceId: { exact: "built-in" } }),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("offscreen error replies", () => {
  it("carries a missing grant across the message boundary as a code", () => {
    const response = errorResponse(
      new MediaPermissionRequiredError("microphone"),
    );

    expect(response.errorCode).toBe(MEDIA_PERMISSION_REQUIRED_CODE);
    expect(response.errorDevice).toBe("microphone");
  });

  it("reports every other capture failure as a plain message", () => {
    const response = errorResponse(new Error("No chunks found"));

    expect(response.error).toBe("No chunks found");
    expect(response.errorCode).toBeUndefined();
  });
});

describe("offscreen upload cancellation", () => {
  it("sends an explicit user cancellation to the upload abort route", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetch);

    await abortServerUpload(
      {
        uploadUrl: "https://clips.example.test/api/uploads/rec-1/chunk?index=0",
        authToken: null,
      },
      "Recording cancelled by user",
      "user_cancelled",
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://clips.example.test/api/uploads/rec-1/abort",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          reason: "Recording cancelled by user",
          failureCode: "user_cancelled",
        }),
      }),
    );
    vi.unstubAllGlobals();
  });
});

describe("offscreen display capture audio policy", () => {
  it("does not request screen/tab audio when the microphone toggle is off", () => {
    const constraints = displayConstraints("monitor", false) as {
      audio: unknown;
      systemAudio?: string;
    };
    expect(constraints.audio).toBe(false);
    expect(constraints.systemAudio).toBe("exclude");
  });

  it("requests screen/tab audio when the microphone toggle is on", () => {
    const constraints = displayConstraints("monitor", true) as {
      audio: unknown;
      systemAudio?: string;
    };
    expect(constraints.audio).toBe(true);
    expect(constraints.systemAudio).toBe("include");
  });
});
