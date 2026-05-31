import { useState } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { StandalonePick } from "@/hooks/use-variant-flow";

interface VariantHandoffCardProps {
  pick: StandalonePick;
  onDismiss: () => void;
}

/**
 * Shown after a pick when the editor was opened from a link-only host (CLI /
 * Codex / Claude Code) that can't relay the choice over a chat bridge. The
 * summary is already on the clipboard; this makes the next step obvious and
 * lets the user re-copy or select it by hand.
 */
export function VariantHandoffCard({
  pick,
  onDismiss,
}: VariantHandoffCardProps) {
  const [copied, setCopied] = useState(true);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pick.text);
      setCopied(true);
      toast.success("Summary copied");
    } catch {
      setCopied(false);
      toast.info("Select the summary to copy it");
    }
  };

  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg">
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary">
            <IconCheck className="h-3.5 w-3.5 text-primary-foreground" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium leading-tight">
              Direction selected
            </div>
            <div className="truncate text-xs text-muted-foreground">
              “{pick.label}”
            </div>
          </div>
        </div>

        <p className="mt-3 text-sm text-muted-foreground">
          Paste this summary into your coding agent to continue from this
          direction.
        </p>

        <Textarea
          readOnly
          value={pick.text}
          className="mt-3 h-28 resize-none border-border/70 bg-muted/40 font-mono text-[11px] leading-relaxed"
          onFocus={(event) => event.currentTarget.select()}
        />

        <div className="mt-3 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="cursor-pointer"
            onClick={onDismiss}
          >
            Dismiss
          </Button>
          <Button size="sm" className="cursor-pointer gap-1.5" onClick={copy}>
            {copied ? (
              <IconCheck className="h-3.5 w-3.5" />
            ) : (
              <IconCopy className="h-3.5 w-3.5" />
            )}
            {copied ? "Copied" : "Copy summary"}
          </Button>
        </div>
      </div>
    </div>
  );
}
