import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import {
  browserDesignExportErrorType,
  trackBrowserDesignExported,
  type BrowserDesignExportContext,
} from "@/lib/design-export-tracking";
import {
  canCopyPngToClipboard,
  copyPngPromiseToClipboard,
  PngClipboardError,
} from "@/lib/png-clipboard";
import type { PngCaptureScope } from "@/pages/design-editor/png-export-render";

export interface CopyAsPngArgs {
  /** Join keys for the `design_exported` this command reports. */
  exportTracking?: BrowserDesignExportContext;
  pngExportingRef: RefObject<boolean>;
  renderPngBlob: (arg0: { scope: PngCaptureScope }) => Promise<Blob>;
  scope: PngCaptureScope;
  setPngExporting: Dispatch<SetStateAction<boolean>>;
  showRasterCaptureError: (error: unknown, format?: "png" | "pdf") => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export async function runCopyAsPng({
  exportTracking,
  pngExportingRef,
  renderPngBlob,
  scope,
  setPngExporting,
  showRasterCaptureError,
  t,
}: CopyAsPngArgs) {
  if (pngExportingRef.current) return;
  if (!canCopyPngToClipboard()) {
    trackBrowserDesignExported("png_copy", {
      ...exportTracking,
      status: "failed",
      errorType: "unsupported",
    });
    toast.error(t("designEditor.toasts.pngClipboardUnsupported"));
    return;
  }

  pngExportingRef.current = true;
  setPngExporting(true);
  try {
    const pngBlob = renderPngBlob({ scope });
    await copyPngPromiseToClipboard(pngBlob);
    toast.success(t("designEditor.toasts.pngCopied"));
    trackBrowserDesignExported("png_copy", {
      ...exportTracking,
      status: "completed",
    });
  } catch (error) {
    trackBrowserDesignExported("png_copy", {
      ...exportTracking,
      status: "failed",
      errorType: browserDesignExportErrorType(error),
    });
    if (error instanceof PngClipboardError) {
      const key =
        error.code === "blocked"
          ? "designEditor.toasts.pngClipboardBlocked"
          : error.code === "unsupported"
            ? "designEditor.toasts.pngClipboardUnsupported"
            : "designEditor.toasts.pngClipboardWriteError";
      toast.error(t(key));
    } else {
      showRasterCaptureError(error);
    }
  } finally {
    pngExportingRef.current = false;
    setPngExporting(false);
  }
}
