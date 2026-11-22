import { describe, expect, it } from "vitest";

import {
  computeInteractZoomToFit,
  DEFAULT_INTERACT_DEVICE_PRESET,
  findSelectableInteractDevicePreset,
  formatInteractZoom,
  INTERACT_CUSTOM_DEVICE_NAME,
  resolveInteractDeviceForScreen,
  SELECTABLE_INTERACT_DEVICE_PRESETS,
} from "./responsive-interact";

// oracle-change: removed DesignCanvas and DesignEditor source greps; the Interact device-choice cases remain

describe("computeInteractZoomToFit", () => {
  it("keeps 100% when the device already fits the available space", () => {
    expect(
      computeInteractZoomToFit({
        availableWidth: 1200,
        availableHeight: 1200,
        deviceWidth: 402,
        deviceHeight: 874,
      }),
    ).toBe(100);
  });

  it("steps down to the nearest 5 when width is the constraint", () => {
    expect(
      computeInteractZoomToFit({
        availableWidth: 500,
        availableHeight: 400,
        deviceWidth: 402,
        deviceHeight: 874,
      }),
    ).toBe(45);
  });

  it("uses the smaller of width/height scale", () => {
    expect(
      computeInteractZoomToFit({
        availableWidth: 200,
        availableHeight: 900,
        deviceWidth: 402,
        deviceHeight: 874,
      }),
    ).toBe(45);
  });

  it("clamps to minZoom instead of going below it", () => {
    expect(
      computeInteractZoomToFit({
        availableWidth: 50,
        availableHeight: 50,
        deviceWidth: 1440,
        deviceHeight: 900,
        minZoom: 10,
      }),
    ).toBe(10);
  });

  it("falls back to 100 for a degenerate device size", () => {
    expect(
      computeInteractZoomToFit({
        availableWidth: 500,
        availableHeight: 500,
        deviceWidth: 0,
        deviceHeight: 874,
      }),
    ).toBe(100);
  });
});

describe("responsive Interact defaults", () => {
  it("falls back to desktop and otherwise adopts the screen viewport", () => {
    expect(DEFAULT_INTERACT_DEVICE_PRESET.category).toBe("desktop");
    expect(resolveInteractDeviceForScreen()).toMatchObject({
      category: "desktop",
      width: 1440,
      height: 900,
    });
    expect(
      resolveInteractDeviceForScreen({ width: 1280, height: 720 }),
    ).toEqual({
      name: "Custom",
      category: "custom",
      width: 1280,
      height: 720,
    });
  });

  it("formats every displayed zoom with one decimal place", () => {
    expect(formatInteractZoom(73.33150562529376)).toBe("73.3");
    expect(formatInteractZoom(100)).toBe("100.0");
  });
});

describe("Interact device choices", () => {
  it("offers every preset except the Custom display state", () => {
    expect(
      SELECTABLE_INTERACT_DEVICE_PRESETS.map((preset) => preset.name),
    ).not.toContain(INTERACT_CUSTOM_DEVICE_NAME);
    expect(
      SELECTABLE_INTERACT_DEVICE_PRESETS.every(
        (preset) => preset.category !== "custom",
      ),
    ).toBe(true);
    expect(SELECTABLE_INTERACT_DEVICE_PRESETS.length).toBeGreaterThan(0);
  });

  it("resolves a selectable preset by exact name only", () => {
    expect(findSelectableInteractDevicePreset("iPhone 17")).toMatchObject({
      width: 402,
      height: 874,
    });
    expect(findSelectableInteractDevicePreset("Custom")).toBeUndefined();
    expect(findSelectableInteractDevicePreset("iphone 17")).toBeUndefined();
    expect(findSelectableInteractDevicePreset(undefined)).toBeUndefined();
    expect(findSelectableInteractDevicePreset(402)).toBeUndefined();
  });

  it("names a screen whose size matches a preset by that preset, and any other size Custom", () => {
    expect(
      resolveInteractDeviceForScreen({ width: 402, height: 874 }).name,
    ).toBe("iPhone 17");
    expect(
      resolveInteractDeviceForScreen({ width: 403, height: 874 }),
    ).toMatchObject({ name: INTERACT_CUSTOM_DEVICE_NAME, width: 403 });
  });
});
