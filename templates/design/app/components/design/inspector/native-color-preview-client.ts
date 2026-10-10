import type {
  NativeColorCapability,
  NativeColorMode,
  NativeDynamicRangeMode,
} from "../bridge/native-color-mode";

export class NativeColorPreviewError extends Error {
  constructor(
    readonly code:
      | "runtime-unavailable"
      | "capability-unreadable"
      | "dynamic-range-unsupported"
      | "hdr-unavailable",
    readonly capability?: NativeColorCapability,
  ) {
    super(code);
    this.name = "NativeColorPreviewError";
  }
}

type ColorRuntime = {
  colorCapability?: () => unknown;
  setColorMode?: (mode: NativeColorMode) => Promise<unknown>;
  setDynamicRangeMode?: (mode: NativeDynamicRangeMode) => Promise<unknown>;
};

function runtimeFor(frame: HTMLIFrameElement): ColorRuntime {
  try {
    const runtime = (
      frame.contentWindow as
        | (Window & {
            __anNativeShaders?: ColorRuntime;
          })
        | null
    )?.__anNativeShaders;
    if (runtime) return runtime;
  } catch {
    throw new NativeColorPreviewError("runtime-unavailable");
  }
  throw new NativeColorPreviewError("runtime-unavailable");
}

function capability(value: unknown): NativeColorCapability {
  if (!value || typeof value !== "object")
    throw new NativeColorPreviewError("capability-unreadable");
  const data = value as Record<string, unknown>;
  const legacyRange =
    data.requestedDynamicRange === undefined &&
    data.presentedDynamicRange === undefined &&
    data.dynamicRangeReason === undefined &&
    data.hdr === "unavailable" &&
    data.outputDynamicRange === "sdr";
  const requestedSdr =
    data.requestedDynamicRange === "sdr" &&
    data.presentedDynamicRange === "sdr" &&
    data.dynamicRangeReason === undefined &&
    data.hdr === "unavailable" &&
    data.outputDynamicRange === "sdr";
  const activeHdr =
    data.requestedDynamicRange === "hdr" &&
    data.presentedDynamicRange === "hdr" &&
    data.dynamicRangeReason === undefined &&
    data.hdr === "configured" &&
    data.outputDynamicRange === "hdr" &&
    data.displayDynamicRangeCapability === "high-capable";
  const failedHdr =
    data.requestedDynamicRange === "hdr" &&
    data.presentedDynamicRange === "sdr" &&
    (data.dynamicRangeReason === "display-not-high-capable" ||
      data.dynamicRangeReason === "display-capability-unreadable" ||
      data.dynamicRangeReason === "float-canvas-unavailable" ||
      data.dynamicRangeReason === "extended-tone-mapping-unavailable" ||
      data.dynamicRangeReason === "gpu-unavailable") &&
    data.hdr === "unavailable" &&
    data.outputDynamicRange === "sdr";
  if (
    (data.requested !== "srgb" && data.requested !== "display-p3") ||
    (data.presented !== "srgb" && data.presented !== "display-p3") ||
    data.sourceGamut !== "dom-srgb-only" ||
    !(legacyRange || requestedSdr || activeHdr || failedHdr) ||
    (data.displayDynamicRangeCapability !== "high-capable" &&
      data.displayDynamicRangeCapability !== "standard-only" &&
      data.displayDynamicRangeCapability !== "unreadable") ||
    (data.canvasToneMappingStandard !== "observed" &&
      data.canvasToneMappingStandard !== "member-not-observed" &&
      data.canvasToneMappingStandard !== "unreadable") ||
    (data.reason !== undefined &&
      data.reason !== "p3-canvas-unavailable" &&
      data.reason !== "gpu-unavailable")
  )
    throw new NativeColorPreviewError("capability-unreadable");
  return data as NativeColorCapability;
}

export function readNativeColorCapability(
  frame: HTMLIFrameElement,
): NativeColorCapability {
  const runtime = runtimeFor(frame);
  if (!runtime.colorCapability)
    throw new NativeColorPreviewError("runtime-unavailable");
  return capability(runtime.colorCapability());
}

export async function setNativeColorMode(
  frame: HTMLIFrameElement,
  mode: NativeColorMode,
): Promise<NativeColorCapability> {
  const runtime = runtimeFor(frame);
  if (!runtime.setColorMode)
    throw new NativeColorPreviewError("runtime-unavailable");
  return capability(await runtime.setColorMode(mode));
}

export async function setNativeDynamicRangeMode(
  frame: HTMLIFrameElement,
  mode: NativeDynamicRangeMode,
): Promise<NativeColorCapability> {
  const runtime = runtimeFor(frame);
  if (!runtime.setDynamicRangeMode)
    throw new NativeColorPreviewError("dynamic-range-unsupported");
  let value: unknown;
  try {
    value = await runtime.setDynamicRangeMode(mode);
  } catch {
    if (mode === "hdr" && runtime.colorCapability) {
      const current = capability(runtime.colorCapability());
      if (current.presentedDynamicRange !== "hdr")
        throw new NativeColorPreviewError("hdr-unavailable", current);
    }
    throw new NativeColorPreviewError("runtime-unavailable");
  }
  const result = capability(value);
  if (result.requestedDynamicRange !== mode)
    throw new NativeColorPreviewError("capability-unreadable");
  if (mode === "hdr" && result.presentedDynamicRange !== "hdr")
    throw new NativeColorPreviewError("hdr-unavailable", result);
  return result;
}
