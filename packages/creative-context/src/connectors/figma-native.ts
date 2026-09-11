import { createHash } from "node:crypto";

import {
  collectFallbackNodeIds,
  collectImageFillRefs,
  extractFigmaTopLevelFrames,
  mapFigmaNodeToHtml,
  type FidelityEntry,
  type FigmaBoundingBox,
  type FigmaNode,
} from "@agent-native/core/ingestion";

import { creativeContextMediaUrl } from "../media-url.js";
import {
  parseNativeCreativeArtifact,
  type NativeCreativeArtifact,
  type NativeCreativeArtifactFidelityReport,
} from "../native-artifact.js";
import type { ContextMediaInput, NormalizedContextItem } from "../types.js";
import { normalizeContextItem } from "./normalize.js";
import { rehostRemoteMedia } from "./private-artifacts.js";
import {
  asRecord,
  executeConnectorProviderRequest,
  stringValue,
} from "./provider-response.js";
import type { ContextConnectorExecutionContext } from "./types.js";

export const MAX_INLINE_NATIVE_CODE_BYTES = 128 * 1024;
const MAX_ARTBOARD_DIMENSION = 12_000;
const MAX_ARTBOARD_AREA = 24_000_000;
const MAX_DIRECT_CHILDREN = 200;
const MAX_HIERARCHY_DEPTH = 12;
const MAX_SEARCH_TEXT_CHARS = 40_000;
const MAX_MANIFEST_CHILDREN_PER_BUCKET = 64;

interface FigmaFileInfo {
  name: string;
  version?: string;
  lastModified?: string;
  editorType?: string;
  role?: string;
  document: Record<string, unknown>;
  components: Record<string, unknown>;
  warnings: string[];
}

interface CompileContext {
  fileKey: string;
  fileName: string;
  sourceUrl: string;
  sourceVersion?: string;
  sourceModifiedAt?: string;
  connectionId?: string;
  context: ContextConnectorExecutionContext;
  assets: FigmaAssetRegistry;
  artifacts: Map<string, CompiledArtifact>;
  warnings: string[];
}

interface CompiledArtifact {
  externalId: string;
  nodeId: string;
  nodeName: string;
  item: NormalizedContextItem;
  nativeArtifact: NativeCreativeArtifact;
}

interface ArtifactAssets {
  fallbackImageUrls: Record<string, string>;
  imageFillUrls: Record<string, string>;
  media: ContextMediaInput[];
  assetRefs: string[];
}

export async function fetchFigmaNativeContextItems(input: {
  fileKey: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceModifiedAt?: string;
  connectionId?: string;
  context: ContextConnectorExecutionContext;
}): Promise<{ items: NormalizedContextItem[]; warnings: string[] }> {
  const file = await fetchFigmaFileInfo(input);
  const compileContext: CompileContext = {
    fileKey: input.fileKey,
    fileName: file.name,
    sourceUrl: input.sourceUrl,
    sourceVersion: file.version,
    sourceModifiedAt: file.lastModified ?? input.sourceModifiedAt,
    connectionId: input.connectionId,
    context: input.context,
    assets: new FigmaAssetRegistry({
      fileKey: input.fileKey,
      sourceUrl: input.sourceUrl,
      sourceVersion: file.version ?? file.lastModified ?? "current",
      connectionId: input.connectionId,
      context: input.context,
    }),
    artifacts: new Map(),
    warnings: [...file.warnings],
  };
  const topLevel = extractFigmaTopLevelFrames(file.document);
  const inventory = new Map<
    string,
    { id: string; name: string; type: string; optional?: boolean }
  >();
  for (const node of topLevel) {
    const id = stringValue(node.id);
    if (!id) continue;
    inventory.set(id, {
      id,
      name: stringValue(node.name) ?? `Node ${id}`,
      type: stringValue(node.type) ?? "FRAME",
    });
  }
  for (const [id, value] of Object.entries(file.components)) {
    const component = asRecord(value);
    inventory.set(id, {
      id,
      name: stringValue(component?.name) ?? `Component ${id}`,
      type: "COMPONENT",
      optional: true,
    });
  }

  for (const entry of inventory.values()) {
    if (compileContext.artifacts.has(externalId(input.fileKey, entry.id))) {
      continue;
    }
    try {
      await compileNodeHierarchy(entry.id, compileContext, 0);
    } catch (error) {
      if (!entry.optional) throw error;
      compileContext.warnings.push(
        `Figma component ${entry.name} could not be hydrated: ${error instanceof Error ? error.message : String(error)}`,
      );
      inventory.delete(entry.id);
    }
  }

  const artifacts = [...compileContext.artifacts.values()];
  const fileText = [
    `${file.name} Figma inventory`,
    ...[...inventory.values()].map((entry) => `${entry.type}: ${entry.name}`),
  ].join("\n");
  const parent = normalizeContextItem({
    externalId: input.fileKey,
    kind: "figma-file",
    title: file.name,
    canonicalUrl: input.sourceUrl,
    mimeType: "application/vnd.figma.file",
    content: fileText,
    sourceModifiedAt: compileContext.sourceModifiedAt,
    sourceVersion: compileContext.sourceVersion,
    parseStatus: "parsed",
    provenance: { provider: "figma", fileKey: input.fileKey },
    metadata: {
      provider: "figma",
      version: file.version,
      editorType: file.editorType,
      role: file.role,
      inventoryDepth: 2,
      artifactCount: artifacts.length,
      childExternalIds: artifacts
        .filter((artifact) => inventory.has(artifact.nodeId))
        .map((artifact) => artifact.externalId),
    },
    chunks: [{ ordinal: 0, kind: "text", text: fileText }],
    edges: artifacts
      .filter((artifact) => inventory.has(artifact.nodeId))
      .map((artifact) => ({
        relation: "contains-native-artifact",
        toExternalId: artifact.externalId,
      })),
  });
  return {
    items: [parent, ...artifacts.map((artifact) => artifact.item)],
    warnings: compileContext.warnings,
  };
}

async function fetchFigmaFileInfo(input: {
  fileKey: string;
  sourceTitle: string;
  sourceModifiedAt?: string;
  connectionId?: string;
  context: ContextConnectorExecutionContext;
}): Promise<FigmaFileInfo> {
  const requestFile = async (depth: number) =>
    asRecord(
      await executeConnectorProviderRequest(input.context.providerApi, {
        provider: "figma",
        method: "GET",
        path: `/files/${encodeURIComponent(input.fileKey)}`,
        query: { depth },
        connectionId: input.connectionId,
        maxBytes: 4 * 1024 * 1024,
      }),
    );
  let value: Record<string, unknown> | null;
  const warnings: string[] = [];
  try {
    value = await requestFile(2);
  } catch (error) {
    if (!isProviderSizeFailure(error)) throw error;
    value = await requestFile(1);
    const document = asRecord(value?.document);
    const pages = Array.isArray(document?.children) ? document.children : [];
    const hydratedPages: Record<string, unknown>[] = [];
    for (const pageValue of pages) {
      const page = asRecord(pageValue);
      const pageId = stringValue(page?.id);
      if (!pageId) continue;
      const payload = asRecord(
        await executeConnectorProviderRequest(input.context.providerApi, {
          provider: "figma",
          method: "GET",
          path: `/files/${encodeURIComponent(input.fileKey)}/nodes`,
          query: { ids: pageId, depth: 1 },
          connectionId: input.connectionId,
          maxBytes: 4 * 1024 * 1024,
        }),
      );
      const hydrated = asRecord(
        asRecord(asRecord(payload?.nodes)?.[pageId])?.document,
      );
      if (hydrated) hydratedPages.push(hydrated);
    }
    value = {
      ...value,
      document: { ...document, children: hydratedPages },
      components: {},
    };
    warnings.push(
      "Figma file inventory exceeded the bounded depth-2 response, so pages were inventoried independently at depth 1.",
    );
  }
  if (!value || !asRecord(value.document)) {
    throw new Error(`Figma file ${input.fileKey} returned no document.`);
  }
  return {
    name: stringValue(value.name) ?? input.sourceTitle,
    version: stringValue(value.version),
    lastModified: stringValue(value.lastModified) ?? input.sourceModifiedAt,
    editorType: stringValue(value.editorType),
    role: stringValue(value.role),
    document: asRecord(value.document)!,
    components: asRecord(value.components) ?? {},
    warnings,
  };
}

async function compileNodeHierarchy(
  nodeId: string,
  input: CompileContext,
  depth: number,
): Promise<CompiledArtifact> {
  const id = externalId(input.fileKey, nodeId);
  const existing = input.artifacts.get(id);
  if (existing) return existing;

  const shallow = await fetchFigmaNode(nodeId, input, 2);
  if (depth < MAX_HIERARCHY_DEPTH && shouldSplitBeforeFullFetch(shallow)) {
    const split = await compileSplitNode(shallow, input, depth);
    if (split) return split;
  }

  let full: FigmaNode;
  try {
    full = await fetchFigmaNode(nodeId, input);
  } catch (error) {
    if (
      depth < MAX_HIERARCHY_DEPTH &&
      isProviderSizeFailure(error) &&
      canSplitAtChildren(shallow)
    ) {
      const split = await compileSplitNode(shallow, input, depth);
      if (split) return split;
    }
    if (isProviderSizeFailure(error)) {
      input.warnings.push(
        `Figma node ${shallow.name ?? nodeId} was indivisible and exceeded the provider response bound; a localized rendered fallback was stored.`,
      );
      return compileRenderedFallback(shallow, input);
    }
    throw error;
  }

  const estimated = compileWithPlaceholderAssets(full);
  if (
    Buffer.byteLength(estimated.html, "utf8") > MAX_INLINE_NATIVE_CODE_BYTES
  ) {
    if (depth < MAX_HIERARCHY_DEPTH && canSplitAtChildren(full)) {
      const split = await compileSplitNode(full, input, depth);
      if (split) return split;
    }
    input.warnings.push(
      `Figma node ${full.name ?? nodeId} produced more than 128 KiB of indivisible native code; a localized rendered fallback was stored.`,
    );
    return compileRenderedFallback(full, input);
  }
  return compileOrdinaryNode(full, input);
}

async function fetchFigmaNode(
  nodeId: string,
  input: CompileContext,
  depth?: number,
): Promise<FigmaNode> {
  const payload = asRecord(
    await executeConnectorProviderRequest(input.context.providerApi, {
      provider: "figma",
      method: "GET",
      path: `/files/${encodeURIComponent(input.fileKey)}/nodes`,
      query: { ids: nodeId, ...(depth ? { depth } : {}) },
      connectionId: input.connectionId,
      maxBytes: 4 * 1024 * 1024,
    }),
  );
  const entry = asRecord(asRecord(payload?.nodes)?.[nodeId]);
  const document = asRecord(entry?.document);
  if (!document) {
    throw new Error(`Figma node ${nodeId} returned no document.`);
  }
  return document as unknown as FigmaNode;
}

async function compileOrdinaryNode(
  node: FigmaNode,
  input: CompileContext,
): Promise<CompiledArtifact> {
  const artifactId = externalId(input.fileKey, node.id);
  const assets = await input.assets.forNode(node, artifactId);
  const mapped = mapFigmaNodeToHtml(node, {
    fallbackImageUrls: assets.fallbackImageUrls,
    imageFillUrls: assets.imageFillUrls,
  });
  const html = wrapFigmaDocument(mapped.html || "<div></div>", node);
  if (Buffer.byteLength(html, "utf8") > MAX_INLINE_NATIVE_CODE_BYTES) {
    return compileRenderedFallback(node, input);
  }
  const fidelityReport = nativeFidelityReportFromEntries(
    mapped.fidelity.entries,
  );
  const nativeArtifact = parseNativeCreativeArtifact({
    schemaVersion: 1,
    app: "design",
    format: "design-html",
    rootExternalId: artifactId,
    sourceBounds: normalizedBounds(node.absoluteBoundingBox),
    fidelityReport,
    ...(assets.assetRefs.length ? { assetRefs: assets.assetRefs } : {}),
  });
  const item = nativeItem({
    input,
    node,
    externalId: artifactId,
    html,
    nativeArtifact,
    media: assets.media,
    edges: figmaUsageEdges(node, input.fileKey),
  });
  const artifact = {
    externalId: artifactId,
    nodeId: node.id,
    nodeName: node.name ?? node.id,
    item,
    nativeArtifact,
  };
  input.artifacts.set(artifactId, artifact);
  return artifact;
}

async function compileRenderedFallback(
  node: FigmaNode,
  input: CompileContext,
): Promise<CompiledArtifact> {
  const artifactId = externalId(input.fileKey, node.id);
  const assets = await input.assets.forRenderedFallback(node, artifactId);
  const mapped = mapFigmaNodeToHtml(node, {
    fallbackImageUrls: assets.fallbackImageUrls,
    forceImageFallbackNodeIds: new Set([node.id]),
  });
  const html = wrapFigmaDocument(mapped.html || "<div></div>", node);
  const fidelityReport = nativeFidelityReportFromEntries(
    mapped.fidelity.entries,
  );
  const nativeArtifact = parseNativeCreativeArtifact({
    schemaVersion: 1,
    app: "design",
    format: "design-html",
    rootExternalId: artifactId,
    sourceBounds: normalizedBounds(node.absoluteBoundingBox),
    fidelityReport,
    assetRefs: assets.assetRefs,
  });
  const item = nativeItem({
    input,
    node,
    externalId: artifactId,
    html,
    nativeArtifact,
    media: assets.media,
    edges: figmaUsageEdges(node, input.fileKey),
  });
  const artifact = {
    externalId: artifactId,
    nodeId: node.id,
    nodeName: node.name ?? node.id,
    item,
    nativeArtifact,
  };
  input.artifacts.set(artifactId, artifact);
  return artifact;
}

async function compileSplitNode(
  node: FigmaNode,
  input: CompileContext,
  depth: number,
): Promise<CompiledArtifact | null> {
  if (!canSplitAtChildren(node)) return null;
  const children = (node.children ?? []).filter(
    (child) => child.visible !== false,
  );
  const artifactId = externalId(input.fileKey, node.id);
  const bounds = normalizedBounds(node.absoluteBoundingBox) ?? {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  };
  let manifestChildren = children.map((child, index) => ({
    externalId: externalId(input.fileKey, child.id),
    sourceNodeId: child.id,
    bounds: relativeBounds(child.absoluteBoundingBox, bounds),
    ...(flattenTransform(child.relativeTransform)
      ? { transform: flattenTransform(child.relativeTransform) }
      : {}),
    zOrder: index,
  }));
  const placeholders = manifestChildren
    .map(
      (child) =>
        `<div data-creative-context-child="${escapeAttribute(child.externalId)}" style="position:absolute;left:${round(child.bounds.x)}px;top:${round(child.bounds.y)}px;width:${round(child.bounds.width)}px;height:${round(child.bounds.height)}px;z-index:${child.zOrder}"></div>`,
    )
    .join("\n");
  const minimumShell = wrapFigmaDocument(`<div>${placeholders}</div>`, node);
  let compiledChildren: CompiledArtifact[] = [];
  for (const child of children) {
    compiledChildren.push(
      await compileNodeHierarchy(child.id, input, depth + 1),
    );
  }
  let boundedPlaceholders = placeholders;
  if (Buffer.byteLength(minimumShell, "utf8") > MAX_INLINE_NATIVE_CODE_BYTES) {
    const bucketed = compileManifestBuckets({
      node,
      input,
      parentBounds: bounds,
      manifestChildren,
      compiledChildren,
    });
    manifestChildren = bucketed.manifestChildren;
    compiledChildren = bucketed.compiledChildren;
    boundedPlaceholders = manifestPlaceholders(manifestChildren);
  }
  const shellNode: FigmaNode = { ...node, children: [] };
  const shellAssets = await input.assets.forNode(shellNode, artifactId);
  const shell = mapFigmaNodeToHtml(shellNode, {
    fallbackImageUrls: shellAssets.fallbackImageUrls,
    imageFillUrls: shellAssets.imageFillUrls,
  });
  const shellWithChildren = insertBeforeLastClosingDiv(
    shell.html || "<div></div>",
    boundedPlaceholders,
  );
  const html = wrapFigmaDocument(shellWithChildren, node);
  if (Buffer.byteLength(html, "utf8") > MAX_INLINE_NATIVE_CODE_BYTES) {
    input.warnings.push(
      `Figma node ${node.name ?? node.id} produced a hierarchical shell larger than 128 KiB; a localized rendered fallback was stored.`,
    );
    return compileRenderedFallback(node, input);
  }
  const fidelityReport = aggregateFidelity([
    nativeFidelityReportFromEntries(shell.fidelity.entries),
    ...compiledChildren.map((child) => child.nativeArtifact.fidelityReport),
  ]);
  const nativeArtifact = parseNativeCreativeArtifact({
    schemaVersion: 1,
    app: "design",
    format: "design-html",
    rootExternalId: artifactId,
    sourceBounds: bounds,
    childExternalIds: manifestChildren.map((child) => child.externalId),
    manifest: { kind: "hierarchical-artboard", children: manifestChildren },
    fidelityReport,
    ...(shellAssets.assetRefs.length
      ? { assetRefs: shellAssets.assetRefs }
      : {}),
  });
  const item = nativeItem({
    input,
    node,
    externalId: artifactId,
    html,
    nativeArtifact,
    media: shellAssets.media,
    edges: [
      ...figmaUsageEdges(node, input.fileKey),
      ...manifestChildren.map((child) => ({
        relation: "contains-native-child",
        toExternalId: child.externalId,
        metadata: {
          bounds: child.bounds,
          transform: child.transform,
          zOrder: child.zOrder,
        },
      })),
    ],
  });
  const artifact = {
    externalId: artifactId,
    nodeId: node.id,
    nodeName: node.name ?? node.id,
    item,
    nativeArtifact,
  };
  input.artifacts.set(artifactId, artifact);
  return artifact;
}

function compileManifestBuckets(input: {
  node: FigmaNode;
  input: CompileContext;
  parentBounds: { x: number; y: number; width: number; height: number };
  manifestChildren: Array<
    NonNullable<NativeCreativeArtifact["manifest"]>["children"][number]
  >;
  compiledChildren: CompiledArtifact[];
}): {
  manifestChildren: Array<
    NonNullable<NativeCreativeArtifact["manifest"]>["children"][number]
  >;
  compiledChildren: CompiledArtifact[];
} {
  const parentExternalId = externalId(input.input.fileKey, input.node.id);
  const parentChildren: Array<
    NonNullable<NativeCreativeArtifact["manifest"]>["children"][number]
  > = [];
  const bucketArtifacts: CompiledArtifact[] = [];
  for (
    let offset = 0;
    offset < input.manifestChildren.length;
    offset += MAX_MANIFEST_CHILDREN_PER_BUCKET
  ) {
    const entries = input.manifestChildren.slice(
      offset,
      offset + MAX_MANIFEST_CHILDREN_PER_BUCKET,
    );
    const childArtifacts = input.compiledChildren.slice(
      offset,
      offset + MAX_MANIFEST_CHILDREN_PER_BUCKET,
    );
    const bucketIndex = Math.floor(offset / MAX_MANIFEST_CHILDREN_PER_BUCKET);
    const bucketExternalId = `${parentExternalId}:manifest-bucket:${bucketIndex}`;
    const bucketSourceNodeId = `${input.node.id}:manifest-bucket:${bucketIndex}`;
    const bucketBounds = unionManifestBounds(entries);
    const bucketChildren = entries.map((entry) => ({
      ...entry,
      bounds: {
        x: round(entry.bounds.x - bucketBounds.x),
        y: round(entry.bounds.y - bucketBounds.y),
        width: entry.bounds.width,
        height: entry.bounds.height,
      },
    }));
    const bucketHtml = wrapFigmaDocument(
      `<div style="position:relative;width:${round(bucketBounds.width)}px;height:${round(bucketBounds.height)}px">${manifestPlaceholders(bucketChildren)}</div>`,
      input.node,
    );
    if (Buffer.byteLength(bucketHtml, "utf8") > MAX_INLINE_NATIVE_CODE_BYTES) {
      throw new Error(
        `Figma manifest bucket ${bucketExternalId} exceeded 128 KiB.`,
      );
    }
    const nativeArtifact = parseNativeCreativeArtifact({
      schemaVersion: 1,
      app: "design",
      format: "design-html",
      rootExternalId: bucketExternalId,
      sourceBounds: {
        x: 0,
        y: 0,
        width: bucketBounds.width,
        height: bucketBounds.height,
      },
      childExternalIds: bucketChildren.map((child) => child.externalId),
      manifest: { kind: "hierarchical-artboard", children: bucketChildren },
      fidelityReport: aggregateFidelity(
        childArtifacts.map((child) => child.nativeArtifact.fidelityReport),
      ),
    });
    const bucketNode: FigmaNode = {
      id: bucketSourceNodeId,
      name: `${input.node.name ?? input.node.id} segment ${bucketIndex + 1}`,
      type: "SECTION",
      absoluteBoundingBox: {
        x: 0,
        y: 0,
        width: bucketBounds.width,
        height: bucketBounds.height,
      },
      children: [],
    };
    const artifact: CompiledArtifact = {
      externalId: bucketExternalId,
      nodeId: bucketSourceNodeId,
      nodeName: bucketNode.name!,
      nativeArtifact,
      item: nativeItem({
        input: input.input,
        node: bucketNode,
        externalId: bucketExternalId,
        html: bucketHtml,
        nativeArtifact,
        media: [],
        edges: bucketChildren.map((child) => ({
          relation: "contains-native-child",
          toExternalId: child.externalId,
          metadata: {
            bounds: child.bounds,
            transform: child.transform,
            zOrder: child.zOrder,
          },
        })),
      }),
    };
    input.input.artifacts.set(bucketExternalId, artifact);
    bucketArtifacts.push(artifact);
    parentChildren.push({
      externalId: bucketExternalId,
      sourceNodeId: bucketSourceNodeId.slice(0, 256),
      bounds: bucketBounds,
      zOrder: entries[0]?.zOrder ?? bucketIndex,
    });
  }
  return {
    manifestChildren: parentChildren,
    compiledChildren: bucketArtifacts,
  };
}

function manifestPlaceholders(
  children: Array<
    NonNullable<NativeCreativeArtifact["manifest"]>["children"][number]
  >,
): string {
  return children
    .map(
      (child) =>
        `<div data-creative-context-child="${escapeAttribute(child.externalId)}" style="position:absolute;left:${round(child.bounds.x)}px;top:${round(child.bounds.y)}px;width:${round(child.bounds.width)}px;height:${round(child.bounds.height)}px;z-index:${child.zOrder}"></div>`,
    )
    .join("\n");
}

function unionManifestBounds(
  children: Array<
    NonNullable<NativeCreativeArtifact["manifest"]>["children"][number]
  >,
): { x: number; y: number; width: number; height: number } {
  const left = Math.min(...children.map((child) => child.bounds.x));
  const top = Math.min(...children.map((child) => child.bounds.y));
  const right = Math.max(
    ...children.map((child) => child.bounds.x + child.bounds.width),
  );
  const bottom = Math.max(
    ...children.map((child) => child.bounds.y + child.bounds.height),
  );
  return {
    x: round(left),
    y: round(top),
    width: Math.max(0, round(right - left)),
    height: Math.max(0, round(bottom - top)),
  };
}

function nativeItem(input: {
  input: CompileContext;
  node: FigmaNode;
  externalId: string;
  html: string;
  nativeArtifact: NativeCreativeArtifact;
  media: ContextMediaInput[];
  edges: Array<{
    relation: string;
    toExternalId: string;
    metadata?: Record<string, unknown>;
  }>;
}): NormalizedContextItem {
  const text = extractSearchText(input.node);
  const tokens = extractCodeTokens(input.html);
  return normalizeContextItem({
    externalId: input.externalId,
    kind: input.nativeArtifact.manifest
      ? "figma-artboard-manifest"
      : input.node.type === "COMPONENT"
        ? "figma-component"
        : "figma-frame",
    title: `${input.input.fileName} — ${input.node.name ?? input.node.id}`,
    canonicalUrl: figmaNodeUrl(input.input.sourceUrl, input.node.id),
    mimeType: "text/html",
    content: input.html,
    preserveContent: true,
    summary: `${input.node.type} compiled to editable Design HTML/CSS${input.nativeArtifact.manifest ? ` in ${input.nativeArtifact.manifest.children.length} bounded child artifacts` : ""}.`,
    sourceModifiedAt: input.input.sourceModifiedAt,
    sourceVersion: input.input.sourceVersion,
    parseStatus: "parsed",
    provenance: {
      provider: "figma",
      fileKey: input.input.fileKey,
      nodeId: input.node.id,
      compiler: "@agent-native/core/ingestion:figma-node-to-html",
    },
    metadata: {
      provider: "figma",
      version: input.input.sourceVersion,
      nodeType: input.node.type,
      nativeArtifact: input.nativeArtifact,
    },
    chunks: [
      ...(text
        ? [
            {
              ordinal: 0,
              kind: "text",
              text,
              metadata: { role: "source-text" },
            },
          ]
        : []),
      {
        ordinal: text ? 1 : 0,
        kind: "code",
        text: tokens,
        metadata: { role: "code-tokens", format: "design-html" },
      },
    ],
    media: input.media,
    edges: [
      { relation: "part-of-figma-file", toExternalId: input.input.fileKey },
      ...input.edges,
    ],
  });
}

function compileWithPlaceholderAssets(node: FigmaNode) {
  return {
    html: wrapFigmaDocument(
      mapFigmaNodeToHtml(node, {
        fallbackImageUrls: Object.fromEntries(
          collectFallbackNodeIds(node).map((id) => [
            id,
            `/figma-fallback/${id}`,
          ]),
        ),
        imageFillUrls: Object.fromEntries(
          collectImageFillRefs(node).map((ref) => [ref, `/figma-image/${ref}`]),
        ),
      }).html,
      node,
    ),
  };
}

class FigmaAssetRegistry {
  private readonly rehosted = new Map<string, Promise<ContextMediaInput>>();
  private imageFillSourceUrls?: Promise<Record<string, string>>;

  constructor(
    private readonly input: {
      fileKey: string;
      sourceUrl: string;
      sourceVersion: string;
      connectionId?: string;
      context: ContextConnectorExecutionContext;
    },
  ) {}

  async forNode(
    node: FigmaNode,
    artifactExternalId: string,
  ): Promise<ArtifactAssets> {
    const fallbackIds = collectFallbackNodeIds(node);
    const imageRefs = collectImageFillRefs(node);
    return this.resolveAssets({
      artifactExternalId,
      fallbackIds,
      imageRefs,
    });
  }

  async forRenderedFallback(
    node: FigmaNode,
    artifactExternalId: string,
  ): Promise<ArtifactAssets> {
    return this.resolveAssets({
      artifactExternalId,
      fallbackIds: [node.id],
      imageRefs: [],
    });
  }

  private async resolveAssets(input: {
    artifactExternalId: string;
    fallbackIds: string[];
    imageRefs: string[];
  }): Promise<ArtifactAssets> {
    const fallbackSourceUrls = await this.renderUrls(input.fallbackIds, "png");
    const imageFillSourceUrls = input.imageRefs.length
      ? await this.imageFillUrls()
      : {};
    const fallbackImageUrls: Record<string, string> = {};
    const imageFillUrls: Record<string, string> = {};
    const media: ContextMediaInput[] = [];
    const assetRefs: string[] = [];

    for (const nodeId of input.fallbackIds) {
      const url = fallbackSourceUrls[nodeId];
      if (!url)
        throw new Error(`Figma could not render fallback node ${nodeId}.`);
      const entry = await this.rehost(`fallback:${nodeId}`, url, {
        nodeId,
        role: "rendered-fallback",
      });
      const withId = this.forArtifact(
        entry,
        input.artifactExternalId,
        `fallback:${nodeId}`,
      );
      const route = creativeContextMediaUrl({ mediaId: withId.id });
      fallbackImageUrls[nodeId] = route;
      media.push(withId);
      assetRefs.push(route);
    }
    for (const imageRef of input.imageRefs) {
      const url = imageFillSourceUrls[imageRef];
      if (!url)
        throw new Error(`Figma image fill ${imageRef} could not be resolved.`);
      const entry = await this.rehost(`fill:${imageRef}`, url, {
        imageRef,
        role: "image-fill",
      });
      const withId = this.forArtifact(
        entry,
        input.artifactExternalId,
        `fill:${imageRef}`,
      );
      const route = creativeContextMediaUrl({ mediaId: withId.id });
      imageFillUrls[imageRef] = route;
      media.push(withId);
      assetRefs.push(route);
    }
    return { fallbackImageUrls, imageFillUrls, media, assetRefs };
  }

  private forArtifact(
    media: ContextMediaInput,
    artifactExternalId: string,
    assetKey: string,
  ): ContextMediaInput & { id: string } {
    return {
      ...media,
      id: stableMediaId(
        this.input.fileKey,
        artifactExternalId,
        assetKey,
        media.contentHash ?? this.input.sourceVersion,
      ),
    };
  }

  private rehost(
    key: string,
    url: string,
    metadata: Record<string, unknown>,
  ): Promise<ContextMediaInput> {
    const existing = this.rehosted.get(key);
    if (existing) return existing;
    const promise = rehostRemoteMedia({
      url,
      provenanceUrl: this.input.sourceUrl,
      filename: `${this.input.fileKey}-${safeFilename(key)}`,
      kind: "image",
      context: this.input.context,
      metadata: {
        provider: "figma",
        fileKey: this.input.fileKey,
        ...metadata,
      },
    });
    this.rehosted.set(key, promise);
    return promise;
  }

  private async imageFillUrls(): Promise<Record<string, string>> {
    if (!this.imageFillSourceUrls) {
      this.imageFillSourceUrls = executeConnectorProviderRequest(
        this.input.context.providerApi,
        {
          provider: "figma",
          method: "GET",
          path: `/files/${encodeURIComponent(this.input.fileKey)}/images`,
          connectionId: this.input.connectionId,
          maxBytes: 4 * 1024 * 1024,
        },
      ).then((value) => {
        const images = asRecord(asRecord(value)?.images) ?? {};
        return Object.fromEntries(
          Object.entries(images).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        );
      });
    }
    return this.imageFillSourceUrls;
  }

  private async renderUrls(
    ids: string[],
    format: "png" | "svg",
  ): Promise<Record<string, string>> {
    if (!ids.length) return {};
    const result: Record<string, string> = {};
    for (let offset = 0; offset < ids.length; offset += 50) {
      const batch = ids.slice(offset, offset + 50);
      const payload = asRecord(
        await executeConnectorProviderRequest(this.input.context.providerApi, {
          provider: "figma",
          method: "GET",
          path: `/images/${encodeURIComponent(this.input.fileKey)}`,
          query: { ids: batch.join(","), format, scale: 2 },
          connectionId: this.input.connectionId,
          maxBytes: 1024 * 1024,
        }),
      );
      for (const [id, url] of Object.entries(asRecord(payload?.images) ?? {})) {
        if (typeof url === "string" && url) result[id] = url;
      }
    }
    return result;
  }
}

function shouldSplitBeforeFullFetch(node: FigmaNode): boolean {
  const bounds = node.absoluteBoundingBox;
  return Boolean(
    canSplitAtChildren(node) &&
    ((bounds &&
      (bounds.width > MAX_ARTBOARD_DIMENSION ||
        bounds.height > MAX_ARTBOARD_DIMENSION ||
        bounds.width * bounds.height > MAX_ARTBOARD_AREA)) ||
      (node.children?.length ?? 0) > MAX_DIRECT_CHILDREN),
  );
}

function canSplitAtChildren(node: FigmaNode): boolean {
  if (node.type === "GROUP") return false;
  const children = (node.children ?? []).filter(
    (child) => child.visible !== false,
  );
  if (children.length < 2) return false;
  if (node.isMask || children.some((child) => child.isMask)) return false;
  return true;
}

function isProviderSizeFailure(error: unknown): boolean {
  return /4 MB|too large|response bound|exceeded.*limit|maximum response/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

export function nativeFidelityReportFromEntries(
  entries: FidelityEntry[],
): NativeCreativeArtifactFidelityReport {
  const reasons = (level: FidelityEntry["level"]) =>
    entries
      .filter((entry) => entry.level === level)
      .map((entry) => ({
        nodeId: entry.nodeId,
        nodeName: entry.nodeName,
        nodeType: entry.nodeType,
        reasons: entry.notes,
      }))
      .slice(0, 1_000);
  const approximated = reasons("approximated");
  const imageFallback = reasons("image-fallback");
  return {
    exact: { count: entries.filter((entry) => entry.level === "exact").length },
    approximated: {
      count: entries.filter((entry) => entry.level === "approximated").length,
      reasons: approximated,
    },
    imageFallback: {
      count: entries.filter((entry) => entry.level === "image-fallback").length,
      reasons: imageFallback,
    },
  };
}

function aggregateFidelity(
  reports: NativeCreativeArtifactFidelityReport[],
): NativeCreativeArtifactFidelityReport {
  return {
    exact: {
      count: reports.reduce((sum, report) => sum + report.exact.count, 0),
    },
    approximated: {
      count: reports.reduce(
        (sum, report) => sum + report.approximated.count,
        0,
      ),
      reasons: reports
        .flatMap((report) => report.approximated.reasons)
        .slice(0, 1_000),
    },
    imageFallback: {
      count: reports.reduce(
        (sum, report) => sum + report.imageFallback.count,
        0,
      ),
      reasons: reports
        .flatMap((report) => report.imageFallback.reasons)
        .slice(0, 1_000),
    },
  };
}

function extractSearchText(node: FigmaNode): string {
  const values: string[] = [];
  const visit = (current: FigmaNode) => {
    if (values.join("\n").length >= MAX_SEARCH_TEXT_CHARS) return;
    if (current.name) values.push(current.name);
    if (current.characters) values.push(current.characters);
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return values.join("\n").slice(0, MAX_SEARCH_TEXT_CHARS);
}

function extractCodeTokens(html: string): string {
  const tokens = new Set(
    (html.match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) ?? []).map((token) =>
      token.toLowerCase(),
    ),
  );
  return [...tokens].slice(0, 4_000).join(" ");
}

function wrapFigmaDocument(fragment: string, node: FigmaNode): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0;min-width:100%;min-height:100%}</style>
</head>
<body>
${fragment}
</body>
</html>`;
}

function figmaUsageEdges(
  node: FigmaNode,
  fileKey: string,
): Array<{
  relation: string;
  toExternalId: string;
  metadata?: Record<string, unknown>;
}> {
  const edges = new Map<
    string,
    {
      relation: string;
      toExternalId: string;
      metadata?: Record<string, unknown>;
    }
  >();
  const visit = (current: FigmaNode) => {
    if (current.componentId) {
      edges.set(`component:${current.componentId}`, {
        relation: "instance-of-component",
        toExternalId: `${fileKey}:${current.componentId}`,
      });
    }
    const styles = (
      current as FigmaNode & {
        styles?: Record<string, unknown>;
      }
    ).styles;
    for (const [styleType, styleId] of Object.entries(styles ?? {})) {
      if (typeof styleId !== "string" || !styleId) continue;
      edges.set(`style:${styleId}`, {
        relation: "uses-figma-token",
        toExternalId: `${fileKey}:style:${styleId}`,
        metadata: { styleType },
      });
    }
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return [...edges.values()];
}

function normalizedBounds(bounds: FigmaBoundingBox | undefined) {
  return bounds
    ? {
        x: round(bounds.x),
        y: round(bounds.y),
        width: Math.max(0, round(bounds.width)),
        height: Math.max(0, round(bounds.height)),
      }
    : undefined;
}

function relativeBounds(
  child: FigmaBoundingBox | undefined,
  parent: { x: number; y: number; width: number; height: number },
) {
  return child
    ? {
        x: round(child.x - parent.x),
        y: round(child.y - parent.y),
        width: Math.max(0, round(child.width)),
        height: Math.max(0, round(child.height)),
      }
    : { x: 0, y: 0, width: parent.width, height: parent.height };
}

function flattenTransform(
  transform: FigmaNode["relativeTransform"],
): [number, number, number, number, number, number] | undefined {
  return transform
    ? [
        transform[0][0],
        transform[0][1],
        transform[0][2],
        transform[1][0],
        transform[1][1],
        transform[1][2],
      ]
    : undefined;
}

function insertBeforeLastClosingDiv(html: string, children: string): string {
  const index = html.lastIndexOf("</div>");
  return index < 0
    ? `${html}\n${children}`
    : `${html.slice(0, index)}\n${children}\n${html.slice(index)}`;
}

function externalId(fileKey: string, nodeId: string): string {
  return `${fileKey}:${nodeId}`;
}

function stableMediaId(...values: string[]): string {
  return `ccm_${createHash("sha256").update(values.join("\u0000")).digest("hex").slice(0, 28)}`;
}

function safeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 120);
}

function figmaNodeUrl(value: string, nodeId: string): string {
  const url = new URL(value);
  url.searchParams.set("node-id", nodeId);
  return url.href;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
