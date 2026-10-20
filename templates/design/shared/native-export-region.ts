export type NativeExportRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type NativeExportViewport = { width: number; height: number };

export function planNativeExportRegion({
  viewport,
  cropRect,
  pixelRatio,
}: {
  viewport: NativeExportViewport;
  cropRect?: NativeExportRegion;
  pixelRatio: number;
}):
  | { ok: true; region: NativeExportRegion; width: number; height: number }
  | {
      ok: false;
      code: "viewport-invalid" | "region-invalid" | "size-unsupported";
    } {
  if (
    ![viewport.width, viewport.height].every(
      (value) => Number.isSafeInteger(value) && value > 0 && value <= 32768,
    )
  )
    return { ok: false, code: "viewport-invalid" };
  const region = cropRect ?? { x: 0, y: 0, ...viewport };
  if (
    ![region.x, region.y, region.width, region.height].every(Number.isFinite) ||
    region.width <= 0 ||
    region.height <= 0
  )
    return { ok: false, code: "region-invalid" };
  const width = Math.ceil(region.width * pixelRatio);
  const height = Math.ceil(region.height * pixelRatio);
  if (
    !Number.isFinite(pixelRatio) ||
    pixelRatio <= 0 ||
    pixelRatio > 4 ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 4096 ||
    width * height > 8_388_608
  )
    return { ok: false, code: "size-unsupported" };
  return { ok: true, region: { ...region }, width, height };
}
