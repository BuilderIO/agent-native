export type NativePublishedPixelFormat = "bgra8unorm" | "rgba8unorm";
export type NativePresentationReadbackPlan = {
  width: number;
  height: number;
  format: NativePublishedPixelFormat;
  bytesPerRow: number;
  bufferBytes: number;
  compactBytes: number;
};

export function planNativePresentationReadback(input: {
  width: number;
  height: number;
  format: string;
  colorSpace: string;
  dynamicRange: string;
}): NativePresentationReadbackPlan {
  const { width, height, format } = input;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 2048 ||
    height > 2048 ||
    width * height > 1_048_576
  )
    throw new Error("presentation-fault-pixels-unbounded");
  if (
    input.colorSpace !== "srgb" ||
    input.dynamicRange !== "sdr" ||
    (format !== "bgra8unorm" && format !== "rgba8unorm")
  )
    throw new Error("presentation-fault-color-unsupported");
  const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
  return {
    width,
    height,
    format,
    bytesPerRow,
    bufferBytes: bytesPerRow * height,
    compactBytes: width * height * 4,
  };
}

export function compactNativePresentationReadback(
  padded: Uint8Array,
  plan: NativePresentationReadbackPlan,
): { rgba: Uint8Array; nonTransparentPixels: number } {
  if (padded.byteLength !== plan.bufferBytes)
    throw new Error("presentation-fault-readback-incomplete");
  const rgba = new Uint8Array(plan.compactBytes);
  let nonTransparentPixels = 0;
  for (let y = 0; y < plan.height; y += 1) {
    for (let x = 0; x < plan.width; x += 1) {
      const source = y * plan.bytesPerRow + x * 4;
      const target = (y * plan.width + x) * 4;
      if (plan.format === "bgra8unorm") {
        rgba[target] = padded[source + 2]!;
        rgba[target + 1] = padded[source + 1]!;
        rgba[target + 2] = padded[source]!;
      } else {
        rgba[target] = padded[source]!;
        rgba[target + 1] = padded[source + 1]!;
        rgba[target + 2] = padded[source + 2]!;
      }
      const alpha = padded[source + 3]!;
      rgba[target + 3] = alpha;
      if (alpha > 0) nonTransparentPixels += 1;
    }
  }
  return { rgba, nonTransparentPixels };
}

export class NativePublishedPresentationMirror<Resource> {
  private published: Resource | null = null;
  private candidate: Resource | null = null;
  constructor(private readonly retire: (resource: Resource) => void) {}
  stage(resource: Resource): void {
    if (this.candidate) throw new Error("presentation-fault-mirror-busy");
    this.candidate = resource;
  }
  commit(): void {
    if (!this.candidate) throw new Error("presentation-fault-mirror-missing");
    const old = this.published;
    this.published = this.candidate;
    this.candidate = null;
    if (old) this.retire(old);
  }
  discard(): void {
    const candidate = this.candidate;
    this.candidate = null;
    if (candidate) this.retire(candidate);
  }
  current(): Resource | null {
    return this.published;
  }
  clear(): void {
    this.discard();
    const old = this.published;
    this.published = null;
    if (old) this.retire(old);
  }
}
