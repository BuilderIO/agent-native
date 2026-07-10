/**
 * Shared Figma REST fetch -> map -> screen-file core.
 *
 * Extracted from `import-figma-frame.ts` so a second import path (paste-driven
 * node resolution, see `figma-clipboard-match.ts` / `import-figma-clipboard.ts`)
 * can reuse the exact same fetch/map logic instead of re-implementing it.
 * `import-figma-frame.ts` still owns the action interface and result shape; this
 * module only owns the parts that talk to the Figma REST API and turn node JSON
 * into `ImportedDesignFile` records.
 *
 * Pure/network-boundary split mirrors `figma-node-to-html.ts`'s own doc comment:
 * this module fetches, `figma-node-to-html.ts` maps (pure, synchronous).
 */

import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { uploadFile } from "@agent-native/core/file-upload";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

import {
  collectFallbackNodeIds,
  collectFontUsage,
  collectImageFillRefs,
  mapFigmaNodeToHtml,
  type FidelityEntry,
  type FidelityLevel,
  type FigmaFontUsage,
  type FigmaNode,
} from "./figma-node-to-html.js";
import {
  normalizeImportedHtmlDocument,
  type ImportedDesignFile,
} from "./import-design-files.js";
import { executeProviderApiRequest } from "./provider-api.js";

const MAX_FIGMA_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_FIGMA_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_FIGMA_IMAGE_REFERENCES = 256;
const MAX_FIGMA_IMAGE_IDS_PER_REQUEST = 50;
const MAX_FIGMA_IMAGE_IDS_QUERY_CHARS = 1_800;
const MAX_CONCURRENT_FIGMA_IMAGE_UPLOADS = 4;
const FIGMA_IMAGE_FETCH_TIMEOUT_MS = 20_000;
const FIGMA_IMAGE_MIME_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/avif", "avif"],
]);

type FigmaImageUploader = typeof uploadFile;
type FigmaImageFetcher = typeof ssrfSafeFetch;

class FigmaImageByteBudget {
  private downloadedBytes = 0;
  private reservedBytes = 0;

  private assertAvailable(bytes: number): void {
    if (bytes <= 0) return;
    if (
      this.downloadedBytes + this.reservedBytes + bytes >
      MAX_TOTAL_FIGMA_IMAGE_BYTES
    ) {
      throw new Error(
        "Figma images exceeded the 64 MB total import limit. Import a smaller frame or selection.",
      );
    }
  }

  reserve(bytes: number): void {
    this.assertAvailable(bytes);
    this.reservedBytes += Math.max(0, bytes);
  }

  consume(bytes: number): void {
    this.assertAvailable(bytes);
    this.downloadedBytes += Math.max(0, bytes);
  }

  consumeReserved(bytes: number): void {
    const consumed = Math.min(this.reservedBytes, Math.max(0, bytes));
    this.reservedBytes -= consumed;
    this.downloadedBytes += consumed;
  }

  releaseReservation(bytes: number): void {
    this.reservedBytes = Math.max(0, this.reservedBytes - Math.max(0, bytes));
  }
}

function normalizedMimeType(value: string | null): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function hasMatchingImageSignature(mimeType: string, data: Buffer): boolean {
  if (mimeType === "image/png") {
    return data
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mimeType === "image/jpeg") {
    return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (mimeType === "image/gif") {
    const signature = data.subarray(0, 6).toString("ascii");
    return signature === "GIF87a" || signature === "GIF89a";
  }
  if (mimeType === "image/webp") {
    return (
      data.subarray(0, 4).toString("ascii") === "RIFF" &&
      data.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  if (mimeType === "image/avif") {
    return (
      data.subarray(4, 8).toString("ascii") === "ftyp" &&
      /^(?:avif|avis)$/.test(data.subarray(8, 12).toString("ascii"))
    );
  }
  return false;
}

async function discardResponseBody(response: Response): Promise<void> {
  if (response.body) {
    await response.body.cancel().catch(() => undefined);
    return;
  }
  await response.arrayBuffer().catch(() => undefined);
}

async function readCappedImageBytes(
  response: Response,
  aggregateBudget: FigmaImageByteBudget,
): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_FIGMA_IMAGE_BYTES
  ) {
    await discardResponseBody(response);
    throw new Error("image exceeded the 15 MB per-asset limit");
  }
  let reservedBytes = 0;
  if (Number.isFinite(declaredLength) && declaredLength > 0) {
    try {
      aggregateBudget.reserve(declaredLength);
    } catch (error) {
      await discardResponseBody(response);
      throw error;
    }
    reservedBytes = declaredLength;
  }

  const accountDownloadedBytes = (bytes: number) => {
    const fromReservation = Math.min(reservedBytes, bytes);
    if (fromReservation > 0) {
      aggregateBudget.consumeReserved(fromReservation);
      reservedBytes -= fromReservation;
    }
    if (bytes > fromReservation) {
      aggregateBudget.consume(bytes - fromReservation);
    }
  };

  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_FIGMA_IMAGE_BYTES) {
      throw new Error("image exceeded the 15 MB per-asset limit");
    }
    accountDownloadedBytes(buffer.byteLength);
    aggregateBudget.releaseReservation(reservedBytes);
    return buffer;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_FIGMA_IMAGE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("image exceeded the 15 MB per-asset limit");
    }
    try {
      accountDownloadedBytes(value.byteLength);
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    }
    chunks.push(Buffer.from(value));
  }
  aggregateBudget.releaseReservation(reservedBytes);
  return Buffer.concat(chunks, total);
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index]!, index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
  return results;
}

async function mirrorFigmaImageUrls(
  urls: string[],
  options: {
    ownerEmail?: string;
    fetcher?: FigmaImageFetcher;
    uploader?: FigmaImageUploader;
  } = {},
): Promise<Map<string, string>> {
  const uniqueUrls = Array.from(new Set(urls));
  if (uniqueUrls.length === 0) return new Map();
  if (uniqueUrls.length > MAX_FIGMA_IMAGE_REFERENCES) {
    throw new Error(
      `Figma import referenced too many images (${uniqueUrls.length}; max ${MAX_FIGMA_IMAGE_REFERENCES}). Import a smaller frame or selection.`,
    );
  }

  const ownerEmail = options.ownerEmail ?? getRequestUserEmail();
  if (!ownerEmail) {
    throw new Error(
      "Figma image import requires an authenticated user so assets can be stored durably.",
    );
  }
  const fetcher = options.fetcher ?? ssrfSafeFetch;
  const uploader = options.uploader ?? uploadFile;
  const aggregateBudget = new FigmaImageByteBudget();

  const mirrored = await mapWithConcurrency(
    uniqueUrls,
    MAX_CONCURRENT_FIGMA_IMAGE_UPLOADS,
    async (url, index) => {
      let response: Response;
      try {
        response = await fetcher(
          url,
          { signal: AbortSignal.timeout(FIGMA_IMAGE_FETCH_TIMEOUT_MS) },
          { maxRedirects: 3, httpsOnly: true },
        );
      } catch (error) {
        throw new Error(
          `Could not securely fetch a Figma image: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!response.ok) {
        await discardResponseBody(response);
        throw new Error(
          `Could not fetch a Figma image (HTTP ${response.status}). Try importing again; Figma render URLs expire.`,
        );
      }

      const mimeType = normalizedMimeType(response.headers.get("content-type"));
      const extension = FIGMA_IMAGE_MIME_TYPES.get(mimeType);
      if (!extension) {
        await discardResponseBody(response);
        throw new Error(
          `Figma returned an unsupported image type (${mimeType || "missing content type"}).`,
        );
      }

      let data: Buffer;
      try {
        data = await readCappedImageBytes(response, aggregateBudget);
      } catch (error) {
        throw new Error(
          `Could not import a Figma image: ${error instanceof Error ? error.message : String(error)}.`,
        );
      }
      if (!hasMatchingImageSignature(mimeType, data)) {
        throw new Error(
          "Figma image bytes did not match the advertised image type.",
        );
      }
      let uploaded: Awaited<ReturnType<FigmaImageUploader>>;
      try {
        uploaded = await uploader({
          data,
          filename: `figma-import-${index + 1}.${extension}`,
          mimeType,
          ownerEmail,
          recordAsset: false,
          stableUrl: true,
        });
      } catch (error) {
        throw new Error(
          `Could not store a Figma image durably. Check Settings > File uploads and try again. ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!uploaded?.url || /^(?:data|blob):/i.test(uploaded.url)) {
        throw new Error(
          "Figma import needs durable file storage for rendered images. Connect Builder.io in Settings > File uploads, or configure S3, R2, GCS, or another file upload provider, then try again. No image bytes were stored in SQL.",
        );
      }
      return [url, uploaded.url] as const;
    },
  );
  return new Map(mirrored);
}

/**
 * Figma's box model treats a frame's declared width/height as the OUTER
 * (border-box-equivalent) size: padding eats into the interior without
 * growing the frame's footprint. The browser default is `box-sizing:
 * content-box`, so `figma-node-to-html.ts`'s per-node inline `width`/`height`
 * (mapped 1:1 from `absoluteBoundingBox`) plus any padding on the same node
 * renders LARGER than Figma intends by exactly the padding amount, and the
 * default UA `body { margin: 8px }` additionally offsets the whole imported
 * screen away from (0,0). Both together produce visible horizontal/vertical
 * overflow and a diagonal pixel offset relative to Figma's own render for any
 * auto-layout frame with padding (i.e. most real designs). Scope the reset to
 * this Figma-import pipeline only — the shared `normalizeImportedHtmlDocument`
 * is also used by non-Figma import paths that must not be affected.
 */
export function withFigmaBoxModelReset(html: string): string {
  return `<style>*,*::before,*::after{box-sizing:border-box;}body{margin:0;}</style>\n${html}`;
}

/**
 * Build a Google Fonts CSS2 URL from the font usage collected for one
 * imported node (mirrors the equivalent helper in `fig-file-to-html.ts` for
 * `.fig` imports, kept separate here to avoid coupling the REST-node and
 * `.fig`-binary import pipelines). Returns null when no custom fonts were
 * used (nothing to request).
 */
export function buildGoogleFontsUrl(
  fontUsage: FigmaFontUsage[],
): string | null {
  if (fontUsage.length === 0) return null;
  const maxVariants = 256;
  const maxUrlLength = 16_384;
  const byFamily = new Map<
    string,
    Array<{ weight: number; italic: boolean }>
  >();
  for (const { family, weight, italic } of fontUsage) {
    if (!byFamily.has(family)) byFamily.set(family, []);
    byFamily.get(family)!.push({ weight, italic });
  }
  const families: string[] = [];
  let variantCount = 0;
  for (const [family, variants] of byFamily) {
    if (variantCount >= maxVariants) break;
    const famParam = encodeURIComponent(family.trim()).replace(/%20/g, "+");
    if (!famParam) continue;
    const hasItalic = variants.some((variant) => variant.italic);
    let familyParam: string;
    if (hasItalic) {
      const tuples = Array.from(
        new Set(
          variants.map(
            (variant) => `${variant.italic ? 1 : 0},${variant.weight}`,
          ),
        ),
      )
        .sort()
        .slice(0, maxVariants - variantCount);
      familyParam = `family=${famParam}:ital,wght@${tuples.join(";")}`;
      variantCount += tuples.length;
    } else {
      const weights = Array.from(
        new Set(variants.map((variant) => variant.weight)),
      )
        .sort((a, b) => a - b)
        .slice(0, maxVariants - variantCount);
      familyParam = `family=${famParam}:wght@${weights.join(";")}`;
      variantCount += weights.length;
    }
    const candidate = `https://fonts.googleapis.com/css2?${[...families, familyParam].join("&")}&display=swap`;
    if (candidate.length > maxUrlLength) {
      break;
    }
    families.push(familyParam);
  }
  if (families.length === 0) return null;
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
}

/**
 * Prepend `<link>` tags requesting the imported node's real fonts from Google
 * Fonts. `normalizeImportedHtmlDocument` wraps content with no `<html>` tag
 * into a fresh document whose `<body>` is exactly this string -- so, like
 * `withFigmaBoxModelReset` above, these tags land in `<body>`, which browsers
 * still apply `rel="stylesheet"` links from. This is the same fallback-font
 * substitution problem `code-layer-state.ts` and `fig-file-to-html.ts`
 * already solve for other design-generation/import paths; the REST-node
 * Figma importer had no equivalent, so every imported font silently
 * substituted the browser default sans-serif.
 */
export function withFigmaFontLoading(
  html: string,
  fontUsage: FigmaFontUsage[],
): string {
  const url = buildGoogleFontsUrl(fontUsage);
  if (!url) return html;
  const escapedUrl = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${escapedUrl}">\n${html}`;
}

type FigmaProviderEnvelope = {
  response?: {
    ok?: boolean;
    status?: number;
    statusText?: string;
    json?: unknown;
    text?: string;
    truncated?: boolean;
    size?: number;
  };
};

export function providerJson(envelope: unknown, label: string): unknown {
  const response = (envelope as FigmaProviderEnvelope | null)?.response;
  if (!response) throw new Error(`Figma ${label} response was empty.`);
  if (response.truncated) {
    throw new Error(
      `Figma ${label} response exceeded the safe 4 MB import limit${response.size ? ` (${response.size} bytes)` : ""}. Import a smaller frame or selection.`,
    );
  }
  if (response.ok === false) {
    const detail =
      (typeof response.text === "string" && response.text.trim()) ||
      response.statusText ||
      `HTTP ${response.status ?? "error"}`;
    throw new Error(`Figma ${label} request failed: ${detail}`);
  }
  return response.json;
}

export async function figmaGet(path: string, query?: Record<string, unknown>) {
  return executeProviderApiRequest({
    provider: "figma",
    method: "GET",
    path,
    query,
    maxBytes: 4 * 1024 * 1024,
  });
}

export interface FigmaFileDepthNode {
  id?: string;
  name?: string;
  type?: string;
  children?: FigmaFileDepthNode[];
  characters?: string;
}

/**
 * Fetches the file's page/frame structure at a given `depth` (cheap: no
 * geometry, just ids/names/types/children/characters). `depth=2` returns
 * pages + their direct children (top-level frames) — used to find a default
 * frame when no node-id is given. `depth=3` additionally returns each top
 * frame's direct children — used by the clipboard matcher to read visible
 * text for heuristic matching.
 */
export async function fetchFileStructure(
  fileKey: string,
  depth: number,
): Promise<FigmaFileDepthNode> {
  const envelope = await figmaGet(`/files/${fileKey}`, { depth });
  const json = providerJson(envelope, "file") as {
    document?: FigmaFileDepthNode;
  };
  return json.document ?? {};
}

export async function resolveTargetNodeId(
  fileKey: string,
  nodeId: string | null,
): Promise<string> {
  if (nodeId) return nodeId;

  // No node-id given: find the file's first top-level frame under its first
  // page. depth=2 keeps this cheap (pages + their direct children only, no
  // deep geometry) instead of pulling the entire document tree.
  const document = await fetchFileStructure(fileKey, 2);
  const firstPage = document.children?.[0];
  const firstFrame = firstPage?.children?.find((child) => Boolean(child?.id));
  if (!firstFrame?.id) {
    throw new Error(
      "Could not find a frame to import. Pass a specific node-id or a Figma frame URL with ?node-id=.",
    );
  }
  return firstFrame.id;
}

/**
 * Fetches one or more nodes' full document JSON. Vector `geometry=paths` is
 * intentionally omitted: structural vectors already use rendered-image
 * fallback, while requesting every raw path frequently pushes ordinary frames
 * past the provider response limit. If a multi-selection is still too large,
 * retry it as smaller batches before failing a single oversized node.
 */
export async function fetchFigmaNodes(
  fileKey: string,
  nodeIds: string[],
): Promise<Record<string, FigmaNode>> {
  if (nodeIds.length === 0) return {};
  let json: {
    nodes?: Record<string, { document?: FigmaNode; err?: string } | undefined>;
  };
  try {
    const envelope = await figmaGet(`/files/${fileKey}/nodes`, {
      ids: nodeIds.join(","),
    });
    json = providerJson(envelope, "nodes") as typeof json;
  } catch (error) {
    if (
      nodeIds.length > 1 &&
      /exceeded the safe 4 MB import limit/i.test(
        error instanceof Error ? error.message : String(error),
      )
    ) {
      const midpoint = Math.ceil(nodeIds.length / 2);
      const [left, right] = await Promise.all([
        fetchFigmaNodes(fileKey, nodeIds.slice(0, midpoint)),
        fetchFigmaNodes(fileKey, nodeIds.slice(midpoint)),
      ]);
      return { ...left, ...right };
    }
    throw error;
  }
  const result: Record<string, FigmaNode> = {};
  for (const nodeId of nodeIds) {
    const entry = json.nodes?.[nodeId];
    if (!entry) {
      throw new Error(
        `Figma node ${nodeId} was not found in file ${fileKey}. Check the node-id and that the token has access to this file.`,
      );
    }
    if (entry.err) {
      throw new Error(
        `Figma returned an error for node ${nodeId}: ${entry.err}`,
      );
    }
    if (!entry.document) {
      throw new Error(`Figma node ${nodeId} had no document payload.`);
    }
    result[nodeId] = entry.document;
  }
  return result;
}

export async function fetchFigmaNode(
  fileKey: string,
  nodeId: string,
): Promise<FigmaNode> {
  const nodes = await fetchFigmaNodes(fileKey, [nodeId]);
  return nodes[nodeId]!;
}

async function fetchFallbackImageUrls(
  fileKey: string,
  nodeIds: string[],
): Promise<Record<string, string>> {
  if (nodeIds.length === 0) return {};
  const batches: string[][] = [];
  let batch: string[] = [];
  let queryChars = 0;
  for (const nodeId of nodeIds) {
    if (nodeId.length > MAX_FIGMA_IMAGE_IDS_QUERY_CHARS) {
      throw new Error("A Figma image fallback node id was unexpectedly long.");
    }
    const addedChars = nodeId.length + (batch.length > 0 ? 1 : 0);
    if (
      batch.length >= MAX_FIGMA_IMAGE_IDS_PER_REQUEST ||
      queryChars + addedChars > MAX_FIGMA_IMAGE_IDS_QUERY_CHARS
    ) {
      batches.push(batch);
      batch = [];
      queryChars = 0;
    }
    batch.push(nodeId);
    queryChars += nodeId.length + (batch.length > 1 ? 1 : 0);
  }
  if (batch.length > 0) batches.push(batch);

  const responses = await mapWithConcurrency(
    batches,
    MAX_CONCURRENT_FIGMA_IMAGE_UPLOADS,
    async (ids) => {
      const envelope = await figmaGet(`/images/${fileKey}`, {
        ids: ids.join(","),
        format: "png",
        scale: 2,
      });
      return providerJson(envelope, "images") as {
        images?: Record<string, string | null | undefined>;
      };
    },
  );
  const result: Record<string, string> = {};
  for (const response of responses) {
    for (const [id, url] of Object.entries(response.images ?? {})) {
      if (typeof url === "string" && url) result[id] = url;
    }
  }
  return result;
}

async function fetchImageFillUrls(
  fileKey: string,
  imageRefs: string[],
): Promise<Record<string, string>> {
  if (imageRefs.length === 0) return {};
  const envelope = await figmaGet(`/files/${fileKey}/images`);
  const json = providerJson(envelope, "image fills") as {
    images?: Record<string, string | null | undefined>;
  };
  const result: Record<string, string> = {};
  for (const ref of imageRefs) {
    const url = json.images?.[ref];
    if (typeof url === "string" && url) result[ref] = url;
  }
  return result;
}

export function sanitizeTitle(
  name: string | undefined,
  fallback: string,
): string {
  const trimmed = name?.trim();
  if (!trimmed) return fallback;
  return (
    trimmed
      .replace(/[^\w. -]+/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 80) || fallback
  );
}

export function summarizeFidelity(entries: FidelityEntry[]) {
  const byLevel = (level: FidelityLevel) =>
    entries
      .filter((entry) => entry.level === level)
      .map((entry) => ({
        nodeId: entry.nodeId,
        nodeName: entry.nodeName,
        nodeType: entry.nodeType,
        notes: entry.notes,
      }));
  return {
    exactCount: entries.filter((entry) => entry.level === "exact").length,
    approximated: byLevel("approximated"),
    imageFallbacks: byLevel("image-fallback"),
  };
}

/**
 * Fetches whatever PNG fallback / image-fill URLs the given nodes need (union
 * across all of them, one request each instead of one per node) and maps
 * every node to an `ImportedDesignFile`. Cascading x-offset placement mirrors
 * `saveImportedDesignFiles`' own frame layout so multiple imported nodes don't
 * land stacked on top of each other before the canvas placement pass runs.
 */
export async function buildScreenFilesFromFigmaNodes(
  fileKey: string,
  nodesById: Record<string, FigmaNode>,
  options: {
    source?: (nodeId: string, node: FigmaNode) => Record<string, unknown>;
    sourceLabel?: (nodeId: string, node: FigmaNode) => string;
  } = {},
): Promise<{ files: ImportedDesignFile[]; fidelityEntries: FidelityEntry[] }> {
  const entries = Object.entries(nodesById);
  const fallbackNodeIds = new Set<string>();
  const imageFillRefs = new Set<string>();
  for (const [, node] of entries) {
    for (const id of collectFallbackNodeIds(node)) fallbackNodeIds.add(id);
    for (const ref of collectImageFillRefs(node)) imageFillRefs.add(ref);
  }
  const imageReferenceCount = fallbackNodeIds.size + imageFillRefs.size;
  if (imageReferenceCount > MAX_FIGMA_IMAGE_REFERENCES) {
    throw new Error(
      `Figma import referenced too many images (${imageReferenceCount}; max ${MAX_FIGMA_IMAGE_REFERENCES}). Import a smaller frame or selection.`,
    );
  }

  const [fallbackImageUrls, imageFillUrls] = await Promise.all([
    fetchFallbackImageUrls(fileKey, Array.from(fallbackNodeIds)),
    fetchImageFillUrls(fileKey, Array.from(imageFillRefs)),
  ]);
  const missingFallbackNodeIds = Array.from(fallbackNodeIds).filter(
    (nodeId) => !fallbackImageUrls[nodeId],
  );
  if (missingFallbackNodeIds.length > 0) {
    throw new Error(
      `Figma could not render ${missingFallbackNodeIds.length} required fallback layer${missingFallbackNodeIds.length === 1 ? "" : "s"} (${missingFallbackNodeIds.slice(0, 5).join(", ")}${missingFallbackNodeIds.length > 5 ? ", …" : ""}). Nothing was imported so the design would not silently lose visible content. Try a smaller selection or retry the import.`,
    );
  }
  const missingImageFillRefs = Array.from(imageFillRefs).filter(
    (imageRef) => !imageFillUrls[imageRef],
  );
  if (missingImageFillRefs.length > 0) {
    throw new Error(
      `Figma did not return ${missingImageFillRefs.length} required image fill${missingImageFillRefs.length === 1 ? "" : "s"}. Nothing was imported so the design would not silently omit imagery. Retry the import or export the affected frame from Figma.`,
    );
  }
  const durableUrls = await mirrorFigmaImageUrls([
    ...Object.values(fallbackImageUrls),
    ...Object.values(imageFillUrls),
  ]);
  for (const [nodeId, url] of Object.entries(fallbackImageUrls)) {
    fallbackImageUrls[nodeId] = durableUrls.get(url)!;
  }
  for (const [imageRef, url] of Object.entries(imageFillUrls)) {
    imageFillUrls[imageRef] = durableUrls.get(url)!;
  }

  const files: ImportedDesignFile[] = [];
  const fidelityEntries: FidelityEntry[] = [];

  for (const [nodeId, node] of entries) {
    const { html, fidelity } = mapFigmaNodeToHtml(node, {
      fallbackImageUrls,
      imageFillUrls,
    });
    fidelityEntries.push(...fidelity.entries);

    const title = sanitizeTitle(
      node.name,
      `figma-${nodeId.replace(/[:;]/g, "-")}`,
    );
    const sourceLabel =
      options.sourceLabel?.(nodeId, node) ??
      `Figma file ${fileKey}, node ${nodeId}`;
    const fontUsage = collectFontUsage(node);
    const content = normalizeImportedHtmlDocument(
      withFigmaFontLoading(
        withFigmaBoxModelReset(html || "<div></div>"),
        fontUsage,
      ),
      sourceLabel,
    );
    files.push({
      filename: `${title}.html`,
      fileType: "html",
      content,
      source: {
        sourceType: "figma-import",
        figmaFileKey: fileKey,
        figmaNodeId: nodeId,
        figmaNodeName: node.name ?? null,
        ...options.source?.(nodeId, node),
      },
      preferredFrame: {
        title: node.name,
        width: node.absoluteBoundingBox?.width,
        height: node.absoluteBoundingBox?.height,
      },
    });
  }

  return { files, fidelityEntries };
}
