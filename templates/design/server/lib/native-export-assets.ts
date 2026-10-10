import { createHash } from "node:crypto";

import { parse } from "parse5";

import {
  checkEffectAssetUrl,
  parseEffectsFromHtml,
} from "../../shared/native-effects";
import {
  MAX_NATIVE_EMBEDDED_ASSETS,
  NATIVE_EMBEDDED_ASSETS_ATTR,
  NATIVE_EMBEDDED_ASSETS_SCRIPT_TYPE,
  NATIVE_EXPORT_INTRINSIC_SOURCE_ATTR,
  NativeEmbeddedAssetRegistryError,
  parseNativeEmbeddedAssetRegistry,
  type NativeEmbeddedAssetEntry,
  type NativeEmbeddedAssetRegistry,
} from "../../shared/native-embedded-assets";
import type { ExportAsset } from "./design-export-assets";

export class NativeExportAssetError extends Error {
  constructor(
    readonly code:
      | "invalid-reference"
      | "unavailable"
      | "unreadable"
      | "limit"
      | "unsupported",
    message: string,
  ) {
    super(message);
    this.name = "NativeExportAssetError";
  }
}

type HtmlNode = {
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: HtmlNode[];
  content?: HtmlNode;
  sourceCodeLocation?: {
    endTag?: { startOffset: number; endOffset: number };
    startTag?: { startOffset: number; endOffset: number };
  };
};

export function collectNativeExportAssetPaths(html: string): string[] {
  const parsed = parseEffectsFromHtml(html);
  if (parsed.errors.length)
    throw new NativeExportAssetError(
      "invalid-reference",
      `Native effect manifest is unreadable: ${parsed.errors.join("; ")}`,
    );
  const document = parsed.document;
  if (!document) return [];
  const definitions = new Map(
    document.definitions.map((definition) => [
      `${definition.id}\u0000${definition.version}`,
      definition,
    ]),
  );
  const paths = new Set<string>();
  const collect = (url: string): void => {
    const checked = checkEffectAssetUrl(url);
    if (!checked.ok || url.includes("#"))
      throw new NativeExportAssetError(
        "invalid-reference",
        "Native input asset needs a same-origin root URL without a fragment.",
      );
    paths.add(url);
    if (paths.size > MAX_NATIVE_EMBEDDED_ASSETS)
      throw new NativeExportAssetError(
        "limit",
        `Native effect inputs exceed ${MAX_NATIVE_EMBEDDED_ASSETS} assets.`,
      );
  };
  for (const instance of document.instances) {
    const definition = definitions.get(
      `${instance.definitionId}\u0000${instance.definitionVersion}`,
    );
    if (!definition)
      throw new NativeExportAssetError(
        "invalid-reference",
        "Native input definition is unavailable in its document.",
      );
    for (const [name, property] of Object.entries(definition.properties)) {
      if (property.type !== "texture") continue;
      const value = Object.prototype.hasOwnProperty.call(instance.params, name)
        ? instance.params[name]
        : property.default;
      if (
        value &&
        typeof value === "object" &&
        "kind" in value &&
        value.kind === "asset"
      )
        collect(value.url);
    }
    for (const binding of Object.values(instance.bindings ?? {}))
      if (binding.kind === "asset") collect(binding.url);
  }
  return [...paths];
}

export type NativeExportIntrinsicAsset = { nodeId: string; path: string };

export function collectNativeExportIntrinsicAssets(
  html: string,
): NativeExportIntrinsicAsset[] {
  const parsed = parseEffectsFromHtml(html);
  if (parsed.errors.length)
    throw new NativeExportAssetError(
      "invalid-reference",
      "Native effect manifest is unreadable for intrinsic image export.",
    );
  if (!parsed.document) return [];
  const definitions = new Map(
    parsed.document.definitions.map((definition) => [
      `${definition.id}\u0000${definition.version}`,
      definition,
    ]),
  );
  const required = new Set<string>();
  for (const instance of parsed.document.instances) {
    if (!instance.enabled) continue;
    const definition = definitions.get(
      `${instance.definitionId}\u0000${instance.definitionVersion}`,
    );
    if (definition?.sourceSizing?.intrinsicEncoding)
      required.add(instance.nodeId);
  }
  if (!required.size) return [];
  const found = new Map<string, NativeExportIntrinsicAsset[]>();
  const visit = (node: HtmlNode, parentTag = ""): void => {
    const nodeId = node.attrs?.find(
      (entry) => entry.name === "data-agent-native-node-id",
    )?.value;
    if (nodeId && required.has(nodeId)) {
      if (node.tagName !== "img" || parentTag === "picture")
        throw new NativeExportAssetError(
          "unsupported",
          "An intrinsic native source must be one direct image outside picture selection.",
        );
      const srcset = node.attrs?.find((entry) => entry.name === "srcset");
      const src = node.attrs?.find((entry) => entry.name === "src")?.value;
      const checked = checkEffectAssetUrl(src);
      if (srcset || !checked.ok || !src || src.includes("#"))
        throw new NativeExportAssetError(
          "invalid-reference",
          "An intrinsic native source needs one root-relative raster src without srcset.",
        );
      const entries = found.get(nodeId) ?? [];
      entries.push({ nodeId, path: src });
      found.set(nodeId, entries);
    }
    for (const child of node.childNodes ?? [])
      visit(child, node.tagName ?? parentTag);
    if (node.content) visit(node.content, node.tagName ?? parentTag);
  };
  visit(parse(html, { sourceCodeLocationInfo: true }) as HtmlNode);
  return [...required].map((nodeId) => {
    const entries = found.get(nodeId);
    if (entries?.length !== 1)
      throw new NativeExportAssetError(
        "invalid-reference",
        "An intrinsic native source must match exactly one image node.",
      );
    return entries[0];
  });
}

export function markNativeExportIntrinsicSources(
  html: string,
  sources: readonly (NativeExportIntrinsicAsset & {
    encodedSource: string;
  })[],
): string {
  if (!sources.length) return html;
  const expected = new Map(sources.map((source) => [source.nodeId, source]));
  const seen = new Set<string>();
  const insertions: { at: number; value: string }[] = [];
  const visit = (node: HtmlNode): void => {
    const nodeId = node.attrs?.find(
      (entry) => entry.name === "data-agent-native-node-id",
    )?.value;
    const source = nodeId ? expected.get(nodeId) : undefined;
    if (source) {
      const src = node.attrs?.find((entry) => entry.name === "src")?.value;
      const tag = node.sourceCodeLocation?.startTag;
      if (
        seen.has(nodeId!) ||
        node.tagName !== "img" ||
        src !== source.encodedSource ||
        !tag
      )
        throw new NativeExportAssetError(
          "invalid-reference",
          "The bundled intrinsic image no longer matches its verified source.",
        );
      seen.add(nodeId!);
      const startTag = html.slice(tag.startOffset, tag.endOffset);
      const close = startTag.lastIndexOf(">");
      const slash = startTag.slice(0, close).match(/\/\s*$/);
      const at = tag.startOffset + close - (slash?.[0].length ?? 0);
      const value = source.path.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      insertions.push({
        at,
        value: ` ${NATIVE_EXPORT_INTRINSIC_SOURCE_ATTR}="${value}"`,
      });
    }
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content) visit(node.content);
  };
  visit(parse(html, { sourceCodeLocationInfo: true }) as HtmlNode);
  if (seen.size !== expected.size)
    throw new NativeExportAssetError(
      "invalid-reference",
      "The bundled intrinsic image is missing from the export scene.",
    );
  return insertions
    .sort((left, right) => right.at - left.at)
    .reduce(
      (content, insertion) =>
        content.slice(0, insertion.at) +
        insertion.value +
        content.slice(insertion.at),
      html,
    );
}

export function assertNoAuthoredNativeAssetRegistry(html: string): void {
  const visit = (node: HtmlNode): void => {
    if (
      node.attrs?.some(
        (attr) => attr.name === NATIVE_EXPORT_INTRINSIC_SOURCE_ATTR,
      )
    )
      throw new NativeExportAssetError(
        "unsupported",
        "Authored intrinsic export source metadata is unsupported.",
      );
    if (
      node.tagName === "script" &&
      node.attrs?.some(
        (attr) =>
          attr.name === NATIVE_EMBEDDED_ASSETS_ATTR ||
          (attr.name === "type" &&
            attr.value === NATIVE_EMBEDDED_ASSETS_SCRIPT_TYPE),
      )
    )
      throw new NativeExportAssetError(
        "unsupported",
        "Authored native embedded asset registry is unsupported.",
      );
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content) visit(node.content);
  };
  visit(parse(html, { sourceCodeLocationInfo: true }) as HtmlNode);
}

export function rasterSignatureMatches(
  mimeType: string,
  bytes: Uint8Array,
): boolean {
  if (mimeType === "image/png")
    return (
      bytes.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every(
        (byte, index) => bytes[index] === byte,
      )
    );
  if (mimeType === "image/jpeg")
    return (
      bytes.length >= 3 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255
    );
  if (mimeType === "image/webp")
    return (
      bytes.length >= 12 &&
      String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
    );
  if (mimeType === "image/avif")
    return (
      bytes.length >= 12 &&
      String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp" &&
      ["avif", "avis"].includes(String.fromCharCode(...bytes.subarray(8, 12)))
    );
  return false;
}

export function embedNativeExportAssets(
  html: string,
  entries: readonly { path: string; asset: ExportAsset }[],
): string {
  if (!entries.length) return html;
  const assets: NativeEmbeddedAssetEntry[] = entries.map(({ path, asset }) => {
    if (
      !["image/png", "image/jpeg", "image/webp", "image/avif"].includes(
        asset.mimeType,
      )
    )
      throw new NativeExportAssetError(
        "unsupported",
        `Native input asset ${path} is not a supported raster image.`,
      );
    if (!rasterSignatureMatches(asset.mimeType, asset.bytes))
      throw new NativeExportAssetError(
        "unreadable",
        `Native input asset ${path} does not match its raster MIME signature.`,
      );
    return {
      path,
      mimeType: asset.mimeType as NativeEmbeddedAssetEntry["mimeType"],
      byteLength: asset.bytes.byteLength,
      sha256: createHash("sha256").update(asset.bytes).digest("hex"),
      base64: Buffer.from(asset.bytes).toString("base64"),
    };
  });
  let registry: NativeEmbeddedAssetRegistry;
  try {
    registry = parseNativeEmbeddedAssetRegistry({ schemaVersion: 1, assets });
  } catch (error) {
    if (
      error instanceof NativeEmbeddedAssetRegistryError &&
      error.code === "registry-limit"
    )
      throw new NativeExportAssetError("limit", error.message);
    throw new NativeExportAssetError(
      "invalid-reference",
      error instanceof Error
        ? error.message
        : "Native embedded asset registry is invalid.",
    );
  }
  const tag = `<script type="${NATIVE_EMBEDDED_ASSETS_SCRIPT_TYPE}" ${NATIVE_EMBEDDED_ASSETS_ATTR}>${JSON.stringify(registry)}</script>`;
  const document = parse(html, { sourceCodeLocationInfo: true }) as HtmlNode;
  let insertion = html.length;
  const visit = (node: HtmlNode): void => {
    if (node.tagName === "body" && node.sourceCodeLocation?.endTag)
      insertion = node.sourceCodeLocation.endTag.startOffset;
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(document);
  return `${html.slice(0, insertion)}${tag}\n${html.slice(insertion)}`;
}
