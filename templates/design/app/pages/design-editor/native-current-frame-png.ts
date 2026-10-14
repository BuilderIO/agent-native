import { callAction } from "@agent-native/core/client/hooks";
import { hashEffectDefinition } from "@shared/native-effect-trust";
import { parseEffectsFromHtml } from "@shared/native-effects";

import { encodeStraightRgbaPng } from "./native-png-encoding";

type PreparedNativeScene = {
  designId: string;
  fileId: string;
  html: string;
  versionHash: string;
  viewport: { width: number; height: number };
  initialPixelRatio: number;
  sourceVersions: { fileId: string; versionHash: string }[];
  approvedDefinitionHashes: string[];
  instanceTargets: { instanceId: string; nodeId: string }[];
};

type NativeFrameWindow = Window & {
  __agentNativeSourceProvenance?: { versionHash?: string };
  __anNativeShaders?: {
    captureCommittedCompositionPixels(options: {
      viewport: { width: number; height: number };
      pixelRatio: number;
      expectedDefinitions: {
        id: string;
        version: number;
        executionHash: string;
      }[];
      expectedInstances: {
        id: string;
        nodeId: string;
        definitionId: string;
        definitionVersion: number;
        placement: "fill" | "layer" | "backdrop";
      }[];
      signal: AbortSignal;
      timeoutMs: number;
    }): Promise<{
      width: number;
      height: number;
      rgba: Uint8Array;
      alpha: "straight";
      colorSpace: "srgb";
    }>;
  };
};

export class NativeCurrentFramePngError extends Error {
  constructor(
    readonly code:
      | "source-stale"
      | "scene-unavailable"
      | "scene-unreadable"
      | "frame-unavailable",
  ) {
    super(code);
    this.name = "NativeCurrentFramePngError";
  }
}

export async function captureNativeCurrentFramePng(args: {
  designId: string;
  fileId: string;
  iframe: HTMLIFrameElement;
  pixelRatio: number;
  signal?: AbortSignal;
}): Promise<Blob> {
  const { iframe } = args;
  const view = iframe.contentWindow as NativeFrameWindow | null;
  if (!iframe.isConnected || !view)
    throw new NativeCurrentFramePngError("scene-unavailable");
  const versionHash = view.__agentNativeSourceProvenance?.versionHash;
  if (!versionHash) throw new NativeCurrentFramePngError("source-stale");
  const viewport = {
    width: iframe.clientWidth,
    height: iframe.clientHeight,
  };
  if (viewport.width < 1 || viewport.height < 1)
    throw new NativeCurrentFramePngError("scene-unavailable");
  const prepared = await callAction<PreparedNativeScene>(
    "prepare-native-scene-export",
    {
      designId: args.designId,
      fileId: args.fileId,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      pixelRatio: args.pixelRatio,
    },
    { method: "GET", signal: args.signal },
  );
  if (
    prepared.designId !== args.designId ||
    prepared.fileId !== args.fileId ||
    prepared.viewport.width !== viewport.width ||
    prepared.viewport.height !== viewport.height ||
    prepared.initialPixelRatio !== args.pixelRatio ||
    prepared.sourceVersions.length !== 1 ||
    prepared.sourceVersions[0]?.fileId !== args.fileId ||
    prepared.sourceVersions[0]?.versionHash !== prepared.versionHash ||
    prepared.versionHash !== versionHash ||
    !iframe.isConnected ||
    iframe.contentWindow !== view
  )
    throw new NativeCurrentFramePngError("source-stale");
  const parsed = parseEffectsFromHtml(prepared.html);
  if (parsed.errors.length || !parsed.document)
    throw new NativeCurrentFramePngError("scene-unreadable");
  const enabled = parsed.document.instances.filter(
    (instance) => instance.enabled,
  );
  const expectedDefinitions = await Promise.all(
    parsed.document.definitions.map(async (definition) => ({
      id: definition.id,
      version: definition.version,
      executionHash: await hashEffectDefinition(definition),
    })),
  );
  const approved = new Set(prepared.approvedDefinitionHashes);
  if (
    enabled.length !== prepared.instanceTargets.length ||
    enabled.some(
      (instance) =>
        !prepared.instanceTargets.some(
          (target) =>
            target.instanceId === instance.id &&
            target.nodeId === instance.nodeId,
        ) ||
        !expectedDefinitions.some(
          (definition) =>
            definition.id === instance.definitionId &&
            definition.version === instance.definitionVersion &&
            approved.has(definition.executionHash),
        ),
    )
  )
    throw new NativeCurrentFramePngError("scene-unreadable");
  const runtime = view.__anNativeShaders;
  if (!runtime?.captureCommittedCompositionPixels)
    throw new NativeCurrentFramePngError("frame-unavailable");
  const signal = args.signal ?? new AbortController().signal;
  const pixels = await runtime.captureCommittedCompositionPixels({
    viewport,
    pixelRatio: args.pixelRatio,
    expectedDefinitions,
    expectedInstances: enabled.map((instance) => ({
      id: instance.id,
      nodeId: instance.nodeId,
      definitionId: instance.definitionId,
      definitionVersion: instance.definitionVersion,
      placement: instance.placement,
    })),
    signal,
    timeoutMs: 15_000,
  });
  if (
    !iframe.isConnected ||
    iframe.contentWindow !== view ||
    view.__agentNativeSourceProvenance?.versionHash !== versionHash ||
    pixels.alpha !== "straight" ||
    pixels.colorSpace !== "srgb"
  )
    throw new NativeCurrentFramePngError("source-stale");
  const blob = await encodeStraightRgbaPng(pixels, signal);
  if (
    !iframe.isConnected ||
    iframe.contentWindow !== view ||
    view.__agentNativeSourceProvenance?.versionHash !== versionHash
  )
    throw new NativeCurrentFramePngError("source-stale");
  return blob;
}
