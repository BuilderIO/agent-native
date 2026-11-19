import { withoutQuery } from "./expiring-links";
import { finalizeMarkdownImport } from "./finalize";
import {
  type MarkdownImportDraft,
  newTablePaddingBudget,
  parseMarkdownImport,
} from "./markdown";
import {
  isNotionExport,
  type NotionDatabase,
  notionFileTitle,
  planNotionExport,
  prepareNotionMarkdown,
} from "./notion-export";
import { isMarkdownFilePath } from "./paths";
import type {
  ImportAssetRequest,
  ImportAssetResolution,
  ImportedPage,
} from "./types";

export const MAX_IMPORT_FILES = 500;
export const MAX_IMPORT_MARKDOWN_BYTES = 1024 * 1024;
export const MAX_IMPORT_TOTAL_MARKDOWN_BYTES = 4 * 1024 * 1024;
export const MAX_IMPORT_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** The editor's full-body snapshot limit; a larger page could not be saved. */
export const MAX_IMPORT_PAGE_CHARACTERS = 500_000;

const IMAGE_MEDIA_TYPES = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["avif", "image/avif"],
  ["svg", "image/svg+xml"],
]);

const ATTACHMENT_MEDIA_TYPES = new Map([
  ["pdf", "application/pdf"],
  ["csv", "text/csv"],
]);

export type ImportFileKind =
  | "markdown"
  | "image"
  | "attachment"
  | "unsupported";

export type ImportSkipReason =
  | "unsupported-format"
  | "unused-image"
  | "unused-file"
  | "too-large"
  | "not-text"
  | "duplicate-name"
  | "invalid-name"
  | "nested-archive";

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
  if (importImageMediaType(path)) return "image";
  return importAttachmentMediaType(path) ? "attachment" : "unsupported";
}

export function importAttachmentMediaType(path: string): string | null {
  const format = importFileFormat(path);
  return format ? (ATTACHMENT_MEDIA_TYPES.get(format) ?? null) : null;
}

/** Image types a page can show, as stored by the editor upload path. */
export function isImportImageMediaType(mediaType: string): boolean {
  return [...IMAGE_MEDIA_TYPES.values()].includes(mediaType.toLowerCase());
}

export function importImageMediaType(path: string): string | null {
  const format = importFileFormat(path);
  return format ? (IMAGE_MEDIA_TYPES.get(format) ?? null) : null;
}

/** A `data:` URL's payload, or null when it has no comma to start one. */
function splitDataUrl(
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
 * The bytes a percent-encoded `data:` payload spells. The bytes needn't be
 * text: a PNG written this way starts `%89PNG`, which `decodeURIComponent`
 * refuses as invalid UTF-8. A `%` not followed by two hex digits stays a `%`,
 * as browsers keep it, so an SVG holding `100%` still shows.
 */
function percentDecodedBytes(payload: string): Uint8Array {
  const encoded = new TextEncoder().encode(payload);
  const bytes = new Uint8Array(encoded.length);
  let length = 0;
  for (let index = 0; index < encoded.length; index++) {
    if (encoded[index] === 0x25) {
      const hex = String.fromCharCode(encoded[index + 1], encoded[index + 2]);
      if (/^[0-9a-f]{2}$/i.test(hex)) {
        bytes[length++] = parseInt(hex, 16);
        index += 2;
        continue;
      }
    }
    bytes[length++] = encoded[index];
  }
  return bytes.subarray(0, length);
}

/**
 * A base64 payload's digits without padding, or null when it isn't base64.
 * It is a URL first, so `%2B` is a `+`, and ASCII whitespace is dropped as
 * browsers drop it. Node's base64 decoder skips what it can't read instead
 * of refusing, so anything it would skip is refused here.
 */
function base64Digits(payload: string): string | null {
  let text = payload;
  if (payload.includes("%")) {
    text = new TextDecoder("latin1").decode(percentDecodedBytes(payload));
  }
  text = text.replace(/[\t\n\f\r ]/g, "");
  const digits = text.replace(/={1,2}$/, "");
  if (!/^[A-Za-z0-9+/]*$/.test(digits) || digits.length % 4 === 1) return null;
  return digits === text || text.length % 4 === 0 ? digits : null;
}

/**
 * Decoded size of a `data:` URL, measured without decoding base64. One with
 * no payload, or base64 that won't decode, such as a character base64 doesn't
 * use, has no size, so the preview reports the image missing instead of apply
 * storing a broken one.
 */
export function dataUrlByteLength(dataUrl: string): number | null {
  const parts = splitDataUrl(dataUrl);
  if (!parts) return null;
  const length = parts.base64
    ? (base64Digits(parts.payload)?.length ?? 0) * 0.75
    : percentDecodedBytes(parts.payload).length;
  return Math.floor(length) || null;
}

/** The bytes a `data:` URL holds, or null when {@link dataUrlByteLength} gives it no size. */
export function dataUrlBytes(dataUrl: string): Uint8Array | null {
  const parts = splitDataUrl(dataUrl);
  if (!parts) return null;
  if (!parts.base64) {
    const bytes = percentDecodedBytes(parts.payload);
    return bytes.length ? bytes : null;
  }
  const digits = base64Digits(parts.payload);
  if (!digits) return null;
  const binary = atob(digits);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export interface PlannedImportPage {
  path: string;
  parentPath: string | null;
  draft: MarkdownImportDraft;
  /** The page as the preview reports it, before uploads and page ids exist. */
  preview: ImportedPage;
  /** Every asset the page needs uploaded, once each, by picked file path. */
  uploads: ImportAssetRequest[];
  fileMatches: ReadonlyMap<string, string>;
}

interface ImportFilePaths {
  images: ReadonlySet<string>;
  attachments: ReadonlySet<string>;
  aliases: ReadonlyMap<string, string>;
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

export function planMarkdownPages(input: {
  markdown: Array<{ path: string; text: string }>;
  imagePaths: ReadonlySet<string>;
  attachmentPaths?: ReadonlySet<string>;
}): {
  pages: PlannedImportPage[];
  tooLarge: string[];
  notion: {
    databases: NotionDatabase[];
    databaseFiles: ReadonlySet<string>;
  } | null;
} {
  const attachmentPaths = input.attachmentPaths ?? new Set<string>();
  const notion = isNotionExport(input.markdown.map(({ path }) => path))
    ? planNotionExport([
        ...input.markdown.map(({ path }) => path),
        ...input.imagePaths,
        ...attachmentPaths,
      ])
    : null;
  const markdown = notion
    ? input.markdown.filter(({ path }) => !notion.databaseFiles.has(path))
    : input.markdown;
  const files: ImportFilePaths = {
    images: input.imagePaths,
    attachments: attachmentPaths,
    aliases: notion?.csvAliases ?? new Map(),
  };

  // Files share one padding budget, so they're parsed in path order: the same
  // files give the same pages in any order, as an import's fingerprint assumes.
  const tablePadding = newTablePaddingBudget();
  const parsed = new Map(
    [...markdown]
      .sort((a, b) => (a.path < b.path ? -1 : 1))
      .map(({ path, text }): [string, MarkdownImportDraft] => {
        if (!notion) {
          return [
            path,
            parseMarkdownImport({ sourcePath: path, text, tablePadding }),
          ];
        }
        const prepared = prepareNotionMarkdown(text);
        return [
          path,
          parseMarkdownImport({
            sourcePath: path,
            text: prepared.text,
            tablePadding,
            fallbackTitle: notionFileTitle(path),
            asideCallouts: true,
            notes: prepared.notes,
          }),
        ];
      }),
  );
  const drafts = new Map<string, MarkdownImportDraft>();
  for (const { path } of markdown) {
    const draft = parsed.get(path);
    if (draft) drafts.set(path, draft);
  }
  const importing = new Set(drafts.keys());
  const parents = new Map<string, string>();
  for (const [path, candidates] of notion?.parentCandidates ?? []) {
    const parent = chooseParent(path, candidates, drafts);
    if (parent) parents.set(path, parent);
  }
  const planned = new Map<string, ReturnType<typeof planPage>>();
  const tooLarge: string[] = [];
  let stale = [...drafts.keys()];
  while (stale.length > 0) {
    for (const path of stale) {
      const draft = drafts.get(path);
      if (draft) planned.set(path, planPage(path, draft, importing, files));
    }
    const dropped = stale.filter(
      (path) =>
        planned.get(path)!.page.preview.content.length >
        MAX_IMPORT_PAGE_CHARACTERS,
    );
    for (const path of dropped) {
      importing.delete(path);
      planned.delete(path);
      drafts.delete(path);
      tooLarge.push(path);
    }
    // A link to a page left out reads differently, which changes the length
    // of the page holding it, so those pages are measured again.
    stale = [...planned].flatMap(([path, { linked }]) =>
      dropped.some((target) => linked.has(target)) ? [path] : [],
    );
  }

  const parentOf = (path: string): string | null => {
    let parent = parents.get(path) ?? null;
    while (parent && !planned.has(parent)) parent = parents.get(parent) ?? null;
    return parent;
  };
  const children = new Map<string | null, PlannedImportPage[]>();
  for (const { page } of planned.values()) {
    const parentPath = parentOf(page.path);
    const siblings = children.get(parentPath) ?? [];
    siblings.push({ ...page, parentPath });
    children.set(parentPath, siblings);
  }
  const pages: PlannedImportPage[] = [];
  const visit = (parentPath: string | null) => {
    for (const page of children.get(parentPath) ?? []) {
      pages.push(page);
      visit(page.path);
    }
  };
  visit(null);
  return {
    pages,
    tooLarge,
    notion: notion && {
      databases: notion.databases,
      databaseFiles: notion.databaseFiles,
    },
  };
}

function chooseParent(
  path: string,
  candidates: readonly string[],
  drafts: ReadonlyMap<string, MarkdownImportDraft>,
): string | null {
  const importing = candidates.filter((candidate) => drafts.has(candidate));
  if (importing.length < 2) return importing[0] ?? null;
  const linking = importing.find((candidate) =>
    drafts
      .get(candidate)
      ?.slots.some(
        (slot) =>
          slot.reference.kind === "relative" && slot.reference.path === path,
      ),
  );
  if (linking) return linking;
  return importing[0] ?? null;
}

function matchImportFile(
  request: Extract<ImportAssetRequest, { kind: "file" }>,
  files: ImportFilePaths,
): string | null {
  const image = matchImportImagePath(request.path, files.images);
  if (image || request.use === "image") return image;
  return matchImportImagePath(
    files.aliases.get(request.path) ?? request.path,
    files.attachments,
  );
}

function planPage(
  path: string,
  draft: MarkdownImportDraft,
  importing: ReadonlySet<string>,
  files: ImportFilePaths,
): { page: PlannedImportPage; linked: Set<string> } {
  const uploads = new Map<string, ImportAssetRequest>();
  const fileMatches = new Map<string, string>();
  const linked = new Set<string>();
  const preview = finalizeMarkdownImport(
    draft,
    {
      asset: (request): ImportAssetResolution => {
        let upload: ImportAssetRequest | null = null;
        if (request.kind === "file") {
          const match = matchImportFile(request, files);
          if (match) {
            fileMatches.set(`${request.use}:${request.path}`, match);
            upload = { ...request, path: match };
          }
        } else if (request.kind === "remote") {
          upload = request;
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
      parentPath: null,
      draft,
      preview,
      uploads: [...uploads.values()],
      fileMatches,
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
        let picked = request;
        if (request.kind === "file") {
          const match = page.fileMatches.get(`${request.use}:${request.path}`);
          if (!match) return { status: "missing" };
          picked = { ...request, path: match };
        }
        const url = resolved.assetUrl(picked);
        return url ? { status: "resolved", url } : { status: "missing" };
      },
      link: resolved.pageHref,
      unhostedUrl: withoutQuery,
    },
    "apply",
  );
}

export function assetKey(request: ImportAssetRequest): string {
  if (request.kind === "file") return `file:${request.path}`;
  if (request.kind === "remote") return `remote:${request.url}`;
  return `data:${request.dataUrl}`;
}
