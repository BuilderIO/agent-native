import { checkEffectAssetUrl } from "./native-effects";

export const NATIVE_EMBEDDED_ASSETS_SCRIPT_TYPE =
  "application/x-agent-native-effect-assets";
export const NATIVE_EMBEDDED_ASSETS_ATTR = "data-agent-native-export-assets";
export const NATIVE_EXPORT_INTRINSIC_SOURCE_ATTR =
  "data-agent-native-export-intrinsic-source";
export const MAX_NATIVE_EMBEDDED_ASSETS = 16;
export const MAX_NATIVE_EMBEDDED_ASSET_BYTES = 1_000_000;
export const MAX_NATIVE_EMBEDDED_ASSET_TOTAL_BYTES = 4_000_000;
export const MAX_NATIVE_EMBEDDED_ASSET_SCRIPT_CHARS = 5_600_000;

export type NativeEmbeddedRasterMime =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/avif";

export interface NativeEmbeddedAssetEntry {
  path: string;
  mimeType: NativeEmbeddedRasterMime;
  byteLength: number;
  sha256: string;
  base64: string;
}

export interface NativeEmbeddedAssetRegistry {
  schemaVersion: 1;
  assets: NativeEmbeddedAssetEntry[];
}

export class NativeEmbeddedAssetRegistryError extends Error {
  constructor(
    readonly code:
      | "registry-malformed"
      | "registry-limit"
      | "registry-duplicate"
      | "registry-path"
      | "registry-mime",
    message: string,
  ) {
    super(message);
    this.name = "NativeEmbeddedAssetRegistryError";
  }
}

const RASTER_MIMES = new Set<NativeEmbeddedRasterMime>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
]);
const BASE64_RE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const HASH_RE = /^[a-f0-9]{64}$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactFields(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    actual.every((name) => expected.includes(name))
  );
}

export function parseNativeEmbeddedAssetRegistry(
  value: unknown,
): NativeEmbeddedAssetRegistry {
  if (
    !record(value) ||
    !exactFields(value, ["schemaVersion", "assets"]) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.assets)
  )
    throw new NativeEmbeddedAssetRegistryError(
      "registry-malformed",
      "Native embedded asset registry has an invalid envelope.",
    );
  if (value.assets.length > MAX_NATIVE_EMBEDDED_ASSETS)
    throw new NativeEmbeddedAssetRegistryError(
      "registry-limit",
      "Native embedded asset registry has too many entries.",
    );
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const candidate of value.assets) {
    if (
      !record(candidate) ||
      !exactFields(candidate, [
        "path",
        "mimeType",
        "byteLength",
        "sha256",
        "base64",
      ])
    )
      throw new NativeEmbeddedAssetRegistryError(
        "registry-malformed",
        "Native embedded asset entry has invalid fields.",
      );
    const path = candidate.path;
    const checked = checkEffectAssetUrl(path);
    if (!checked.ok || typeof path !== "string" || path.includes("#"))
      throw new NativeEmbeddedAssetRegistryError(
        "registry-path",
        "Native embedded asset path is not a same-origin root URL.",
      );
    if (seen.has(path))
      throw new NativeEmbeddedAssetRegistryError(
        "registry-duplicate",
        "Native embedded asset registry repeats a path.",
      );
    seen.add(path);
    if (!RASTER_MIMES.has(candidate.mimeType as NativeEmbeddedRasterMime))
      throw new NativeEmbeddedAssetRegistryError(
        "registry-mime",
        "Native embedded input must be a supported raster image.",
      );
    const length = candidate.byteLength;
    if (
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length <= 0 ||
      length > MAX_NATIVE_EMBEDDED_ASSET_BYTES
    )
      throw new NativeEmbeddedAssetRegistryError(
        "registry-limit",
        "Native embedded input exceeds the per-asset limit.",
      );
    totalBytes += length;
    if (totalBytes > MAX_NATIVE_EMBEDDED_ASSET_TOTAL_BYTES)
      throw new NativeEmbeddedAssetRegistryError(
        "registry-limit",
        "Native embedded inputs exceed the bundle limit.",
      );
    const encoded = candidate.base64;
    if (
      typeof encoded !== "string" ||
      encoded.length !== Math.ceil(length / 3) * 4 ||
      !BASE64_RE.test(encoded) ||
      (length % 3 === 0 && encoded.endsWith("=")) ||
      (length % 3 === 1 && !encoded.endsWith("==")) ||
      (length % 3 === 2 && (encoded.endsWith("==") || !encoded.endsWith("=")))
    )
      throw new NativeEmbeddedAssetRegistryError(
        "registry-malformed",
        "Native embedded input has invalid base64 encoding.",
      );
    if (typeof candidate.sha256 !== "string" || !HASH_RE.test(candidate.sha256))
      throw new NativeEmbeddedAssetRegistryError(
        "registry-malformed",
        "Native embedded input has an invalid digest.",
      );
  }
  return value as unknown as NativeEmbeddedAssetRegistry;
}

export function parseNativeEmbeddedAssetRegistryText(
  text: string,
): NativeEmbeddedAssetRegistry {
  if (text.length > MAX_NATIVE_EMBEDDED_ASSET_SCRIPT_CHARS)
    throw new NativeEmbeddedAssetRegistryError(
      "registry-limit",
      "Native embedded asset registry script is too large.",
    );
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new NativeEmbeddedAssetRegistryError(
      "registry-malformed",
      "Native embedded asset registry JSON is unreadable.",
    );
  }
  return parseNativeEmbeddedAssetRegistry(value);
}
