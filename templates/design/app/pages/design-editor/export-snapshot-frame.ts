import type { RuntimeLayerSnapshotReadiness } from "@/components/design/DesignCanvas";

import type { RuntimeLayerSnapshot } from "./command-types";
import { PngCaptureError } from "./png-export-render";

export interface ExportSnapshotSource {
  html: string;
  baseUrl: string;
}

export function isCurrentRuntimeLayerSnapshot(
  snapshot: RuntimeLayerSnapshot | undefined,
  readiness: RuntimeLayerSnapshotReadiness | undefined,
): boolean {
  return Boolean(
    snapshot?.documentId &&
    readiness?.status === "ready" &&
    readiness.documentId === snapshot.documentId,
  );
}

export interface ExportSnapshotFrame {
  doc: Document;
  iframe: HTMLIFrameElement;
  dispose: () => void;
}

export interface ExportCaptureTarget {
  doc: Document | null;
  iframe: HTMLIFrameElement;
  snapshotSource?: ExportSnapshotSource;
  snapshotWidth?: number;
  snapshotHeight?: number;
}

const SNAPSHOT_FRAME_LOAD_TIMEOUT_MS = 10_000;

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function addExportSnapshotBaseUrl(
  html: string,
  baseUrl: string,
): string {
  const parsedBaseUrl = new URL(baseUrl);
  if (
    parsedBaseUrl.protocol !== "http:" &&
    parsedBaseUrl.protocol !== "https:"
  ) {
    throw new PngCaptureError("blob-failed");
  }

  const base = `<base href="${escapeAttribute(parsedBaseUrl.toString())}">`;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (head) => `${head}${base}`);
  }
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(
      /<html\b[^>]*>/i,
      (root) => `${root}<head>${base}</head>`,
    );
  }
  return `<!doctype html><html><head>${base}</head><body>${html}</body></html>`;
}

export async function createExportSnapshotFrame(args: {
  source: ExportSnapshotSource;
  width: number;
  height: number;
  ownerDocument?: Document;
}): Promise<ExportSnapshotFrame> {
  const ownerDocument = args.ownerDocument ?? document;
  const iframe = ownerDocument.createElement("iframe");
  const width = Math.max(1, Math.round(args.width));
  const height = Math.max(1, Math.round(args.height));
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  iframe.setAttribute("sandbox", "allow-same-origin");
  iframe.style.cssText = [
    "position:fixed",
    "left:-100000px",
    "top:0",
    `width:${width}px`,
    `height:${height}px`,
    "border:0",
    "pointer-events:none",
  ].join(";");

  let timeoutId: number | undefined;
  const ready = new Promise<Document>((resolve, reject) => {
    const onLoad = () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      const doc = iframe.contentDocument;
      if (!doc?.documentElement) {
        reject(new PngCaptureError("blob-failed"));
        return;
      }
      resolve(doc);
    };
    iframe.addEventListener("load", onLoad, { once: true });
    timeoutId = window.setTimeout(() => {
      iframe.removeEventListener("load", onLoad);
      reject(new PngCaptureError("blob-failed"));
    }, SNAPSHOT_FRAME_LOAD_TIMEOUT_MS);
  });

  try {
    iframe.srcdoc = addExportSnapshotBaseUrl(
      args.source.html,
      args.source.baseUrl,
    );
    ownerDocument.body.appendChild(iframe);
    const doc = await ready;
    return {
      doc,
      iframe,
      dispose: () => iframe.remove(),
    };
  } catch (error) {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    iframe.remove();
    throw error;
  }
}

export async function prepareExportCaptureTarget(
  target: ExportCaptureTarget,
): Promise<ExportSnapshotFrame> {
  if (target.doc) {
    return { doc: target.doc, iframe: target.iframe, dispose: () => {} };
  }
  if (!target.snapshotSource) {
    throw new PngCaptureError("external-preview");
  }
  return createExportSnapshotFrame({
    source: target.snapshotSource,
    width: target.snapshotWidth ?? target.iframe.clientWidth,
    height: target.snapshotHeight ?? target.iframe.clientHeight,
  });
}
