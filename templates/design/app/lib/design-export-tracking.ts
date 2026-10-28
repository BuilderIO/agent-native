import { trackDesignRelay } from "./design-relay-tracking";

/**
 * Exports the editor builds in the browser. HTML, ZIP and the coding handoff
 * are server actions that record their own `design_exported`, so they must
 * never be reported from here too.
 */
export type BrowserDesignExportFormat =
  | "png"
  | "jpg"
  | "webp"
  | "png_copy"
  | "pdf"
  | "pdf_all_screens"
  | "svg"
  | "figma_copy"
  | "figma_download";

export interface BrowserDesignExportContext {
  designId?: string;
  signedIn?: boolean;
}

export function trackBrowserDesignExported(
  exportFormat: BrowserDesignExportFormat,
  facts: BrowserDesignExportContext & {
    status: "completed" | "failed";
    errorType?: string;
    screenCount?: number;
  },
): void {
  // Called from export catch blocks: a throw here would replace the user's
  // real error toast.
  try {
    trackDesignRelay(
      "design_exported",
      {
        ...(facts.designId ? { output_id: facts.designId } : {}),
        output_type: "design",
        export_format: exportFormat,
        render_location: "browser",
        status: facts.status,
        ...(facts.errorType ? { error_type: facts.errorType } : {}),
        ...(facts.screenCount !== undefined
          ? { screen_count: facts.screenCount }
          : {}),
      },
      { signedIn: facts.signedIn },
    );
  } catch {
    // coercion-ok: a failed analytics send must never surface to the user.
  }
}

const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

/**
 * The export error classes all carry a short enum `code`; anything else is
 * reported generically so free-form messages never reach analytics.
 */
export function browserDesignExportErrorType(error: unknown): string {
  try {
    if (error && typeof error === "object") {
      if ((error as { name?: unknown }).name === "AbortError") {
        return "cancelled";
      }
      const code = (error as { code?: unknown }).code;
      if (typeof code === "string" && ERROR_CODE_PATTERN.test(code)) {
        return code.replace(/-/g, "_");
      }
    }
  } catch {
    // coercion-ok: an unreadable error is still reported, as the generic type.
  }
  return "export_error";
}
