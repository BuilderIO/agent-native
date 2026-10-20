export class NativePixelReadbackError extends Error {
  readonly code = "readback-layout-invalid";

  constructor(message: string) {
    super(message);
    this.name = "NativePixelReadbackError";
  }
}

export class NativePixelCleanupError extends Error {
  readonly code = "gpu-cleanup-failed";

  constructor(readonly causes: readonly unknown[]) {
    super("The GPU export resources could not be fully released.");
    this.name = "NativePixelCleanupError";
  }
}

export function rgbaFromAlignedRows(
  padded: Uint8Array,
  width: number,
  height: number,
  bytesPerRow: number,
): Uint8Array {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    !Number.isSafeInteger(bytesPerRow) ||
    width <= 0 ||
    height <= 0 ||
    bytesPerRow < width * 4 ||
    bytesPerRow % 256 !== 0 ||
    padded.byteLength !== bytesPerRow * height
  )
    throw new NativePixelReadbackError(
      "The mapped GPU pixel rows do not match the requested export dimensions.",
    );
  const rgba = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1)
    rgba.set(
      padded.subarray(row * bytesPerRow, row * bytesPerRow + width * 4),
      row * width * 4,
    );
  return rgba;
}
