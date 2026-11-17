import { assertSafeDecodedFigDocument, decodeFig } from "./fig-file-decoder.js";
import {
  type FigNode,
  type Guid,
  guidKey,
  renderHtmlTemplates,
} from "./fig-file-to-html.js";
import { MAX_FIG_FRAME_HTML_BYTES } from "./import-limits.js";

export const MAX_CLIPBOARD_BUFFER_BYTES = 8 * 1024 * 1024;
const MAX_CLIPBOARD_NODES = 75_000;
const MAX_CLIPBOARD_FRAMES = 50;
// A frame over the import action's limit would fail the whole paste after the
// decode, so it is rejected here instead.
const MAX_FRAME_HTML_BYTES = MAX_FIG_FRAME_HTML_BYTES;
const MAX_TOTAL_HTML_BYTES = 24 * 1024 * 1024;

export interface DecodedClipboardFrame {
  html: string;
  fileName: string;
  frameName: string;
  width?: number | undefined;
  height?: number | undefined;
  x: number;
  y: number;
  wrapsLooseNode: boolean;
  sourceOffset: { x: number; y: number } | null;
}

export interface DecodedFigmaClipboard {
  frames: DecodedClipboardFrame[];
  warnings: string[];
  unresolvedImageRefs: string[];
  nodeCount: number;
  format: "kiwi" | "zip";
  version?: number | undefined;
}

function findOrphanRoots(nodeChanges: FigNode[]): FigNode[] {
  const ownKeys = new Set(nodeChanges.map((n) => guidKey(n.guid)));
  return nodeChanges.filter((n) => {
    const pk = guidKey(n.parentIndex?.guid);
    return !pk || !ownKeys.has(pk);
  });
}

const TOP_LEVEL_FRAME_TYPES = new Set([
  "FRAME",
  "SYMBOL",
  "INSTANCE",
  "SECTION",
]);

interface NormalizedClipboardDocument {
  document: unknown;
  wrapperKeys: Set<string>;
}

function normalizeClipboardDocument(
  document: unknown,
): NormalizedClipboardDocument {
  const doc = document as {
    nodeChanges?: FigNode[];
    blobs?: unknown[];
  };
  const wrapperKeys = new Set<string>();
  if (!Array.isArray(doc.nodeChanges)) return { document, wrapperKeys };

  const synBase =
    doc.nodeChanges.reduce((m, n) => Math.max(m, n.guid?.sessionID ?? 0), 0) +
    1;
  let nodeChanges = doc.nodeChanges;

  if (!nodeChanges.some((n) => n.type === "DOCUMENT")) {
    const docGuid: Guid = { sessionID: synBase, localID: 0 };
    const pageGuid: Guid = { sessionID: synBase, localID: 1 };
    const orphanKeys = new Set(
      findOrphanRoots(nodeChanges).map((n) => guidKey(n.guid)),
    );
    nodeChanges = [
      { guid: docGuid, type: "DOCUMENT", name: "Document" },
      {
        guid: pageGuid,
        type: "CANVAS",
        name: "Clipboard",
        parentIndex: { guid: docGuid, position: "0.5" },
      },
      ...nodeChanges.map((n) =>
        orphanKeys.has(guidKey(n.guid))
          ? {
              ...n,
              parentIndex: {
                guid: pageGuid,
                position: n.parentIndex?.position ?? "0.5",
              },
            }
          : n,
      ),
    ];
  }

  const pageKeys = new Set(
    nodeChanges
      .filter((n) => n.type === "CANVAS" && !n.internalOnly)
      .map((n) => guidKey(n.guid)),
  );
  const wrappers: FigNode[] = [];
  const patched = nodeChanges.map((n) => {
    if (
      !n.type ||
      n.visible === false ||
      TOP_LEVEL_FRAME_TYPES.has(n.type) ||
      !pageKeys.has(guidKey(n.parentIndex?.guid))
    ) {
      return n;
    }
    const t = n.transform ?? { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
    const w = n.size?.x ?? 0;
    const h = n.size?.y ?? 0;
    const corners = (
      [
        [0, 0],
        [w, 0],
        [0, h],
        [w, h],
      ] as Array<[number, number]>
    ).map(([x, y]) => ({
      x: t.m00 * x + t.m01 * y + t.m02,
      y: t.m10 * x + t.m11 * y + t.m12,
    }));
    const minX = Math.min(...corners.map((c) => c.x));
    const minY = Math.min(...corners.map((c) => c.y));
    const wrapperGuid: Guid = {
      sessionID: synBase,
      localID: 2 + wrappers.length,
    };
    wrappers.push({
      guid: wrapperGuid,
      type: "FRAME",
      ...(n.name !== undefined ? { name: n.name } : {}),
      visible: true,
      opacity: 1,
      ...(n.parentIndex ? { parentIndex: n.parentIndex } : {}),
      size: {
        x: Math.max(...corners.map((c) => c.x)) - minX,
        y: Math.max(...corners.map((c) => c.y)) - minY,
      },
      transform: { m00: 1, m01: 0, m02: minX, m10: 0, m11: 1, m12: minY },
      fillPaints: [],
      frameMaskDisabled: true,
    });
    wrapperKeys.add(guidKey(wrapperGuid));
    return {
      ...n,
      parentIndex: { guid: wrapperGuid, position: "!" },
      transform: { ...t, m02: t.m02 - minX, m12: t.m12 - minY },
    };
  });

  if (wrappers.length === 0) {
    return {
      document:
        nodeChanges === doc.nodeChanges ? document : { ...doc, nodeChanges },
      wrapperKeys,
    };
  }
  return {
    document: { ...doc, nodeChanges: [...patched, ...wrappers] },
    wrapperKeys,
  };
}

/** Pure decode of a Figma clipboard `fig-kiwi` buffer; runs in the browser and on the server. */
export function decodeFigmaClipboardFrames(
  bufferBytes: Uint8Array,
): DecodedFigmaClipboard {
  if (bufferBytes.length > MAX_CLIPBOARD_BUFFER_BYTES) {
    throw new Error(
      `Figma clipboard buffer is too large for local decode (max 8 MB). Use a Figma access token for direct REST import instead.`,
    );
  }

  const decoded = decodeFig(bufferBytes);
  assertSafeDecodedFigDocument(decoded.document);

  const rawDoc = decoded.document as { nodeChanges?: FigNode[] };
  const nodeCount = rawDoc.nodeChanges?.length ?? 0;
  if (nodeCount > MAX_CLIPBOARD_NODES) {
    throw new Error(
      `Figma clipboard has too many nodes (${nodeCount}; max ${MAX_CLIPBOARD_NODES}). Import a smaller selection.`,
    );
  }

  const normalized = normalizeClipboardDocument(decoded.document);
  const rendered = renderHtmlTemplates(normalized.document, {
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

  const unresolvedImageRefs = Array.from(rendered.unresolvedImageRefs ?? []);
  const pasteOffset = (
    decoded.document as { pasteOffset?: { x: number; y: number } }
  ).pasteOffset;
  const frames = rendered.frames.map((frame) => ({
    html: frame.html,
    fileName: frame.fileName,
    frameName: frame.frameName,
    width: frame.width,
    height: frame.height,
    x: frame.x,
    y: frame.y,
    wrapsLooseNode: normalized.wrapperKeys.has(frame.nodeKey),
    sourceOffset: pasteOffset
      ? { x: frame.x - pasteOffset.x, y: frame.y - pasteOffset.y }
      : null,
  }));

  const warnings: string[] = [];
  if (unresolvedImageRefs.length > 0) {
    warnings.push(
      `${unresolvedImageRefs.length} image${unresolvedImageRefs.length === 1 ? "" : "s"} could not be loaded without a Figma access token. Connect Figma to fill them in.`,
    );
  }
  const approximatedByNote = new Map<string, number>();
  for (const entry of rendered.approximatedNodes) {
    for (const note of entry.notes) {
      approximatedByNote.set(note, (approximatedByNote.get(note) ?? 0) + 1);
    }
  }
  for (const [note, count] of approximatedByNote) {
    warnings.push(count === 1 ? note : `${count} nodes: ${note}`);
  }

  return {
    frames,
    warnings,
    unresolvedImageRefs,
    nodeCount,
    format: decoded.format,
    version: decoded.version,
  };
}
