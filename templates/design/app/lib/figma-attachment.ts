import { callAction } from "@agent-native/core/client/hooks";
import type { FigmaReferenceFrame } from "@shared/figma-reference";

import {
  browserImageUploader,
  browserImportId,
  completeFigInBrowser,
  prepareFigImport,
  type PreparedFigImport,
} from "@/lib/fig-client-import";
import {
  extractFigmeta,
  resolveFigmaPasteImportCall,
} from "@/lib/figma-clipboard";

const FIGMA_REFERENCE_KEY_PREFIX = "figma-reference:";

/** Keeps one attachment's frames from crowding out the rest of the prompt. */
export const FIGMA_REFERENCE_CONTEXT_BUDGET = 60_000;

/**
 * A .fig is decoded in the browser with no progress shown; past this size
 * that takes minutes, so a link (decoded by Figma) is the better route.
 */
export const MAX_FIG_REFERENCE_FILE_BYTES = 50 * 1024 * 1024;

export type FigmaReferenceSource =
  | { kind: "clipboard"; html: string }
  | { kind: "file"; file: File };

export type { FigmaReferenceFrame };

export interface FigmaReference {
  frames: FigmaReferenceFrame[];
  /** Frames in the source, including any left out of `frames`. */
  frameCount: number;
  unresolvedImages: number;
  /** Attachment ref that `place-figma-frames` places exactly. */
  ref: string;
}

export function isFigmaReferenceKey(key: string): boolean {
  return key.startsWith(FIGMA_REFERENCE_KEY_PREFIX);
}

/**
 * New-design generation tells the agent to write a fresh screen, which wins
 * over the attachment's own context unless the run is told otherwise.
 */
export const FIGMA_REFERENCE_GENERATION_DIRECTIVE =
  "A Figma design is attached as reference. If the request is to make, recreate, or import that design, call `place-figma-frames` with the attachment's ref and this design id instead of `generate-design`; that call is this run's generation step, and you must not retype the frames' HTML. If the request builds something new from it, generate as usual and copy its SVG markup for logos, icons, and other vectors verbatim; never redraw a vector with CSS shapes or new paths.";

/**
 * Figma puts the copied scene on the HTML clipboard: a figmeta marker plus the
 * encoded document. Plain text or a bare link carries no scene.
 */
export function readFigmaClipboardSource(
  clipboard: Pick<DataTransfer, "getData">,
): { key: string; source: FigmaReferenceSource } | null {
  const html = clipboard.getData("text/html");
  const figmeta = extractFigmeta(html);
  if (!figmeta) return null;
  return {
    key: `${FIGMA_REFERENCE_KEY_PREFIX}clipboard:${figmeta.fileKey}:${figmeta.pasteID ?? Date.now()}`,
    source: { kind: "clipboard", html },
  };
}

export function figFileReferenceKey(file: File): string {
  return `${FIGMA_REFERENCE_KEY_PREFIX}file:${file.name}:${file.size}:${file.lastModified}`;
}

async function readClipboardReference(
  html: string,
  emptyMessage: string,
): Promise<FigmaReference> {
  const call = resolveFigmaPasteImportCall(html, "figma-paste.html", "missing");
  if (call.action !== "import-figma-clipboard") throw new Error(emptyMessage);
  const {
    figmetaFileKey,
    clipboardHtml,
    clipboardBuffer,
    clipboardBufferOmittedBytes,
  } = call.payload;
  const result = await callAction("read-figma-clipboard", {
    figmetaFileKey,
    clipboardHtml,
    ...(clipboardBuffer ? { clipboardBuffer } : {}),
    ...(clipboardBufferOmittedBytes ? { clipboardBufferOmittedBytes } : {}),
  });
  return {
    frames: result.frames,
    frameCount: result.frames.length,
    unresolvedImages: result.unresolvedImages,
    ref: result.ref,
  };
}

/**
 * Frame HTML is verbose and compresses about tenfold; sent raw, a large file
 * outgrows the request size hosted functions accept.
 */
async function gzipBase64(text: string): Promise<string> {
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

async function readFileReference(file: File): Promise<FigmaReference> {
  const prepared = await prepareFigImport(file);
  let rendered: Awaited<ReturnType<PreparedFigImport["render"]>>;
  try {
    rendered = await prepared.render(
      new Set(prepared.summary.pages.map((page) => page.id)),
    );
  } finally {
    prepared.dispose();
  }
  const converted = await completeFigInBrowser(
    rendered,
    file.name,
    browserImageUploader(browserImportId()),
  );
  const frames: FigmaReferenceFrame[] = converted.files.map((screen) => {
    const title = screen.preferredFrame?.title ?? screen.filename;
    const page = screen.source?.figPageName;
    return {
      name: typeof page === "string" && page ? `${page} / ${title}` : title,
      ...(screen.preferredFrame?.width !== undefined
        ? { width: screen.preferredFrame.width }
        : {}),
      ...(screen.preferredFrame?.height !== undefined
        ? { height: screen.preferredFrame.height }
        : {}),
      html: screen.content,
    };
  });
  const payload = {
    frames,
    frameCount: Math.max(prepared.summary.frameCount, frames.length),
    unresolvedImages:
      converted.stats.unresolvedImageRefCount +
      rendered.skippedEmbeddedImageCount,
  };
  if (!frames.length) {
    await converted.cleanup?.();
    return { ...payload, ref: "" };
  }
  try {
    const { ref } = await callAction("stage-figma-reference", {
      payloadGzipBase64: await gzipBase64(JSON.stringify(payload)),
    });
    await converted.finalize?.();
    return { ...payload, ref };
  } catch (error) {
    await converted.cleanup?.();
    throw error;
  }
}

/** Decodes a copied selection or a .fig into frames, saving nothing. */
export async function readFigmaReference(
  source: FigmaReferenceSource,
  emptyMessage: string,
): Promise<FigmaReference> {
  const reference =
    source.kind === "clipboard"
      ? await readClipboardReference(source.html, emptyMessage)
      : await readFileReference(source.file);
  if (!reference.frames.length) throw new Error(emptyMessage);
  return reference;
}

function frameLabel(frame: FigmaReferenceFrame, index: number): string {
  const size =
    frame.width !== undefined && frame.height !== undefined
      ? ` (${Math.round(frame.width)}×${Math.round(frame.height)})`
      : "";
  return `"${frame.name ?? `Frame ${index + 1}`}"${size}`;
}

/**
 * The agent's view of an attachment: reference material, never a canvas
 * change. Frames past the budget are still named so the agent knows of them.
 */
export function figmaReferenceContext(
  reference: FigmaReference,
  sourceLabel: string,
): string {
  const parts = [
    `The user attached a Figma design as reference: ${sourceLabel}, ${reference.frameCount} frame${reference.frameCount === 1 ? "" : "s"}, decoded from Figma with layout, text, and styles as HTML.`,
    "Use it as reference for the request, and do not put it on the canvas unless the request asks for that.",
    `To make, recreate, or import this design, call place-figma-frames with ref "${reference.ref}" (frames are numbered as below; omit frames to place all). It saves each frame exactly. Never retype a frame's HTML yourself: it is too long to copy and comes out truncated.`,
    "When building something new from it, copy its SVG markup for logos, icons, and other vectors verbatim; never redraw a vector with CSS shapes or new paths.",
  ];
  if (reference.unresolvedImages > 0) {
    parts.push(
      `${reference.unresolvedImages} image fill(s) did not come through and render as placeholders.`,
    );
  }
  let used = parts.join("\n\n").length;
  const omitted: string[] = [];
  reference.frames.forEach((frame, index) => {
    const block = `## Frame ${index + 1}: ${frameLabel(frame, index)}\n\`\`\`html\n${frame.html}\n\`\`\``;
    if (used + block.length + 2 > FIGMA_REFERENCE_CONTEXT_BUDGET) {
      omitted.push(frameLabel(frame, index));
      return;
    }
    parts.push(block);
    used += block.length + 2;
  });
  if (omitted.length) {
    parts.push(
      `These frames are attached too, and place-figma-frames places them like the rest; their HTML is left out here to keep the prompt short: ${omitted.join(", ")}.`,
    );
  }
  const undecoded = reference.frameCount - reference.frames.length;
  if (undecoded > 0) {
    parts.push(
      `${undecoded} frame${undecoded === 1 ? "" : "s"} in the file could not be decoded and ${undecoded === 1 ? "is" : "are"} not attached.`,
    );
  }
  return parts.join("\n\n");
}
