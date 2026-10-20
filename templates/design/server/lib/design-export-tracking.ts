import {
  isActionContractError,
  type ActionRunContext,
} from "@agent-native/core/action";

import { trackDesign, trackingErrorType } from "./design-tracking.js";

export type DesignServerExportFormat =
  | "html"
  | "zip"
  | "png"
  | "svg"
  | "figma_svg"
  | "coding_handoff";

export interface DesignExportFacts {
  /** Set only once the caller is shown to have access to the design. */
  designId?: string;
  fileCount?: number;
  fileId?: string;
}

/**
 * The one `design_exported` for an export action. The editor's browser
 * exports report their own event; these actions are the server paths (the
 * editor's HTML/ZIP/coding handoff, and agent, MCP or A2A calls), so nothing
 * on the client may emit for them too.
 */
export function trackDesignExported(
  event: DesignExportFacts & {
    exportFormat: DesignServerExportFormat;
    status: "completed" | "failed";
    errorType?: string;
  },
  source?: ActionRunContext,
): void {
  try {
    trackDesign(
      "design_exported",
      {
        ...(event.designId ? { output_id: event.designId } : {}),
        output_type: "design",
        export_format: event.exportFormat,
        render_location: "server",
        status: event.status,
        ...(event.errorType ? { error_type: event.errorType } : {}),
        ...(event.fileCount !== undefined
          ? { file_count: event.fileCount }
          : {}),
        ...(event.fileId ? { file_id: event.fileId } : {}),
      },
      source,
    );
  } catch {
    // coercion-ok: this also runs inside export catch blocks, where a throw would replace the user's real error.
  }
}

export function designExportErrorType(error: unknown): string {
  return isActionContractError(error)
    ? error.errorCode
    : trackingErrorType(error);
}

/**
 * Reports a failed server export, then rethrows the original error unchanged.
 * `run` fills `facts` as it learns them so the failure carries whatever was
 * verified when it threw.
 */
export function withDesignExportFailureTracking<TArgs>(
  exportFormat: DesignServerExportFormat,
) {
  return <TReturn>(
    run: (
      args: TArgs,
      ctx: ActionRunContext | undefined,
      facts: DesignExportFacts,
    ) => Promise<TReturn>,
  ) =>
    async (args: TArgs, ctx?: ActionRunContext): Promise<TReturn> => {
      const facts: DesignExportFacts = {};
      try {
        return await run(args, ctx, facts);
      } catch (error) {
        // Inside its own guard: reading the error must never replace it.
        try {
          trackDesignExported(
            {
              ...facts,
              exportFormat,
              status: "failed",
              errorType: designExportErrorType(error),
            },
            ctx,
          );
        } catch {
          // coercion-ok: losing the failure event must not change the error the caller sees.
        }
        throw error;
      }
    };
}
