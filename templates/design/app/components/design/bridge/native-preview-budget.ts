import { fitNativeRasterDensity } from "./native-preview-geometry";

interface NativePreviewBudgetRequest {
  id: string;
  width: number;
  height: number;
  baseDensity: number;
  desiredDensity: number;
  bytesPerPixel: number;
  maxDimension: number;
  maxPixels: number;
}

export function planNativePreviewBudget(
  requests: readonly NativePreviewBudgetRequest[],
  availableBytes: number,
): Map<string, number> {
  if (!Number.isFinite(availableBytes) || availableBytes < 0)
    throw new RangeError("Invalid native preview working budget.");
  const densities = new Map<string, number>();
  const planned = requests.map((request) => {
    if (
      !request.id ||
      densities.has(request.id) ||
      !Number.isFinite(request.bytesPerPixel) ||
      request.bytesPerPixel <= 0 ||
      !Number.isFinite(request.desiredDensity) ||
      request.desiredDensity <= 0
    )
      throw new RangeError("Invalid native preview budget request.");
    const fit = (density: number, maxPixels = request.maxPixels): number =>
      fitNativeRasterDensity({
        ...request,
        density,
        maxPixels,
        pixelPadding: 6,
      });
    const cost = (density: number): number =>
      (Math.ceil(request.width * density) + 6) *
      (Math.ceil(request.height * density) + 6) *
      request.bytesPerPixel;
    const base = fit(request.baseDensity);
    const desired = fit(Math.max(request.baseDensity, request.desiredDensity));
    const baseCost = cost(base);
    densities.set(request.id, base);
    return {
      request,
      fit,
      base,
      desired,
      baseCost,
      increment: cost(desired) - baseCost,
    };
  });
  const baseCost = planned.reduce((sum, entry) => sum + entry.baseCost, 0);
  if (baseCost > availableBytes)
    throw new RangeError(
      "The native preview base working set exceeds its budget.",
    );
  let remaining = availableBytes - baseCost;
  const upgrades = planned
    .filter((entry) => entry.increment > 0)
    .sort(
      (first, second) =>
        first.increment - second.increment ||
        (first.request.id < second.request.id ? -1 : 1),
    );
  for (let index = 0; index < upgrades.length; index += 1) {
    const entry = upgrades[index]!;
    const share = remaining / (upgrades.length - index);
    if (entry.increment <= share) {
      densities.set(entry.request.id, entry.desired);
      remaining -= entry.increment;
      continue;
    }
    // Reserve each unsaturated target's share before physical-pixel rounding.
    for (const unsaturated of upgrades.slice(index)) {
      const maxPixels = Math.min(
        unsaturated.request.maxPixels,
        Math.floor(
          (unsaturated.baseCost + share) / unsaturated.request.bytesPerPixel,
        ),
      );
      densities.set(
        unsaturated.request.id,
        Math.max(
          unsaturated.base,
          unsaturated.fit(unsaturated.desired, maxPixels),
        ),
      );
    }
    break;
  }
  return densities;
}
