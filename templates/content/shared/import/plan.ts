import { finalizeMarkdownImport } from "./finalize";
import { type MarkdownImportDraft, parseMarkdownImport } from "./markdown";
import { isMarkdownFilePath } from "./paths";
import type {
  ImportAssetRequest,
  ImportAssetResolution,
  ImportedPage,
} from "./types";

export const MAX_IMPORT_FILES = 50;
export const MAX_IMPORT_MARKDOWN_BYTES = 1024 * 1024;
export const MAX_IMPORT_IMAGE_BYTES = 10 * 1024 * 1024;
/** The editor's full-body snapshot limit; a larger page could not be saved. */
export const MAX_IMPORT_PAGE_CHARACTERS = 500_000;

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
};

export type ImportFileKind = "markdown" | "image" | "unsupported";

/**
 * Why a file in the import did not become a page or an uploaded image. Every
 * skipped file is reported; none is dropped quietly.
 */
export type ImportSkipReason =
  | "unsupported-format"
  | "unused-image"
  | "too-large"
  | "not-text"
  | "duplicate-name"
  | "invalid-name";

export interface ImportSkippedFile {
  name: string;
  reason: ImportSkipReason;
  /** File extension, lowercased, for "not supported yet" messages. */
  format: string | null;
}

/**
 * Turns a picked file name or an archive path into an import-root-relative
 * path. Returns null for names that climb out of the import.
 */
export function normalizeImportPath(name: string): string | null {
  const segments: string[] = [];
  for (const segment of name.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") return null;
    segments.push(segment);
  }
  return segments.length ? segments.join("/") : null;
}

export function importFileFormat(path: string): string | null {
  return /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? null;
}

export function importFileKind(path: string): ImportFileKind {
  if (isMarkdownFilePath(path)) return "markdown";
  return importImageMediaType(path) ? "image" : "unsupported";
}

/** Image types a page can show, as stored by the editor upload path. */
export function isImportImageMediaType(mediaType: string): boolean {
  return Object.values(IMAGE_MEDIA_TYPES).includes(mediaType.toLowerCase());
}

export function importImageMediaType(path: string): string | null {
  const format = importFileFormat(path);
  return format ? (IMAGE_MEDIA_TYPES[format] ?? null) : null;
}

/** A `data:` URL's payload, or null when it has no comma to start one. */
export function splitDataUrl(
  dataUrl: string,
): { base64: boolean; payload: string } | null {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return null;
  return {
    base64: /;base64$/i.test(dataUrl.slice(0, comma)),
    payload: dataUrl.slice(comma + 1),
  };
}

/**
 * Decoded size of a `data:` URL, measured without decoding base64. One with
 * no payload, or a percent-encoded payload that can't be decoded, such as a
 * stray `%`, has no size, so the preview reports the image missing instead of
 * apply failing.
 */
export function dataUrlByteLength(dataUrl: string): number | null {
  const parts = splitDataUrl(dataUrl);
  if (!parts) return null;
  const { base64, payload } = parts;
  if (!base64) {
    try {
      return new TextEncoder().encode(decodeURIComponent(payload)).length;
    } catch (error) {
      if (error instanceof URIError) return null;
      throw error;
    }
  }
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

export interface PlannedImportPage {
  path: string;
  draft: MarkdownImportDraft;
  /** The page as the preview reports it, before uploads and page ids exist. */
  preview: ImportedPage;
  /** Every asset the page needs uploaded, once each, by picked file path. */
  uploads: ImportAssetRequest[];
  /** Picked image path for each image path the source references. */
  imageMatches: ReadonlyMap<string, string>;
}

/**
 * Picked and dropped files arrive without their folders, so a reference to
 * `images/logo.png` matches a picked `logo.png` when no other picked image
 * has that name.
 */
export function matchImportImagePath(
  path: string,
  imagePaths: ReadonlySet<string>,
): string | null {
  if (imagePaths.has(path)) return path;
  const name = path.slice(path.lastIndexOf("/") + 1);
  let match: string | null = null;
  for (const candidate of imagePaths) {
    if (candidate.slice(candidate.lastIndexOf("/") + 1) !== name) continue;
    if (match) return null;
    match = candidate;
  }
  return match;
}

/**
 * Parses each Markdown file and reports what it would become. Images picked
 * alongside count as available; nothing is uploaded or stored. A page longer
 * than the editor can save is left out, and the pages that link to it report
 * those links as not imported.
 */
export function planMarkdownPages(input: {
  markdown: Array<{ path: string; text: string }>;
  imagePaths: ReadonlySet<string>;
}): { pages: PlannedImportPage[]; tooLarge: string[] } {
  const drafts = new Map(
    input.markdown.map(({ path, text }) => [
      path,
      parseMarkdownImport({ sourcePath: path, text }),
    ]),
  );
  const importing = new Set(drafts.keys());
  const planned = new Map<string, ReturnType<typeof planPage>>();
  const tooLarge: string[] = [];
  let stale = [...drafts.keys()];
  while (stale.length > 0) {
    for (const path of stale) {
      planned.set(
        path,
        planPage(path, drafts.get(path)!, importing, input.imagePaths),
      );
    }
    const dropped = stale.filter(
      (path) =>
        planned.get(path)!.page.preview.content.length >
        MAX_IMPORT_PAGE_CHARACTERS,
    );
    for (const path of dropped) {
      importing.delete(path);
      planned.delete(path);
      tooLarge.push(path);
    }
    // A link to a page left out reads differently, which changes the length
    // of the page holding it, so those pages are measured again.
    stale = [...planned].flatMap(([path, { linked }]) =>
      dropped.some((target) => linked.has(target)) ? [path] : [],
    );
  }
  return { pages: [...planned.values()].map(({ page }) => page), tooLarge };
}

function planPage(
  path: string,
  draft: MarkdownImportDraft,
  importing: ReadonlySet<string>,
  imagePaths: ReadonlySet<string>,
): { page: PlannedImportPage; linked: Set<string> } {
  const uploads = new Map<string, ImportAssetRequest>();
  const imageMatches = new Map<string, string>();
  const linked = new Set<string>();
  const preview = finalizeMarkdownImport(
    draft,
    {
      asset: (request): ImportAssetResolution => {
        let upload: ImportAssetRequest | null = null;
        if (request.kind === "file") {
          const match = matchImportImagePath(request.path, imagePaths);
          if (match) {
            imageMatches.set(request.path, match);
            upload = { ...request, path: match };
          }
        } else if (isImportImageMediaType(request.mediaType)) {
          const bytes = dataUrlByteLength(request.dataUrl);
          if (bytes !== null && bytes <= MAX_IMPORT_IMAGE_BYTES) {
            upload = request;
          }
        }
        if (!upload) return { status: "missing" };
        const key = assetKey(upload);
        if (!uploads.has(key)) uploads.set(key, upload);
        return { status: "available" };
      },
      link: (target) => {
        if (!importing.has(target)) return null;
        linked.add(target);
        return target;
      },
    },
    "preview",
  );
  return {
    page: {
      path,
      draft,
      preview,
      uploads: [...uploads.values()],
      imageMatches,
    },
    linked,
  };
}

/**
 * Produces the stored page once its assets are uploaded and every imported
 * file has a page id, so links between imported files point at new pages.
 * `assetUrl` receives file requests by picked path, as in `uploads`.
 */
export function finalizePlannedPage(
  page: PlannedImportPage,
  resolved: {
    assetUrl: (request: ImportAssetRequest) => string | null;
    pageHref: (path: string) => string | null;
  },
): ImportedPage {
  return finalizeMarkdownImport(
    page.draft,
    {
      asset: (request) => {
        const match =
          request.kind === "file" ? page.imageMatches.get(request.path) : null;
        if (request.kind === "file" && !match) return { status: "missing" };
        const url = resolved.assetUrl(
          match && request.kind === "file"
            ? { ...request, path: match }
            : request,
        );
        return url ? { status: "resolved", url } : { status: "missing" };
      },
      link: resolved.pageHref,
    },
    "apply",
  );
}

export function assetKey(request: ImportAssetRequest): string {
  return request.kind === "file"
    ? `file:${request.path}`
    : `data:${request.dataUrl}`;
}
