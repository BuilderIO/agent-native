/**
 * Lightweight inline CTA that nudges users to connect Builder.io for
 * higher-quality transcription. Renders nothing when Builder is already
 * connected.
 *
 * Drop this next to transcript displays in any template.
 */

import { IconBolt, IconLoader2 } from "@tabler/icons-react";

import { BuilderConnectPopover } from "../settings/BuilderConnectPopover.js";
import { useBuilderConnectFlow } from "../settings/useBuilderStatus.js";

export function BuilderTranscriptionCta() {
  const flow = useBuilderConnectFlow({
    provisionAccount: true,
    trackingSource: "builder_transcription_cta",
    trackingFlow: "transcription",
  });
  const configured = flow.statusResolved
    ? flow.configured || flow.envManaged
    : null;
  const statusUnavailable = flow.hasFetchedStatus && !flow.statusResolved;

  // Keep a retry path visible after an unreadable status response.
  if (configured || (configured === null && !statusUnavailable)) return null;

  return (
    <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <IconBolt
        size={14}
        className="shrink-0 text-muted-foreground/70"
        aria-hidden="true"
      />
      <span className="flex-1">
        {flow.connecting
          ? "Waiting for Builder.io…"
          : statusUnavailable
            ? "Builder status unavailable. Try again."
            : "Connect Builder.io for higher-quality transcription — free credits, no API key needed."}
      </span>
      {flow.error && (
        <span className="text-destructive text-[10px]">{flow.error}</span>
      )}
      {flow.connecting ? (
        <IconLoader2 size={12} className="shrink-0 animate-spin" />
      ) : (
        <BuilderConnectPopover flow={flow}>
          <button
            type="button"
            disabled={flow.connecting}
            className="ml-auto shrink-0 inline-flex items-center gap-1 rounded bg-foreground px-2 py-1 text-[10px] font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          >
            {statusUnavailable || flow.error ? "Retry" : "Connect"}
          </button>
        </BuilderConnectPopover>
      )}
    </div>
  );
}
