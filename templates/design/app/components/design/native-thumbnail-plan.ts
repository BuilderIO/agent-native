import { NATIVE_EFFECT_DEFINITION_CATALOG } from "@shared/native-effect-presets";
import { hashEffectDefinition } from "@shared/native-effect-trust";
import {
  validateEffectDocument,
  type EffectDefinition,
  type EffectInstance,
  type NativeSourceSizing,
} from "@shared/native-effects";
import type {
  NativeExpectedLinearSamples,
  NativeLinearGoldenSummary,
} from "@shared/native-shader-validation";
import { defaultNativeIntrinsicSourceSizing } from "@shared/native-source-sizing";

export const NATIVE_THUMBNAIL_WIDTH = 160;
export const NATIVE_THUMBNAIL_HEIGHT = 100;
export const MAX_NATIVE_THUMBNAIL_BATCH = 4;

export interface NativeThumbnailItem {
  id: string;
  definition: EffectDefinition;
  placement?: EffectInstance["placement"];
  params: EffectInstance["params"];
  seed: number;
  sourceRevision: string;
  sourceSizing?: NativeSourceSizing;
}

export interface NativeValidationFixture {
  sourceKind: "generated" | "owned-image" | "editable-text";
  aspect: "landscape" | "portrait" | "square";
  alpha: "opaque" | "transparent" | "zero";
  rounded: boolean;
}

export interface NativeValidationItem extends NativeThumbnailItem {
  placement: EffectInstance["placement"];
  fixture: NativeValidationFixture;
  timeSeconds?: number;
  expectedLinearSamples?: NativeExpectedLinearSamples;
}

export type NativeValidationResult =
  | {
      id: string;
      status: "ready";
      backend: "webgpu";
      executionHash: string;
      width: number;
      height: number;
      colorSpace: "srgb";
      alpha: "straight";
      rgba: Uint8Array;
      frames: number;
      sourceCaptures: number;
      estimatedResourceBytes: number;
      renderWallMs?: number;
      linearGolden?: NativeLinearGoldenSummary;
    }
  | {
      id: string;
      status: "approval-required" | "error" | "unavailable" | "last-good";
      backend: "webgpu" | "unavailable";
      executionHash: string;
      code: string;
      message: string;
      frames?: number;
      sourceCaptures?: number;
      estimatedResourceBytes?: number;
      renderWallMs?: number;
    };

export type NativeThumbnailResult =
  | {
      id: string;
      status: "ready";
      objectUrl: string;
      executionHash: string;
    }
  | {
      id: string;
      status: "approval-required" | "error";
      code: string;
      message: string;
    };

export interface PreparedNativeThumbnail {
  item: NativeThumbnailItem;
  executionHash: string;
  cacheKey: string;
  instance: EffectInstance;
}

export class NativeThumbnailError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NativeThumbnailError";
  }
}

const HASH = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export function nativeValidationFixtureBox(fixture: NativeValidationFixture): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  if (!fixture || typeof fixture !== "object")
    throw new NativeThumbnailError(
      "validation-fixture-invalid",
      "The clean GPU fixture is invalid.",
    );
  const dimensions =
    fixture.aspect === "landscape"
      ? { width: 144, height: 90 }
      : fixture.aspect === "portrait"
        ? { width: 80, height: 90 }
        : fixture.aspect === "square"
          ? { width: 90, height: 90 }
          : null;
  if (
    !dimensions ||
    !["generated", "owned-image", "editable-text"].includes(
      fixture.sourceKind,
    ) ||
    !["opaque", "transparent", "zero"].includes(fixture.alpha) ||
    typeof fixture.rounded !== "boolean"
  )
    throw new NativeThumbnailError(
      "validation-fixture-invalid",
      "The clean GPU fixture is invalid.",
    );
  return {
    left: Math.floor((NATIVE_THUMBNAIL_WIDTH - dimensions.width) / 2),
    top: Math.floor((NATIVE_THUMBNAIL_HEIGHT - dimensions.height) / 2),
    ...dimensions,
  };
}

export function nativeValidationFrameIndex(timeSeconds = 0): number {
  const frameIndex = Math.round(timeSeconds * 60);
  if (
    !Number.isFinite(timeSeconds) ||
    timeSeconds < 0 ||
    frameIndex > 120 ||
    Math.abs(timeSeconds - frameIndex / 60) > 1e-6
  )
    throw new NativeThumbnailError(
      "validation-time-unsupported",
      "Clean GPU validation accepts frame-aligned time from 0 to 2 seconds.",
    );
  return frameIndex;
}

let builtinHashes: Promise<Set<string>> | null = null;

async function approvedBuiltinHashes(): Promise<Set<string>> {
  builtinHashes ??= Promise.all(
    NATIVE_EFFECT_DEFINITION_CATALOG.map(hashEffectDefinition),
  ).then((hashes) => new Set(hashes));
  return builtinHashes;
}

export async function prepareNativeThumbnailBatch(input: {
  items: readonly NativeThumbnailItem[];
  approvedExecutionHashes: readonly string[];
}): Promise<{
  prepared: PreparedNativeThumbnail[];
  results: NativeThumbnailResult[];
}> {
  if (
    input.items.length < 1 ||
    input.items.length > MAX_NATIVE_THUMBNAIL_BATCH ||
    input.approvedExecutionHashes.length > 128 ||
    input.approvedExecutionHashes.some((hash) => !HASH.test(hash))
  )
    throw new NativeThumbnailError(
      "thumbnail-request-invalid",
      "Thumbnail batch or approval hashes are invalid.",
    );
  const trusted = await approvedBuiltinHashes();
  const approved = new Set(input.approvedExecutionHashes);
  const prepared: PreparedNativeThumbnail[] = [];
  const results: NativeThumbnailResult[] = [];
  const seenIds = new Set<string>();
  const seenDefinitions = new Map<string, string>();
  for (const [index, item] of input.items.entries()) {
    if (
      !SAFE_ID.test(item.id) ||
      seenIds.has(item.id) ||
      !Number.isSafeInteger(item.seed) ||
      item.seed < 0 ||
      item.seed > 0xffffffff ||
      typeof item.sourceRevision !== "string" ||
      item.sourceRevision.length > 128
    )
      throw new NativeThumbnailError(
        "thumbnail-request-invalid",
        "Thumbnail identity, seed, or source revision is invalid.",
      );
    seenIds.add(item.id);
    const executionHash = await hashEffectDefinition(item.definition);
    if (!trusted.has(executionHash) && !approved.has(executionHash)) {
      results.push({
        id: item.id,
        status: "approval-required",
        code: "definition-untrusted",
        message: "definition-untrusted",
      });
      continue;
    }
    const placement =
      item.placement ??
      (item.definition.kind !== "processor" &&
      item.definition.placements.includes("fill")
        ? "fill"
        : item.definition.placements.includes("layer")
          ? "layer"
          : item.definition.placements.includes("backdrop")
            ? "backdrop"
            : null);
    if (!placement || !item.definition.placements.includes(placement)) {
      results.push({
        id: item.id,
        status: "error",
        code: "thumbnail-placement-unsupported",
        message: "thumbnail-placement-unsupported",
      });
      continue;
    }
    if (
      item.definition.sourceSizing?.intrinsicEncoding &&
      placement !== "layer"
    ) {
      results.push({
        id: item.id,
        status: "error",
        code: "thumbnail-intrinsic-placement-unsupported",
        message: "thumbnail-intrinsic-placement-unsupported",
      });
      continue;
    }
    const instance: EffectInstance = {
      id: `native-thumb-${index}`,
      nodeId: `native-thumb-target-${index}`,
      definitionId: item.definition.id,
      definitionVersion: item.definition.version,
      placement,
      params: item.params,
      enabled: true,
      opacity: 1,
      seed: item.seed,
      clip: "bounds",
      blend: "normal",
      timing: { speed: 1, paused: true, time: 0 },
      ...(item.sourceSizing ? { sourceSizing: item.sourceSizing } : {}),
    };
    if (item.definition.sourceSizing?.intrinsicEncoding) {
      const sourceSizing = defaultNativeIntrinsicSourceSizing(
        NATIVE_THUMBNAIL_WIDTH,
        NATIVE_THUMBNAIL_HEIGHT,
      );
      if (!sourceSizing.ok)
        throw new NativeThumbnailError(
          sourceSizing.code,
          "The neutral image has invalid intrinsic dimensions.",
        );
      instance.sourceSizing = {
        ...(item.sourceSizing ?? sourceSizing.value),
        inputSpace: "intrinsic-image",
        aspectRatio: sourceSizing.value.aspectRatio,
      };
    }
    const validation = validateEffectDocument({
      schemaVersion: 2,
      definitions: [item.definition],
      instances: [instance],
    });
    if (!validation.valid) {
      results.push({
        id: item.id,
        status: "error",
        code: "thumbnail-definition-invalid",
        message: validation.errors.slice(0, 3).join("; "),
      });
      continue;
    }
    const definitionKey = `${item.definition.id}:${item.definition.version}`;
    const priorHash = seenDefinitions.get(definitionKey);
    if (priorHash && priorHash !== executionHash)
      throw new NativeThumbnailError(
        "thumbnail-definition-conflict",
        "One thumbnail batch contains conflicting definition versions.",
      );
    seenDefinitions.set(definitionKey, executionHash);
    const cacheKey = JSON.stringify([
      executionHash,
      Object.entries(item.params).sort(([a], [b]) => a.localeCompare(b)),
      item.seed,
      item.sourceRevision,
      instance.sourceSizing,
    ]);
    prepared.push({ item, executionHash, cacheKey, instance });
  }
  return { prepared, results };
}

export function cropNativeThumbnailRgba(
  pixels: { width: number; height: number; rgba: Uint8Array },
  slot: number,
): Uint8ClampedArray {
  if (
    !Number.isSafeInteger(slot) ||
    slot < 0 ||
    slot >= MAX_NATIVE_THUMBNAIL_BATCH ||
    pixels.width !== NATIVE_THUMBNAIL_WIDTH * 2 ||
    pixels.height !== NATIVE_THUMBNAIL_HEIGHT * 2 ||
    pixels.rgba.length !== pixels.width * pixels.height * 4
  )
    throw new NativeThumbnailError(
      "thumbnail-pixels-invalid",
      "The rendered thumbnail sheet has invalid dimensions or bytes.",
    );
  const output = new Uint8ClampedArray(
    NATIVE_THUMBNAIL_WIDTH * NATIVE_THUMBNAIL_HEIGHT * 4,
  );
  const x = (slot % 2) * NATIVE_THUMBNAIL_WIDTH;
  const y = Math.floor(slot / 2) * NATIVE_THUMBNAIL_HEIGHT;
  for (let row = 0; row < NATIVE_THUMBNAIL_HEIGHT; row += 1) {
    const from = ((y + row) * pixels.width + x) * 4;
    output.set(
      pixels.rgba.subarray(from, from + NATIVE_THUMBNAIL_WIDTH * 4),
      row * NATIVE_THUMBNAIL_WIDTH * 4,
    );
  }
  return output;
}
