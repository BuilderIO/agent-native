/**
 * Resolves the `data-figma-image-ref` placeholders a no-token clipboard/`.fig`
 * decode stamps onto unresolved IMAGE fills. Trap: the clipboard carries only
 * hashes, never bytes; the `.fig`'s embedded `images/` bytes — keyed by the same
 * SHA-1 the kiwi IMAGE fills reference — are what `resolveFigImageHashes` mirrors
 * token-free. REST (`hydrate-figma-paste-images`) resolves the same hashes with a token.
 */

import {
  agentEnterDocument,
  agentLeaveDocument,
} from "@agent-native/core/collab";
import { uploadFile } from "@agent-native/core/file-upload";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import {
  readLiveSourceFile,
  writeInlineSourceFile,
  type SourceWorkspaceFile,
} from "../source-workspace.js";
import { mutateDesignData } from "./design-data-mutation.js";
import { decodeFig, type DecodedFigImage } from "./fig-file-decoder.js";

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

const DATA_IMAGE_REF_ATTR_RE = /\sdata-figma-image-ref="([^"]*)"/;

// Must match the renderer's real placeholder form `url('about:blank')` (single
// quotes survive style-attr escaping); lenient to the `&quot;` entity form for
// older screens, with the back-reference keeping the quotes matched.
const IMAGE_URL_PLACEHOLDER_RE = /url\((&quot;|')about:blank\1\)/g;

/**
 * Wrap `url()` exactly as the renderer's escaped `style="…"` would, so hydrated
 * fills are byte-identical to natively rendered image fills.
 */
function cssUrlInAttr(url: string): string {
  const inner = url
    .replace(/'/g, "%27")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
  return `url('${inner}')`;
}

export function collectImageRefHashes(html: string): string[] {
  const hashes = new Set<string>();
  for (const m of html.matchAll(/<[^>]+>/g)) {
    const ref = m[0].match(DATA_IMAGE_REF_ATTR_RE);
    if (ref?.[1]) {
      for (const h of ref[1].trim().split(/\s+/)) {
        if (h) hashes.add(h);
      }
    }
  }
  return Array.from(hashes);
}

/**
 * Fill `url('about:blank')` placeholders on `data-figma-image-ref` elements: the
 * Nth placeholder maps to the Nth hash in the space-separated attr value.
 */
export function hydrateImageRefsInHtml(
  html: string,
  resolvedUrls: Map<string, string>,
): { html: string; resolved: number; missing: string[] } {
  let resolvedCount = 0;
  const missing: string[] = [];

  const newHtml = html.replace(/<[^>]+>/g, (tag) => {
    const refMatch = tag.match(DATA_IMAGE_REF_ATTR_RE);
    if (!refMatch?.[1]) return tag;

    const hashes = refMatch[1].trim().split(/\s+/).filter(Boolean);
    if (hashes.length === 0) return tag;

    const unresolvedHashes: string[] = [];
    let hashIdx = 0;

    let newTag = tag.replace(IMAGE_URL_PLACEHOLDER_RE, (match) => {
      if (hashIdx >= hashes.length) return match;
      const hash = hashes[hashIdx++]!;
      const durableUrl = resolvedUrls.get(hash);
      if (!durableUrl) {
        unresolvedHashes.push(hash);
        return match;
      }
      resolvedCount++;
      return cssUrlInAttr(durableUrl);
    });

    // Hashes beyond url() occurrences (shouldn't happen with our renderer).
    while (hashIdx < hashes.length) {
      unresolvedHashes.push(hashes[hashIdx++]!);
    }

    missing.push(...unresolvedHashes);

    if (unresolvedHashes.length === 0) {
      newTag = newTag.replace(/\s+data-figma-image-ref="[^"]*"/, "");
    } else if (unresolvedHashes.length < hashes.length) {
      newTag = newTag.replace(
        /data-figma-image-ref="[^"]*"/,
        `data-figma-image-ref="${unresolvedHashes.join(" ")}"`,
      );
    }

    return newTag;
  });

  return { html: newHtml, resolved: resolvedCount, missing };
}

// ---------------------------------------------------------------------------
// Shared file load + persist
// ---------------------------------------------------------------------------

export interface HydratableFile {
  workspaceFile: SourceWorkspaceFile;
  designId: string;
  /** Present only when the screen was imported via a REST clipboard path. */
  figmaFileKey?: string;
}

/**
 * Scoped, editor-access load of one HTML design file, plus the originating Figma
 * file key when recorded. Throws identical not-found/non-HTML errors for both resolvers.
 */
export async function loadHydratableFile(
  fileId: string,
): Promise<HydratableFile> {
  const db = getDb();
  const [row] = await db
    .select({
      id: schema.designFiles.id,
      designId: schema.designFiles.designId,
      filename: schema.designFiles.filename,
      fileType: schema.designFiles.fileType,
      content: schema.designFiles.content,
      designData: schema.designs.data,
    })
    .from(schema.designFiles)
    .innerJoin(
      schema.designs,
      eq(schema.designFiles.designId, schema.designs.id),
    )
    .where(
      and(
        eq(schema.designFiles.id, fileId),
        accessFilter(schema.designs, schema.designShares),
      ),
    )
    .limit(1);

  if (!row) throw new Error(`File not found: ${fileId}`);
  if (row.fileType !== "html") {
    throw new Error("hydrate-figma-paste-images only supports HTML files.");
  }

  await assertAccess("design", row.designId, "editor");

  let figmaFileKey: string | undefined;
  try {
    const designData: unknown = row.designData
      ? JSON.parse(row.designData)
      : {};
    const screenMeta = (designData as Record<string, unknown>)?.screenMetadata;
    if (screenMeta && typeof screenMeta === "object") {
      const fileMeta = (screenMeta as Record<string, unknown>)[fileId];
      if (fileMeta && typeof fileMeta === "object") {
        const key = (fileMeta as Record<string, unknown>).figmaFileKey;
        if (typeof key === "string" && key) figmaFileKey = key;
      }
    }
  } catch {
    // JSON.parse failure — figmaFileKey stays undefined; the REST caller
    // surfaces its own missing-key error, the .fig path does not need one.
  }

  const workspaceFile: SourceWorkspaceFile = {
    id: row.id,
    designId: row.designId,
    filename: row.filename,
    fileType: "html",
    content: row.content ?? "",
    createdAt: null,
    updatedAt: null,
  };

  return { workspaceFile, designId: row.designId, figmaFileKey };
}

export interface ApplyHydrationResult {
  resolved: number;
  missing: number;
  skipped: number;
}

/**
 * Hydrate placeholders and persist (CAS + collab sync), pruning
 * `screenMetadata.unresolvedImageRefs`. Never writes when nothing resolved.
 */
export async function applyHydration(opts: {
  file: SourceWorkspaceFile;
  designId: string;
  fileId: string;
  liveContent: string;
  liveVersionHash: string;
  requestedHashes: string[];
  resolvedUrls: Map<string, string>;
}): Promise<ApplyHydrationResult> {
  const { file, designId, fileId, liveContent, liveVersionHash } = opts;
  const {
    html: hydratedHtml,
    resolved,
    missing,
  } = hydrateImageRefsInHtml(liveContent, opts.resolvedUrls);

  const uniqueMissing = Array.from(new Set(missing));
  const skipped = opts.requestedHashes.length - opts.resolvedUrls.size;

  if (resolved === 0) {
    return { resolved: 0, missing: uniqueMissing.length, skipped };
  }

  agentEnterDocument(fileId);
  try {
    await writeInlineSourceFile({
      designId,
      file,
      content: hydratedHtml,
      expectedVersionHash: liveVersionHash,
    });
  } finally {
    agentLeaveDocument(fileId);
  }

  await mutateDesignData({
    designId,
    mutate: (current) => {
      const screenMeta = current.screenMetadata;
      if (!screenMeta || typeof screenMeta !== "object") return current;
      const fileMeta = (screenMeta as Record<string, unknown>)[fileId];
      if (!fileMeta || typeof fileMeta !== "object") return current;
      const updatedFileMeta: Record<string, unknown> = {
        ...(fileMeta as Record<string, unknown>),
      };
      if (uniqueMissing.length > 0) {
        updatedFileMeta.unresolvedImageRefs = uniqueMissing;
      } else {
        delete updatedFileMeta.unresolvedImageRefs;
      }
      return {
        ...current,
        screenMetadata: {
          ...(screenMeta as Record<string, unknown>),
          [fileId]: updatedFileMeta,
        },
      };
    },
    isApplied: (persisted) => {
      const screenMeta = persisted.screenMetadata;
      if (!screenMeta || typeof screenMeta !== "object") return false;
      const fileMeta = (screenMeta as Record<string, unknown>)[fileId];
      if (!fileMeta || typeof fileMeta !== "object") return false;
      const refs = (fileMeta as Record<string, unknown>).unresolvedImageRefs;
      return uniqueMissing.length === 0
        ? refs === undefined || (Array.isArray(refs) && refs.length === 0)
        : Array.isArray(refs) && refs.length === uniqueMissing.length;
    },
  });

  return { resolved, missing: uniqueMissing.length, skipped };
}

// ---------------------------------------------------------------------------
// Token-free `.fig` resolver
// ---------------------------------------------------------------------------

const FIG_HYDRATE_UPLOAD_CONCURRENCY = 4;

function mimeTypeForExt(ext: string): string {
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "application/octet-stream";
}

/**
 * Decode a `.fig` and index its embedded images by SHA-1 hash. Decode once per
 * upload and reuse the index across screens — a multi-screen hydration must not
 * re-parse the whole (up to 50 MB) file per screen.
 */
export function indexFigImages(figBytes: Buffer): Map<string, DecodedFigImage> {
  const byHash = new Map<string, DecodedFigImage>();
  for (const image of decodeFig(figBytes).images) byHash.set(image.hash, image);
  return byHash;
}

/**
 * Match placeholder hashes against a `.fig`'s embedded `images/` bytes (keyed by
 * the same SHA-1 the paste stamped) and mirror matches to durable storage. No
 * Figma token or REST call.
 */
export async function resolveFigImageHashes(opts: {
  figImages: Map<string, DecodedFigImage>;
  hashes: string[];
  ownerEmail: string;
  uploader?: typeof uploadFile;
}): Promise<Map<string, string>> {
  const { figImages, hashes, ownerEmail } = opts;
  const uploader = opts.uploader ?? uploadFile;

  const wanted = hashes.filter((h) => figImages.has(h));
  const resolved = new Map<string, string>();

  for (
    let offset = 0;
    offset < wanted.length;
    offset += FIG_HYDRATE_UPLOAD_CONCURRENCY
  ) {
    const batch = wanted.slice(offset, offset + FIG_HYDRATE_UPLOAD_CONCURRENCY);
    await Promise.all(
      batch.map(async (hash) => {
        const image = figImages.get(hash)!;
        try {
          const uploaded = await uploader({
            data: image.bytes,
            filename: `figma-${image.hash}.${image.ext}`,
            mimeType: mimeTypeForExt(image.ext),
            ownerEmail,
            recordAsset: false,
            stableUrl: true,
          });
          if (uploaded?.url) resolved.set(hash, uploaded.url);
        } catch {
          // Skip; a partial resolve still helps and leaves placeholders for a retry.
        }
      }),
    );
  }

  return resolved;
}

/**
 * Token-free hydration of one screen's image placeholders from an uploaded
 * `.fig`. Takes a pre-decoded image index (see `indexFigImages`) so a
 * multi-screen hydration decodes the file once, not once per screen.
 */
export async function hydrateFileImagesFromFig(opts: {
  fileId: string;
  figImages: Map<string, DecodedFigImage>;
  ownerEmail: string;
  uploader?: typeof uploadFile;
}): Promise<ApplyHydrationResult & { fileId: string }> {
  const { fileId, figImages, ownerEmail } = opts;
  const { workspaceFile, designId } = await loadHydratableFile(fileId);
  const live = await readLiveSourceFile(workspaceFile);

  const hashes = collectImageRefHashes(live.content);
  if (hashes.length === 0) {
    return { fileId, resolved: 0, missing: 0, skipped: 0 };
  }

  const resolvedUrls = await resolveFigImageHashes({
    figImages,
    hashes,
    ownerEmail,
    uploader: opts.uploader,
  });

  const result = await applyHydration({
    file: workspaceFile,
    designId,
    fileId,
    liveContent: live.content,
    liveVersionHash: live.versionHash,
    requestedHashes: hashes,
    resolvedUrls,
  });

  return { fileId, ...result };
}
