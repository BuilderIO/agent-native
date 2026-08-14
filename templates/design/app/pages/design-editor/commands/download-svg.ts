import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";

import type { ExportSettingsValue } from "@/components/design/inspector";
import type { ElementInfo } from "@/components/design/types";
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
  design: DesignData | null;
  fallbackExportName: (extension: string, suffix?: string) => string;
  selectedElement: ElementInfo | null;
  setSvgExporting: Dispatch<SetStateAction<boolean>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  triggerBlobDownload: (blob: Blob, filename: string) => void;
}

export async function runDownloadSvg(
  {
    design,
    fallbackExportName,
    selectedElement,
    setSvgExporting,
    t,
    triggerBlobDownload,
  }: DownloadSvgArgs,
  settings?: Partial<ExportSettingsValue>,
) {
  const iframe = document.querySelector<HTMLIFrameElement>(
    "iframe[data-design-preview-iframe]",
  );
  const doc = iframe?.contentDocument;
  if (!doc?.documentElement) {
    toast.error(t("designEditor.toasts.openScreenSvg"));
    return;
  }

  setSvgExporting(true);
  try {
    // Same readiness race as the PNG path (see waitForExportReady):
    // without this, an SVG downloaded right after a screen loads inlines
    // whatever partial/empty CSSOM exists at that instant, producing an
    // unstyled export for no reason a user could tell from the UI.
    await waitForExportReady(doc);
    const width = Math.max(
      doc.documentElement.scrollWidth,
      doc.body?.scrollWidth ?? 0,
      iframe?.clientWidth ?? 0,
    );
    const height = Math.max(
      doc.documentElement.scrollHeight,
      doc.body?.scrollHeight ?? 0,
      iframe?.clientHeight ?? 0,
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
        // Cross-origin stylesheets cannot be read. Leave the original link in
        // place instead of failing the whole export.
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
    // Strip the editor's selection outline / handles so the SVG shows only
    // the design, not the editor chrome.
    removeEditorChromeOverlays(clone);
    // The live DOM can contain Alpine/Vue-style directive attributes such
    // as `@click`, `:class`, and `x-bind:class`. They are valid HTML but
    // invalid/unbound XML names, and the old serializer emitted a download
    // that xmllint/Figma rejected at the first directive. This is a static
    // snapshot (scripts are removed just above), so strip executable and
    // otherwise XML-unsafe attributes from the clone before serialization.
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
    // When an element is selected, crop to just that frame by narrowing the
    // SVG viewBox to its document-space rect. The foreignObject still holds
    // the full document so layout and inherited styles stay intact; the
    // viewBox clips the visible region to the selection.
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
  } catch (error) {
    console.error("SVG export failed:", error);
    toast.error(
      error instanceof Error
        ? error.message
        : t("designEditor.toasts.svgExportError"),
    );
  } finally {
    setSvgExporting(false);
  }
}
