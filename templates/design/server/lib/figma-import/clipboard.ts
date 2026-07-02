import type { FigmaClipboardMeta, ParsedFigmaClipboardHtml } from "./types.js";

const MAX_CLIPBOARD_HTML_BYTES = 2 * 1024 * 1024;
const MAX_DECODED_BUFFER_BYTES = 25 * 1024 * 1024;
const FIG_KIWI_MAGIC = Buffer.from("fig-kiwi", "utf8");

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function stripWrapper(value: string, marker: "figmeta" | "figma"): string {
  return value
    .trim()
    .replace(new RegExp(`^<!--\\(${marker}\\)`, "i"), "")
    .replace(new RegExp(`\\(/${marker}\\)-->$`, "i"), "")
    .trim();
}

function decodeBase64(value: string, label: string): Buffer {
  const normalized = value.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error(`${label} is not valid base64.`);
  }
  const decoded = Buffer.from(normalized, "base64");
  const roundTrip = decoded.toString("base64").replace(/=+$/, "");
  if (roundTrip !== normalized.replace(/=+$/, "")) {
    throw new Error(`${label} is malformed base64.`);
  }
  return decoded;
}

function extractDataAttribute(html: string, attribute: string): string | null {
  const pattern = new RegExp(`${attribute}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i");
  const match = pattern.exec(html);
  return match?.[2] ?? null;
}

function removeFigmaHiddenSpans(html: string): string {
  return html
    .replace(
      /<span\b[^>]*\bdata-metadata\s*=\s*(["'])[\s\S]*?\1[^>]*>\s*<\/span>/gi,
      "",
    )
    .replace(
      /<span\b[^>]*\bdata-buffer\s*=\s*(["'])[\s\S]*?\1[^>]*>\s*<\/span>/gi,
      "",
    )
    .replace(/<meta\b[^>]*charset[^>]*>/gi, "")
    .trim();
}

function normalizeMeta(value: unknown): FigmaClipboardMeta {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const selectedNodeData =
    typeof raw.selectedNodeData === "string" ? raw.selectedNodeData : undefined;
  const selectedNodeId = selectedNodeData?.split("|")[0]?.trim() || undefined;
  return {
    fileKey: typeof raw.fileKey === "string" ? raw.fileKey : undefined,
    pasteID:
      typeof raw.pasteID === "string" || typeof raw.pasteID === "number"
        ? raw.pasteID
        : undefined,
    dataType: typeof raw.dataType === "string" ? raw.dataType : undefined,
    environment:
      typeof raw.environment === "string" ? raw.environment : undefined,
    selectedNodeData,
    selectedNodeId,
    raw,
  };
}

export function looksLikeFigmaClipboardHtml(html: string): boolean {
  return /\(figmeta\)|\(figma\)|data-metadata=|data-buffer=/i.test(html);
}

export function parseFigmaClipboardHtml(
  html: string,
): ParsedFigmaClipboardHtml {
  if (byteLength(html) > MAX_CLIPBOARD_HTML_BYTES) {
    throw new Error("Clipboard HTML is too large to import (max 2 MB).");
  }

  const metadataAttr = extractDataAttribute(html, "data-metadata");
  const bufferAttr = extractDataAttribute(html, "data-buffer");
  const fallbackHtml = removeFigmaHiddenSpans(html);

  let meta: FigmaClipboardMeta | null = null;
  if (metadataAttr) {
    const metadataBase64 = stripWrapper(metadataAttr, "figmeta");
    const metadataJson = decodeBase64(
      metadataBase64,
      "Figma metadata",
    ).toString("utf8");
    meta = normalizeMeta(JSON.parse(metadataJson));
  }

  let buffer: Buffer | undefined;
  if (bufferAttr) {
    const bufferBase64 = stripWrapper(bufferAttr, "figma");
    buffer = decodeBase64(bufferBase64, "Figma buffer");
    if (buffer.length > MAX_DECODED_BUFFER_BYTES) {
      throw new Error(
        "Figma clipboard buffer is too large to import (max 25 MB).",
      );
    }
  }

  const hasFigmaBuffer =
    !!buffer &&
    buffer.length >= FIG_KIWI_MAGIC.length &&
    buffer.subarray(0, FIG_KIWI_MAGIC.length).equals(FIG_KIWI_MAGIC);

  return {
    meta,
    buffer,
    hasFigmaBuffer,
    fallbackHtml: fallbackHtml || undefined,
  };
}
