import type {
  EffectDefinition,
  NativeSourceSizing,
} from "@shared/native-effects";
import {
  defaultNativeIntrinsicSourceSizing as sourceSizingForImage,
  isNativeSourceSizing,
} from "@shared/native-source-sizing";

import { findNativeDraftFrame } from "./native-shader-draft-client";

export class NativeIntrinsicSourceClientError extends Error {
  constructor(
    readonly code:
      | "frame-unavailable"
      | "target-unavailable"
      | "target-ambiguous"
      | "image-unavailable",
  ) {
    super(code);
    this.name = "NativeIntrinsicSourceClientError";
  }
}

function authoredDocument(frame: HTMLIFrameElement): Document {
  try {
    const source = frame.contentDocument;
    if (!source || frame.contentWindow?.document !== source || !source.body)
      throw new NativeIntrinsicSourceClientError("frame-unavailable");
    return source;
  } catch {
    throw new NativeIntrinsicSourceClientError("frame-unavailable");
  }
}

export function defaultNativeIntrinsicSourceSizing(options: {
  fileId: string;
  boardFile: boolean;
  nodeIds: readonly string[];
  presetSizing?: NativeSourceSizing;
  defaultSampling?: NativeSourceSizing["sampling"];
}): Record<string, NativeSourceSizing> {
  let frame: HTMLIFrameElement;
  try {
    frame = findNativeDraftFrame(options.fileId, options.boardFile);
  } catch {
    throw new NativeIntrinsicSourceClientError("frame-unavailable");
  }
  const source = authoredDocument(frame);
  const targets = new Map<string, Element[]>();
  const expected = new Set(options.nodeIds);
  if (
    !expected.size ||
    expected.size > 32 ||
    expected.size !== options.nodeIds.length
  )
    throw new NativeIntrinsicSourceClientError("target-ambiguous");
  for (const node of source.body.querySelectorAll(
    "[data-agent-native-node-id]",
  )) {
    const id = node.getAttribute("data-agent-native-node-id");
    if (!id || !expected.has(id)) continue;
    const matches = targets.get(id) ?? [];
    matches.push(node);
    targets.set(id, matches);
  }
  const sizing: Record<string, NativeSourceSizing> = {};
  for (const nodeId of options.nodeIds) {
    const matches = targets.get(nodeId);
    if (!matches?.length)
      throw new NativeIntrinsicSourceClientError("target-unavailable");
    if (matches.length !== 1)
      throw new NativeIntrinsicSourceClientError("target-ambiguous");
    const image = matches[0];
    if (image.localName !== "img")
      throw new NativeIntrinsicSourceClientError("image-unavailable");
    const authoredImage = image as HTMLImageElement;
    const url = authoredImage.currentSrc || authoredImage.src;
    let local = false;
    try {
      local = new URL(url, source.baseURI).origin === window.location.origin;
    } catch {
      local = false;
    }
    if (
      !authoredImage.complete ||
      !Number.isSafeInteger(authoredImage.naturalWidth) ||
      !Number.isSafeInteger(authoredImage.naturalHeight) ||
      authoredImage.naturalWidth <= 0 ||
      authoredImage.naturalHeight <= 0 ||
      !url ||
      !local
    )
      throw new NativeIntrinsicSourceClientError("image-unavailable");
    const measured = sourceSizingForImage(
      authoredImage.naturalWidth,
      authoredImage.naturalHeight,
      options.presetSizing ? undefined : options.defaultSampling,
    );
    if (!measured.ok)
      throw new NativeIntrinsicSourceClientError("image-unavailable");
    sizing[nodeId] = {
      ...measured.value,
      ...options.presetSizing,
      inputSpace: "intrinsic-image",
      aspectRatio: measured.value.aspectRatio,
    };
    if (!isNativeSourceSizing(sizing[nodeId]))
      throw new NativeIntrinsicSourceClientError("image-unavailable");
  }
  return sizing;
}

export function nativeApplySourceSizing(options: {
  definition: EffectDefinition;
  presetSizing?: NativeSourceSizing;
  fileId: string;
  boardFile: boolean;
  nodeIds: readonly string[];
}):
  | { sourceSizing?: NativeSourceSizing; sourceSizingByNodeId?: never }
  | {
      sourceSizing?: never;
      sourceSizingByNodeId: Record<string, NativeSourceSizing>;
    } {
  if (!options.definition.sourceSizing?.intrinsicEncoding)
    return options.presetSizing ? { sourceSizing: options.presetSizing } : {};
  const byNode = defaultNativeIntrinsicSourceSizing({
    ...options,
    defaultSampling: options.presetSizing
      ? undefined
      : options.definition.sourceSizing.defaultSampling,
  });
  return options.nodeIds.length === 1
    ? { sourceSizing: byNode[options.nodeIds[0]] }
    : { sourceSizingByNodeId: byNode };
}
