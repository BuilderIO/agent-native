import type {
  AspectRatio,
  PresetSkeletonForegroundLayer,
  PresetSkeletonSpec,
} from "../../shared/api.js";

export function normalizePresetSkeletonSpec(
  value: unknown,
): PresetSkeletonSpec | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const background = normalizeBackground(raw.background);
  if (!background) return null;
  const mask = normalizeMask(raw.mask);
  const contentMode =
    raw.contentMode === "fill" || raw.contentMode === "cutout"
      ? raw.contentMode
      : "fill";
  const contentRegion = normalizeRegion(raw.contentRegion);
  const foreground = Array.isArray(raw.foreground)
    ? raw.foreground
        .map(normalizeForegroundLayer)
        .filter((layer): layer is PresetSkeletonForegroundLayer =>
          Boolean(layer),
        )
        .slice(0, 8)
    : undefined;
  return {
    background,
    ...(mask ? { mask } : {}),
    contentMode,
    ...(contentRegion ? { contentRegion } : {}),
    ...(raw.dropShadow === true ? { dropShadow: true } : {}),
    ...(foreground?.length ? { foreground } : {}),
  };
}

function normalizeMask(value: unknown): PresetSkeletonSpec["mask"] | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.type === "asset" && typeof record.assetId === "string") {
    const assetId = record.assetId.trim();
    return assetId ? { type: "asset", assetId } : null;
  }
  return null;
}

export function skeletonUsesCanonicalLogo(
  spec: PresetSkeletonSpec | null | undefined,
): boolean {
  return Boolean(
    spec?.foreground?.some((layer) => layer.source === "canonicalLogo"),
  );
}

export function clampCutoutAspectRatio(input: {
  aspectRatio: AspectRatio;
  supported: readonly AspectRatio[];
}): AspectRatio {
  if (input.supported.includes(input.aspectRatio)) return input.aspectRatio;
  const requested = aspectRatioValue(input.aspectRatio);
  return [...input.supported].sort(
    (left, right) =>
      Math.abs(aspectRatioValue(left) - requested) -
      Math.abs(aspectRatioValue(right) - requested),
  )[0];
}

export function aspectRatioValue(aspectRatio: AspectRatio | string): number {
  const [w, h] = String(aspectRatio)
    .split(":")
    .map((part) => Number(part));
  return Number.isFinite(w) && Number.isFinite(h) && h > 0 ? w / h : 1;
}

function normalizeBackground(
  value: unknown,
): PresetSkeletonSpec["background"] | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.type === "asset" && typeof record.assetId === "string") {
    const assetId = record.assetId.trim();
    return assetId ? { type: "asset", assetId } : null;
  }
  return null;
}

function normalizeForegroundLayer(
  value: unknown,
): PresetSkeletonForegroundLayer | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  let source: PresetSkeletonForegroundLayer["source"] | null = null;
  if (raw.source === "canonicalLogo") {
    source = "canonicalLogo";
  } else if (
    raw.source &&
    typeof raw.source === "object" &&
    typeof (raw.source as Record<string, unknown>).assetId === "string"
  ) {
    source = { assetId: (raw.source as { assetId: string }).assetId };
  }
  if (!source) return null;
  return {
    source,
    x: clampNumber(raw.x, 0, 1, 0.78),
    y: clampNumber(raw.y, 0, 1, 0.06),
    w: clampNumber(raw.w, 0.02, 1, 0.16),
  };
}

function normalizeRegion(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  return {
    x: clampNumber(raw.x, 0, 1, 0),
    y: clampNumber(raw.y, 0, 1, 0),
    w: clampNumber(raw.w, 0.02, 1, 1),
    h: clampNumber(raw.h, 0.02, 1, 1),
  };
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, numberValue));
}
