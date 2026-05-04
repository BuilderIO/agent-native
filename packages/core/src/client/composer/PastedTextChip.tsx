import { useCallback, useEffect, useState } from "react";
import { IconClipboardText, IconX } from "@tabler/icons-react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { Attachment } from "@assistant-ui/react";
import { cn } from "../utils.js";
import { countLines, unwrapAttachmentEnvelope } from "./pasted-text.js";

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
  /** Compact variant rendered inside sent user messages. */
  compact?: boolean;
}

export function PastedTextChip({
  attachment,
  onRemove,
  compact = false,
}: PastedTextChipProps) {
  const [open, setOpen] = useState(false);
  const { text, lines, chars } = usePastedAttachmentText(attachment);

  const handleRemove = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onRemove?.(attachment.id);
    },
    [attachment.id, onRemove],
  );

  const summary = lines > 0 ? `${lines} lines` : `${chars} chars`;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className={cn(
            "group relative inline-flex items-center gap-2 rounded-md border border-border/70 bg-muted/50 text-left text-foreground hover:bg-muted/70 cursor-pointer",
            compact
              ? "max-w-[220px] px-2 py-1.5 text-xs"
              : "max-w-[260px] px-2.5 py-2 text-xs",
            onRemove && !compact && "pr-7",
          )}
          aria-label="Preview pasted text"
        >
          <span
            className={cn(
              "flex shrink-0 items-center justify-center rounded bg-background text-muted-foreground",
              compact ? "h-6 w-6" : "h-8 w-8",
            )}
          >
            <IconClipboardText
              className={compact ? "h-3.5 w-3.5" : "h-4 w-4"}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">Pasted text</span>
            <span className="block text-[11px] text-muted-foreground">
              {summary}
            </span>
          </span>
          {onRemove && (
            <span
              role="button"
              tabIndex={-1}
              onClick={handleRemove}
              aria-label="Remove pasted text"
              className={cn(
                "flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground",
                compact ? "" : "absolute right-1.5 top-1.5",
              )}
            >
              <IconX className="h-3 w-3" />
            </span>
          )}
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-[min(560px,calc(100vw-32px))] rounded-lg border border-border bg-popover text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <IconClipboardText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium truncate">Pasted text</span>
              <span className="text-[11px] text-muted-foreground shrink-0">
                {lines} lines · {chars} chars
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close preview"
              className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          </div>
          <pre className="max-h-[60vh] overflow-auto px-3 py-2 text-[12px] leading-[1.5] whitespace-pre-wrap break-words font-mono text-foreground">
            {text}
          </pre>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
