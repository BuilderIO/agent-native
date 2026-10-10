import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, posix, resolve, sep } from "node:path";

import {
  FileUploadReadError,
  readUploadedFile,
} from "@agent-native/core/file-upload";
import { parse, parseFragment } from "parse5";

import type { DesignExportFile } from "./design-export";
import {
  DesignNativeTextureAssetError,
  parseDesignNativeTexturePath,
  readDesignNativeTextureAsset,
} from "./design-native-texture-assets";
import {
  isLocalFigmaQaAssetUrl,
  LocalFigmaQaExportAssetError,
  readLocalFigmaQaAssetForExport,
} from "./local-figma-qa-upload";
import {
  assertNoAuthoredNativeAssetRegistry,
  collectNativeExportAssetPaths,
  collectNativeExportIntrinsicAssets,
  markNativeExportIntrinsicSources,
  embedNativeExportAssets,
  NativeExportAssetError,
  rasterSignatureMatches,
} from "./native-export-assets";

export interface ExportAsset {
  mimeType: string;
  bytes: Uint8Array;
  licenseText?: string;
}

export interface ExportAssetReferences {
  localPaths: string[];
  externalUrls: string[];
  nativeAssetPaths: string[];
}

export class ExportAssetError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid-reference"
      | "unavailable"
      | "unreadable"
      | "limit"
      | "unsupported",
  ) {
    super(message);
    this.name = "ExportAssetError";
  }
}

type HtmlLocation = {
  startOffset: number;
  endOffset: number;
  attrs?: Record<string, { startOffset: number; endOffset: number }>;
};

type HtmlNode = {
  tagName?: string;
  nodeName?: string;
  attrs?: { name: string; value: string }[];
  sourceCodeLocation?: HtmlLocation;
  childNodes?: HtmlNode[];
};

type Replacement = { start: number; end: number; value: string };

const URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi;
const MAX_REFERENCES = 64;
const MAX_PATH_LENGTH = 1024;
const MAX_ASSET_BYTES = 1_000_000;
const MAX_TOTAL_ASSET_BYTES = 4_000_000;
const MAX_FONT_LICENSE_BYTES = 32_000;
const MAX_FONT_LICENSES_PER_DIRECTORY = 8;
const MAX_TOTAL_FONT_LICENSE_BYTES = 64_000;
const MIME_BY_EXTENSION: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};
const ASSET_ATTRIBUTE_TAGS: Record<string, string[]> = {
  img: ["src", "srcset"],
  source: ["src", "srcset"],
  video: ["poster"],
  audio: ["src"],
  image: ["href", "xlink:href"],
  link: ["href"],
  script: ["src"],
};

function resolveReference(
  raw: string,
  filename: string,
): { kind: "local" | "external" | "skip"; value: string } {
  const value = raw.trim();
  if (!value || value.startsWith("#") || value.startsWith("data:"))
    return { kind: "skip", value };
  if (/^(?:https?:)?\/\//i.test(value)) return { kind: "external", value };
  if (/^[a-z][a-z\d+.-]*:/i.test(value))
    throw new ExportAssetError(
      `Unsupported export asset URL scheme: ${value.slice(0, 80)}`,
      "unsupported",
    );
  if (value.length > MAX_PATH_LENGTH || value.includes("\\"))
    throw new ExportAssetError(
      "Export asset path is too long or contains a backslash",
      "invalid-reference",
    );
  const pathname = value.split(/[?#]/, 1)[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new ExportAssetError(
      `Malformed export asset URL: ${value.slice(0, 80)}`,
      "invalid-reference",
    );
  }
  if (decoded.includes("\0") || decoded.startsWith("//"))
    throw new ExportAssetError(
      `Export asset path escapes public root: ${value.slice(0, 80)}`,
      "invalid-reference",
    );
  const base = filename.startsWith("/") ? filename : `/${filename}`;
  let depth = decoded.startsWith("/")
    ? 0
    : posix.dirname(base).split("/").filter(Boolean).length;
  for (const segment of decoded.split("/")) {
    if (segment === "..") depth--;
    else if (segment && segment !== ".") depth++;
    if (depth < 0)
      throw new ExportAssetError(
        `Export asset path escapes public root: ${value.slice(0, 80)}`,
        "invalid-reference",
      );
  }
  const absolute = decoded.startsWith("/")
    ? posix.normalize(decoded)
    : posix.resolve(posix.dirname(base), decoded);
  if (absolute === "/" || !absolute.startsWith("/"))
    throw new ExportAssetError(
      `Invalid export asset path: ${value.slice(0, 80)}`,
      "invalid-reference",
    );
  return { kind: "local", value: absolute };
}

function dataUrl(asset: ExportAsset): string {
  if (
    !/^(?:image\/(?:svg\+xml|png|jpeg|gif|webp|avif)|font\/(?:woff|woff2|ttf|otf)|text\/css)$/.test(
      asset.mimeType,
    )
  )
    throw new ExportAssetError(
      `Unsupported export asset MIME type: ${asset.mimeType}`,
      "unsupported",
    );
  return `data:${asset.mimeType};base64,${Buffer.from(asset.bytes).toString("base64")}`;
}

function replaceCssUrls(
  css: string,
  filename: string,
  assets: Readonly<Record<string, ExportAsset>> | null,
  localPaths: Set<string>,
  externalUrls: Set<string>,
): string {
  return css.replace(
    URL_RE,
    (match, double: string, single: string, bare: string) => {
      const ref = double ?? single ?? bare;
      const resolved = resolveReference(ref, filename);
      if (resolved.kind === "skip") return match;
      if (resolved.kind === "external") {
        externalUrls.add(resolved.value);
        if (!assets) return match;
        const asset = assets[resolved.value];
        if (!asset)
          throw new ExportAssetError(
            "External export asset is unavailable.",
            "unavailable",
          );
        return `url("${dataUrl(asset)}")`;
      }
      localPaths.add(resolved.value);
      if (!assets) return match;
      const asset = assets[resolved.value];
      if (!asset)
        throw new ExportAssetError(
          `Export asset ${resolved.value} is unavailable`,
          "unavailable",
        );
      return `url("${dataUrl(asset)}")`;
    },
  );
}

function replaceAttributeValue(
  name: string,
  value: string,
  filename: string,
  assets: Readonly<Record<string, ExportAsset>> | null,
  localPaths: Set<string>,
  externalUrls: Set<string>,
): string {
  if (name === "style")
    return replaceCssUrls(value, filename, assets, localPaths, externalUrls);
  if (name === "srcset") {
    if (value.includes("data:")) return value;
    const candidates = value.split(",").map((candidate) => {
      const match = candidate.trim().match(/^(\S+)(\s+.*)?$/);
      if (!match) return candidate;
      const source = replaceAttributeValue(
        "src",
        match[1],
        filename,
        assets,
        localPaths,
        externalUrls,
      );
      return `${source}${match[2] ?? ""}`;
    });
    if (assets && candidates.some((candidate) => candidate.startsWith("data:")))
      throw new ExportAssetError(
        "Bundling srcset candidates as data URLs is unsupported; use an img src or public asset without srcset",
        "unsupported",
      );
    return candidates.join(", ");
  }
  const resolved = resolveReference(value, filename);
  if (resolved.kind === "skip") return value;
  if (resolved.kind === "external") {
    externalUrls.add(resolved.value);
    if (!assets) return value;
    const asset = assets[resolved.value];
    if (!asset)
      throw new ExportAssetError(
        "External export asset is unavailable.",
        "unavailable",
      );
    return dataUrl(asset);
  }
  localPaths.add(resolved.value);
  if (!assets) return value;
  const asset = assets[resolved.value];
  if (!asset)
    throw new ExportAssetError(
      `Export asset ${resolved.value} is unavailable`,
      "unavailable",
    );
  return dataUrl(asset);
}

function transformHtml(
  html: string,
  filename: string,
  assets: Readonly<Record<string, ExportAsset>> | null,
  localPaths: Set<string>,
  externalUrls: Set<string>,
): string {
  const document = (
    /<html[\s>]|<!doctype/i.test(html)
      ? parse(html, { sourceCodeLocationInfo: true })
      : parseFragment(html, { sourceCodeLocationInfo: true })
  ) as HtmlNode;
  const replacements: Replacement[] = [];
  const visit = (node: HtmlNode, parentTag = "") => {
    const tag = node.tagName?.toLowerCase() ?? "";
    const location = node.sourceCodeLocation;
    if (tag && location?.attrs) {
      let allowed = ASSET_ATTRIBUTE_TAGS[tag] ?? [];
      if (tag === "link") {
        const rel =
          node.attrs?.find((attr) => attr.name === "rel")?.value ?? "";
        if (!/\b(?:stylesheet|icon|preload)\b/i.test(rel)) allowed = [];
      }
      for (const attr of node.attrs ?? []) {
        if (attr.name !== "style" && !allowed.includes(attr.name)) continue;
        const attrLocation = location.attrs[attr.name];
        if (!attrLocation) continue;
        const value = replaceAttributeValue(
          attr.name,
          attr.value,
          filename,
          assets,
          localPaths,
          externalUrls,
        );
        if (assets && value !== attr.value) {
          replacements.push({
            start: attrLocation.startOffset,
            end: attrLocation.endOffset,
            value: `${attr.name}="${value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`,
          });
        }
      }
    }
    if (parentTag === "style" && node.nodeName === "#text" && location) {
      const raw = html.slice(location.startOffset, location.endOffset);
      const value = replaceCssUrls(
        raw,
        filename,
        assets,
        localPaths,
        externalUrls,
      );
      if (assets && value !== raw)
        replacements.push({
          start: location.startOffset,
          end: location.endOffset,
          value,
        });
    }
    for (const child of node.childNodes ?? []) visit(child, tag);
  };
  visit(document);
  return replacements
    .sort((a, b) => b.start - a.start)
    .reduce(
      (content, edit) =>
        `${content.slice(0, edit.start)}${edit.value}${content.slice(edit.end)}`,
      html,
    );
}

export function processExportAssetReferences(
  files: readonly DesignExportFile[],
  assets: Readonly<Record<string, ExportAsset>> | null = null,
): { files: DesignExportFile[]; references: ExportAssetReferences } {
  const localPaths = new Set<string>();
  const externalUrls = new Set<string>();
  const nativeAssetPaths = new Set<string>();
  const processed = files.map((file) => {
    if (!file.content) return file;
    const intrinsicSources =
      file.fileType === "html"
        ? collectNativeExportIntrinsicAssets(file.content)
        : [];
    const nativePaths =
      file.fileType === "html"
        ? [
            ...new Set([
              ...collectNativeExportAssetPaths(file.content),
              ...intrinsicSources.map((source) => source.path),
            ]),
          ]
        : [];
    if (file.fileType === "html")
      assertNoAuthoredNativeAssetRegistry(file.content);
    const nativeEntries: { path: string; asset: ExportAsset }[] = [];
    for (const path of nativePaths) {
      nativeAssetPaths.add(path);
      const resolved = resolveReference(path, file.filename);
      if (resolved.kind !== "local")
        throw new NativeExportAssetError(
          "invalid-reference",
          "Native input asset is not local.",
        );
      localPaths.add(resolved.value);
      if (assets) {
        const asset = assets[resolved.value];
        if (!asset)
          throw new NativeExportAssetError(
            "unavailable",
            `Native input asset ${path} is unavailable.`,
          );
        nativeEntries.push({ path, asset });
      }
    }
    let content =
      file.fileType === "css"
        ? replaceCssUrls(
            file.content,
            file.filename,
            assets,
            localPaths,
            externalUrls,
          )
        : file.fileType === "html" || file.fileType === "jsx"
          ? transformHtml(
              file.content,
              file.filename,
              assets,
              localPaths,
              externalUrls,
            )
          : file.content;
    if (assets && intrinsicSources.length)
      content = markNativeExportIntrinsicSources(
        content,
        intrinsicSources.map((source) => {
          const resolved = resolveReference(source.path, file.filename);
          if (resolved.kind !== "local")
            throw new NativeExportAssetError(
              "invalid-reference",
              "Intrinsic native input asset is not local.",
            );
          const asset = assets[resolved.value];
          if (!asset)
            throw new NativeExportAssetError(
              "unavailable",
              "Intrinsic native input asset is unavailable.",
            );
          return { ...source, encodedSource: dataUrl(asset) };
        }),
      );
    if (assets && nativeEntries.length)
      content = embedNativeExportAssets(content, nativeEntries);
    if (localPaths.size + externalUrls.size > MAX_REFERENCES)
      throw new ExportAssetError(
        `Export references exceed ${MAX_REFERENCES} assets`,
        "limit",
      );
    return { ...file, content };
  });
  return {
    files: processed,
    references: {
      localPaths: [...localPaths],
      externalUrls: [...externalUrls],
      nativeAssetPaths: [...nativeAssetPaths],
    },
  };
}

export async function loadPublicExportAssets(
  publicDirectory: string,
  paths: readonly string[],
  options: { ownerEmail?: string | null; qaRootDir?: string } = {},
): Promise<Record<string, ExportAsset>> {
  if (paths.length > MAX_REFERENCES)
    throw new ExportAssetError(
      `Export references exceed ${MAX_REFERENCES} assets`,
      "limit",
    );
  let root: string;
  try {
    root = await realpath(publicDirectory);
  } catch {
    throw new ExportAssetError(
      "Public export asset directory is unavailable",
      "unavailable",
    );
  }
  const assets: Record<string, ExportAsset> = {};
  let totalBytes = 0;
  for (const path of paths) {
    if (/^https?:\/\//i.test(path)) {
      if (!options.ownerEmail)
        throw new ExportAssetError(
          "Export asset owner is unavailable.",
          "unavailable",
        );
      let uploaded;
      try {
        uploaded = await readUploadedFile({
          url: path,
          ownerEmail: options.ownerEmail,
          maxBytes: MAX_ASSET_BYTES,
        });
      } catch (error) {
        if (error instanceof FileUploadReadError)
          throw new ExportAssetError(
            error.message,
            error.code === "limit"
              ? "limit"
              : error.code === "unsupported"
                ? "unsupported"
                : error.code === "invalid-reference"
                  ? "invalid-reference"
                  : "unavailable",
          );
        throw error;
      }
      if (!rasterSignatureMatches(uploaded.mimeType, uploaded.data))
        throw new ExportAssetError(
          "Uploaded export asset bytes do not match a supported raster image type.",
          "unsupported",
        );
      totalBytes += uploaded.data.byteLength;
      if (totalBytes > MAX_TOTAL_ASSET_BYTES)
        throw new ExportAssetError(
          "Export assets exceed the 4 MB bundle limit",
          "limit",
        );
      assets[path] = { mimeType: uploaded.mimeType, bytes: uploaded.data };
      continue;
    }
    if (path.startsWith("/api/design-native-texture/")) {
      if (!parseDesignNativeTexturePath(path))
        throw new ExportAssetError(
          "Native texture reference is invalid.",
          "invalid-reference",
        );
      let asset: ExportAsset;
      try {
        const resolved = await readDesignNativeTextureAsset(
          path,
          MAX_ASSET_BYTES,
        );
        asset = { mimeType: resolved.mimeType, bytes: resolved.bytes };
      } catch (error) {
        if (!(error instanceof DesignNativeTextureAssetError)) throw error;
        throw new ExportAssetError(
          error.message,
          error.code === "limit"
            ? "limit"
            : error.code === "unsupported"
              ? "unsupported"
              : error.code === "invalid-reference"
                ? "invalid-reference"
                : error.code === "unreadable"
                  ? "unreadable"
                  : "unavailable",
        );
      }
      totalBytes += asset.bytes.byteLength;
      if (totalBytes > MAX_TOTAL_ASSET_BYTES)
        throw new ExportAssetError(
          "Export assets exceed the 4 MB bundle limit",
          "limit",
        );
      assets[path] = asset;
      continue;
    }
    if (isLocalFigmaQaAssetUrl(path)) {
      let qaAsset: ExportAsset;
      try {
        qaAsset = await readLocalFigmaQaAssetForExport(
          path,
          options.ownerEmail,
          {
            rootDir: options.qaRootDir,
            maxBytes: MAX_ASSET_BYTES,
          },
        );
      } catch (error) {
        if (error instanceof LocalFigmaQaExportAssetError)
          throw new ExportAssetError(
            error.message,
            error.code === "limit"
              ? "limit"
              : error.code === "invalid-reference" || error.code === "forbidden"
                ? "invalid-reference"
                : error.code === "unsupported"
                  ? "unsupported"
                  : error.code === "unreadable"
                    ? "unreadable"
                    : "unavailable",
          );
        throw error;
      }
      totalBytes += qaAsset.bytes.byteLength;
      if (totalBytes > MAX_TOTAL_ASSET_BYTES)
        throw new ExportAssetError(
          "Export assets exceed the 4 MB bundle limit",
          "limit",
        );
      assets[path] = qaAsset;
      continue;
    }
    if (
      !path.startsWith("/") ||
      path.startsWith("//") ||
      path.split("/").includes("..") ||
      path.includes("\\") ||
      path.length > MAX_PATH_LENGTH
    )
      throw new ExportAssetError(
        `Invalid public export asset path: ${path.slice(0, 80)}`,
        "invalid-reference",
      );
    const mimeType = MIME_BY_EXTENSION[extname(path).toLowerCase()];
    if (!mimeType)
      throw new ExportAssetError(
        `Unsupported public export asset type: ${path.slice(0, 80)}`,
        "unsupported",
      );
    const candidate = resolve(root, `.${path}`);
    let real: string;
    try {
      real = await realpath(candidate);
    } catch {
      throw new ExportAssetError(
        `Export asset ${path} is unavailable`,
        "unavailable",
      );
    }
    if (
      !isAbsolute(real) ||
      (real !== root && !real.startsWith(`${root}${sep}`))
    )
      throw new ExportAssetError(
        `Export asset ${path} escapes public root`,
        "invalid-reference",
      );
    const details = await stat(real);
    if (!details.isFile() || details.size > MAX_ASSET_BYTES)
      throw new ExportAssetError(
        `Export asset ${path} is not a bounded file`,
        "limit",
      );
    totalBytes += details.size;
    if (totalBytes > MAX_TOTAL_ASSET_BYTES)
      throw new ExportAssetError(
        "Export assets exceed the 4 MB bundle limit",
        "limit",
      );
    const asset: ExportAsset = { mimeType, bytes: await readFile(real) };
    if (mimeType.startsWith("font/")) {
      const names = await readdir(dirname(real));
      const licenseNames = names
        .filter((name) => /^LICENSE(?:[_\w.-]*)$/i.test(name))
        .sort();
      if (licenseNames.length > MAX_FONT_LICENSES_PER_DIRECTORY)
        throw new ExportAssetError(
          `Font licenses for ${path} exceed the bundle limit`,
          "limit",
        );
      const licenseTexts: string[] = [];
      let licenseBytes = 0;
      for (const licenseName of licenseNames) {
        const licensePath = await realpath(resolve(dirname(real), licenseName));
        if (licensePath !== root && !licensePath.startsWith(`${root}${sep}`))
          throw new ExportAssetError(
            `Font license for ${path} escapes public root`,
            "invalid-reference",
          );
        const licenseStat = await stat(licensePath);
        if (!licenseStat.isFile() || licenseStat.size > MAX_FONT_LICENSE_BYTES)
          throw new ExportAssetError(
            `Font license for ${path} is not a bounded file`,
            "limit",
          );
        licenseBytes += licenseStat.size;
        if (licenseBytes > MAX_TOTAL_FONT_LICENSE_BYTES)
          throw new ExportAssetError(
            `Font licenses for ${path} exceed the bundle limit`,
            "limit",
          );
        licenseTexts.push(
          `${licenseName}\n${await readFile(licensePath, "utf8")}`,
        );
      }
      if (licenseTexts.length) asset.licenseText = licenseTexts.join("\n\n");
    }
    assets[path] = asset;
  }
  return assets;
}
