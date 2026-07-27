/**
 * Local kiwi decode path for Figma clipboard pastes.
 *
 * When no Figma access token is configured, a clipboard paste still carries
 * the full fig-kiwi binary buffer: geometry, auto-layout, text, fills, and
 * effects are all present in the kiwi message. This module decodes that
 * buffer locally using the same decoder as the .fig upload path, synthesizes
 * an editable HTML screen per top-level frame, and annotates IMAGE fill
 * elements with `data-figma-image-ref` attributes so that a later call to
 * `hydrate-figma-paste-images` can fill them in once the user connects their
 * Figma access token.
 *
 * Images are NOT available in the clipboard buffer — Figma stores image bytes
 * server-side and only includes a 20-byte SHA-1 hash in the kiwi message.
 * Elements with image fills render as `about:blank` placeholders until
 * `hydrate-figma-paste-images` resolves and mirrors the real URLs.
 */

import { assertSafeDecodedFigDocument, decodeFig } from "./fig-file-decoder.js";
import {
  type FigNode,
  type Guid,
  guidKey,
  renderHtmlTemplates,
} from "./fig-file-to-html.js";
import {
  normalizeImportedHtmlDocument,
  type ImportedDesignFile,
} from "./import-design-files.js";

// 8 MB binary cap. Above this the caller should use an upload handle; below
// it the action payload carries the base64 directly.
const MAX_CLIPBOARD_BUFFER_BYTES = 8 * 1024 * 1024;

const MAX_CLIPBOARD_NODES = 75_000;
const MAX_CLIPBOARD_FRAMES = 50;
const MAX_FRAME_HTML_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_HTML_BYTES = 24 * 1024 * 1024;

export interface ClipboardLocalDecodeResult {
  files: ImportedDesignFile[];
  warnings: string[];
  unresolvedImageRefs: string[];
  stats: {
    sourceKind: "figma-clipboard-local-kiwi";
    format: "kiwi" | "zip";
    version?: number;
    frameCount: number;
    nodeCount: number;
    unresolvedImageCount: number;
  };
}

/**
 * Return the `guidKey` string for all nodes whose parentIndex.guid does not
 * point to any other node in the flat nodeChanges list. These are the "roots"
 * that need a synthetic CANVAS parent so `renderHtmlTemplates` can traverse
 * the hierarchy starting from its expected DOCUMENT→CANVAS→FRAME structure.
 */
function findOrphanRoots(nodeChanges: FigNode[]): FigNode[] {
  const ownKeys = new Set(nodeChanges.map((n) => guidKey(n.guid)));
  return nodeChanges.filter((n) => {
    const pk = guidKey(n.parentIndex?.guid);
    return !pk || !ownKeys.has(pk);
  });
}

/**
 * Wrap an orphaned nodeChanges array (clipboard format: selected subtree
 * without a DOCUMENT/CANVAS container) in synthetic DOCUMENT and CANVAS
 * nodes so `renderHtmlTemplates` can find the top-level frame hierarchy.
 *
 * The synthetic node GUIDs use `sessionID = maxExisting + 1` to guarantee
 * no collision with real clipboard node GUIDs.
 */
function normalizeClipboardDocument(document: unknown): unknown {
  const doc = document as {
    nodeChanges?: FigNode[];
    blobs?: unknown[];
  };
  const nodeChanges = doc.nodeChanges;
  if (!Array.isArray(nodeChanges)) return document;

  // Already has a DOCUMENT node → renderer can handle it as-is.
  if (nodeChanges.some((n) => n.type === "DOCUMENT")) return document;

  const maxSession = nodeChanges.reduce(
    (m, n) => Math.max(m, n.guid?.sessionID ?? 0),
    0,
  );
  const synBase = maxSession + 1;
  const docGuid: Guid = { sessionID: synBase, localID: 0 };
  const pageGuid: Guid = { sessionID: synBase, localID: 1 };

  const orphans = findOrphanRoots(nodeChanges);

  const documentNode: FigNode = {
    guid: docGuid,
    type: "DOCUMENT",
    name: "Document",
  };
  const canvasNode: FigNode = {
    guid: pageGuid,
    type: "CANVAS",
    name: "Clipboard",
    parentIndex: { guid: docGuid, position: "0.5" },
  };

  // Shallow-copy the orphan nodes, pointing their parentIndex to the
  // synthetic CANVAS. Non-orphan nodes keep their original parentIndex.
  const orphanKeys = new Set(orphans.map((n) => guidKey(n.guid)));
  const patchedNodes = nodeChanges.map((n) => {
    if (!orphanKeys.has(guidKey(n.guid))) return n;
    return {
      ...n,
      parentIndex: {
        guid: pageGuid,
        position: n.parentIndex?.position ?? "0.5",
      },
    };
  });

  return {
    ...doc,
    nodeChanges: [documentNode, canvasNode, ...patchedNodes],
  };
}

/**
 * Decode a base64 fig-kiwi clipboard buffer into editable HTML screens.
 *
 * @param options.bufferBase64 - Base64 string of the raw fig-kiwi bytes.
 * @param options.fileKey      - Figma file key from the clipboard's figmeta.
 * @param options.originalName - Human-readable name for warnings/source metadata.
 */
export async function importFigmaClipboardFromBuffer(options: {
  bufferBase64: string;
  fileKey: string;
  originalName?: string;
}): Promise<ClipboardLocalDecodeResult> {
  const { bufferBase64, fileKey, originalName = "figma-paste" } = options;

  // Base64 → binary with cap check.
  const bufferBytes = Buffer.from(bufferBase64, "base64");
  if (bufferBytes.length > MAX_CLIPBOARD_BUFFER_BYTES) {
    throw new Error(
      `Figma clipboard buffer is too large for local decode (max 8 MB). Use a Figma access token for direct REST import instead.`,
    );
  }

  const decoded = decodeFig(bufferBytes);
  assertSafeDecodedFigDocument(decoded.document);

  // Count nodes before synthesis to report against the cap.
  const rawDoc = decoded.document as { nodeChanges?: FigNode[] };
  const nodeCount = rawDoc.nodeChanges?.length ?? 0;
  if (nodeCount > MAX_CLIPBOARD_NODES) {
    throw new Error(
      `Figma clipboard has too many nodes (${nodeCount}; max ${MAX_CLIPBOARD_NODES}). Import a smaller selection.`,
    );
  }

  const normalizedDoc = normalizeClipboardDocument(decoded.document);

  // Empty imageMap so all IMAGE fills are treated as unresolved. The renderer
  // will stamp data-figma-image-ref on affected elements via trackUnresolvedImageRefs.
  const rendered = renderHtmlTemplates(normalizedDoc, {
    imageMap: new Map(),
    missingImageUrl: "about:blank",
    trackUnresolvedImageRefs: true,
    maxFrames: MAX_CLIPBOARD_FRAMES,
    maxFrameOutputBytes: MAX_FRAME_HTML_BYTES,
    maxTotalOutputBytes: MAX_TOTAL_HTML_BYTES,
  });

  if (rendered.frames.length === 0) {
    throw new Error(
      "No editable frames were found in the Figma clipboard. Copy a top-level frame before pasting.",
    );
  }

  const unresolvedRefs = Array.from(rendered.unresolvedImageRefs ?? []);

  let totalHtmlBytes = 0;
  const files: ImportedDesignFile[] = rendered.frames.map((frame) => {
    const content = normalizeImportedHtmlDocument(
      frame.html,
      `figma clipboard local-kiwi decode ${originalName}`,
    );
    const htmlBytes = Buffer.byteLength(content, "utf8");
    totalHtmlBytes += htmlBytes;
    if (totalHtmlBytes > MAX_TOTAL_HTML_BYTES) {
      throw new Error(
        "Figma clipboard import generated too much HTML (max 24 MB). Import a smaller selection.",
      );
    }
    return {
      filename: frame.fileName,
      fileType: "html" as const,
      content,
      source: {
        sourceType: "figma-clipboard-local-kiwi",
        figmaFileKey: fileKey,
        figmaNodeName: frame.frameName,
        figFormat: decoded.format,
        figVersion: decoded.version,
        unresolvedImageRefs:
          unresolvedRefs.length > 0 ? unresolvedRefs : undefined,
      },
      preferredFrame: {
        title: frame.frameName,
        width: frame.width,
        height: frame.height,
      },
    } satisfies ImportedDesignFile;
  });

  const warnings: string[] = [];
  if (unresolvedRefs.length > 0) {
    warnings.push(
      `${unresolvedRefs.length} image${unresolvedRefs.length === 1 ? "" : "s"} could not be loaded without a Figma access token. Connect Figma to fill them in.`,
    );
  }

  return {
    files,
    warnings,
    unresolvedImageRefs: unresolvedRefs,
    stats: {
      sourceKind: "figma-clipboard-local-kiwi",
      format: decoded.format,
      version: decoded.version,
      frameCount: rendered.frames.length,
      nodeCount,
      unresolvedImageCount: unresolvedRefs.length,
    },
  };
}
