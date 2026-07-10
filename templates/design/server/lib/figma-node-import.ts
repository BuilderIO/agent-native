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

import {
  collectFallbackNodeIds,
  collectImageFillRefs,
  mapFigmaNodeToHtml,
  type FidelityEntry,
  type FidelityLevel,
  type FigmaNode,
} from "./figma-node-to-html.js";
import {
  normalizeImportedHtmlDocument,
  type ImportedDesignFile,
} from "./import-design-files.js";
import { executeProviderApiRequest } from "./provider-api.js";

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
function withFigmaBoxModelReset(html: string): string {
  return `<style>*,*::before,*::after{box-sizing:border-box;}body{margin:0;}</style>\n${html}`;
}

type FigmaProviderEnvelope = {
  response?: {
    ok?: boolean;
    status?: number;
    statusText?: string;
    json?: unknown;
    text?: string;
  };
};

export function providerJson(envelope: unknown, label: string): unknown {
  const response = (envelope as FigmaProviderEnvelope | null)?.response;
  if (!response) throw new Error(`Figma ${label} response was empty.`);
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
    maxBytes: 8 * 1024 * 1024,
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
 * Fetches one or more nodes' full document JSON (with vector path geometry)
 * in a single request — the Figma nodes endpoint accepts a comma-joined
 * `ids` list. Throws immediately on the first node id that is missing,
 * errored, or has no document payload, naming that specific node id.
 */
export async function fetchFigmaNodes(
  fileKey: string,
  nodeIds: string[],
): Promise<Record<string, FigmaNode>> {
  if (nodeIds.length === 0) return {};
  const envelope = await figmaGet(`/files/${fileKey}/nodes`, {
    ids: nodeIds.join(","),
    geometry: "paths",
  });
  const json = providerJson(envelope, "nodes") as {
    nodes?: Record<string, { document?: FigmaNode; err?: string } | undefined>;
  };
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
  const envelope = await figmaGet(`/images/${fileKey}`, {
    ids: nodeIds.join(","),
    format: "png",
    scale: 2,
  });
  const json = providerJson(envelope, "images") as {
    images?: Record<string, string | null | undefined>;
  };
  const result: Record<string, string> = {};
  for (const [id, url] of Object.entries(json.images ?? {})) {
    if (typeof url === "string" && url) result[id] = url;
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

  const [fallbackImageUrls, imageFillUrls] = await Promise.all([
    fetchFallbackImageUrls(fileKey, Array.from(fallbackNodeIds)),
    fetchImageFillUrls(fileKey, Array.from(imageFillRefs)),
  ]);

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
    const content = normalizeImportedHtmlDocument(
      withFigmaBoxModelReset(html || "<div></div>"),
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
