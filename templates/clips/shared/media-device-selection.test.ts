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

  it("lists phone-like microphones so the user can pick one", () => {
    expect(isSelectableAudioInputDevice(audio("default", "Default"))).toBe(
      false,
    );
    expect(
      isSelectableAudioInputDevice(audio("iphone", "Steve's iPhone")),
    ).toBe(true);
    expect(isSelectableAudioInputDevice(audio("ipad", "iPad Mic"))).toBe(true);
  });

  it("rematches a picked phone-like mic under a new id by its exact name", () => {
    expect(
      chooseFallbackAudioInput(
        [
          audio("built-in", "MacBook Pro Microphone"),
          audio("ipad-rotated", "iPad Mic"),
        ],
        { savedLabel: "iPad Mic", avoidDeviceIds: ["ipad-old"] },
      ),
    ).toEqual({
      deviceId: "ipad-rotated",
      label: "iPad Mic",
      reason: "saved-label",
    });
  });

  it("never brings back a phone-like mic through a loose name match", () => {
    expect(
      chooseFallbackAudioInput(
        [
          audio("iphone", "Steve's iPhone Microphone"),
          audio("built-in", "MacBook Pro Microphone"),
        ],
        { savedLabel: "Default - Steve's iPhone Microphone" },
      ),
    ).toEqual({
      deviceId: "built-in",
      label: "MacBook Pro Microphone",
      reason: "best-concrete",
    });
  });

  it("skips pseudo and phone microphones when choosing a concrete fallback", () => {
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
