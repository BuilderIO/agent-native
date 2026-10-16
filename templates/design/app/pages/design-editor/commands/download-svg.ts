import { normalizeDesignSourceType } from "@shared/source-mode";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { ExportSettingsValue } from "@/components/design/inspector";
import type { ElementInfo } from "@/components/design/types";
import {
  browserDesignExportErrorType,
  trackBrowserDesignExported,
  type BrowserDesignExportContext,
} from "@/lib/design-export-tracking";
import {
  buildStaticForeignObjectSvg,
  stripNonStaticXmlAttributes,
  waitForExportReady,
} from "@/pages/design-editor/export-capture";
import {
  removeEditorChromeOverlays,
  resolveExportCropRect,
  sanitizeSerializedXmlForSvg,
} from "@/pages/design-editor/png-export-render";
import type { DesignData } from "@/pages/design-editor/types";

export interface DownloadSvgArgs {
  activeCanvasSourceType?: "inline" | "localhost" | "fusion";
  design: DesignData | null;
  activePreviewFrameId?: string | null;
  requireContentSizeReport?: boolean;
  exportScreenId?: string | null;
  exportScreenSourceType?: string | null;
  /** Join keys for the `design_exported` this command reports. */
  exportTracking?: BrowserDesignExportContext;
  fallbackExportName: (extension: string, suffix?: string) => string;
  pngExportingRef: RefObject<boolean>;
  prepareScreenForExport?: (screenId: string) => void;
  releaseScreenFromExport?: () => void;
  selectedElement: ElementInfo | null;
  setSvgExporting: Dispatch<SetStateAction<boolean>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  triggerBlobDownload: (blob: Blob, filename: string) => void;
}

const SCREEN_PREVIEW_READY_TIMEOUT_MS = 15_000;

async function waitForSvgExportIframe(args: {
  activeCanvasSourceType?: DownloadSvgArgs["activeCanvasSourceType"];
  activePreviewFrameId?: string | null;
  requireContentSizeReport?: boolean;
  waitForMount: boolean;
  exportScreenSourceType?: string | null;
}): Promise<
  | { kind: "ready"; iframe: HTMLIFrameElement; doc: Document }
  | { kind: "unreadable"; iframe: HTMLIFrameElement }
  | null
> {
  const deadline =
    window.performance.now() +
    (args.waitForMount ? SCREEN_PREVIEW_READY_TIMEOUT_MS : 0);
  while (true) {
    const iframe = resolveSvgExportIframe(
      document.querySelectorAll<HTMLIFrameElement>(
        "iframe[data-screen-iframe-id], iframe[data-design-preview-iframe]",
      ),
      args.activePreviewFrameId,
    );
    if (iframe?.isConnected) {
      let doc: Document | null = null;
      try {
        doc = iframe.contentDocument;
      } catch {
        return { kind: "unreadable", iframe };
      }
      if (!doc) return { kind: "unreadable", iframe };
      if (!doc.documentElement && doc.readyState === "complete") {
        return { kind: "unreadable", iframe };
      }
      const sourceType =
        normalizeDesignSourceType(
          iframe.dataset.designSourceType ?? args.exportScreenSourceType,
        ) ??
        args.activeCanvasSourceType ??
        "inline";
      const isInitialExternalDocument =
        sourceType !== "inline" && doc.URL === "about:blank";
      if (!args.waitForMount && !isInitialExternalDocument) {
        return { kind: "ready", iframe, doc };
      }
      const bridgeWindow = doc?.defaultView as
        | (Window & { __agentNativeContentSizeReport?: boolean })
        | null;
      if (
        !isInitialExternalDocument &&
        doc?.readyState === "complete" &&
        (sourceType !== "inline" ||
          args.requireContentSizeReport !== true ||
          bridgeWindow?.__agentNativeContentSizeReport === true)
      ) {
        return { kind: "ready", iframe, doc };
      }
    }
    if (window.performance.now() >= deadline) {
      return null;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
  }
}

export function resolveSvgExportIframe<
  T extends { getAttribute(name: string): string | null },
>(iframes: Iterable<T>, activePreviewFrameId?: string | null): T | null {
  const candidates = Array.from(iframes);
  if (activePreviewFrameId != null) {
    return (
      candidates.find(
        (iframe) =>
          iframe.getAttribute("data-screen-iframe-id") === activePreviewFrameId,
      ) ?? null
    );
  }
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

export async function runDownloadSvg(
  {
    activeCanvasSourceType,
    activePreviewFrameId,
    design,
    exportTracking,
    exportScreenId,
    exportScreenSourceType,
    requireContentSizeReport,
    fallbackExportName,
    pngExportingRef,
    prepareScreenForExport,
    releaseScreenFromExport,
    selectedElement,
    setSvgExporting,
    t,
    triggerBlobDownload,
  }: DownloadSvgArgs,
  settings?: Partial<ExportSettingsValue>,
) {
  if (pngExportingRef.current) {
    toast.error(t("designEditor.toasts.exportBusy"));
    return;
  }
  pngExportingRef.current = true;
  let preparedScreen = false;
  try {
    setSvgExporting(true);
    if (exportScreenId && prepareScreenForExport) {
      preparedScreen = true;
      prepareScreenForExport(exportScreenId);
    }
    const iframe = await waitForSvgExportIframe({
      activeCanvasSourceType,
      activePreviewFrameId,
      requireContentSizeReport,
      waitForMount: Boolean(exportScreenId),
      exportScreenSourceType,
    });
    if (!iframe) {
      trackBrowserDesignExported("svg", {
        ...exportTracking,
        status: "failed",
        errorType: "no_preview",
      });
      toast.error(t("designEditor.toasts.openScreenSvg"));
      return;
    }
    if (iframe.kind === "unreadable") {
      trackBrowserDesignExported("svg", {
        ...exportTracking,
        status: "failed",
        errorType: "export_error",
      });
      toast.error(t("designEditor.toasts.svgExportError"));
      return;
    }
    const { iframe: previewIframe, doc } = iframe;
    await waitForExportReady(doc);
    const width = Math.max(
      doc.documentElement.scrollWidth,
      doc.body?.scrollWidth ?? 0,
      previewIframe.clientWidth,
    );
    const height = Math.max(
      doc.documentElement.scrollHeight,
      doc.body?.scrollHeight ?? 0,
      previewIframe.clientHeight,
    );
    const clone = doc.documentElement.cloneNode(true) as HTMLElement;
    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    const stylesheetLinks = Array.from(
      doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]'),
    );
    const clonedStylesheetLinks = Array.from(
      clone.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]'),
    );
    const stylesheets = Array.from(doc.styleSheets);

    stylesheetLinks.forEach((link, index) => {
      const sheet = stylesheets.find(
        (candidate) =>
          (candidate as StyleSheet & { ownerNode?: Node | null }).ownerNode ===
          link,
      ) as CSSStyleSheet | undefined;
      let cssText = "";
      try {
        cssText = Array.from(sheet?.cssRules ?? [])
          .map((rule) => rule.cssText)
          .join("\n");
      } catch {
        return;
      }
      if (!cssText.trim()) return;
      const style = doc.createElement("style");
      style.setAttribute(
        "data-agent-native-inlined-stylesheet",
        link.getAttribute("href") ?? "",
      );
      style.textContent = cssText;
      clonedStylesheetLinks[index]?.replaceWith(style);
    });
    clone.querySelectorAll("script").forEach((node) => node.remove());
    removeEditorChromeOverlays(clone);
    stripNonStaticXmlAttributes(clone);
    clone.style.width = `${width}px`;
    clone.style.minHeight = `${height}px`;

    const body = clone.querySelector("body") as HTMLElement | null;
    if (body) {
      body.style.margin = body.style.margin || "0";
      body.style.width = `${width}px`;
      body.style.minHeight = `${height}px`;
    }

    const serializedHtml = sanitizeSerializedXmlForSvg(
      new XMLSerializer().serializeToString(clone),
    );
    const safeTitle =
      design?.title
        ?.replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;") || t("designEditor.designExport");
    const exportScale = Math.max(0.1, Math.min(4, settings?.scale ?? 1));
    const cropRect = resolveExportCropRect(doc, selectedElement);
    const svg = buildStaticForeignObjectSvg({
      documentWidth: width,
      documentHeight: height,
      cropRect,
      scale: exportScale,
      safeTitle,
      serializedHtml,
    });

    triggerBlobDownload(
      new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
      fallbackExportName("svg", settings?.suffix),
    );
    toast.success(t("designEditor.toasts.svgDownloaded"));
    trackBrowserDesignExported("svg", {
      ...exportTracking,
      status: "completed",
    });
  } catch (error) {
    trackBrowserDesignExported("svg", {
      ...exportTracking,
      status: "failed",
      errorType: browserDesignExportErrorType(error),
    });
    console.error("SVG export failed:", error);
    toast.error(
      error instanceof Error
        ? error.message
        : t("designEditor.toasts.svgExportError"),
    );
  } finally {
    try {
      if (preparedScreen) releaseScreenFromExport?.();
    } finally {
      try {
        pngExportingRef.current = false;
      } finally {
        setSvgExporting(false);
      }
    }
  }
}
