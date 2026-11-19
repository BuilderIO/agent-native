import type { Attachment } from "@assistant-ui/react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { IconClipboardText, IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { cn } from "../utils.js";
import { countLines, unwrapAttachmentEnvelope } from "./pasted-text.js";
import { useComposerRuntimeAdapters } from "./runtime-adapters.js";

function readAttachmentText(attachment: Attachment): Promise<string> | string {
  if ("file" in attachment && attachment.file instanceof File) {
    return attachment.file.text();
  }
  const textPart = attachment.content?.find(
    (p): p is { type: "text"; text: string } =>
      p.type === "text" && "text" in p && typeof p.text === "string",
  );
  return textPart ? unwrapAttachmentEnvelope(textPart.text) : "";
}

function usePastedAttachmentText(attachment: Attachment): {
  text: string;
  lines: number;
  chars: number;
} {
  const [text, setText] = useState("");

  useEffect(() => {
    let cancelled = false;
    const result = readAttachmentText(attachment);
    if (typeof result === "string") {
      setText(result);
      return;
    }
    result
      .then((value) => {
        if (!cancelled) setText(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [attachment]);

  return { text, lines: countLines(text), chars: text.length };
}

export interface PastedTextChipProps {
  attachment: Attachment;
  onRemove?: (id: string) => void;
  compact?: boolean;
}

export function PastedTextChip({
  attachment,
  onRemove,
  compact = false,
}: PastedTextChipProps) {
  const [open, setOpen] = useState(false);
  const { text, lines, chars } = usePastedAttachmentText(attachment);
  const adapters = useComposerRuntimeAdapters();
  const t = adapters.translate!;
  const formatNumber = adapters.formatNumber!;

  const lineSummary = t("agentChat.pastedText.lines", {
    count: lines,
    formattedCount: formatNumber(lines),
    defaultValue: `${lines} lines`,
  });
  const charSummary = t("agentChat.pastedText.characters", {
    count: chars,
    formattedCount: formatNumber(chars),
    defaultValue: `${chars} chars`,
  });
  const summary = lines > 0 ? lineSummary : charSummary;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      {/* Remove stays outside the trigger: a control in a button is unreachable. */}
      <span className="relative inline-flex">
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            className={cn(
              "group relative inline-flex items-center gap-2 rounded-[var(--agent-kit-radius-sm,0.5rem)] border border-border bg-muted/50 text-start text-foreground hover:bg-muted/70 cursor-pointer",
              compact
                ? "max-w-[220px] px-2 py-1.5 text-xs"
                : "max-w-[260px] px-2.5 py-2 text-xs",
              onRemove && "pe-7",
            )}
            aria-label={t("agentChat.pastedText.preview", {
              defaultValue: "Preview pasted text",
            })}
          >
            <span
              className={cn(
                "flex shrink-0 items-center justify-center rounded-[var(--agent-kit-radius-xs,0.25rem)] bg-background text-muted-foreground",
                compact ? "h-6 w-6" : "h-8 w-8",
              )}
            >
              <IconClipboardText
                className={compact ? "h-3.5 w-3.5" : "h-4 w-4"}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">
                {t("agentChat.pastedText.title", {
                  defaultValue: "Pasted text",
                })}
              </span>
              <span className="block agent-kit-caption-copy text-muted-foreground">
                {summary}
              </span>
            </span>
          </button>
        </PopoverPrimitive.Trigger>
        {onRemove && (
          <button
            type="button"
            data-agent-composer-slot="attachment-remove"
            onClick={() => onRemove(attachment.id)}
            aria-label={t("agentChat.pastedText.remove", {
              defaultValue: "Remove pasted text",
            })}
            className={cn(
              // The 20px glyph box keeps the chip's geometry; the pseudo
              // element extends the hit target to 24px.
              "absolute end-1.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[var(--agent-kit-radius-xs,0.25rem)] text-muted-foreground hover:text-foreground after:absolute after:-inset-0.5 after:content-['']",
              compact ? "top-1/2 -translate-y-1/2" : "top-1.5",
            )}
          >
            <IconX className="h-3 w-3" />
          </button>
        )}
      </span>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-[min(560px,calc(100vw-32px))] rounded-[var(--agent-kit-radius-sm,0.5rem)] border border-border bg-popover text-popover-foreground shadow-lg origin-[var(--radix-popover-content-transform-origin)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <IconClipboardText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium truncate">
                {t("agentChat.pastedText.title", {
                  defaultValue: "Pasted text",
                })}
              </span>
              <span className="agent-kit-caption-copy text-muted-foreground shrink-0">
                {lineSummary} · {charSummary}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("agentChat.composer.closePreview", {
                defaultValue: "Close preview",
              })}
              className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[var(--agent-kit-radius-xs,0.25rem)] text-muted-foreground hover:text-foreground"
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          </div>
          <pre className="max-h-[60vh] overflow-auto px-3 py-2 text-xs leading-[1.5] whitespace-pre-wrap break-words font-mono text-foreground">
            {text}
          </pre>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
