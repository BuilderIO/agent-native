import { describe, expect, it } from "vitest";

import {
  chooseFallbackAudioInput,
  isSelectableAudioInputDevice,
} from "./media-device-selection";

function audio(deviceId: string, label: string): MediaDeviceInfo {
  return {
    kind: "audioinput",
    deviceId,
    label,
  } as MediaDeviceInfo;
}

describe("media device selection", () => {
  it("rematches a rotated mic id by saved label", () => {
    expect(
      chooseFallbackAudioInput(
        [
          audio("iphone", "Steve's iPhone Microphone"),
          audio("rotated", "Shure MV7"),
          audio("built-in", "MacBook Pro Microphone"),
        ],
        { savedLabel: "Shure MV7", avoidDeviceIds: ["old-id"] },
      ),
    ).toEqual({
      deviceId: "rotated",
      label: "Shure MV7",
      reason: "saved-label",
    });
  });

  it("skips pseudo and phone microphones when choosing a concrete fallback", () => {
    expect(isSelectableAudioInputDevice(audio("default", "Default"))).toBe(
      false,
    );
    expect(
      isSelectableAudioInputDevice(audio("iphone", "Steve's iPhone")),
    ).toBe(false);
    expect(
      chooseFallbackAudioInput([
        audio("default", "Default"),
        audio("iphone", "Steve's iPhone Microphone"),
        audio("built-in", "MacBook Pro Microphone"),
        audio("usb", "USB Audio"),
      ]),
    ).toEqual({
      deviceId: "built-in",
      label: "MacBook Pro Microphone",
      reason: "best-concrete",
    });
  });
});
