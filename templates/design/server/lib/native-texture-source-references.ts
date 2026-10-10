import { parse } from "parse5";

import {
  collectNativeExportAssetPaths,
  collectNativeExportIntrinsicAssets,
} from "./native-export-assets";

const PREFIX = "/api/design-native-texture/";
const NATIVE_PATH =
  /^\/api\/design-native-texture\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(?:png|jpg|webp)$/;
const CSS_URL = /url\(\s*(?:["']([^"']+)["']|([^\s)]+))\s*\)/gi;
const RAW_REFERENCE = /\/api\/design-native-texture\/[^\s"'<>),;]+/g;
const MAX_SOURCE_BYTES = 4_000_000;
const MAX_REFERENCES = 64;

type HtmlNode = {
  tagName?: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
  content?: HtmlNode;
};

export class NativeTextureSourceReferenceError extends Error {
  constructor(
    readonly code: "invalid-reference" | "limit",
    message: string,
  ) {
    super(message);
    this.name = "NativeTextureSourceReferenceError";
  }
}

export function collectNativeTextureSourceReferences(
  fileType: string,
  source: string,
): string[] {
  const exceedsPrivateReferenceBudget =
    Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES;
  const paths = new Set<string>();
  const collect = (value: string) => {
    if (!value.startsWith(PREFIX)) return;
    if (!NATIVE_PATH.test(value))
      throw new NativeTextureSourceReferenceError(
        "invalid-reference",
        "Native texture source path is malformed.",
      );
    paths.add(value);
    if (paths.size > MAX_REFERENCES)
      throw new NativeTextureSourceReferenceError(
        "limit",
        "Native texture source references exceed the bounded limit.",
      );
  };
  if (fileType === "html") {
    for (const path of collectNativeExportAssetPaths(source)) collect(path);
    for (const item of collectNativeExportIntrinsicAssets(source))
      collect(item.path);
    const visit = (node: HtmlNode) => {
      if (node.tagName === "style")
        for (const child of node.childNodes ?? [])
          for (const match of (child.value ?? "").matchAll(CSS_URL))
            collect(match[1] ?? match[2] ?? "");
      for (const attr of node.attrs ?? []) {
        if (["src", "href", "poster"].includes(attr.name)) collect(attr.value);
        if (attr.name === "style")
          for (const match of attr.value.matchAll(CSS_URL))
            collect(match[1] ?? match[2] ?? "");
      }
      for (const child of node.childNodes ?? []) visit(child);
      if (node.content) visit(node.content);
    };
    visit(parse(source) as HtmlNode);
  } else if (fileType === "css") {
    for (const match of source.matchAll(CSS_URL))
      collect(match[1] ?? match[2] ?? "");
  }
  for (const raw of source.matchAll(RAW_REFERENCE))
    if (!paths.has(raw[0]))
      throw new NativeTextureSourceReferenceError(
        "invalid-reference",
        "Native texture reference uses an unsupported source form.",
      );
  if (exceedsPrivateReferenceBudget && paths.size)
    throw new NativeTextureSourceReferenceError(
      "limit",
      "Native texture source exceeds the bounded private-reference size.",
    );
  return [...paths].sort();
}
