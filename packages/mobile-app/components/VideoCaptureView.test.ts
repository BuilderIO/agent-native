// @ts-expect-error Vitest is provided by the repository test workspace.
import { describe, expect, it, vi } from "vitest";

vi.mock("@tabler/icons-react-native", () => ({
  IconAlertCircle: vi.fn(),
  IconCamera: vi.fn(),
  IconCameraRotate: vi.fn(),
  IconPhoto: vi.fn(),
  IconSettings: vi.fn(),
  IconX: vi.fn(),
}));
vi.mock("expo-camera", () => ({
  CameraView: vi.fn(),
  useCameraPermissions: vi.fn(),
  useMicrophonePermissions: vi.fn(),
}));
vi.mock("expo-image-picker", () => ({}));
vi.mock("expo-file-system", () => ({ File: vi.fn() }));
vi.mock("react-native", () => ({
  ActivityIndicator: vi.fn(),
  AppState: { currentState: "active" },
  BackHandler: {},
  Linking: {},
  Pressable: vi.fn(),
  StyleSheet: {
    absoluteFill: {},
    create: <T>(styles: T) => styles,
  },
  Text: vi.fn(),
  View: vi.fn(),
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: vi.fn(),
}));
vi.mock("@/lib/mobile-state-api", () => ({
  setMobileCaptureStateBestEffort: vi.fn(),
}));

import {
  canCancelVideoRecording,
  completeVideoRecording,
} from "./VideoCaptureView";

describe("completeVideoRecording", () => {
  it("does not allow cancel once irreversible delivery starts", () => {
    expect(canCancelVideoRecording(false)).toBe(true);
    expect(canCancelVideoRecording(true)).toBe(false);
  });

  it("discards a canceled recording without delivering it", async () => {
    const deliverMedia = vi.fn();
    const discardMedia = vi.fn();

    await expect(
      completeVideoRecording({
        disposition: "discard",
        uri: "file:///private/canceled.mp4",
        startedAt: 1_000,
        stoppedAt: 4_000,
        deliverMedia,
        discardMedia,
      }),
    ).resolves.toBe("discarded");

    expect(deliverMedia).not.toHaveBeenCalled();
    expect(discardMedia).toHaveBeenCalledWith("file:///private/canceled.mp4");
  });

  it("delivers a normally stopped recording", async () => {
    const deliverMedia = vi.fn();
    const discardMedia = vi.fn();

    await expect(
      completeVideoRecording({
        disposition: "capture",
        uri: "file:///private/completed.mp4",
        startedAt: 1_000,
        stoppedAt: 4_000,
        deliverMedia,
        discardMedia,
      }),
    ).resolves.toBe("captured");

    expect(deliverMedia).toHaveBeenCalledOnce();
    expect(deliverMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "camera",
        uri: "file:///private/completed.mp4",
        durationMs: 3_000,
      }),
    );
    expect(discardMedia).not.toHaveBeenCalled();
  });

  it("does not treat a missing canceled result as a capture error", async () => {
    const deliverMedia = vi.fn();
    const discardMedia = vi.fn();

    await expect(
      completeVideoRecording({
        disposition: "discard",
        uri: undefined,
        startedAt: 1_000,
        stoppedAt: 4_000,
        deliverMedia,
        discardMedia,
      }),
    ).resolves.toBe("discarded");

    expect(deliverMedia).not.toHaveBeenCalled();
    expect(discardMedia).not.toHaveBeenCalled();
  });
});
