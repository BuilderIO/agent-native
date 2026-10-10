import { describe, expect, it } from "vitest";

import {
  NativeColorPreviewError,
  readNativeColorCapability,
  setNativeColorMode,
  setNativeDynamicRangeMode,
} from "./native-color-preview-client";

const p3 = {
  requested: "display-p3",
  presented: "display-p3",
  sourceGamut: "dom-srgb-only",
  hdr: "unavailable",
  outputDynamicRange: "sdr",
  displayDynamicRangeCapability: "high-capable",
  canvasToneMappingStandard: "observed",
} as const;

describe("selected native preview color capability", () => {
  it("reports the actual presented mode and its source/HDR limits", async () => {
    const frame = {
      contentWindow: {
        __anNativeShaders: {
          colorCapability: () => p3,
          setColorMode: async () => p3,
        },
      },
    } as unknown as HTMLIFrameElement;
    expect(readNativeColorCapability(frame)).toEqual(p3);
    expect(await setNativeColorMode(frame, "display-p3")).toEqual(p3);
  });

  it("rejects a claimed P3 result without a readable source gamut", () => {
    const frame = {
      contentWindow: {
        __anNativeShaders: {
          colorCapability: () => ({
            requested: "display-p3",
            presented: "display-p3",
          }),
        },
      },
    } as unknown as HTMLIFrameElement;
    expect(() => readNativeColorCapability(frame)).toThrowError(
      NativeColorPreviewError,
    );
  });

  it("rejects an ambiguous dynamic-range probe instead of implying HDR output", () => {
    const frame = {
      contentWindow: {
        __anNativeShaders: {
          colorCapability: () => ({
            ...p3,
            outputDynamicRange: "hdr",
          }),
        },
      },
    } as unknown as HTMLIFrameElement;
    expect(() => readNativeColorCapability(frame)).toThrowError(
      NativeColorPreviewError,
    );
  });

  it("requires a configured extended-range result before reporting HDR", async () => {
    const active = {
      ...p3,
      requestedDynamicRange: "hdr",
      presentedDynamicRange: "hdr",
      hdr: "configured",
      outputDynamicRange: "hdr",
    } as const;
    const frame = {
      contentWindow: {
        __anNativeShaders: {
          colorCapability: () => active,
          setDynamicRangeMode: async () => active,
        },
      },
    } as unknown as HTMLIFrameElement;
    expect(await setNativeDynamicRangeMode(frame, "hdr")).toEqual(active);
    expect(readNativeColorCapability(frame).presentedDynamicRange).toBe("hdr");
    const falseClaim = {
      ...active,
      displayDynamicRangeCapability: "standard-only",
    };
    const falseFrame = {
      contentWindow: {
        __anNativeShaders: { colorCapability: () => falseClaim },
      },
    } as unknown as HTMLIFrameElement;
    expect(() => readNativeColorCapability(falseFrame)).toThrowError(
      NativeColorPreviewError,
    );
  });

  it("refuses an HDR request with typed SDR fallback while retaining its diagnostic", async () => {
    const fallback = {
      ...p3,
      requestedDynamicRange: "hdr",
      presentedDynamicRange: "sdr",
      dynamicRangeReason: "extended-tone-mapping-unavailable",
    } as const;
    const frame = {
      contentWindow: {
        __anNativeShaders: {
          setDynamicRangeMode: async () => fallback,
        },
      },
    } as unknown as HTMLIFrameElement;
    await expect(setNativeDynamicRangeMode(frame, "hdr")).rejects.toMatchObject(
      {
        code: "hdr-unavailable",
        capability: fallback,
      },
    );
  });

  it("reads the actual SDR state when the runtime rejects an HDR configuration", async () => {
    const current = {
      ...p3,
      requestedDynamicRange: "sdr",
      presentedDynamicRange: "sdr",
    } as const;
    const frame = {
      contentWindow: {
        __anNativeShaders: {
          colorCapability: () => current,
          setDynamicRangeMode: async () => {
            throw new Error("float canvas unsupported");
          },
        },
      },
    } as unknown as HTMLIFrameElement;
    await expect(setNativeDynamicRangeMode(frame, "hdr")).rejects.toMatchObject(
      {
        code: "hdr-unavailable",
        capability: current,
      },
    );
  });

  it("does not offer HDR from an older runtime without the control", async () => {
    const frame = {
      contentWindow: { __anNativeShaders: { colorCapability: () => p3 } },
    } as unknown as HTMLIFrameElement;
    expect(
      readNativeColorCapability(frame).requestedDynamicRange,
    ).toBeUndefined();
    await expect(setNativeDynamicRangeMode(frame, "hdr")).rejects.toMatchObject(
      {
        code: "dynamic-range-unsupported",
      },
    );
  });
});
