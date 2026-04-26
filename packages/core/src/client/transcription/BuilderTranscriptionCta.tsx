/**
 * Lightweight inline CTA that nudges users to connect Builder.io for
 * higher-quality transcription. Renders nothing when Builder is already
 * connected.
 *
 * Drop this next to transcript displays in any template.
 */

import { IconArrowUp } from "@tabler/icons-react";
import { useBuilderStatus } from "../settings/useBuilderStatus.js";

export function BuilderTranscriptionCta() {
  const { status, loading } = useBuilderStatus();

  // Still loading or already connected — render nothing.
  if (loading || status?.configured) return null;

  return (
    <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <IconArrowUp
        size={16}
        className="shrink-0 text-muted-foreground/70"
        aria-hidden="true"
      />
      <span>Connect Builder.io for higher-quality transcription</span>
      <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
        Coming soon
      </span>
    </div>
  );
}
