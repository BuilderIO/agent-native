import { AsyncLocalStorage } from "node:async_hooks";

import {
  isActionContractError,
  type ActionRunContext,
} from "@agent-native/core/action";
import type { TrackingSource } from "@agent-native/core/tracking";

import { trackSlides } from "./slides-tracking.js";

export type DeckExportFormat = "pptx" | "html" | "pdf" | "google_slides";

export interface DeckExportFacts {
  slideCount?: number;
  generationAttemptId?: string;
}

const pptxBuildForGoogleSlides = new AsyncLocalStorage<true>();

/**
 * Runs the PPTX build behind a Google Slides export. That export reports its
 * own `deck_exported` after the Drive upload, so the build step stays silent.
 * Only the HTTP route sets this; it is deliberately not an action input, so
 * an agent or MCP caller cannot suppress an export it really made.
 */
export function asGoogleSlidesBuildStep<T>(run: () => Promise<T>): Promise<T> {
  return pptxBuildForGoogleSlides.run(true, run);
}

export function inGoogleSlidesBuildStep(): boolean {
  return pptxBuildForGoogleSlides.getStore() === true;
}

export function trackDeckExported(
  event: DeckExportFacts & {
    deckId?: string;
    exportFormat: DeckExportFormat;
    renderLocation: "server" | "browser";
    status: "completed" | "failed";
    errorType?: string;
  },
  source?: TrackingSource,
): void {
  if (
    event.exportFormat === "pptx" &&
    event.renderLocation === "server" &&
    inGoogleSlidesBuildStep()
  ) {
    return;
  }
  trackSlides(
    "deck_exported",
    {
      ...(event.deckId ? { output_id: event.deckId } : {}),
      output_type: "deck",
      export_format: event.exportFormat,
      render_location: event.renderLocation,
      status: event.status,
      ...(event.errorType ? { error_type: event.errorType } : {}),
      ...(event.slideCount !== undefined
        ? { slide_count: event.slideCount }
        : {}),
      ...(event.generationAttemptId
        ? { generation_attempt_id: event.generationAttemptId }
        : {}),
    },
    source,
  );
}

export function exportErrorType(error: unknown): string {
  return isActionContractError(error) ? error.errorCode : "export_error";
}

/**
 * Reports a failed server export, then rethrows. `run` fills `facts` as it
 * learns them so the failure carries whatever was known when it threw.
 */
export function withExportFailureTracking<TArgs extends { deckId: string }>(
  exportFormat: "pptx" | "html",
) {
  return <TReturn>(
    run: (
      args: TArgs,
      ctx: ActionRunContext | undefined,
      facts: DeckExportFacts,
    ) => Promise<TReturn>,
  ) =>
    async (args: TArgs, ctx?: ActionRunContext): Promise<TReturn> => {
      const facts: DeckExportFacts = {};
      try {
        return await run(args, ctx, facts);
      } catch (error) {
        trackDeckExported(
          {
            ...facts,
            deckId: args.deckId,
            exportFormat,
            renderLocation: "server",
            status: "failed",
            errorType: exportErrorType(error),
          },
          ctx,
        );
        throw error;
      }
    };
}
