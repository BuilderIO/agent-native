import { NATIVE_EFFECT_BUILTIN_VERSIONS } from "@shared/native-effect-presets";
import {
  hashEffectDefinition,
  nativeEffectExecutionPayload,
} from "@shared/native-effect-trust";
import {
  writeEffectsToHtml,
  validateEffectDocument,
  type EffectDefinition,
  type EffectInstance,
} from "@shared/native-effects";
import { planNativeInputResources } from "@shared/native-input-resources";

import { encodeStraightRgbaPng } from "@/pages/design-editor/native-png-encoding";

export const NATIVE_CATALOG_PREVIEW_WIDTH = 160;
export const NATIVE_CATALOG_PREVIEW_HEIGHT = 100;
const COLUMNS = 4;
const MAX_ITEMS = 16;
const TIMEOUT_MS = 15_000;

type Pixels = {
  width: number;
  height: number;
  rgba: Uint8Array;
  alpha: "straight";
  colorSpace: "srgb";
};
type PreviewRuntime = {
  scan(): Promise<void>;
  pause(): void;
  renderCompositionFramePixels(options: {
    frameIndex: 0;
    fps: 60;
    sourceContract: "declarative-only";
    viewport: { width: number; height: number };
    pixelRatio: 1;
    signal: AbortSignal;
    timeoutMs: number;
  }): Promise<Pixels>;
  dispose(): Promise<void>;
};
type PreviewWindow = Window & { __anNativeShaders?: PreviewRuntime };

export function nativeCatalogPreviewKey(definition: EffectDefinition): string {
  return JSON.stringify(nativeEffectExecutionPayload(definition));
}

export function partitionNativeCatalogPreviewBatch<T>(
  definitions: readonly T[],
): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < definitions.length; index += MAX_ITEMS)
    batches.push(definitions.slice(index, index + MAX_ITEMS));
  return batches;
}

// guard:allow-raw-color — thumbnail source paint is a fixed fixture, independent of editor theme tokens.
const SOURCE_FIXTURE =
  '<div style="position:absolute;inset:0;background:lightgray">' +
  '<div style="position:absolute;left:10px;top:11px;width:81px;height:78px;border-radius:12px;background:steelblue"></div>' +
  '<div style="position:absolute;left:91px;top:9px;width:58px;height:58px;border-radius:29px;background:coral"></div>' +
  '<div style="position:absolute;left:0;top:66px;width:160px;height:8px;background:white;transform:rotate(-20deg)"></div>' +
  "</div>";

export function createNativeCatalogPreviewScene(
  definitions: readonly EffectDefinition[],
  placement: EffectInstance["placement"],
): { html: string; width: number; height: number } {
  if (!definitions.length || definitions.length > MAX_ITEMS)
    throw new Error("native-catalog-preview-batch-invalid");
  const canonical = definitions.map((definition) => {
    const trusted = NATIVE_EFFECT_BUILTIN_VERSIONS.find(
      (candidate) =>
        candidate.id === definition.id &&
        candidate.version === definition.version,
    );
    if (!trusted) {
      if (
        NATIVE_EFFECT_BUILTIN_VERSIONS.some(
          (builtin) => builtin.id === definition.id,
        ) ||
        !definition.placements.includes(placement) ||
        !validateEffectDocument({
          schemaVersion: 2,
          definitions: [definition],
          instances: [],
        }).valid
      )
        throw new Error("native-catalog-preview-definition-unsupported");
      return definition;
    }
    if (
      !trusted.placements.includes(placement) ||
      JSON.stringify(nativeEffectExecutionPayload(trusted)) !==
        JSON.stringify(nativeEffectExecutionPayload(definition))
    )
      throw new Error("native-catalog-preview-definition-unsupported");
    return trusted;
  });
  if (
    new Set(
      canonical.map((definition) => `${definition.id}@${definition.version}`),
    ).size !== canonical.length
  )
    throw new Error("native-catalog-preview-definition-duplicate");
  const width =
    Math.min(COLUMNS, canonical.length) * NATIVE_CATALOG_PREVIEW_WIDTH;
  const height =
    Math.ceil(canonical.length / COLUMNS) * NATIVE_CATALOG_PREVIEW_HEIGHT;
  const instances: EffectInstance[] = canonical.map((definition, index) => ({
    id: `catalog-effect-${index}`,
    nodeId: `catalog-target-${index}`,
    definitionId: definition.id,
    definitionVersion: definition.version,
    placement,
    params: {},
    enabled: true,
    opacity: 1,
    seed: 0,
    clip: "bounds",
    blend: "normal",
    timing: { speed: 1, paused: true, time: 0 },
  }));
  const cards = canonical.map((definition, index) => {
    const inputs = planNativeInputResources(definition, instances[index]!);
    if (!inputs.ok)
      throw new Error(
        `native-catalog-preview-inputs-unavailable:${inputs.code}`,
      );
    const receiverGeometry = [...inputs.inputs.values()].some(
      (input) =>
        input.kind === "builtin" && input.source === "receiver-geometry",
    );
    const shape = receiverGeometry
      ? "inset:12px;border-radius:20px"
      : "inset:0";
    const target = `<div data-agent-native-node-id="catalog-target-${index}" style="position:absolute;${shape}">${placement === "layer" ? SOURCE_FIXTURE : ""}</div>`;
    return `<div style="position:absolute;left:${(index % COLUMNS) * NATIVE_CATALOG_PREVIEW_WIDTH}px;top:${Math.floor(index / COLUMNS) * NATIVE_CATALOG_PREVIEW_HEIGHT}px;width:${NATIVE_CATALOG_PREVIEW_WIDTH}px;height:${NATIVE_CATALOG_PREVIEW_HEIGHT}px;overflow:hidden">${placement === "backdrop" ? SOURCE_FIXTURE : ""}${target}</div>`;
  });
  // guard:allow-raw-color — a neutral CSS canvas background makes source-processing thumbnail captures opaque.
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:white}*{box-sizing:border-box}</style></head><body>${cards.join("")}</body></html>`;
  return {
    html: writeEffectsToHtml(html, {
      schemaVersion: 2,
      definitions: canonical,
      instances,
    }),
    width,
    height,
  };
}

export function cropNativeCatalogPreview(
  pixels: Pixels,
  index: number,
): { width: number; height: number; rgba: Uint8Array } {
  const left = (index % COLUMNS) * NATIVE_CATALOG_PREVIEW_WIDTH;
  const top = Math.floor(index / COLUMNS) * NATIVE_CATALOG_PREVIEW_HEIGHT;
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= MAX_ITEMS ||
    pixels.alpha !== "straight" ||
    pixels.colorSpace !== "srgb" ||
    pixels.rgba.byteLength !== pixels.width * pixels.height * 4 ||
    left + NATIVE_CATALOG_PREVIEW_WIDTH > pixels.width ||
    top + NATIVE_CATALOG_PREVIEW_HEIGHT > pixels.height
  )
    throw new Error("native-catalog-preview-pixels-invalid");
  const rgba = new Uint8Array(
    NATIVE_CATALOG_PREVIEW_WIDTH * NATIVE_CATALOG_PREVIEW_HEIGHT * 4,
  );
  for (let row = 0; row < NATIVE_CATALOG_PREVIEW_HEIGHT; row += 1) {
    const start = ((top + row) * pixels.width + left) * 4;
    rgba.set(
      pixels.rgba.subarray(start, start + NATIVE_CATALOG_PREVIEW_WIDTH * 4),
      row * NATIVE_CATALOG_PREVIEW_WIDTH * 4,
    );
  }
  return {
    width: NATIVE_CATALOG_PREVIEW_WIDTH,
    height: NATIVE_CATALOG_PREVIEW_HEIGHT,
    rgba,
  };
}

function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      finish();
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error("native-catalog-preview-timeout"));
    }, TIMEOUT_MS);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        finish();
        resolve(value);
      },
      (error: unknown) => {
        finish();
        reject(error);
      },
    );
    if (signal.aborted) onAbort();
  });
}

async function capturePreviews(
  definitions: readonly EffectDefinition[],
  placement: EffectInstance["placement"],
  signal: AbortSignal,
  approvedHashes: readonly string[],
): Promise<ReadonlyMap<string, Blob>> {
  signal.throwIfAborted();
  for (const definition of definitions) {
    if (
      !NATIVE_EFFECT_BUILTIN_VERSIONS.some(
        (builtin) => builtin.id === definition.id,
      ) &&
      !approvedHashes.includes(await hashEffectDefinition(definition))
    )
      throw new Error("native-catalog-preview-definition-unapproved");
  }
  const scene = createNativeCatalogPreviewScene(definitions, placement);
  const { ensureNativeShaderRuntime } = await import("@shared/shader-fills");
  signal.throwIfAborted();
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("data-native-catalog-preview-renderer", "");
  frame.tabIndex = -1;
  frame.style.cssText = `position:fixed;left:0;top:0;width:${scene.width}px;height:${scene.height}px;opacity:0;pointer-events:none;z-index:-1;border:0;`;
  const loaded = new Promise<void>((resolve, reject) => {
    frame.addEventListener("load", () => resolve(), { once: true });
    frame.addEventListener(
      "error",
      () => reject(new Error("native-catalog-preview-frame-unavailable")),
      { once: true },
    );
  });
  frame.srcdoc = ensureNativeShaderRuntime(scene.html);
  document.body.append(frame);
  let runtime: PreviewRuntime | undefined;
  try {
    await bounded(loaded, signal);
    runtime = (frame.contentWindow as PreviewWindow | null)?.__anNativeShaders;
    if (!runtime) throw new Error("native-catalog-preview-runtime-unavailable");
    frame.contentWindow!.postMessage(
      {
        type: "native-shader-approvals",
        status: "ready",
        hashes: approvedHashes,
      },
      "*",
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await bounded(runtime.scan(), signal);
    runtime.pause();
    const pixels = await runtime.renderCompositionFramePixels({
      frameIndex: 0,
      fps: 60,
      sourceContract: "declarative-only",
      viewport: { width: scene.width, height: scene.height },
      pixelRatio: 1,
      signal,
      timeoutMs: TIMEOUT_MS,
    });
    if (pixels.width !== scene.width || pixels.height !== scene.height)
      throw new Error("native-catalog-preview-viewport-mismatch");
    const entries = await Promise.all(
      definitions.map(
        async (definition, index) =>
          [
            nativeCatalogPreviewKey(definition),
            await encodeStraightRgbaPng(
              cropNativeCatalogPreview(pixels, index),
              signal,
            ),
          ] as const,
      ),
    );
    signal.throwIfAborted();
    return new Map(entries);
  } finally {
    try {
      runtime ??= (frame.contentWindow as PreviewWindow | null)
        ?.__anNativeShaders;
      if (runtime)
        await bounded(runtime.dispose(), new AbortController().signal);
    } finally {
      frame.remove();
    }
  }
}

let renderQueue: Promise<void> = Promise.resolve();
export function renderNativeCatalogPreviews(
  definitions: readonly EffectDefinition[],
  placement: EffectInstance["placement"],
  signal: AbortSignal,
  approvedHashes: readonly string[] = [],
): Promise<ReadonlyMap<string, Blob>> {
  const rendered = renderQueue.then(async () => {
    const previews = new Map<string, Blob>();
    for (const batch of partitionNativeCatalogPreviewBatch(definitions)) {
      signal.throwIfAborted();
      for (const [key, blob] of await capturePreviews(
        batch,
        placement,
        signal,
        approvedHashes,
      ))
        previews.set(key, blob);
    }
    return previews;
  });
  // The caller receives the failed render; only the serialization tail settles so the next picker can render.
  renderQueue = rendered.then(
    () => undefined,
    () => undefined,
  );
  return rendered;
}
